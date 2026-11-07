import { mockApi } from "./interview";
import type {
  DialogueInteraction,
  DialogueRequest,
  DialogueSubmission,
} from "../lib/client/dialogue-contract";
import { completeTranscript } from "../lib/client/dialogue-contract";
interface StoredDialogue {
  request: DialogueRequest;
  interaction: DialogueInteraction;
}
const key = (id: string) => `dialogue-fixture:${id}`;
export function readInteractions(id: string): StoredDialogue[] {
  return JSON.parse(sessionStorage.getItem(key(id)) ?? "[]");
}
export async function requestFixtureDialogue(
  id: string,
  request: DialogueRequest,
): Promise<DialogueInteraction> {
  const session = await mockApi.session(id),
    q = session.currentTurn?.question;
  if (!q || q.id !== request.questionId)
    throw Error("This question is no longer active. Reload your practice.");
  const items = readInteractions(id),
    existing = items.find(
      (v) => v.request.clientRequestId === request.clientRequestId,
    );
  if (existing) {
    if (JSON.stringify(existing.request) !== JSON.stringify(request))
      throw Error("This request ID already has different content.");
    return existing.interaction;
  }
  if (!request.candidateText.trim() || request.candidateText.length > 10000)
    throw Error("Enter a question or answer draft of 1–10,000 characters.");
  if (
    request.kind === "clarification" &&
    items.some(
      (v) =>
        v.interaction.questionId === q.id &&
        v.interaction.kind === "clarification",
    )
  )
    throw Error("You have already asked for clarification on this question.");
  if (
    request.kind === "follow_up" &&
    items.some((v) => v.interaction.kind === "follow_up")
  )
    throw Error("This session already has its optional follow-up.");
  const prompts = {
    behavioral: "What was your own contribution, and what changed as a result?",
    technical:
      "How would you check that your explanation or proposed improvement is correct?",
    system_design:
      "Which failure would you address first, and what trade-off would that introduce?",
  };
  const text =
    request.kind === "clarification"
      ? {
          behavioral:
            "Use one real example. Explain the situation, your own actions, and what happened. You can state any assumptions.",
          technical:
            "Explain your reasoning in ordinary language. State reasonable assumptions and discuss how you would verify them. No code is needed.",
          system_design:
            "Keep the scenario small. State your assumptions, describe the main flow, and explain a meaningful failure or trade-off. No diagram or code is needed.",
        }[q.kind]
      : `You mentioned “${request.candidateText.slice(0, 90)}”. ${prompts[q.kind]}`;
  const interaction: DialogueInteraction = {
    id: crypto.randomUUID(),
    questionId: q.id,
    questionKind: q.kind,
    kind: request.kind,
    text,
  };
  items.push({ request, interaction });
  sessionStorage.setItem(key(id), JSON.stringify(items));
  return interaction;
}
export function validateFixtureDialogue(
  id: string,
  answer: DialogueSubmission,
) {
  const items = readInteractions(id),
    seen = new Set<string>();
  let followups = 0;
  for (const c of answer.dialogueContext) {
    const item = items.find((v) => v.interaction.id === c.interactionId);
    if (
      !item ||
      item.interaction.questionId !== answer.questionId ||
      seen.has(c.interactionId)
    )
      throw Error("Dialogue context does not belong to this question.");
    seen.add(c.interactionId);
    if (item.interaction.kind === "follow_up") {
      followups++;
      if (!c.responseTranscript?.trim())
        throw Error("Answer the follow-up or decline it before submitting.");
    } else if (c.responseTranscript)
      throw Error("A clarification is not a candidate answer.");
  }
  if (
    followups > 1 ||
    answer.transcript !==
      completeTranscript(answer.baseTranscript, answer.dialogueContext)
  )
    throw Error(
      "The complete confirmed answer does not match its dialogue context.",
    );
}
