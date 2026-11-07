import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { fixtureQuestions, mockApi } from "../src/mocks/interview";
import type { InterviewMode } from "../src/lib/client/contracts";
const store = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  },
});
beforeEach(() => store.clear());
for (const round of [
  "behavioral",
  "technical",
  "system_design",
  "mixed",
] as InterviewMode[])
  test(`${round}: three confirmed answers, retry deduplication, persisted report and deletion`, async () => {
    const s = await mockApi.create({
      companyId: "google",
      roleId: "software-engineer",
      round,
      audioProcessingConsent: false,
    });
    sessionStorage.setItem(`token:mock:${s.sessionId}`, s.sessionToken);
    const questions = fixtureQuestions(round);
    assert.equal(new Set(questions.map((q) => q.id)).size, 3);
    if (round === "mixed")
      assert.deepEqual(
        questions.map((q) => q.kind),
        ["behavioral", "technical", "system_design"],
      );
    await assert.rejects(() => mockApi.report(s.sessionId));
    for (let i = 0; i < 3; i++) {
      const state = await mockApi.session(s.sessionId);
      const q = state.currentTurn!.question;
      assert.equal(q.kind, questions[i].kind);
      assert.equal(
        q.maxAnswerSeconds,
        { behavioral: 180, technical: 300, system_design: 600 }[q.kind],
      );
      const payload = {
        clientAnswerId: `answer-${i}`,
        questionId: q.id,
        transcript: "I measured the result and explained the trade-off.",
        inputMode: "text" as const,
        durationSeconds: null,
      };
      const result = await mockApi.submit(s.sessionId, payload);
      assert.deepEqual(await mockApi.submit(s.sessionId, payload), result);
      await assert.rejects(() =>
        mockApi.submit(s.sessionId, { ...payload, transcript: "Changed" }),
      );
      assert.equal((await mockApi.session(s.sessionId)).answers.length, i + 1);
      assert.ok(
        payload.transcript.includes(result.answer.evaluation.evidence[0].quote),
      );
    }
    const report = await mockApi.report(s.sessionId);
    assert.equal(report.answers.length, 3);
    assert.deepEqual(await mockApi.report(s.sessionId), report);
    assert.equal((await mockApi.session(s.sessionId)).currentTurn, null);
    await mockApi.delete(s.sessionId);
    await assert.rejects(() => mockApi.session(s.sessionId));
  });
test("fixture capability token required", async () => {
  const s = await mockApi.create({
    companyId: "google",
    roleId: "software-engineer",
    round: "mixed",
    audioProcessingConsent: false,
  });
  await assert.rejects(() => mockApi.session(s.sessionId));
});
