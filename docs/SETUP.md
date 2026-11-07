# Backend setup and deployment

## Local setup

Use Node.js 22.12+ (Node 24 was used for implementation) and npm.

```sh
npm ci
cp .env.example .env.local
# Fill .env.local as described below. Never commit it.
npm run dev
```

Only the public catalog and setup interface work without configuration. Private API operations fail with `NOT_CONFIGURED` until the server environment is valid. No secrets are needed for tests or builds.

| Variable | Get it from / feature |
| --- | --- |
| `SUPABASE_URL` | Supabase project → Settings/API → project URL; all private data |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project API keys → server service-role key; server only, bypasses RLS |
| `ANTHROPIC_API_KEY` | [Claude Console](https://platform.claude.com/) API keys; questions, evaluations and research analysis |
| `ANTHROPIC_MODEL` | A model available to your account supporting [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs); explicit ID required, no hardcoded default |
| `OPENAI_API_KEY` | [OpenAI project API keys](https://platform.openai.com/api-keys); speech, transcription and optional Realtime voice |
| `OPENAI_REALTIME_MODEL` | Supported [Realtime model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1), e.g. `gpt-realtime-2.1` if available to your project; verify access |
| `OPENAI_TRANSCRIPTION_MODEL` | Supported input transcription model from the [Realtime reference](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create); explicit account-supported ID required |
| `TAVILY_API_KEY` | [Tavily dashboard](https://app.tavily.com/); optional targeted industry search; official sources still run without it |
| `OPENALEX_API_KEY` | [OpenAlex settings](https://openalex.org/settings/api); optional OpenAlex branch; arXiv still runs without it |
| `CRON_SECRET` | Generate random 32+ character secret; required for the monthly/manual research endpoint |
| `RATE_LIMIT_SALT` | Independent random 32+ character secret; required to hash IP rate keys |
| `RESEARCH_DATA_MODE` | `verified` by default; deliberately set `illustrative` for synthetic fixtures |
| `RESEARCH_CONTACT_EMAIL` | Optional valid contact email for arXiv User-Agent |
| `RESEARCH_DEADLINE_SECONDS` | 30–210, default 210; keep below the deployed route duration with saving margin |
| `SESSION_DAILY_LIMIT` | Global rolling 24-hour creation budget, default 100 |
| `NEXT_PUBLIC_USE_MOCK_API` | Frontend coordination flag, false by default; it does not enable backend mock AI |

Generate two independent secrets with `openssl rand -hex 32` (once for each variable). Store them in `.env.local` and Vercel environment settings, never in source or browser variables. Don't use `NEXT_PUBLIC_` for provider/database keys. Model availability and provider retention must be reviewed for the configured accounts. Set provider project spend limits.

## Supabase migrations

These files are **not automatically applied** by Next.js. No deployed Supabase database was connected during implementation.

SQL Editor method:

1. Create a Supabase project and open its SQL Editor as an administrator.
2. Run **all** of `supabase/migrations/202611070001_backend.sql` once.
3. Run **all** of `supabase/migrations/202611070002_research_persistence.sql` once.
4. Run **all** of `supabase/migrations/202611070003_live_conversation.sql` once.
5. Confirm all three transactions succeeded. Run the read-only verification queries below.

Supabase CLI method (install the CLI separately using its official instructions):

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase migration list
```

The SQL is versioned and transactional, not intended for repeated copy/paste over an existing migration. The CLI tracks migration versions. Never run migrations against a teammate's unrelated project.

Verification in SQL Editor:

```sql
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename in
('interview_sessions','session_questions','interview_answers','answer_evaluations','session_reports');

select routine_name from information_schema.routines
where routine_schema='public' and routine_name in
('create_interview','claim_answer','checkpoint_answer','finish_answer','save_forecast','acquire_research_run');

select has_table_privilege('anon','public.interview_sessions','select') as anon_can_read,
       has_function_privilege('anon','public.interview_snapshot(uuid)','execute') as anon_can_call;
-- Both privilege checks should be false.
```

Check that the API uses the **service role**, and never add unrestricted browser policies to fix permission errors. Tests execute the same SQL in PGlite with Supabase-style roles; this does not prove your hosted project's setup.

## Seed the first interview

With configured Supabase credentials and applied migrations:

```sh
npm run seed
```

This fetches current arXiv metadata in one request for [PagedAttention](https://arxiv.org/abs/2309.06180) and [Mamba](https://arxiv.org/abs/2312.00752). It stores actual metadata and two original, weak-confidence preparation hypotheses. They are older seed papers, not claims of newly published research, company endorsement or actual interview questions. A failed fetch never silently substitutes fixtures. Repeated seeding appends forecast history while source/paper records deduplicate.

For offline research integration only:

```sh
npm run seed -- --illustrative
# Set RESEARCH_DATA_MODE=illustrative in .env.local, then restart Next.js.
```

This still requires Supabase and Claude. It uses a synthetic, explicitly labeled source with no fabricated real citations. Restore `RESEARCH_DATA_MODE=verified` for the real-data demo. With no matching forecasts, starting returns `RESEARCH_DATA_UNAVAILABLE`.

## Run checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke # briefly serves the production build on localhost:3107
```

Local verification passed: 35 tests, TypeScript checks, lint, production build and the production HTTP smoke test. The dependency audit reported zero vulnerabilities after a patched development dependency override.

Tests use no paid APIs or external database. They execute migrations and verify auth, hashing, expiry, idempotency/concurrency, scoring, privacy, reports, state recovery, source parsing, evidence validation, forecasting and cron locks/policies. Model quality and browser audio still require a walkthrough with live accounts.

## Manual research trigger

Load `CRON_SECRET` into your shell without printing it; then use the protected endpoint:

```sh
curl --fail-with-body -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/monthly-research
```

The same path works on your deployed origin. Unauthorized requests are rejected. `partial` means some work persisted but sources/deadline/AI errors prevented a complete scan. `failed` returns 503. Inspect `research_runs` for sanitized error codes and processed counts. A concurrent invocation gets 409. After hard termination, wait for the 240-second lease to expire before retrying. Retries retain the last-success watermark and source deduplication; historical forecasts may still be appended. Failed Vercel cron calls are **not automatically retried**.

To delete expired local/hosted data manually as an administrator:

```sql
select public.cleanup_expired();
```

Immediate access expiry is implemented. Eventual cleanup runs at the beginning of the configured monthly scan, not precisely at 24 hours. Confirm a successful deployed invocation before claiming automatic deletion works.

## Vercel

1. Import this repository/branch as a Next.js project and choose a compatible Node.js runtime (22 or 24). Use npm; the lockfile is included.
2. Set required variables in Vercel Project Settings → Environment Variables. Give Preview and Production the correct separate database/keys. Redeploy after environment changes.
3. Enable **Fluid compute** and verify your plan supports `maxDuration=180` on interview handlers and `maxDuration=240` on research. The [current limits documentation](https://vercel.com/docs/functions/limitations) lists 300 seconds maximum on Hobby with Fluid compute; legacy non-Fluid Hobby is limited to 60 seconds. Actual project plan/runtime settings were not accessible here and must be verified in the dashboard. Lower the research deadline/budgets if your deployment is more constrained; do not assume a large monthly scan always fits.
4. `vercel.json` declares exactly one monthly cron: first day of month at 09:00 UTC. Set `CRON_SECRET`; Vercel sends the corresponding Bearer header. Verify the production cron configuration and invocation logs after deployment. Preview deploys are for manual testing; do not assume scheduled production jobs run in previews.
5. Keep deployment protection enabled during the walkthrough. Configure provider spend limits and review privacy/consent copy before sharing with candidates.
6. Apply migrations and run the verified seed before the first interview. Deploying the app does neither.

## Live-account walkthrough remaining

- [ ] Apply/verify all three hosted migrations and server role grants.
- [ ] Load actual metadata through the verified seed; confirm `dataMode: verified` in creation.
- [ ] Complete three typed turns using live Claude, check persisted questions/evaluations and final arithmetic.
- [ ] Retry one successful answer with the same payload; confirm unchanged result and no additional model call.
- [ ] Test cross-session token rejection and deletion against hosted Supabase.
- [ ] Obtain temporary Realtime credentials, verify WebRTC/transcription model access and browser consent handling with Developer A.
- [ ] Test microphone denial, interruption, transcript correction and disconnect recovery on the actual demo browser.
- [ ] Invoke monthly research, inspect actual source coverage and run metrics; verify plan duration/production cron.
- [ ] Confirm provider budget and retention settings. No live provider, hosted migration or deployed cron success is claimed by local automated checks.

The integrated recording UI also requires `OPENAI_TTS_MODEL` and `OPENAI_TTS_VOICE` (blank defaults to `alloy`). See the [official OpenAI audio API](https://developers.openai.com/api/reference/typescript/resources/audio). Rebuild after changing the public mock flag.

For the live voice frontend, follow [LIVE_INTERVIEW.md](LIVE_INTERVIEW.md). The Realtime and transcription model settings are required for live audio; separate TTS settings are optional legacy recorded-mode settings.
