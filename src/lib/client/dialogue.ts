import { isMock } from "./api";
import type { DialogueRequest } from "./dialogue-contract";
import { requestFixtureDialogue } from "../../mocks/dialogue";
// Deliberately no public flag can enable a wire contract that the backend has not agreed to.
export const dialogueEnabled = isMock;
export async function requestDialogue(id: string, request: DialogueRequest) {
  if (!dialogueEnabled)
    throw Error(
      "Conversational follow-ups are not connected in live practice yet. Your original answer can still be submitted.",
    );
  return requestFixtureDialogue(id, request);
}
