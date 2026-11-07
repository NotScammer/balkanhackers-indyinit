"use client";
import { useEffect, useRef, useState } from "react";
import type {
  DialogueInteraction,
  DialogueRequest,
  ConfirmedDialogue,
} from "../lib/client/dialogue-contract";
import { completeTranscript } from "../lib/client/dialogue-contract";
import { requestDialogue, dialogueEnabled } from "../lib/client/dialogue";
import type { Question } from "../lib/client/contracts";
export interface DialogueDraft {
  interactions: DialogueInteraction[];
  response: string;
  declined: boolean;
  request?: DialogueRequest;
  clarification: string;
}
export const emptyDialogue: DialogueDraft = {
  interactions: [],
  response: "",
  declined: false,
  clarification: "",
};
const key = (id: string, qid: string) => `dialogue-draft:${id}:${qid}`;
export function readDialogueDraft(id: string, qid: string): DialogueDraft {
  try {
    return {
      ...emptyDialogue,
      ...JSON.parse(sessionStorage.getItem(key(id, qid)) ?? "{}"),
    };
  } catch {
    return emptyDialogue;
  }
}
export interface DialogueSnapshot {
  transcript: string;
  context: ConfirmedDialogue[];
  baseTranscript: string;
  valid: boolean;
  hasFollowup: boolean;
}
export function dialogueSnapshot(
  base: string,
  d: DialogueDraft,
): DialogueSnapshot {
  const followup = d.interactions.find((i) => i.kind === "follow_up");
  const context: ConfirmedDialogue[] = d.interactions
    .filter((i) => i.kind === "clarification" || !d.declined)
    .map((i) => ({
      interactionId: i.id,
      ...(i.kind === "follow_up" ? { responseTranscript: d.response } : {}),
    }));
  return {
    transcript: completeTranscript(base, context),
    context,
    baseTranscript: base,
    valid: !followup || d.declined || !!d.response.trim(),
    hasFollowup: !!followup && !d.declined,
  };
}
export default function DialogueView({
  id,
  question,
  base,
  disabled,
  onChange,
  recordedResponse,
}: {
  id: string;
  question: Question;
  base: string;
  disabled: boolean;
  onChange: (value: DialogueSnapshot) => void;
  recordedResponse?: string;
}) {
  const [d, setD] = useState(() => readDialogueDraft(id, question.id)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const hasFollowup = d.interactions.some((i) => i.kind === "follow_up");
  const [used, setUsed] = useState(
    () => sessionStorage.getItem(`follow-up-used:${id}`) === "true",
  );
  useEffect(() => {
    sessionStorage.setItem(key(id, question.id), JSON.stringify(d));
    onChange({
      ...dialogueSnapshot(base, d),
      valid: dialogueSnapshot(base, d).valid && !busy,
    });
  }, [id, question.id, d, base, onChange, busy]);
  useEffect(() => {
    if (recordedResponse !== undefined)
      queueMicrotask(() =>
        setD((v) => ({ ...v, response: recordedResponse, declined: false })),
      );
  }, [recordedResponse]);
  async function ask(kind: "clarification" | "follow_up") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const request = d.request ?? {
      questionId: question.id,
      clientRequestId: crypto.randomUUID(),
      kind,
      candidateText: kind === "clarification" ? d.clarification : base,
    };
    setD((v) => ({ ...v, request }));
    try {
      const interaction = await requestDialogue(id, request);
      setD((v) => ({
        ...v,
        request: undefined,
        interactions: [
          ...v.interactions.filter((i) => i.id !== interaction.id),
          interaction,
        ],
      }));
      if (interaction.kind === "follow_up") {
        sessionStorage.setItem(`follow-up-used:${id}`, "true");
        setUsed(true);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not get a response. Retry or continue with your original answer.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!dialogueEnabled)
    return (
      <p className="fine">
        Clarification and follow-ups are not connected in live practice yet.
        State reasonable assumptions and continue with your answer.
      </p>
    );
  return (
    <div className="dialogue">
      <p className="fine">
        Conversation preview · Scripted fixtures. One clarification per question
        and one optional follow-up in this session.
      </p>
      {!d.interactions.some((i) => i.kind === "clarification") && (
        <details>
          <summary>Ask about this question</summary>
          <label>
            What would you like clarified?
            <textarea
              maxLength={2000}
              value={d.clarification}
              disabled={disabled || busy || !!d.request}
              onChange={(e) => setD({ ...d, clarification: e.target.value })}
            />
          </label>
          <button
            disabled={
              disabled ||
              busy ||
              !d.clarification.trim() ||
              (!!d.request && d.request.kind !== "clarification")
            }
            onClick={() => void ask("clarification")}
          >
            {d.request?.kind === "clarification"
              ? "Retry clarification"
              : "Ask for clarification"}
          </button>
        </details>
      )}
      {d.interactions
        .filter((i) => i.kind === "clarification")
        .map((i) => (
          <section key={i.id}>
            <h3>A little clarification</h3>
            <p>{i.text}</p>
          </section>
        ))}
      {!hasFollowup && !used && base.trim() && (
        <>
          <p>
            Want to explore one part of your answer a little further? This stays
            within the same scored question.
          </p>
          <button
            disabled={
              disabled ||
              busy ||
              !base.trim() ||
              (!!d.request && d.request.kind !== "follow_up")
            }
            onClick={() => void ask("follow_up")}
          >
            {d.request?.kind === "follow_up"
              ? "Retry follow-up"
              : "Ask me a follow-up"}
          </button>
          <p className="fine">
            Optional. You can also continue directly to feedback.
          </p>
        </>
      )}
      {used && !hasFollowup && (
        <p className="fine">
          You’ve used the optional follow-up for this session.
        </p>
      )}
      {d.interactions
        .filter((i) => i.kind === "follow_up")
        .map((i) => (
          <section key={i.id}>
            <h3>One more thought</h3>
            <p>{i.text}</p>
            {d.declined ? (
              <>
                <p>You chose to continue with your original answer.</p>
                <button
                  disabled={disabled || busy}
                  onClick={() => setD({ ...d, declined: false })}
                >
                  Answer the follow-up after all
                </button>
              </>
            ) : (
              <>
                <label>
                  Your follow-up answer
                  <textarea
                    maxLength={10000}
                    value={d.response}
                    disabled={disabled || busy}
                    onChange={(e) => setD({ ...d, response: e.target.value })}
                  />
                </label>
                <p className="fine">
                  Type here, or select “Follow-up answer” in the recording
                  controls above.
                </p>
                <button
                  disabled={disabled || busy}
                  onClick={() => setD({ ...d, declined: true })}
                >
                  Continue without answering this follow-up
                </button>
              </>
            )}
          </section>
        ))}
      {busy && <p role="status">Preparing a scripted response…</p>}
      {error && (
        <p role="alert">{error} You may continue with your original answer.</p>
      )}
    </div>
  );
}
