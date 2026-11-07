/** Shared contract owned by backend. Coordinate changes through docs/FRONTEND_INTEGRATION.md. */
import type { z } from 'zod';
import type { createSessionSchema, completeTurnSchema, aiEvaluationSchema, generatedQuestionSchema } from './schemas';
export type CreateSessionRequest = z.infer<typeof createSessionSchema>;
export type CompleteTurnRequest = z.infer<typeof completeTurnSchema>;
export type InterviewMode = CreateSessionRequest['round'];
export type QuestionKind = Exclude<InterviewMode, 'mixed'>;
export type Difficulty = CreateSessionRequest['difficulty'];
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type PrivateEvaluation = z.infer<typeof aiEvaluationSchema> & { overallScore: number; model: string };
export type Category = 'content' | 'structure' | 'relevance';
export interface Question {
  id: string; text: string; kind: QuestionKind; topic: string; difficulty: Difficulty;
  maxAnswerSeconds: number; origin: 'generated'; sourceLabel: string | null;
  forecastId: string | null; evidenceIds: string[]; isFollowUp: boolean;
}
export interface QuestionTurn { question: Question; questionNumber: number; totalQuestions: number }
export interface SessionView {
  sessionId: string; round: InterviewMode; status: 'active' | 'completed' | 'cancelled';
  currentTurn: QuestionTurn | null; assessedTurns: number; totalQuestions: number;
  expiresAt: string; reportAvailable: boolean; dataMode: 'verified' | 'illustrative';
}
export interface CreateSessionResponse extends SessionView { sessionToken: string }
export interface CompleteTurnResponse {
  sessionId: string; status: SessionView['status']; answer: { answerId: string; questionId: string };
  nextTurn: QuestionTurn | null; reportAvailable: boolean;
}
export interface Evaluation {
  rubricVersion: string; questionKind: QuestionKind; scores: Record<Category, number>; overallScore: number;
  evidence: PrivateEvaluation['evidence']; strengths: string[]; weaknesses: string[]; improvements: string[]; suggestedAnswerOutline: string[];
}
export interface SessionReport {
  sessionId: string; status: 'completed'; completedAt: string; round: InterviewMode;
  overallScore: number; categoryAverages: Record<Category, number>;
  answers: { answerId: string; questionId: string; transcript: string; question: Question; evaluation: Evaluation }[];
  strengths: string[]; nextSteps: string[]; dataMode: SessionView['dataMode'];
}
export interface ApiError { error: { code: string; message: string; retryable: boolean; requestId: string } }
export interface Catalog {
  companies: { id: string; name: string }[]; roles: { id: string; name: string }[];
  interviewModes: InterviewMode[];
  availableInterviews: { companyId: string; roleId: string; round: InterviewMode }[];
}
