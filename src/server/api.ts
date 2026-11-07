import 'server-only';
import { createLiveApi } from './live/api';
import { createSessionSchema, completeTurnSchema } from '@/shared/schemas';
import { authorize, hashToken } from './auth';
import { catalog, validateCombination } from './catalog';
import { env } from './config';
import { AppError } from './errors';
import { body, handle, json, sessionId } from './http';
import { InterviewService } from './interviews/service';
import { sessionView, answerEvaluation } from './interviews/views';
import { AnthropicAI, type StructuredAI } from './providers/anthropic';
import { issueRealtimeToken } from './realtime';
import { SupabaseDatabase } from './storage/supabase';
import type { Database, Forecast, Snapshot } from './storage/types';
export interface ApiDependencies {
  db: Database; ai: () => StructuredAI; dataMode: Forecast['data_mode']; rateSalt: string; dailyLimit: number;
  realtime: (state: Snapshot) => Promise<unknown>;
}
export function createApi(deps: ApiDependencies) {
  const { db } = deps;
  async function rate(key: string, limit: number, seconds: number) {
    if (!await db.rpc<boolean>('consume_rate', { p_key: key, p_limit: limit, p_seconds: seconds })) throw new AppError('RATE_LIMITED', 429, 'Request budget exceeded. Try again later.', true);
  }
  return {
    live: createLiveApi(deps),
    frontendGet: (request: Request, id: string) => handle(async () => {
      const state = await authorize(db, sessionId(id), request);
      return json({ ...sessionView(state), answers: state.answers.filter(a => a.processing_status === 'done' && a.evaluation).map(a => ({ answerId: a.id, questionId: a.question_id, transcript: a.transcript, evaluation: answerEvaluation(a.evaluation!) })) });
    }),
    frontendComplete: (request: Request, id: string) => handle(async () => {
      const state = await authorize(db, sessionId(id), request);
      const input = await body(request, completeTurnSchema);
      const ai: StructuredAI = { get model() { return deps.ai().model; }, generate: (...args) => deps.ai().generate(...args) };
      const result = await new InterviewService(db, ai, deps.dataMode).complete(state, input);
      const fresh = await db.snapshot(id);
      const a = fresh?.answers.find(a => a.id === result.answer.answerId);
      if (!a?.evaluation) throw new AppError('DATABASE_UNAVAILABLE', 503, 'Saved feedback unavailable.', true);
      return json({ ...result, answer: { ...result.answer, transcript: a.transcript, evaluation: answerEvaluation(a.evaluation) } });
    }),
    catalog: () => handle(async () => json(catalog)),
    create: (request: Request) => handle(async () => {
      const input = await body(request, createSessionSchema); validateCombination(input);
      await rate('create:global', deps.dailyLimit, 86400);
      // Vercel overwrites x-vercel-forwarded-for. Untrusted forwarded headers are ignored elsewhere.
      const ip = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for') ?? 'unknown' : 'local';
      await rate(`create:${hashToken(deps.rateSalt + ip)}`, 10, 3600);
      return json(await new InterviewService(db, deps.ai(), deps.dataMode).create(input), 201);
    }),
    get: (request: Request, id: string) => handle(async () => json(sessionView(await authorize(db, sessionId(id), request)))),
    complete: (request: Request, id: string) => handle(async () => {
      const state = await authorize(db, sessionId(id), request);
      const input = await body(request, completeTurnSchema);
      // Lazy AI construction allows a stored successful response to be retried during provider outages.
      const ai: StructuredAI = { get model() { return deps.ai().model; }, generate: (...args) => deps.ai().generate(...args) };
      return json(await new InterviewService(db, ai, deps.dataMode).complete(state, input));
    }),
    report: (request: Request, id: string) => handle(async () => {
      const state = await authorize(db, sessionId(id), request);
      if (state.session.status !== 'completed' || !state.report) throw new AppError('SESSION_INCOMPLETE', 409, 'Private feedback is available only after all required turns are assessed.');
      return json(state.report);
    }),
    end: (request: Request, id: string) => handle(async () => {
      await authorize(db, sessionId(id), request);
      await db.rpc('end_interview', { p_session_id: id });
      return json(sessionView((await db.snapshot(id))!));
    }),
    remove: (request: Request, id: string) => handle(async () => {
      await authorize(db, sessionId(id), request); await db.deleteSession(id); return json(null, 204);
    }),
    realtime: (request: Request, id: string) => handle(async () => {
      const state = await authorize(db, sessionId(id), request);
      if (!state.session.audio_processing_consent) throw new AppError('AUDIO_CONSENT_REQUIRED', 403, 'Audio processing consent is required.');
      if (state.session.status !== 'active') throw new AppError('SESSION_INCOMPLETE', 409, 'Voice requires an active session.');
      await rate(`realtime:${id}`, 6, 3600); await rate('realtime:global', 100, 86400);
      return json(await deps.realtime(state));
    }),
  };
}
export function backend() {
  const config = env();
  return createApi({ db: new SupabaseDatabase(), ai: () => new AnthropicAI(), dataMode: config.RESEARCH_DATA_MODE, rateSalt: config.RATE_LIMIT_SALT, dailyLimit: config.SESSION_DAILY_LIMIT, realtime: issueRealtimeToken });
}
