# Frontend integration notes

The initial repository contained only README.md; no AGENTS.md or CLAUDE.md was present. This implementation owns the frontend only. No API route handlers, server providers, shared contracts, or backend files were added.

## Run

Use Node.js 20.9 or newer. Install with `npm ci`, copy `.env.example` to `.env.local`, then run `npm run dev`. The example explicitly enables fixture mode. Set `NEXT_PUBLIC_USE_MOCK_API=false` and restart/rebuild to use the real same-origin API. Real mode never silently falls back to fixtures.

## Contract boundary

`src/lib/client/contracts.ts` mirrors README section 6 locally because the backend/shared directory does not exist yet. Replace those local definitions with imports from the coordinated shared contract once the backend owner provides it. `src/lib/client/api.ts` is the only network adapter. Tokens stay in per-tab session storage, separate for real and fixture sessions, and never enter URLs. Fixture sessions and answer drafts are local to the browser tab. Fixture scores are fixed illustrative data, not an evaluation algorithm.

Setup uses the catalog's supported combinations. The first complete curated path is Google / Software Engineer; Product Manager and other companies are intentionally unavailable until backend catalog coverage exists. Mixed mode uses behavioral, technical, then system design. The report displays backend scores without recalculating them.

## Backend handoff

Implement the README `/api/v1` catalog, creation, resume, answer, report, speech, transcription, and deletion endpoints with the exact response fields. Supply server-enforced session capabilities and expiry, persistent question order, deduplication by clientAnswerId, and immutable reports. Supply consent enforcement, upload format validation, duration/size enforcement, raw-audio disposal, and retention cleanup. Browser recording detects WebM/Opus, MP4, WebM, and Ogg/Opus; confirm the allowlist with the backend and demo browser. Speech responses must carry the actual audio MIME type. Private responses must not be cached. Rate limits should return Retry-After.

Evaluation failures preserve and freeze the original submitted payload, including its UUID, for safe retries. Use reload saved state to reconcile an out-of-order or ambiguously completed request. Answer editing is available before the first submission. Audio consent is fixed at session creation; start a new session to change it. Live requests time out after 90 seconds and never automatically resubmit answers. Audio is held only in memory for transcription retries and is lost on refresh; transcript drafts survive refresh in the tab.

## Verification limits

Real AI/audio end-to-end integration and deployed retention cannot be verified until the backend is supplied. Test microphone permission denial, format support, recording time limits, actual audio playback, transcript corrections, keyboard navigation, and narrow layouts in the intended demo browser. No deployed provider handling or automatic deletion is claimed by the frontend.

## Checks completed

- TypeScript and ESLint passed.
- Eight automated tests passed: all four three-answer fixture modes, exact mixed ordering and limits, stable-ID retry deduplication, immutable saved reports, capability access, deletion, authenticated API request payloads, multipart transcription format, and structured rate-limit recovery.
- Browser verified mixed-mode setup, unavailable speech fallback, all three typed answers with explicit confirmation, feedback between questions, the results route, and saved report refresh.
- Actual microphone capture, provider transcription/synthesis, real scoring, and mobile browser interaction remain unverified. API adapter tests intercept fetch; they do not prove a running backend integration.
- Dependency audit: eight moderate development-tooling findings through eslint-config-next / TypeScript ESLint / minimatch; zero production dependency findings. Do not apply the suggested framework downgrade automatically.
- The development server generated the root AGENTS.md; its local Next.js guidance was read before subsequent changes.
