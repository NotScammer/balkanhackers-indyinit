import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { mockApi } from "../src/mocks/interview";
import { requestFixtureDialogue } from "../src/mocks/dialogue";
import {
  completeTranscript,
  type DialogueSubmission,
} from "../src/lib/client/dialogue-contract";
import {
  dialogueSnapshot,
  emptyDialogue,
} from "../src/components/DialogueView";
const store = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  },
});
beforeEach(() => store.clear());
async function start() {
  const s = await mockApi.create({
    companyId: "google",
    roleId: "software-engineer",
    round: "mixed",
    audioProcessingConsent: false,
  });
  store.set(`token:mock:${s.sessionId}`, s.sessionToken);
  return s;
}
test("clarification and follow-up stay within the saved question and retries are deduplicated", async () => {
  const s = await start(),
    q = s.currentTurn!.question;
  const request = {
    questionId: q.id,
    clientRequestId: "clarify",
    kind: "clarification" as const,
    candidateText: "Should I use a real example?",
  };
  const c = await requestFixtureDialogue(s.sessionId, request);
  assert.deepEqual(await requestFixtureDialogue(s.sessionId, request), c);
  assert.equal(c.questionKind, q.kind);
  await assert.rejects(() =>
    requestFixtureDialogue(s.sessionId, {
      ...request,
      clientRequestId: "another",
    }),
  );
  await assert.rejects(() =>
    requestFixtureDialogue(s.sessionId, {
      ...request,
      candidateText: "Changed request",
    }),
  );
  assert.equal((await mockApi.session(s.sessionId)).answers.length, 0);
});
test("one follow-up per session and exactly three scored questions, preserving mixed order", async () => {
  const s = await start(),
    q = s.currentTurn!.question,
    base = "I compared options and measured the outcome.";
  const follow = await requestFixtureDialogue(s.sessionId, {
    questionId: q.id,
    clientRequestId: "follow",
    kind: "follow_up",
    candidateText: base,
  });
  const context = [
    {
      interactionId: follow.id,
      responseTranscript:
        "I owned the experiment and explained its limitations.",
    },
  ];
  const payload: DialogueSubmission = {
    clientAnswerId: "answer1",
    questionId: q.id,
    baseTranscript: base,
    dialogueContext: context,
    transcript: completeTranscript(base, context),
    inputMode: "text",
    durationSeconds: null,
  };
  await assert.rejects(() =>
    mockApi.submit(s.sessionId, {
      ...payload,
      transcript: "Altered complete answer",
    }),
  );
  const result = await mockApi.submit(s.sessionId, payload);
  assert.deepEqual(await mockApi.submit(s.sessionId, payload), result);
  assert.equal(result.nextTurn!.question.kind, "technical");
  await assert.rejects(() =>
    requestFixtureDialogue(s.sessionId, {
      questionId: result.nextTurn!.question.id,
      clientRequestId: "another-follow",
      kind: "follow_up",
      candidateText: "A technical answer.",
    }),
  );
  for (let i = 1; i < 3; i++) {
    const state = await mockApi.session(s.sessionId);
    await mockApi.submit(s.sessionId, {
      clientAnswerId: `answer${i + 1}`,
      questionId: state.currentTurn!.question.id,
      transcript: "A considered answer.",
      inputMode: "text",
      durationSeconds: null,
    });
  }
  const report = await mockApi.report(s.sessionId);
  assert.equal(report.answers.length, 3);
  assert.deepEqual(
    report.answers.map((a) => a.evaluation.questionKind),
    ["behavioral", "technical", "system_design"],
  );
  assert.equal(report.answers[0].transcript, payload.transcript);
});
test("declining a follow-up submits the original answer and never includes interviewer words", async () => {
  const s = await start(),
    base = "My original answer.";
  const f = await requestFixtureDialogue(s.sessionId, {
    questionId: s.currentTurn!.question.id,
    clientRequestId: "f",
    kind: "follow_up",
    candidateText: base,
  });
  const snapshot = dialogueSnapshot(base, {
    ...emptyDialogue,
    interactions: [f],
    declined: true,
    response: "Not included",
  });
  assert.equal(snapshot.valid, true);
  assert.equal(snapshot.transcript, base);
  assert.equal(snapshot.context.length, 0);
  assert.equal(
    dialogueSnapshot(base, { ...emptyDialogue, interactions: [f] }).valid,
    false,
  );
});
test("dialogue failures leave the active question and answers unchanged", async () => {
  const s = await start();
  await assert.rejects(() =>
    requestFixtureDialogue(s.sessionId, {
      questionId: "wrong",
      clientRequestId: "bad",
      kind: "clarification",
      candidateText: "Help",
    }),
  );
  const state = await mockApi.session(s.sessionId);
  assert.equal(state.currentTurn!.question.id, s.currentTurn!.question.id);
  assert.equal(state.answers.length, 0);
});
