import { z } from "zod";
import type { Question, SessionReport } from "./contracts";
export const liveRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("utterance"),
      clientRequestId: z.uuid(),
      revision: z.number().int().nonnegative(),
      questionId: z.uuid(),
      transcript: z.string().trim().min(1).max(10000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("correct"),
      clientRequestId: z.uuid(),
      revision: z.number().int().nonnegative(),
      answerId: z.uuid(),
      transcript: z.string().trim().min(1).max(10000),
    })
    .strict(),
]);
export type LiveRequest = z.infer<typeof liveRequestSchema>;
export interface LiveMessage {
  id: string;
  role: "candidate" | "interviewer";
  kind: "answer" | "clarification" | "question" | "feedback" | "control";
  text: string;
  questionId: string;
  mainNumber: number;
}
export interface LiveView {
  sessionId: string;
  revision: number;
  status: "active" | "completed" | "cancelled";
  expiresAt: string;
  mainNumber: number;
  totalMainQuestions: 3;
  followUpNumber: number;
  currentQuestion: Question | null;
  messages: LiveMessage[];
  spokenText: string;
  report: SessionReport | null;
  dataMode: "verified" | "illustrative";
}
