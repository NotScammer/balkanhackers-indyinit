import 'server-only';
import { randomUUID } from 'node:crypto';
import type { CompleteTurnRequest, CompleteTurnResponse, CreateSessionRequest, CreateSessionResponse } from '@/shared/contracts';
import { newCapability, hashToken } from '../auth';
import { INTERVIEW } from '../config';
import type { StructuredAI } from '../providers/anthropic';
import type { AnswerRow, Database, Forecast, Snapshot } from '../storage/types';
import { validateCombination } from '../catalog';
import { generateQuestion } from '../questions';
import { evaluate } from '../evaluation';
import { decideNext } from './adaptive';
import { buildReport, publicQuestion, sessionView } from './views';
import { AppError } from '../errors';
export function payloadHash(input: CompleteTurnRequest) {
  return hashToken(JSON.stringify([input.questionId, input.transcript, input.inputMode, input.durationSeconds ?? null]));
}
export class InterviewService {
  constructor(private db: Database, private ai: StructuredAI, private dataMode: Forecast['data_mode']) {}
  async create(input: CreateSessionRequest, ownerId: string): Promise<CreateSessionResponse> {
    validateCombination(input);
    const { token, hash } = newCapability(); const id = randomUUID();
    const q = await generateQuestion(this.db, this.ai, input, [], decideNext(input.round, [], null), this.dataMode);
    await this.db.rpc('create_interview', { p_s: { ...input, id, ownerId, tokenHash: hash, totalTurns: INTERVIEW.turns, dataMode: this.dataMode, expiresAt: new Date(Date.now() + INTERVIEW.expiryHours * 3600000).toISOString() }, p_q: q });
    const state = await this.db.snapshot(id);
    if (!state) throw new AppError('DATABASE_UNAVAILABLE', 503, 'Created session could not be retrieved.', true);
    return { ...sessionView(state), sessionToken: token };
  }
  async complete(state: Snapshot, input: CompleteTurnRequest): Promise<CompleteTurnResponse> {
    const s = state.session; const lease = randomUUID();
    const answer = await this.db.rpc<AnswerRow>('claim_answer', { p_session_id: s.id, p_input: input, p_hash: payloadHash(input), p_lease: lease });
    if (answer.processing_status === 'done' && answer.response_data) return answer.response_data;
    try {
      // Refresh after acquiring the lease so a stale HTTP snapshot never drives progression.
      const fresh = (await this.db.snapshot(s.id))!;
      const saved = fresh.answers.find(a => a.id === answer.id)!;
      const question = fresh.questions.find(q => q.id === input.questionId)!;
      if (!question) throw new AppError('QUESTION_OUT_OF_ORDER', 409, 'Question does not belong to this session.');
      if (!saved.evaluation) {
        const evaluation = await evaluate(this.ai, question, input.transcript, s.role_id);
        await this.db.rpc('checkpoint_answer', { p_answer_id: answer.id, p_lease: lease, p_evaluation: evaluation });
        saved.evaluation = evaluation;
      }
      const done = fresh.session.current_turn_index + 1 >= fresh.session.total_turns;
      let next = saved.next_question_checkpoint;
      if (!done && !next) {
        const decision = decideNext(s.interview_mode, fresh.questions, saved.evaluation, s.total_turns);
        next = await generateQuestion(this.db, this.ai, { companyId: s.company_id, roleId: s.role_id, round: s.interview_mode, difficulty: s.difficulty, audioProcessingConsent: s.audio_processing_consent }, fresh.questions, decision, s.data_mode);
        await this.db.rpc('checkpoint_answer', { p_answer_id: answer.id, p_lease: lease, p_next: next });
      }
      const response: CompleteTurnResponse = { sessionId: s.id, status: done ? 'completed' : 'active',
        answer: { answerId: answer.id, questionId: input.questionId },
        nextTurn: next && !done ? { question: publicQuestion(next), questionNumber: fresh.session.current_turn_index + 2, totalQuestions: s.total_turns } : null,
        reportAvailable: done,
      };
      const report = done ? buildReport(fresh) : null;
      await this.db.rpc('finish_answer', { p_answer_id: answer.id, p_lease: lease, p_response: response, p_report: report });
      return response;
    } catch (error) {
      // A committed evaluation survives subsequent generation/finalization failures.
      await this.db.rpc('fail_answer', { p_answer_id: answer.id, p_lease: lease }).catch(() => {});
      throw error;
    }
  }
}
