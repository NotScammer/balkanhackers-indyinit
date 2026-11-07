// Proposed additive dialogue contract. Real integration is disabled pending backend agreement.
import type { QuestionKind, Submission } from "./contracts";
export type DialogueKind = "clarification" | "follow_up";
export interface DialogueRequest {
  questionId: string;
  clientRequestId: string;
  kind: DialogueKind;
  candidateText: string;
}
export interface DialogueInteraction {
  id: string;
  questionId: string;
  questionKind: QuestionKind;
  kind: DialogueKind;
  text: string;
}
export interface ConfirmedDialogue {
  interactionId: string;
  responseTranscript?: string;
}
export interface DialogueSubmission extends Submission {
  baseTranscript: string;
  dialogueContext: ConfirmedDialogue[];
}
export function completeTranscript(base: string, context: ConfirmedDialogue[]) {
  return [
    base,
    ...context
      .filter((c) => c.responseTranscript?.trim())
      .map((c) => `Follow-up answer:\n${c.responseTranscript}`),
  ].join("\n\n");
}
