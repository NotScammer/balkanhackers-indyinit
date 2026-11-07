import { z } from "zod";
import type { Question, SessionReport } from "./contracts";
export const liveRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("control"),
      clientRequestId: z.uuid(),
      revision: z.number().int().nonnegative(),
      action: z.enum(["repeat", "pause", "finish", "next_topic"]),
    })
    .strict(),
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
  control?: "pause";
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

// Match whole requests only: discussing a pause or finishing a project is answer evidence.
export function spokenControl(
  text: string,
): "repeat" | "pause" | "finish" | "handoff" | null {
  const command = text
    .toLowerCase()
    .trim()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:please |can you |could you )/, "")
    .replace(/ please$/, "");
  if (
    /^(?:repeat(?: (?:that|the question|the interviewer))?|say that again)$/.test(
      command,
    )
  )
    return "repeat";
  if (
    /^(?:pause(?: (?:the interview|interview))?|take a break|i need a break)$/.test(
      command,
    )
  )
    return "pause";
  if (
    /^(?:(?:finish|end|stop) (?:the |my )?interview|finish and review|finish & review)$/.test(
      command,
    )
  )
    return "finish";
  if (
    /^(?:i['’]?m done|i am done|done answering|that['’]?s my answer)$/.test(
      command,
    )
  )
    return "handoff";
  return null;
}

export function reportRecap(
  report: Pick<
    SessionReport,
    "overallScore" | "strengths" | "nextSteps" | "coverage"
  >,
) {
  const coverage = report.coverage;
  return [
    coverage?.finishedEarly
      ? `You finished early. This recap covers ${coverage.answeredMainQuestions} of ${coverage.plannedMainQuestions} main questions.`
      : "Your interview is complete.",
    `Your practice score is ${report.overallScore} out of 100.`,
    report.strengths[0] ? `One strength: ${report.strengths[0]}` : "",
    report.nextSteps[0] ? `For your next practice: ${report.nextSteps[0]}` : "",
    "Your full report is ready to explore.",
  ]
    .filter(Boolean)
    .join(" ");
}
