"use client";
import { rememberQuestion } from "../lib/client/interview-state";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { api, RequestError } from "../lib/client/api";
import {
  initialInterview,
  interviewReducer,
  restoreDraft,
  saveDraft,
  draftKey,
  feedbackToRestore,
} from "../lib/client/interview-state";

import type { InterviewPhase } from "../lib/client/interview-model";
import type { Submission } from "../lib/client/contracts";
import type { DialogueSubmission } from "../lib/client/dialogue-contract";
export function useInterview(id: string, results: boolean) {
  const [state, dispatch] = useReducer(interviewReducer, initialInterview);
  const lock = useRef(false),
    live = useRef(true);
  const run = useCallback(
    async (
      label: string,
      work: () => Promise<void>,
      phase?: InterviewPhase,
    ) => {
      if (lock.current) return;
      lock.current = true;
      dispatch({ type: "request", label, phase });
      try {
        await work();
      } catch (e) {
        if (live.current)
          dispatch({
            type: "failure",
            message:
              e instanceof Error
                ? e.message
                : "Something went wrong. Your draft is preserved.",
            retryAt:
              e instanceof RequestError && e.retryAfter
                ? Date.now() + e.retryAfter
                : undefined,
          });
      } finally {
        lock.current = false;
        if (live.current) dispatch({ type: "settled" });
      }
    },
    [],
  );
  const load = useCallback(
    () =>
      run(
        "Opening your practice",
        async () => {
          const session = await api.session(id);
          if (!live.current) return;
          rememberQuestion(id, session.currentTurn?.question ?? null);
          const consent = sessionStorage.getItem(`consent:${id}`) === "true";
          const feedback = feedbackToRestore(session, results);
          const saved = session.currentTurn
            ? restoreDraft(id, session.currentTurn.question.id)
            : {};
          const mode = "voice" as const;
          const report =
            session.status === "completed" && !feedback
              ? await api.report(id)
              : null;
          dispatch({
            type: "restore",
            value: {
              ...initialInterview,
              session,
              consent,
              ...saved,
              mode,
              feedback,
              report,
              phase: feedback
                ? "feedback"
                : report
                  ? "complete"
                  : saved.draft
                    ? "reviewing transcript"
                    : "ready",
              busy: "Opening your practice",
            },
          });
        },
        "loading",
      ),
    [id, results, run],
  );
  useEffect(() => {
    live.current = true;
    const t = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(t);
      live.current = false;
    };
  }, [load]);
  const question = state.session?.currentTurn?.question;
  useEffect(() => {
    if (question && !state.feedback) saveDraft(id, question.id, state);
  }, [id, question, state]);
  const submit = async (
    extra?: Partial<DialogueSubmission>,
    explicitConfirmation = false,
  ) => {
    if (
      !question ||
      !(state.confirmed || explicitConfirmation) ||
      !state.draft.trim()
    )
      return;
    await run(
      "Preparing your feedback",
      async () => {
        if (Date.now() < state.retryAt)
          throw Error(
            "Please wait for the retry delay before submitting again.",
          );
        const payload: Submission = state.pending ?? {
          clientAnswerId: crypto.randomUUID(),
          questionId: question.id,
          transcript: state.draft,
          inputMode: state.mode,
          durationSeconds: state.mode === "voice" ? state.duration : null,
          ...extra,
        };
        if (payload.transcript.length > 10000)
          throw Error("The complete answer must be at most 10,000 characters.");
        dispatch({ type: "pending", payload });
        saveDraft(id, question.id, { ...state, pending: payload });
        const result = await api.submit(id, payload);
        if (!live.current) return;
        rememberQuestion(id, result.nextTurn?.question ?? null);
        dispatch({ type: "answered", result });
        sessionStorage.removeItem(draftKey(id, question.id));
      },
      "evaluating",
    );
  };
  return { state, dispatch, question, run, load, submit };
}
