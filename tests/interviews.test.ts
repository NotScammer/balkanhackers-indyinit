import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createApi } from '../src/server/api';
import { TestDatabase, seedTestForecast, forecast } from './database';
import type { StructuredAI } from '../src/server/providers/anthropic';
import type { CreateSessionResponse, PrivateEvaluation } from '../src/shared/contracts';
import { hashToken, newCapability, authorizeCron } from '../src/server/auth';
import { weightedScore, verifyQuotes } from '../src/server/evaluation';
import { aiEvaluationSchema, generatedQuestionSchema } from '../src/shared/schemas';
import { decideNext } from '../src/server/interviews/adaptive';
import { payloadHash } from '../src/server/interviews/service';
import { realtimeConfig } from '../src/server/realtime';

const assessment = (kind: string) => ({
  questionKind: kind, rubricVersion: kind === 'system_design' ? 'system-design-v1' : `${kind}-v1`,
  scores: { content: 80, structure: 70, relevance: 90 }, evidence: [{ category: 'content', quote: 'I measured latency', explanation: 'Specific verification.' }],
  strengths: ['Measurement'], weaknesses: ['Failure modes'], improvements: ['Discuss failure modes'], suggestedAnswerOutline: ['Requirements', 'Validation'],
  understoodConcepts: ['Latency'], missingConcepts: ['Reliability'], reasoningGaps: [], misconceptions: [],
  adaptiveNextAction: { action: 'follow_up', weaknesses: ['Failure modes'], reasoning: 'Probe reliability', targetTopic: forecast.topic },
});
let serial = 0;
function mockAI() {
  return { model: 'test-provider-only', generate: vi.fn<StructuredAI['generate']>(async <T>(schema: z.ZodType<T>, _instruction: string, input: unknown): Promise<T> => {
    const data = input as Record<string, unknown>;
    if ('confirmedTranscript' in data) return schema.parse(assessment((data.question as { kind: string }).kind));
    const behavioral = data.kind === 'behavioral';
    // Distinct wording avoids testing with an accidentally repeated synthetic question.
    const texts = ['Explain inference capacity planning and how you would measure its operating limits.', 'Describe a reliability incident and your individual actions and lessons learned.', 'Design a bounded inference service with load shedding and recovery requirements.', 'Discuss how memory bandwidth changes performance diagnostics for serving.', 'Explain deployment safety and rollback for a constrained inference pipeline.'];
    return schema.parse({ text: texts[serial++ % texts.length], kind: data.kind, topic: forecast.topic, difficulty: data.difficulty, forecastId: behavioral ? null : forecast.id, evidenceIds: behavioral ? [] : [forecast.evidence[0].id], assessmentGuidance: 'Assess the reasoning and validation steps.', expectedConcepts: ['Validation'] });
  }) };
}
const request = (token?: string, data?: unknown) => new Request('http://localhost/api', { method: data ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
let db: TestDatabase; let ai: ReturnType<typeof mockAI>; let api: ReturnType<typeof createApi>;
async function create(round = 'technical', audioProcessingConsent = false) {
  const response = await api.create(request(undefined, { companyId: 'google', roleId: 'software-engineer', round, audioProcessingConsent }));
  expect(response.status).toBe(201);
  return await response.json() as CreateSessionResponse;
}
function answer(session: CreateSessionResponse, questionId = session.currentTurn!.question.id) { return { clientAnswerId: randomUUID(), questionId, transcript: 'I measured latency under load and verified the trade-offs.', inputMode: 'text' as const }; }
async function submit(s: CreateSessionResponse, input = answer(s)) { return api.complete(request(s.sessionToken, input), s.sessionId); }

beforeAll(async () => { db = await TestDatabase.create(); await seedTestForecast(db); });
afterAll(async () => { await db?.sql.close(); });
beforeEach(async () => {
  serial = 0; ai = mockAI();
  await db.sql.exec('delete from interview_sessions; delete from rate_buckets;');
  api = createApi({ db, ai: () => ({ model: ai.model, generate: async <T>(schema: z.ZodType<T>, instruction: string, data: unknown, signal?: AbortSignal): Promise<T> => schema.parse(await ai.generate(schema, instruction, data, signal)) }), dataMode: 'illustrative', rateSalt: 'test-only', dailyLimit: 100, realtime: async () => ({ clientSecret: 'temporary-test-credential' }) });
});

describe('scoring and validation', () => {
  it('calculates weighted score with documented rounding', () => { expect(weightedScore({ content: 80, structure: 70, relevance: 90 })).toBe(79); expect(weightedScore({ content: 100, structure: 100, relevance: 100 })).toBe(100); });
  it('rejects invalid scores, malformed questions and fabricated quotes', () => {
    expect(aiEvaluationSchema.safeParse({ ...assessment('technical'), scores: { content: 101, structure: 50, relevance: 50 } }).success).toBe(false);
    expect(generatedQuestionSchema.safeParse({ text: 'bad' }).success).toBe(false);
    expect(verifyQuotes('actual words', [{ quote: 'invented quote' }])).toBe(false);
    expect(verifyQuotes('actual words', [{ quote: 'actual' }])).toBe(true);
  });
  it('generates random capabilities and stores only hashes', async () => {
    const a = newCapability(); expect(a.token).not.toBe(newCapability().token); expect(a.hash).toBe(hashToken(a.token));
    const s = await create(); const state = (await db.snapshot(s.sessionId))!;
    expect(state.session.session_token_hash).toBe(hashToken(s.sessionToken)); expect(JSON.stringify(state)).not.toContain(s.sessionToken);
  });
});

describe('authorized durable three-turn flow', () => {
  it('rejects missing, wrong, another-session and expired credentials', async () => {
    const s = await create(); const other = await create();
    expect((await api.get(request(), s.sessionId)).status).toBe(401);
    expect((await api.get(request(other.sessionToken), s.sessionId)).status).toBe(404);
    await db.sql.query("update interview_sessions set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1", [s.sessionId]);
    expect((await api.get(request(s.sessionToken), s.sessionId)).status).toBe(404);
  });
  it('keeps feedback private and returns persisted final report and retry response', async () => {
    const s = await create('mixed');
    const observed: string[] = [];
    let qid = s.currentTurn!.question.id;
    for (let i = 0; i < 3; i++) {
      const before = await (await api.get(request(s.sessionToken), s.sessionId)).json();
      expect(JSON.stringify(before)).not.toMatch(/assessmentGuidance|expectedConcepts|overallScore|weaknesses|scores/);
      expect((await api.report(request(s.sessionToken), s.sessionId)).status).toBe(409);
      observed.push(before.currentTurn.question.kind);
      const input = answer(s, qid); const response = await submit(s, input); expect(response.status).toBe(200);
      const result = await response.json();
      expect(JSON.stringify(result)).not.toMatch(/overallScore|weaknesses|scores|evaluation/);
      const count = ai.generate.mock.calls.length;
      expect(await (await submit(s, input)).json()).toEqual(result); expect(ai.generate).toHaveBeenCalledTimes(count);
      if (result.nextTurn) qid = result.nextTurn.question.id;
    }
    expect(observed).toEqual(['behavioral', 'technical', 'system_design']);
    const report = await (await api.report(request(s.sessionToken), s.sessionId)).json();
    expect(report.overallScore).toBe(79); expect(report.answers).toHaveLength(3);
    expect(report.categoryAverages).toEqual({ content: 80, structure: 70, relevance: 90 });
    expect(await (await api.report(request(s.sessionToken), s.sessionId)).json()).toEqual(report);
    expect((await api.remove(request(s.sessionToken), s.sessionId)).status).toBe(204);
    expect((await db.sql.query('select * from interview_answers')).rows).toHaveLength(0);
    expect((await db.sql.query('select * from answer_evaluations')).rows).toHaveLength(0);
  });
  it('fails explicitly without research instead of silently substituting synthetic forecasts', async () => {
    vi.spyOn(db, 'forecasts').mockResolvedValueOnce([]);
    const response = await api.create(request(undefined, { companyId: 'google', roleId: 'software-engineer', round: 'technical' }));
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('RESEARCH_DATA_UNAVAILABLE');
    expect(ai.generate).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it('rejects invented transcript evidence before persisting any evaluation', async () => {
    const s = await create();
    ai.generate.mockResolvedValueOnce({ ...assessment('technical'), evidence: [{ category: 'content', quote: 'invented evidence', explanation: 'Invalid' }] });
    const response = await submit(s); expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('AI_INVALID_OUTPUT');
    const state = (await db.snapshot(s.sessionId))!;
    expect(state.session.current_turn_index).toBe(0); expect(state.answers[0].evaluation).toBeNull();
  });
  it('executes the complete persistence flow with the actual service_role grants', async () => {
    await db.sql.exec('set role service_role;');
    try {
      const s = await create(); expect((await submit(s)).status).toBe(200);
      expect((await api.get(request(s.sessionToken), s.sessionId)).status).toBe(200);
      expect((await api.remove(request(s.sessionToken), s.sessionId)).status).toBe(204);
    } finally { await db.sql.exec('reset role;'); }
  });
  it('rejects wrong question and changed payload under same client answer ID', async () => {
    const s = await create(); const input = answer(s);
    expect((await submit(s, { ...input, questionId: randomUUID() })).status).toBe(409);
    expect((await submit(s, input)).status).toBe(200);
    const conflict = await submit(s, { ...input, transcript: 'changed payload' });
    expect(conflict.status).toBe(409); expect((await conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('concurrent submissions get an in-progress response and cannot skip a turn', async () => {
    const s = await create(); const input = answer(s);
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const hold = new Promise<void>(resolve => { release = resolve; });
    const base = ai.generate.getMockImplementation()!;
    ai.generate.mockImplementationOnce(async (...args: Parameters<typeof base>) => { entered(); await hold; return base(...args); });
    const first = submit(s, input); await started;
    const duplicate = await submit(s, input); expect(duplicate.status).toBe(409); expect((await duplicate.json()).error.retryable).toBe(true);
    const alternate = await submit(s, { ...input, clientAnswerId: randomUUID() }); expect(alternate.status).toBe(409);
    release(); expect((await first).status).toBe(200);
    expect((await db.snapshot(s.sessionId))!.session.current_turn_index).toBe(1);
  });
  it('reuses saved evaluation after generation failure', async () => {
    const s = await create(); const input = answer(s); const base = ai.generate.getMockImplementation()!;
    ai.generate.mockImplementationOnce(base).mockRejectedValueOnce(new Error('Generation offline'));
    expect((await submit(s, input)).status).toBe(500);
    expect((await db.snapshot(s.sessionId))!.answers[0].evaluation).toBeTruthy();
    ai.generate.mockClear(); expect((await submit(s, input)).status).toBe(200);
    expect(ai.generate).toHaveBeenCalledTimes(1); // generation only; evaluation was checkpointed
  });
  it('recovers stale leases and rejects stale lease holders', async () => {
    const s = await create(); const input = answer(s); const lease = randomUUID();
    const a = await db.rpc<{ id: string }>('claim_answer', { p_session_id: s.sessionId, p_input: input, p_hash: payloadHash(input), p_lease: lease });
    await db.sql.query("update interview_answers set lease_until=now()-interval '1 second' where id=$1", [a.id]);
    expect((await submit(s, input)).status).toBe(200);
    await expect(db.rpc('checkpoint_answer', { p_answer_id: a.id, p_lease: lease, p_next: {} })).rejects.toMatchObject({ code: 'EVALUATION_IN_PROGRESS' });
  });
  it('cancels an early end without generating a partial score', async () => {
    const s = await create(); const response = await api.end(request(s.sessionToken), s.sessionId);
    expect((await response.json()).status).toBe('cancelled'); expect((await api.report(request(s.sessionToken), s.sessionId)).status).toBe(409);
  });
  it('requires voice consent and gives Realtime only approved public context', async () => {
    const s = await create(); expect((await api.realtime(request(s.sessionToken), s.sessionId)).status).toBe(403);
    expect((await submit(s, { ...answer(s), inputMode: 'voice' as 'text' })).status).toBe(403);
    const consented = await create('technical', true);
    expect((await api.realtime(request(consented.sessionToken), consented.sessionId)).status).toBe(200);
    const cfg = realtimeConfig((await db.snapshot(consented.sessionId))!, 'configured-model', 'configured-transcriber');
    expect(cfg.audio.input.turn_detection.create_response).toBe(false);
    expect(cfg.instructions).not.toContain('Assess the reasoning');
  });
  it('caps follow-up depth and preserves mixed coverage', async () => {
    const s = await create(); const first = (await db.snapshot(s.sessionId))!.questions[0];
    const e = { ...assessment('technical'), overallScore: 79, model: 'test' } as PrivateEvaluation;
    expect(decideNext('technical', [first], e).followUp).toBe(true);
    const follow = { ...first, id: randomUUID(), is_follow_up: true, parent_question_id: first.id };
    expect(decideNext('technical', [first, follow], e).followUp).toBe(false);
    expect(decideNext('mixed', [{ ...first, question_kind: 'behavioral' }], e).kind).toBe('technical');
  });
});

it('protects cron authorization without exposing the configured secret', () => {
  expect(() => authorizeCron(request(), 'x'.repeat(32))).toThrow();
  expect(() => authorizeCron(request('y'.repeat(32)), 'x'.repeat(32))).toThrow();
  expect(() => authorizeCron(request('x'.repeat(32)), 'x'.repeat(32))).not.toThrow();
});
