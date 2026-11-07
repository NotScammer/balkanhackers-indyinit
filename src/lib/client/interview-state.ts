import type {
  Session,
  SessionReport,
  Submission,
  Submitted,
} from "./contracts";
import type { InterviewPhase } from "./interview-model";
export interface InterviewState {
  session: Session | null;
  report: SessionReport | null;
  feedback: Submitted | null;
  phase: InterviewPhase;
  draft: string;
  mode: "voice" | "text";
  duration: number;
  pending: Submission | null;
  confirmed: boolean;
  consent: boolean;
  error: string;
  busy: string;
  retryAt: number;
}
export const initialInterview: InterviewState = {
  session: null,
  report: null,
  feedback: null,
  phase: "loading",
  draft: "",
  mode: "text",
  duration: 0,
  pending: null,
  confirmed: false,
  consent: false,
  error: "",
  busy: "",
  retryAt: 0,
};
export type InterviewEvent =
  | { type: "restore"; value: Partial<InterviewState> }
  | { type: "edit"; text: string }
  | { type: "mode"; mode: "voice" | "text" }
  | { type: "confirm"; value: boolean }
  | { type: "request"; label: string; phase?: InterviewPhase }
  | { type: "settled" }
  | { type: "failure"; message: string; retryAt?: number }
  | { type: "pending"; payload: Submission }
  | { type: "answered"; result: Submitted }
  | { type: "next" };
export function interviewReducer(
  s: InterviewState,
  e: InterviewEvent,
): InterviewState {
  switch (e.type) {
    case "restore":
      return { ...s, ...e.value };
    case "edit":
      return s.pending
        ? s
        : {
            ...s,
            draft: e.text,
            confirmed: false,
            phase: "reviewing transcript",
          };
    case "mode":
      return s.pending ? s : { ...s, mode: e.mode, confirmed: false };
    case "confirm":
      return { ...s, confirmed: e.value };
    case "request":
      return { ...s, busy: e.label, error: "", phase: e.phase ?? s.phase };
    case "settled":
      return { ...s, busy: "" };
    case "failure":
      return {
        ...s,
        error: e.message,
        retryAt: e.retryAt ?? s.retryAt,
        phase: s.feedback
          ? "feedback"
          : s.draft
            ? "reviewing transcript"
            : "ready",
      };
    case "pending":
      return { ...s, pending: e.payload };
    case "answered":
      return {
        ...s,
        feedback: e.result,
        phase: "feedback",
        confirmed: false,
        session: s.session
          ? {
              ...s.session,
              status: e.result.status,
              currentTurn: e.result.nextTurn,
              answers: [
                ...s.session.answers.filter(
                  (a) => a.answerId !== e.result.answer.answerId,
                ),
                e.result.answer,
              ],
            }
          : null,
      };
    case "next":
      return {
        ...s,
        feedback: null,
        draft: "",
        pending: null,
        duration: 0,
        confirmed: false,
        phase: "ready",
        error: "",
      };
  }
}
export const draftKey = (id: string, qid: string) => `draft:${id}:${qid}`;
export function saveDraft(
  id: string,
  qid: string,
  s: Pick<InterviewState, "draft" | "mode" | "duration" | "pending">,
) {
  sessionStorage.setItem(
    draftKey(id, qid),
    JSON.stringify({
      text: s.draft,
      mode: s.mode,
      duration: s.duration,
      pending: s.pending,
    }),
  );
}
export function restoreDraft(id: string, qid: string): Partial<InterviewState> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(draftKey(id, qid)) ?? "null");
    if (!raw) return {};
    return {
      draft: typeof raw.text === "string" ? raw.text : "",
      mode: raw.mode === "voice" ? "voice" : "text",
      duration: typeof raw.duration === "number" ? raw.duration : 0,
      pending: raw.pending ?? null,
    };
  } catch {
    return {};
  }
}
export function feedbackToRestore(
  session: Session,
  results: boolean,
): Submitted | null {
  const acknowledged = Number(
    sessionStorage.getItem(`read:${session.sessionId}`) ?? 0,
  );
  const last = session.answers.at(-1);
  return !results && last && session.answers.length > acknowledged
    ? {
        sessionId: session.sessionId,
        status: session.status,
        answer: last,
        nextTurn: session.currentTurn,
      }
    : null;
}

export function rememberQuestion(
  id: string,
  question: { id: string; text: string } | null,
) {
  if (!question) return;
  let saved: Record<string, string> = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(`question-cache:${id}`) ?? "{}");
  } catch {}
  saved[question.id] = question.text;
  sessionStorage.setItem(`question-cache:${id}`, JSON.stringify(saved));
}
