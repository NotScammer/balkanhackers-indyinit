export type InterviewMode =
  "behavioral" | "technical" | "system_design" | "mixed";
export type QuestionKind = Exclude<InterviewMode, "mixed">;
export type Category = "content" | "structure" | "relevance";
export interface Question {
  id: string;
  text: string;
  kind: QuestionKind;
  topic: string;
  maxAnswerSeconds: number;
  origin: "curated" | "generated";
  sourceLabel: string | null;
}
export interface QuestionTurn {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
}
export interface Evaluation {
  rubricVersion: string;
  questionKind: QuestionKind;
  scores: Record<Category, number>;
  overallScore: number;
  evidence: { category: Category; quote: string; explanation: string }[];
  strengths: string[];
  improvements: string[];
  suggestedAnswerOutline: string[];
}
export interface AnswerResult {
  answerId: string;
  questionId: string;
  transcript: string;
  evaluation: Evaluation;
}
export interface SessionReport {
  coverage?: { answeredMainQuestions: number; plannedMainQuestions: number; finishedEarly: boolean };
  sessionId: string;
  status: "completed";
  completedAt: string;
  round: InterviewMode;
  overallScore: number;
  categoryAverages: Record<Category, number>;
  answers: AnswerResult[];
  strengths: string[];
  nextSteps: string[];
}
export interface Catalog {
  companies: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  availableInterviews: {
    companyId: string;
    roleId: string;
    round: InterviewMode;
  }[];
}
export interface Setup {
  companyId: string;
  roleId: string;
  round: InterviewMode;
  audioProcessingConsent: boolean;
}
export interface Session {
  sessionId: string;
  round: InterviewMode;
  status: "active" | "completed";
  currentTurn: QuestionTurn | null;
  answers: AnswerResult[];
  expiresAt: string;
}
export interface CreatedSession extends Omit<Session, "answers"> {
  sessionToken: string;
}
export interface Submission {
  clientAnswerId: string;
  questionId: string;
  transcript: string;
  inputMode: "text" | "voice";
  durationSeconds: number | null;
}
export interface Submitted {
  sessionId: string;
  status: "active" | "completed";
  answer: AnswerResult;
  nextTurn: QuestionTurn | null;
}
export interface ApiError {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId: string;
  };
}
export interface InterviewApi {
  catalog(): Promise<Catalog>;
  create(setup: Setup): Promise<CreatedSession>;
  session(id: string): Promise<Session>;
  submit(id: string, answer: Submission): Promise<Submitted>;
  report(id: string): Promise<SessionReport>;
  transcribe(
    id: string,
    questionId: string,
    audio: Blob,
  ): Promise<{ transcript: string }>;
  speech(id: string, questionId: string): Promise<Blob>;
  delete(id: string): Promise<void>;
}
