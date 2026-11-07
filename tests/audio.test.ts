import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), speech: vi.fn(), transcribe: vi.fn() }));
vi.mock('../src/server/auth', () => ({ authorize: mocks.authorize }));
vi.mock('../src/server/storage/supabase', () => ({ SupabaseDatabase: class { rpc = mocks.rpc; } }));
vi.mock('../src/server/config', () => ({ env: () => ({ OPENAI_API_KEY: 'test', OPENAI_TTS_MODEL: 'test-tts', OPENAI_TRANSCRIPTION_MODEL: 'test-stt' }) }));
vi.mock('openai', () => ({ default: class { audio = { speech: { create: mocks.speech }, transcriptions: { create: mocks.transcribe } }; } }));
import { audio } from '../src/server/audio';
const sid = '11111111-1111-4111-8111-111111111111';
const qid = '22222222-2222-4222-8222-222222222222';
let state: { session: { audio_processing_consent: boolean; status: string; current_question_id: string }; questions: { id: string; question_text: string }[] };
beforeEach(() => {
  vi.clearAllMocks();
  state = { session: { audio_processing_consent: true, status: 'active', current_question_id: qid }, questions: [{ id: qid, question_text: 'Explain reliability.' }] };
  mocks.authorize.mockImplementation(async () => state);
  mocks.rpc.mockResolvedValue(true);
});
const speechRequest = (questionId = qid) => new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId }) });
it('requires consent and current saved question before speaking', async () => {
  state.session.audio_processing_consent = false;
  expect((await audio(speechRequest(), sid, 'speech')).status).toBe(403);
  state.session.audio_processing_consent = true;
  expect((await audio(speechRequest(sid), sid, 'speech')).status).toBe(409);
  expect(mocks.speech).not.toHaveBeenCalled();
});
it('speaks only saved text and returns private audio', async () => {
  mocks.speech.mockResolvedValue(new Response(new Uint8Array([1, 2])));
  const response = await audio(speechRequest(), sid, 'speech');
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(mocks.speech.mock.calls[0][0].input).toBe('Explain reliability.');
});
it('rejects exhausted budgets before provider calls', async () => {
  mocks.rpc.mockResolvedValue(false);
  expect((await audio(speechRequest(), sid, 'speech')).status).toBe(429);
  expect(mocks.speech).not.toHaveBeenCalled();
});
it('uploads valid audio and returns only the transcription', async () => {
  const form = new FormData(); form.set('questionId', qid); form.set('audio', new File(['test'], 'answer.webm', { type: 'audio/webm' }));
  mocks.transcribe.mockResolvedValue({ text: 'My confirmed words.' });
  const response = await audio(new Request('http://localhost', { method: 'POST', body: form }), sid, 'transcriptions');
  expect(await response.json()).toEqual({ transcript: 'My confirmed words.' });
});
