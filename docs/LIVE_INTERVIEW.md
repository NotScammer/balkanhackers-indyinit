> Google OAuth update: every private/live endpoint also requires the signed-in Supabase owner. See [OAuth setup](OAUTH_SETUP.md).

# Live interview

## Agreed behavior

- Open microphone with natural turn detection, interruptible interviewer speech, mute, disconnect and end controls.
- Three main questions. Each can have zero, one or two adaptive follow-ups in the same topic/kind; mixed mode always covers behavioral, technical and system design.
- Spoken coaching and visible notes after every answer. Numeric scores are returned only with the completed report.
- Clarification explains wording, scope and assumptions without giving solutions or using an answer/follow-up slot.
- Transcription advances automatically. Candidates can correct saved answer transcripts during or after the interview. Corrections reassess that main-question group without advancing the conversation.
- Each main question and all its follow-up answers receive one combined evaluation. The final average contains three groups, regardless of the number of follow-ups.

## Setup

1. Apply the existing two migrations, then `supabase/migrations/202611070003_live_conversation.sql`. Supabase CLI users can run `supabase db push` against their selected project.
2. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL` and `OPENAI_TRANSCRIPTION_MODEL` using `.env.example`. Model IDs must be supported by the configured accounts. `OPENAI_TTS_MODEL` is used by the older recorded-audio routes, not this live flow.
3. Seed research using the instructions in SETUP.md. Rebuild/restart. The product always opens live conversation; the previous mock-mode flag no longer selects a recorded-answer interface. Fixtures remain available only to isolated tests.
4. Start a new session, then choose **Connect live audio** and allow microphone access. Use HTTPS outside localhost.

No credentials are committed. This change was tested with isolated model/audio fixtures and the actual SQL migrations in PGlite; a real OpenAI/Claude/Supabase session still needs verification with configured services.

## Structure and endpoints

`LiveInterview.tsx` is the live screen. `live-audio.ts` handles WebRTC, microphone lifecycle, VAD events, partial/final transcripts, interruption and playback. The existing server Realtime adapter issues short-lived credentials; the browser never receives the project API key. OpenAI carries/transcribes audio and reads approved speech. Claude interprets the candidate utterance, clarifies, evaluates and generates deeper questions.

The browser negotiates directly with OpenAI using its [WebRTC interface](https://developers.openai.com/api/docs/guides/voice-webrtc). Automatic voice responses are disabled while semantic turn detection stays active. The application requests approved interviewer speech with an empty input context, as documented in [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations). This keeps speech separate from assessment/progression.

All application endpoints require the existing session Bearer capability and validate expiry:

| Endpoint | Purpose |
| --- | --- |
| GET `/api/v1/sessions/:id/live` | Initialize once and restore public conversation state |
| POST `/api/v1/sessions/:id/live` | Submit an utterance or transcript correction |
| POST `/api/v1/sessions/:id/live/token` | Create a short-lived audio credential for an active, consented interview |
| POST `/api/v1/sessions/:id/end` | Cancel further interview progression |
| DELETE `/api/v1/sessions/:id` | Delete the session and its associated conversation |
| GET `/api/v1/sessions/:id/report` | Read the completed, persisted combined report |

Utterance: `{ kind: "utterance", clientRequestId, revision, questionId, transcript }`.
Correction: `{ kind: "correct", clientRequestId, revision, answerId, transcript }`.

Both return a `LiveView`: public conversation messages, current question, revision, qualitative coaching, approved spoken text and (only when complete) the report. Full contracts are in `src/shared/live.ts`.

## Persistence, retries and boundaries

`live_interviews` stores private conversation state including grouped evaluations. `live_requests` stores request hashes, bounded attempts and saved responses. Both tables have RLS enabled with no anonymous/authenticated access. New database functions are service-role-only.

Durable leases serialize processing. Stable request IDs deduplicate retries, and revision checks stop stale progression. Pending transcripts survive refresh in tab storage. Out-of-order transcription events are delivered in committed-audio order. Words spoken while an earlier answer is processing retain their original question ID; continuations update that answer group without consuming more follow-ups. Older answer endpoints cannot independently advance a live session.

Uploaded recordings are not used in live mode. While connected and unmuted, audio streams to OpenAI; transcripts go to Claude and are persisted in Supabase. The app does not persist raw audio. Existing expiry/deletion rules and separate provider retention apply. Audio disconnects on cancellation, connection failure and navigation. A connection pauses after 30 minutes or session expiry; reconnect can resume valid saved progress. Completed interviews stop the microphone and close audio after final feedback.

Existing limits cover connection issuance and conversation requests. A session allows at most 80 distinct live requests and four attempts per request; main-question combined transcripts are limited to 10,000 characters. These are operational limits rather than a guarantee about provider billing.

## Release verification

Automated checks cover full mixed-mode progression with all six follow-ups, score privacy, combined reports, clarification, correction/rescoring, continuations, deduplication, provider failure, lease serialization, capability checks, expiry, anonymous access denial and deletion. Audio tests cover WebRTC setup, ordered transcription, interruption, muting, disconnect and late microphone cleanup.

With real credentials, verify a complete spoken session, interruption during playback, a spoken clarification, deeper follow-ups, transcript correction, reconnect after network loss, mobile playback/microphone permissions, final grouped scores and deletion. Do not treat fixture tests as proof of live provider behavior.
