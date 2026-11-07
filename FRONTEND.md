# Frontend handoff

The `frontend` branch implements the practice notebook design, working guest entry, account previews, guided interview interactions, and scripted dialogue fixtures. No backend routes, server providers, shared contracts, scoring logic, or credentials were added.

## Run and modes

Use `npm ci`, copy `.env.example` to `.env.local`, then `npm run dev`. `NEXT_PUBLIC_USE_MOCK_API=true` selects clearly labeled fixtures. Set it to `false` and restart/rebuild to use the existing same-origin `/api/v1` client. Real mode never falls back to fixture scores or dialogue. All four modes remain supported by catalog availability; mixed order is behavioral, technical, system design. Exactly three answers are evaluated.

`/login` supports guest continuation and an email account preview. It sends no email, creates no authenticated identity, and stores no email. Return destinations are restricted to local interview/report routes. Existing capability links do not require login. Setup and input preferences survive account navigation in the same tab. Account sign-in, history, and guest-to-account migration require a separate coordinated backend milestone.

## Interview and audio

The controller uses an explicit interview state model, with separate setup, feedback, report, conversation, and recording views/helpers. Tokens remain in session storage, separate for fixture and real sessions. Drafts and immutable pending payloads survive refresh. Unread feedback is reconstructed from saved answers before the next question is shown; advancing acknowledges it without another evaluation.

Recording begins only after a user action and session consent. A local five-second microphone check uploads and retains no audio. Permission requests can be cancelled and time out after 15 seconds; late streams are stopped. Recordings are held only in memory with revocable local playback URLs. Stopping recording does not transcribe it. Explicit transcription uploads the selected recording, then requires transcript review and confirmation before scoring. Recording, playback, timers, tracks, audio contexts, and URLs are cleaned up on exit. Answer allowance is shared across successfully transcribed original/follow-up recordings. Discarded attempts do not consume the submitted-answer allowance. The backend must enforce duration, size, format, consent, retention, and deletion independently.

Supported detected formats: WebM/Opus, MP4, WebM, Ogg/Opus; uploads preserve the corresponding filename extension. Maximum file size is 25 MB. Text stays available when audio fails. The microphone level meter uses real analyser input; if Web Audio is unavailable, recording can still work. Provider failures preserve transcript drafts and stable answer IDs; Retry-After is respected for answer retries. Network requests time out after 90 seconds.

## Proposed dialogue extension — NOT an agreed live contract

`src/lib/client/dialogue-contract.ts` defines a frontend proposal; existing shared API fields were not changed. `dialogueEnabled` is deliberately true only in fixture mode. No environment flag enables an unagreed real dialogue route. The standard live interview works without this extension.

Proposed authenticated route: `POST /api/v1/sessions/:sessionId/dialogue`. Body: `{ questionId, clientRequestId, kind: 'clarification' | 'follow_up', candidateText }`. Response: `{ id, questionId, questionKind, kind, text }`. Backend must persist interactions, deduplicate by request ID and payload, enforce active-question ownership, allow one clarification per question and one optional follow-up per session, and maintain the current question kind. Clarification/follow-up interactions do not advance the question or trigger evaluation. Proposed resume support must return saved interactions and session follow-up availability; browser fixture storage is not a substitute for live persistence.

Proposed additive answer fields: `{ baseTranscript, dialogueContext: [{ interactionId, responseTranscript? }] }`. The existing `transcript` contains the complete user-confirmed candidate text, combining the original answer and an accepted follow-up answer. Interviewer prompts are excluded from candidate transcript text and are obtained from persisted interaction IDs during evaluation. Clarification has no candidate response transcript. Declining a follow-up omits that follow-up from the submitted context and submits the original answer. The combined transcript remains limited to 10,000 characters. Scoring is performed once against the saved question and its dialogue context. Evidence must quote the submitted candidate text. The backend owner must review/agree this extension, implement access/validation/persistence, and expose capability/resume support before enabling real dialogue.

Scripted fixtures echo a short draft excerpt and use a fixed question-kind prompt. They are not generated or assessed by AI. Fixture tests validate interaction ownership, limits, retries, combined transcript consistency, and the three-evaluation budget.

## Verification

- Lint, TypeScript, and automated tests pass. Tests cover all four fixture journeys, mixed ordering, answer retry deduplication, immutable reports, capabilities, deletion, exact network payloads, multipart formats, rate-limit recovery, account-preview boundaries, evidence highlighting, unread feedback recovery, dialogue limits/declining/failure, and microphone permission timeout/late-stream cleanup.
- Browser verified: account preview explicitly says no email was sent; guest entry; setup preservation across login; full mixed typed interview; clarification; answered follow-up; complete transcript review; evidence highlighting; original question/dialogue history; focus on new questions/feedback; unread feedback after refresh; report; optional account return path; 390px narrow layout without horizontal overflow; pending microphone cancellation and typed fallback.
- Actual microphone capture, recording playback on the demo device, provider speech/transcription, live AI scoring, real authentication, screen-reader hardware/software behavior, and backend retention remain integration checks. Unit tests cover permission denial and unsupported recording formats; browser verification confirmed cancellation of a pending permission request without granting microphone access.
- Existing dependency audit findings are development-tooling issues documented in the prior handoff; no dependencies were added for this redesign. Root AGENTS.md is generated by Next.js; bundled routing guidance was consulted.
