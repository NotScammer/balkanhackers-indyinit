# Current live conversation contract

The integrated real frontend uses `/sessions/:id/live` and `/sessions/:id/live/token`, with three main questions, up to two follow-ups per main question, automatic transcripts, clarification and final grouped scores. See [LIVE_INTERVIEW.md](LIVE_INTERVIEW.md) and `src/shared/live.ts`. The recorded-answer contracts below remain available to older clients. Do not mix the two progression endpoints within one session.

# Frontend integration contract

**OAuth update:** Google sign-in is required for creation and all private routes, including audio/live endpoints. Keep the existing interview Bearer token and send the signed-in owner's Supabase cookie with same-origin requests. Creation derives ownership from the verified account. See [OAuth setup](OAUTH_SETUP.md); this supersedes the anonymous access rules below. The catalog stays public; cron uses its separate secret.

Developer A owns pages, components, styles, microphone UI and WebRTC. Developer B owns the API and shared contracts. Import **types only** from `src/shared/contracts.ts` in browser code; runtime request schemas are in `src/shared/schemas.ts`. Coordinate changes to either shared file. See [setup](SETUP.md) for credentials/migrations and [architecture](BACKEND_ARCHITECTURE.md) for backend details.

## Changes from the original README

- Questions are dynamically generated from evidence-backed forecasts. There is no fixed question bank.
- Submit a completed answer to `/turns/complete`. `/answers` is a compatibility alias with the **same new response**, not the older response that included evaluation.
- Scores and feedback are private until all three turns complete. Active GET responses do not contain `answers` or evaluations. Do not build per-answer feedback screens during the interview.
- Voice uses browser ↔ OpenAI Realtime WebRTC. The old `/transcriptions` and `/speech` endpoints are not implemented; do not call them. Typed fallback uses the identical turn submission endpoint.
- The mode field remains **`round`** to preserve the original setup contract; system design is **`system_design`**. Company labels are practice context, not endorsements or verified company interview questions.

## Endpoints

All JSON uses camelCase, opaque UUID IDs, ISO 8601 UTC timestamps, and scores 0–100. Send `Content-Type: application/json` on JSON writes. Serve frontend/API on the same origin; no cross-origin credential flow is configured.

| Method | Path | Auth | Success |
| --- | --- | --- | --- |
| GET | `/api/v1/catalog` | None | 200 `Catalog` |
| POST | `/api/v1/sessions` | None | 201 `CreateSessionResponse` |
| GET | `/api/v1/sessions/:sessionId` | Session Bearer token | 200 `SessionView` |
| POST | `/api/v1/sessions/:sessionId/turns/complete` | Session Bearer token | 200 `CompleteTurnResponse` |
| POST | `/api/v1/sessions/:sessionId/answers` | Session Bearer token | Compatibility alias of complete |
| POST | `/api/v1/sessions/:sessionId/end` | Session Bearer token | 200 `SessionView` (completed or cancelled) |
| GET | `/api/v1/sessions/:sessionId/report` | Session Bearer token | 200 `SessionReport` |
| POST | `/api/v1/sessions/:sessionId/realtime-token` | Session Bearer token + saved audio consent | 200 temporary credential |
| DELETE | `/api/v1/sessions/:sessionId` | Session Bearer token | 204 empty body |
| GET | `/api/cron/monthly-research` | **CRON_SECRET**, server/admin only | 200 run status/counts; failed run 503 |

Every private response is `Cache-Control: no-store, private`. Never store tokens in query strings, analytics or logs. Store the session token in browser `sessionStorage` with the session ID for this hackathon, keep it out of shared screenshots, and clear it after deletion. It is returned **exactly once** on creation. A lost token cannot be recovered by knowing the session ID. Sessions expire after 24 hours.

## Catalog and session creation

Browser requests automatically use the HttpOnly Auth cookies. For CLI examples, `cookies.txt` must contain a valid signed-in owner's cookie jar obtained through the browser OAuth flow; a session token alone is insufficient.

```sh
curl http://localhost:3000/api/v1/catalog
curl --cookie cookies.txt -X POST http://localhost:3000/api/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"companyId":"google","roleId":"software-engineer","round":"mixed","difficulty":"intermediate","audioProcessingConsent":false}'
```

Catalog shape (companies shown abbreviated):

```json
{
  "companies": [{ "id": "google", "name": "Google" }],
  "roles": [{ "id": "software-engineer", "name": "Software Engineer" }],
  "interviewModes": ["behavioral", "technical", "system_design", "mixed"],
  "availableInterviews": [{ "companyId": "google", "roleId": "software-engineer", "round": "mixed" }]
}
```

The real response includes OpenAI, Anthropic, NVIDIA and Microsoft and every supported company/role/mode combination. Supported combinations still need configured providers and loaded research when starting.

Create body fields: `companyId`, `roleId`, `round` required; `difficulty` defaults to `intermediate` (`beginner|intermediate|advanced`); `audioProcessingConsent` defaults to false. Unknown body fields are rejected. The client cannot set turn count, rubric or scores.

Illustrative shape of a creation response (question text/IDs vary):

```json
{
  "sessionId": "8c756df5-7eec-49cb-9e81-c332c0e32aa0",
  "sessionToken": "ONE_TIME_RANDOM_CAPABILITY_STORE_SECURELY",
  "round": "mixed",
  "status": "active",
  "assessedTurns": 0,
  "totalQuestions": 3,
  "expiresAt": "2026-11-08T15:00:00.000Z",
  "reportAvailable": false,
  "dataMode": "verified",
  "currentTurn": {
    "questionNumber": 1,
    "totalQuestions": 3,
    "question": {
      "id": "1eb020b3-60ad-4cf9-aa25-6cf83832e170",
      "text": "Describe a technical disagreement, your individual actions, and what you learned.",
      "kind": "behavioral",
      "topic": "Collaboration",
      "difficulty": "intermediate",
      "maxAnswerSeconds": 180,
      "origin": "generated",
      "sourceLabel": "Generated behavioral practice",
      "forecastId": null,
      "evidenceIds": [],
      "isFollowUp": false
    }
  }
}
```

This is a shape example, not a saved question fixture. Display `dataMode: illustrative` with a visible **DEMO / ILLUSTRATIVE research** banner. `verified` describes actual source provenance; forecasts remain provisional hypotheses, not verified hiring predictions. Never relabel illustrative data as real.

## Recover and submit

After refreshing, read the token from sessionStorage and GET the session. Its response matches creation **without `sessionToken`**. Use `currentTurn` verbatim; never generate or choose replacements in the frontend. Current turn is null when completed/cancelled. No transcript drafts are returned by this endpoint; preserve unsent drafts locally if desired, then clear them after submission/deletion. A cancelled session has no final report.

```sh
# SESSION_ID and SESSION_TOKEN are copied into local shell variables without logging them.
curl --cookie cookies.txt -H "Authorization: Bearer $SESSION_TOKEN" \
  "http://localhost:3000/api/v1/sessions/$SESSION_ID"

curl --cookie cookies.txt -X POST -H "Authorization: Bearer $SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  "http://localhost:3000/api/v1/sessions/$SESSION_ID/turns/complete" \
  -d '{"clientAnswerId":"6ef81925-8250-4502-b4f4-2d69c63a0180","questionId":"1eb020b3-60ad-4cf9-aa25-6cf83832e170","transcript":"I compared the proposed approaches with a small experiment and shared the results with my teammate.","inputMode":"text","durationSeconds":null}'
```

Generate `clientAnswerId` **once** with `crypto.randomUUID()` when the user confirms an answer. Reuse the ID and exactly the same payload after network errors, 409 in-progress or retryable provider failures. Store the pending request locally before sending. Do not create a fresh ID on each retry or resend an edited payload with the same ID. A claimed answer is immutable; preserve that payload for recovery.

Transcripts are trimmed, nonempty and at most 10,000 characters. `inputMode` is `text|voice`; `durationSeconds` is optional/null or a finite nonnegative number up to 3600. It is not used for scoring and is not trusted as an authoritative recording duration. The frontend should enforce the current question's recording window: 180 seconds behavioral, 300 technical, 600 design. Voice requires consent saved at creation. There is no consent-update endpoint; start a new consented session to switch from an unconsented session to voice.

Response after a non-final answer:

```json
{
  "sessionId": "8c756df5-7eec-49cb-9e81-c332c0e32aa0",
  "status": "active",
  "answer": {
    "answerId": "88d48ccd-cdcc-4075-b3bb-74fc014e6f41",
    "questionId": "1eb020b3-60ad-4cf9-aa25-6cf83832e170"
  },
  "nextTurn": {
    "questionNumber": 2,
    "totalQuestions": 3,
    "question": {
      "id": "825cc08a-5b45-4f19-a5f0-9f8e49d11c3f",
      "text": "Explain how you would diagnose memory pressure in a model-serving service.",
      "kind": "technical",
      "topic": "KV cache memory efficiency",
      "difficulty": "intermediate",
      "maxAnswerSeconds": 300,
      "origin": "generated",
      "sourceLabel": "Generated practice grounded in cited research; forecast is a hypothesis",
      "forecastId": "4cb4304c-d114-4fbd-af25-94bb033d4dc2",
      "evidenceIds": ["98862cc8-38c5-4267-b348-e459ba348d75"],
      "isFollowUp": false
    }
  },
  "reportAvailable": false
}
```

After the third assessment: `status:"completed"`, `nextTurn:null`, `reportAvailable:true`, and the same saved-answer reference shape. Neither response contains feedback. A successful retry returns the original response even if the session has subsequently progressed; GET the session to resolve newer progress. Each follow-up counts as a turn. Mixed interviews preserve the three kinds in the configured three-turn budget.

TypeScript example using the actual shared types:

```ts
import type {
  CreateSessionRequest, CreateSessionResponse, CompleteTurnRequest,
  CompleteTurnResponse, SessionView, SessionReport, ApiError,
} from '@/shared/contracts';

async function api<T>(path: string, token?: string, payload?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: method ?? (payload === undefined ? 'GET' : 'POST'),
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  if (!response.ok) throw await response.json() as ApiError;
  return response.status === 204 ? undefined as T : response.json();
}

const setup: CreateSessionRequest = {
  companyId: 'google', roleId: 'software-engineer', round: 'mixed',
  difficulty: 'intermediate', audioProcessingConsent: false,
};
const created = await api<CreateSessionResponse>('/sessions', undefined, setup);
sessionStorage.setItem(`interview:${created.sessionId}`, created.sessionToken);
const pending: CompleteTurnRequest = {
  clientAnswerId: crypto.randomUUID(), questionId: created.currentTurn!.question.id,
  transcript: 'The user-confirmed substantive answer goes here.', inputMode: 'text',
};
// Persist pending until success; disable double submission in UI.
const result = await api<CompleteTurnResponse>(
  `/sessions/${created.sessionId}/turns/complete`, created.sessionToken, pending,
);
// Show result.nextTurn, or fetch report if result.reportAvailable.
const saved = await api<SessionView>(`/sessions/${created.sessionId}`, created.sessionToken);
if (saved.reportAvailable) {
  const report = await api<SessionReport>(`/sessions/${created.sessionId}/report`, created.sessionToken);
  console.log(report.overallScore); // Example only; never log credentials or transcripts.
}
```

## Reports, end and delete

```sh
curl --cookie cookies.txt -H "Authorization: Bearer $SESSION_TOKEN" \
  "http://localhost:3000/api/v1/sessions/$SESSION_ID/report"
curl --cookie cookies.txt -X POST -H "Authorization: Bearer $SESSION_TOKEN" \
  "http://localhost:3000/api/v1/sessions/$SESSION_ID/end"
curl --cookie cookies.txt -X DELETE -H "Authorization: Bearer $SESSION_TOKEN" \
  "http://localhost:3000/api/v1/sessions/$SESSION_ID"
```

Reports are stored and stable; retrieving one never calls AI. The complete `SessionReport` type is in shared contracts. Abbreviated shape (the real report includes all three answers):

```ts
interface ReportShape {
  sessionId: string;
  status: 'completed';
  completedAt: string;
  round: 'behavioral' | 'technical' | 'system_design' | 'mixed';
  overallScore: number;
  categoryAverages: { content: number; structure: number; relevance: number };
  dataMode: 'verified' | 'illustrative';
  answers: Array<{
    answerId: string; questionId: string; transcript: string;
    question: import('@/shared/contracts').Question;
    evaluation: {
      rubricVersion: string;
      questionKind: 'behavioral' | 'technical' | 'system_design';
      scores: { content: number; structure: number; relevance: number };
      overallScore: number;
      evidence: Array<{ category: 'content' | 'structure' | 'relevance'; quote: string; explanation: string }>;
      strengths: string[]; weaknesses: string[]; improvements: string[];
      suggestedAnswerOutline: string[];
    };
  }>;
  strengths: string[];
  nextSteps: string[];
}
```

Before completion report GET returns 409 `SESSION_INCOMPLETE`. There is no endpoint for fetching private scores during an active interview. Ending early sets `cancelled`, returns a SessionView with no current turn/report, and does not invent scores for missing answers. After the third completed turn the report is already stored; `/end` is optional and idempotent. DELETE returns an empty 204; clear local tokens/drafts and close all voice resources.

## Voice coordination

1. Explain that confirmed transcripts go to the backend/Claude and audio goes directly to OpenAI. Obtain explicit audio-processing consent in session setup. Request microphone permission only after a user gesture.
2. POST `/realtime-token` with the session Bearer token (no body needed).

```json
{
  "clientSecret": "ek_TEMPORARY_VALUE",
  "expiresAt": "2026-11-07T15:01:00.000Z",
  "model": "ACCOUNT_CONFIGURED_REALTIME_MODEL",
  "questionId": "1eb020b3-60ad-4cf9-aa25-6cf83832e170"
}
```

The credential is valid for starting connections for 60 seconds; an established voice connection can outlive that TTL. Never persist it, put it in a URL or log it. The permanent OpenAI key never leaves the server. Issuance is rate limited.

3. Following [OpenAI Realtime documentation](https://developers.openai.com/api/docs/guides/realtime), create an `RTCPeerConnection`, microphone stream and data channel. Send the SDP offer to **`POST https://api.openai.com/v1/realtime/calls`** with `Authorization: Bearer <clientSecret>` and `Content-Type: application/sdp`; set the SDP answer as the remote description. Send application API auth only to this app; send the ephemeral OpenAI credential only to OpenAI. Do not use deprecated beta headers. Wait for the data channel and session-ready events. Browser microphone/audio UI belongs to Developer A.

Sketch of the browser transport (wire into your cleanup/error handling):

```ts
const pc = new RTCPeerConnection();
const remoteAudio = new Audio();
remoteAudio.autoplay = true; // Catch autoplay rejection and offer a Play control.
pc.ontrack = event => { remoteAudio.srcObject = event.streams[0]; };
const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
for (const track of mic.getTracks()) pc.addTrack(track, mic);
const dc = pc.createDataChannel('oai-events');
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
const connection = await fetch('https://api.openai.com/v1/realtime/calls', {
  method: 'POST', body: offer.sdp,
  headers: { Authorization: `Bearer ${credential.clientSecret}`, 'Content-Type': 'application/sdp' },
});
if (!connection.ok) throw new Error('Voice connection failed; offer typed fallback.');
await pc.setRemoteDescription({ type: 'answer', sdp: await connection.text() });
```

4. The credential configuration includes the saved question, semantic VAD with low eagerness, and `create_response:false`. Send a `response.create` when ready to speak the approved question. Use response instructions asking to read **only** the exact current `Question.text`. Disable microphone capture while speaking to avoid transcribing interviewer audio.
5. Candidate speech events/transcription completion events are transport segments, not automatically whole interview answers. Accumulate user transcript items by `item_id` (deduplicate events), handle interruptions and order, and let the candidate explicitly **Finish answer → review/edit transcript → Submit**. Do not evaluate every sentence or treat a brief pause as a final answer. VAD is an aid; user confirmation is authoritative.
6. Submit the confirmed full transcript with `inputMode:'voice'` using the exact `/turns/complete` payload. Disable auto-responses, microphone submission and substantive interviewer generation while the backend privately evaluates. Display an assessing/loading state with no scores.
7. When the next saved turn arrives, update the voice session's reader instructions with that exact question and explicitly request its delivery. Do not let the voice model choose its own follow-up. Keep local `questionId` aligned with the saved backend turn; no hidden rubric, evaluation or expected concepts should ever enter the Realtime session.
8. On interruption, cancel the speaking response and resume/replay the same approved question when the candidate chooses. Do not count interrupted question playback as an answer. On disconnect, retain the confirmed draft/pending answer ID, GET saved state, acquire a new ephemeral credential if still active/consented, and read the saved current question. Never create a replacement question on reconnect.
9. On microphone denial, missing devices, autoplay failure, transcription failure, provider errors or unsupported WebRTC, show the saved text question and switch to typed input. It uses `inputMode:'text'` and the same assessment pipeline. Do not upload raw audio to this backend. Stop media tracks and close the data channel/peer connection when leaving, cancelling, deleting or completing.

Direct browser WebRTC can alter voice configuration and cannot guarantee everything the model says. The backend controls saved state, questions and grading. Treat unexpected voice content as non-authoritative; the public saved question remains the source of truth. Show no scores until the stored report is available.

## Errors and retry policy

Every application error has this shape and an `X-Request-Id` header:

```json
{
  "error": {
    "code": "EVALUATION_IN_PROGRESS",
    "message": "A turn is being processed. Retry the same answer ID.",
    "retryable": true,
    "requestId": "1bde754f-f78f-4fce-ad9b-28122b8872b7"
  }
}
```

| HTTP | Code | Action |
| --- | --- | --- |
| 400 | `INVALID_REQUEST`, `UNSUPPORTED_INTERVIEW` | Fix input/catalog choice; keep draft |
| 401 | `UNAUTHORIZED` | Restore valid Bearer credential or start new session |
| 403 | `AUDIO_CONSENT_REQUIRED` | Typed fallback or create a new consented session |
| 404 | `SESSION_UNAVAILABLE` | Expired/deleted/wrong token; start again |
| 409 | `QUESTION_OUT_OF_ORDER` | GET saved session and reconcile pending answer |
| 409 | `IDEMPOTENCY_CONFLICT` | Same answer ID with changed payload; preserve the original payload |
| 409 | `EVALUATION_IN_PROGRESS` | Wait a few seconds, retry same immutable payload with bounded backoff; a stale lease recovers after 180 seconds |
| 409 | `SESSION_INCOMPLETE` | Continue interview; do not attempt to fetch private feedback |
| 413 | `PAYLOAD_TOO_LARGE` | Reduce JSON body below 64 KiB |
| 429 | `RATE_LIMITED` | Keep draft; respect `Retry-After: 60`; the actual rolling budget may take longer to reset |
| 429 | `ATTEMPT_LIMIT` | Four processing attempts exhausted; end and start a new session |
| 502 | `AI_UNAVAILABLE`, `AI_INVALID_OUTPUT`, `VOICE_UNAVAILABLE` | Retry if flagged; voice failures can use typed input |
| 503 | `NOT_CONFIGURED`, `DATABASE_UNAVAILABLE` | Backend setup/service issue; keep draft, share request ID |
| 503 | `RESEARCH_DATA_UNAVAILABLE` | Backend owner must seed/research; do not silently use synthetic frontend research |
| 500 | `INTERNAL_ERROR` | Preserve draft/payload, share request ID and retry only when flagged |

Proxies/platform-generated errors may not be JSON. Handle malformed/non-JSON responses as recoverable transport failures and keep the same pending payload. Do not automatically loop session creation: it has no creation idempotency key, and a lost initial token cannot be recovered.

## Integrated compatibility routes

POST `/api/v1/sessions/:id/answers` now returns the saved answer transcript and public evaluation alongside the next turn. Session GET includes completed public answers for refresh recovery. These are deliberate contract additions for the existing frontend. `/turns/complete` retains its minimal response. Adaptive reasoning, private guidance and provider metadata remain excluded. POST `speech` takes JSON `{ questionId }` and returns MP3. POST `transcriptions` takes multipart `questionId` and `audio`, returning `{ transcript }`. Both require capability authorization, consent, an active saved question and persistent request budgets. Uploads are bounded at 4 MiB. See README for deployment.
