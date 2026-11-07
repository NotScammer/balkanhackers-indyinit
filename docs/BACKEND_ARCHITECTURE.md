# Backend architecture (Developer B)

This contract supersedes conflicting sections of the original README. The backend uses Next.js App Router on Node.js, Supabase PostgreSQL, Claude for structured dynamic questions/private evaluation, and OpenAI Realtime over browser WebRTC. No question bank, code execution, Python service, websocket proxy, or worker deployment is used.

## Ownership and entry points

- `src/app/api/`: thin HTTP route handlers.
- `src/server/`: server-only providers, authorization, interview state, research, persistence.
- `src/shared/contracts.ts` and `schemas.ts`: coordinated frontend/backend types and validation. Developer B owns the initial contract; both developers must review subsequent changes.
- `supabase/migrations/`: versioned database DDL, constraints and atomic RPCs.
- `tests/`: provider-mocked tests using embedded PostgreSQL (PGlite), including executing both migrations.
- `src/app/{page.tsx,layout.tsx,globals.css}`: minimal **frontend-owned placeholders**, created only because the repository had no app. Developer A can replace them. Root package/configuration files scaffold the shared app.

See [Frontend integration](FRONTEND_INTEGRATION.md) and [Setup](SETUP.md).

## Interview lifecycle

1. Validate catalog combination and difficulty, consume database-backed creation budgets, select the latest relevant evidence-backed forecasts.
2. Claude generates one original verbal question. Zod validates structure, kind, difficulty and evidence references. The server rejects repeated wording and explicit code-writing prompts. Behavioral questions do not force research citations. Model instructions establish role relevance; semantic quality still needs demo review.
3. Atomically persist the session and first question before returning the one-time capability token.
4. Every private request authorizes against the stored SHA-256 token hash with a timing-safe comparison and enforces expiry. Session IDs grant no access. Tokens never appear in URLs or logs.
5. A completed transcript claims a database processing lease **before** any model call. The private evaluator checks the saved rubric, exact transcript quotes, scores and assessment context. TypeScript computes `round(content*.60 + structure*.25 + relevance*.15)`.
6. Save the evaluation checkpoint before generating a next question. The adaptive engine bounds follow-up depth (one), remaining turns and mixed coverage. With three turns, mixed sessions cover behavioral → technical → system design and therefore have no spare turn for a follow-up.
7. Save the next-question checkpoint; an atomic database transaction inserts it, advances the session and persists the exact public response. After turn three, that transaction stores the deterministic report instead. Its score is the rounded mean of saved answer scores. Category means are calculated separately.
8. Active retrieval and turn completion return explicit public projections. Evaluations, weaknesses, expected concepts and assessment guidance are never in active responses. Completed reports expose coaching evaluations; provider prompts and internal adaptive reasoning remain private.

The catalog exposes Google, OpenAI, Anthropic, NVIDIA and Microsoft as practice contexts, and Software Engineer only. All four modes are implemented; starting requires at least one matching forecast in the configured data mode. Catalog availability describes supported combinations rather than guaranteeing research/provider readiness. Product Manager is intentionally not advertised with an engineering rubric.

## Transactions, concurrency and recovery

PostgreSQL is authoritative. `claim_answer` locks the session, checks active question/consent/expiry, detects payload conflicts, and inserts a unique answer per `(session_id, client_answer_id)` and `(session_id, question_id)`. Questions have a unique `(session_id, turn_index)` constraint. The stable payload hash covers question ID, normalized transcript, input mode and optional duration.

The answer lease is 180 seconds with a random fencing token. A live lease returns retryable HTTP 409. Failed attempts release the lease immediately; stale leases can be reclaimed with the **same** answer ID/payload, up to four attempts. Another client answer ID cannot replace an already claimed answer to that question. The lease token prevents an old request from checkpointing or finalizing after reclamation. Session locking and conditional checks prevent two advances. Ending during processing returns 409. Ending early otherwise cancels the session without a report.

A successful replay returns the persisted response without contacting the model. An evaluation checkpoint survives generation failures, and a next-question checkpoint survives finalization failures. A crash **between external provider success and database checkpoint commit** can require another external call: no transaction spans a model provider and PostgreSQL. Provider billing cannot be guaranteed exactly once at that boundary. Persisted successful evaluations and progression are reused and do not duplicate. Provider network failures have no automatic SDK retries; invalid structured output gets at most one repair attempt. Invalid quotes/provenance cause a retryable failure without accepting feedback.

Session creation does not currently have its own idempotency key. If the initial response is lost, its token cannot be recovered; create a new session. The orphan expires and is eligible for cleanup. Do not retry creation in a loop.

## Rubrics and model boundaries

`config.ts` versions the provisional weights and interpretations for `behavioral-v1`, `technical-v1`, and `system-design-v1`. Scores are coaching estimates, not hiring probabilities or validated comparisons. Assess the confirmed transcript, accept correct alternatives, and never penalize accents, transcription artifacts or typed fallback. Do not infer whether a personal experience was fabricated.

The Anthropic Messages SDK uses `output_config.format` via `zodOutputFormat`; original Zod constraints are revalidated locally. All model IDs must be configured. Candidate answers and fetched research are explicitly untrusted prompt data. AI output is validated before it controls state or cites evidence. These checks reduce injection risk; they do not make model interpretation infallible.

Realtime receives only the public approved question and voice-reader instructions. Its semantic VAD has `create_response:false` and low eagerness. The browser controls speaking and answer confirmation. Realtime cannot change saved questions or grading. A direct browser credential allows the browser to modify voice settings/instructions, and model speech is not an absolute authority boundary. Do not put hidden grading data into Realtime.

## Database and privacy

All core research/interview tables have foreign keys, useful indexes and relevant checks. RLS is enabled on every table, with no anonymous/authenticated table policies or RPC grants. The service role accesses data exclusively from `server-only` modules. RPCs run with caller privileges and are restricted to `service_role`. Never send the service key to the browser.

Only SHA-256 capability hashes are stored. All private responses are non-cacheable. The authorization abstraction can later validate Supabase Auth subjects instead of capabilities without making tables public. No raw audio or full-paper documents are persisted; transcripts, metadata, original summaries and evidence excerpts are persisted.

Sessions expire after 24 hours immediately for access purposes. Explicit DELETE cascades through questions, answers, evaluations and reports. Expired rows are deleted when the protected monthly research route invokes `cleanup_expired`, or when an administrator runs that RPC. This is **not** deletion precisely at 24 hours; a deployed/working cron is required for eventual cleanup, and hard failures before cleanup can delay it. Provider retention is separate from app deletion.

Creation is limited to 100 globally per rolling 24-hour bucket (configurable) and 10 per IP/hour on Vercel. Elsewhere a shared local bucket is used; untrusted forwarded headers are ignored. Realtime issuance is limited to six/session/hour and 100 globally/day. Answer attempts, transcript size (10,000 characters), request size (64 KiB), provider timeouts (25 seconds Claude, 15 seconds Realtime), output tokens and question counts bound costs. Set provider spending limits too. Ephemeral OpenAI secrets can open more than one connection during their TTL; issuance rate limits cannot enforce per-connection audio spend. Rehearse behind Vercel deployment protection and configure OpenAI project budgets before sharing widely.

## Monthly research and forecasting

One protected Vercel route runs at `0 9 1 * *` (first of the month, 09:00 UTC). Cron requests require `Authorization: Bearer <CRON_SECRET>`. A database advisory transaction and unique running-row constraint acquire a 240-second lease. A second scan gets 409. Expired runs become partial on the next invocation; the next window starts three days before the last **successful** scan's end, or 33 days ago initially. Partial runs do not advance that watermark.

Conservative per-run caps: 20 industry sources (up to 12 Tavily search results across three organizations, plus official items), 60 arXiv + 40 OpenAlex metadata records before deduplication, and up to five selected full-paper analyses. The 210-second total deadline and per-request limits take precedence. Stages stop starting work with fewer than 30 seconds left. Results persist incrementally; final metrics/status/errors accurately distinguish success, partial and failed. Hard termination may leave unfinished metrics until lease recovery. Vercel does not automatically retry a failed cron; invoke the protected endpoint manually if needed.

Industry monitors OpenAI, Anthropic and NVIDIA via official feeds/news and optional Tavily news search. Dates must be in the window; canonical URLs deduplicate. Robots rules and bounded request rates govern official HTML retrieval. Missing/failed robots retrieval skips the page. Redirects are rejected rather than followed to untrusted hosts. Search snippets are marked secondary, never automatically scraped. Exact evidence excerpts must occur in retrieved text; speculation is excluded and secondary reports are labeled unverified. Site markup/access may change and must be checked in deployment.

Academic discovery parses arXiv Atom and OpenAlex JSON. Stable arXiv IDs (without version), DOI and OpenAlex identifiers deduplicate. Only actual OpenAlex affiliation records identify MIT/Stanford/CMU; arXiv categories imply no university. Preprint status is retained conservatively. One bounded arXiv API request avoids bursts. Accessible arXiv HTML, robots permitting and with at least 3.1 seconds between same-origin requests, supplies selected fulltext excerpts. PDF-only/restricted papers get **abstract-only** analyses with an explicit limitation. There is no PDF download/extraction fallback in this MVP. Fulltext excerpts are bounded at 45,000 characters, and analyses disclose possible truncation. Originals are not stored or redistributed.

AI groups normalized concepts and produces hypotheses with validated source references and supporting/contradicting relations. Each forecast and its evidence are saved atomically. Monthly rows preserve history; interview retrieval takes the newest per topic and stores the exact forecast/evidence snapshot with the question. Preparation priority weights are industry momentum 25%, academic momentum 20%, role relevance 30%, technical maturity 15%, recency 10% (`preparation-v1`). Momentum counts evidence/organizations, recency decays deterministically, and validated AI role/maturity judgments supply two dimensions. Weights are provisional heuristics, not calibrated probabilities. Confidence is a separate weak/moderate/strong evidence label based on publisher diversity, branch support and contradictions. Strong confidence is still not an independently validated scientific assessment.

## Demo and verification boundaries

`npm run seed` retrieves real metadata for two cited older papers and stores original preparation hypotheses, clearly described as older source-backed seeds rather than fresh trend discoveries. `npm run seed -- --illustrative` loads an unmistakably synthetic fixture with `example.invalid` provenance. Enable `RESEARCH_DATA_MODE=illustrative` intentionally to use it; verified mode cannot select it. Dynamic question/evaluation calls still use Claude in both modes. There is no production mock AI adapter or fabricated success after provider failure.

Automated tests mock external providers while running the actual SQL migrations and state functions. They do not establish live Supabase connectivity, provider account model access, browser microphone behavior or actual Vercel scheduling. Apply migrations, configure keys and complete the deployment walkthrough in [SETUP.md](SETUP.md).

## Verified implementation references

- [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [OpenAI Realtime client secrets](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)
- [OpenAI Realtime](https://developers.openai.com/api/docs/guides/realtime)
- [arXiv API manual](https://info.arxiv.org/help/api/user-manual.html)
- [OpenAlex filters](https://help.openalex.org/api/filtering/) and [authentication](https://help.openalex.org/api/authentication/)
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Vercel execution limits](https://vercel.com/docs/functions/limitations)
