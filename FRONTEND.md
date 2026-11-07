# Current frontend

Google sign-in is now required through Supabase OAuth. Guest/account-preview entry has been replaced with a real sign-in flow and ownership checks. See [OAuth setup](docs/OAUTH_SETUP.md); it supersedes the guest-access descriptions in the historical notes below.

Real API sessions now open the live conversation screen: continuous microphone audio with mute/end/disconnect controls, interruptible interviewer speech, partial transcripts, automatic progression, clarification, deeper follow-ups, coaching notes, transcript corrections and a final grouped report. The live conversation interface is now the only product flow. Recording, manual transcription and transcript-confirmation steps have been removed; fixtures remain only for isolated tests. See [docs/LIVE_INTERVIEW.md](docs/LIVE_INTERVIEW.md) for setup, contracts and verification limits.

The notes below describe the earlier recorded-answer interface and remain as history.

# Frontend handoff

The frontend now uses an avatar-free, voice-only interview interface. The latest user direction replaces the earlier notebook design and typed-answer UI. No backend files or shared API contracts were changed.

## Experience

A plain dark conversation screen shows the current question and a single microphone control. Questions can be spoken aloud; answers are recorded, played back locally, explicitly transcribed, then confirmed before evaluation. There are no answer textareas, typed-answer switches, notebook layouts, or avatars. Transcripts are read-only; re-record to correct an answer. Follow-up responses also use recording. Clarification uses a one-click request and a spoken explanation in fixture mode.

All four interview modes and three scored turns remain intact. A follow-up stays within the current turn. Guest entry and clearly labeled email account previews remain available. Account previews do not send email or create accounts. Setup choices survive navigation; session links remain capability-protected and do not require login.

## Audio integration

`NEXT_PUBLIC_USE_MOCK_API=true` selects labeled fixtures. In this mode, browser speech synthesis reads curated questions and scripted dialogue aloud. Browser speech is a preview and is not evidence of working server audio. Fixture transcription deliberately fails with a useful integration message; it never invents a candidate transcript. A complete spoken interview therefore needs the real transcription API.

Set `NEXT_PUBLIC_USE_MOCK_API=false` and restart/rebuild to use the existing same-origin `/api/v1` endpoints. Live question audio uses the documented speech endpoint. Recording is enabled only after audio-processing consent and explicit microphone interaction. Unsupported recording, permission denial, stalled permission requests, playback errors, and transcription failures offer retry/cancellation/re-recording. There is no typed fallback by current user request.

Raw recordings stay in memory with revocable playback URLs until explicitly uploaded for transcription. Stopping recording never submits an answer. Pending submissions retain their original UUID and payload for safe retries. Draft transcripts and unread feedback survive refresh; raw audio does not. Time limits are resolved from the saved question and shared across accepted original/follow-up recordings. The backend must independently enforce consent, formats, duration, upload size, retention, and deletion.

The microphone meter uses real audio analysis. No avatar or simulated listening animation is shown. Question playback stops before recording; candidate playback stops before interviewer speech.

## Dialogue proposal: not enabled in real mode

`src/lib/client/dialogue-contract.ts` is an additive frontend proposal, not an agreed shared contract. `dialogueEnabled` remains fixture-only. No public environment flag enables an unsupported real route.

Proposed authenticated route: `POST /api/v1/sessions/:sessionId/dialogue`, with `{ questionId, clientRequestId, kind: 'clarification' | 'follow_up', candidateText }`. Return `{ id, questionId, questionKind, kind, text }`. Persist and deduplicate interactions. Enforce one clarification per question and one optional follow-up per session, matching the saved question kind. These interactions must not advance questions or trigger scoring.

Proposed additive answer fields: `{ baseTranscript, dialogueContext: [{ interactionId, responseTranscript? }] }`. The existing transcript contains only the complete user-confirmed candidate text. Interviewer prompts are obtained from persisted IDs, never inserted as candidate speech. Declining a follow-up omits its response. Keep the complete transcript below 10,000 characters and evaluate once. Resume support must return saved interactions and follow-up availability before live integration is enabled. The backend owner must agree and implement this proposal, including spoken dialogue support; the current speech endpoint supports saved questions only.

## Verification and remaining work

Lint, TypeScript, 21 automated tests, and production build pass. Existing tests cover the unchanged text/voice-compatible API contract, modes and ordering, deduplication, reports, capability access, account-preview boundaries, transcript evidence, feedback recovery, dialogue limits and failure, and microphone denial/timeout/late-stream cleanup.

Browser verified the new consent-based setup, voice-only screen, microphone control, absence of typed answer fields, dark layout, and browser question speech entering its speaking state. The prior browser pass verified the three-turn report/feedback flow and narrow layout. Actual microphone capture, transcription, live scoring, and a complete real spoken session remain unverified until the backend audio providers are available. Real authentication and guest-to-account migration are separate integration work.

Run: `npm ci`, copy `.env.example` to `.env.local`, and `npm run dev`. No dependencies were added for this change. The generated Next.js environment declarations may change between development and production builds; avoid committing incidental changes to them.

## Merged backend

The live recording, per-turn feedback and refresh recovery endpoints are now implemented. Follow the README deployment section. Full microphone and provider verification remains pending deployment credentials.
