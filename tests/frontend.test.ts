import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialInterview,
  interviewReducer,
  feedbackToRestore,
  saveDraft,
  restoreDraft,
} from "../src/lib/client/interview-state";
import {
  highlightParts,
  remainingSeconds,
} from "../src/lib/client/interview-model";
import {
  safeReturnPath,
  accountPreview,
} from "../src/lib/client/account-preview";
import { fixtureQuestions } from "../src/mocks/interview";
import { recordingMime } from "../src/hooks/useRecorder";
import type { Session, AnswerResult } from "../src/lib/client/contracts";
const store = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  },
});
test("account previews never authenticate and return destinations stay local", async () => {
  accountPreview.continueAsGuest();
  assert.equal(store.get("talk-to-future:entry"), "guest");
  assert.match(
    (await accountPreview.requestEmailLink("demo@example.com")).message,
    /No email was sent/,
  );
  await assert.rejects(() => accountPreview.requestEmailLink("invalid"));
  assert.equal(safeReturnPath("//evil.test"), "/");
  assert.equal(safeReturnPath("/results/opaque-id"), "/results/opaque-id");
  assert.equal([...store.values()].includes("demo@example.com"), false);
});
test("evidence highlighting preserves exact text and merges overlaps", () => {
  const text = "I measured latency and measured latency again.";
  const parts = highlightParts(text, ["measured latency", "latency", "absent"]);
  assert.equal(parts.map((p) => p.text).join(""), text);
  assert.equal(parts.filter((p) => p.marked).length, 2);
  assert.equal(
    highlightParts(text, ["invented"]).some((p) => p.marked),
    false,
  );
});
test("pending evaluation freezes the payload and preserves it after failure and refresh", () => {
  const payload = {
    clientAnswerId: "stable",
    questionId: "q",
    transcript: "Original answer",
    inputMode: "text" as const,
    durationSeconds: null,
  };
  let s = interviewReducer(initialInterview, {
    type: "edit",
    text: payload.transcript,
  });
  s = interviewReducer(s, { type: "pending", payload });
  s = interviewReducer(s, { type: "failure", message: "Retry", retryAt: 500 });
  assert.equal(
    interviewReducer(s, { type: "edit", text: "changed" }).draft,
    "Original answer",
  );
  saveDraft("s", "q", s);
  assert.deepEqual(restoreDraft("s", "q").pending, payload);
  s = interviewReducer(s, { type: "next" });
  assert.equal(s.confirmed, false);
  assert.equal(s.pending, null);
  assert.equal(s.duration, 0);
});
test("saved feedback is restored before advancing, including third answer", () => {
  const answer = { answerId: "a" } as AnswerResult;
  const session: Session = {
    sessionId: "feedback-session",
    round: "mixed",
    status: "completed",
    answers: [answer],
    currentTurn: null,
    expiresAt: new Date().toISOString(),
  };
  assert.equal(feedbackToRestore(session, false)?.answer.answerId, "a");
  assert.equal(feedbackToRestore(session, true), null);
  store.set("read:feedback-session", "1");
  assert.equal(feedbackToRestore(session, false), null);
});
test("recording budget cannot be exceeded across responses", () => {
  assert.equal(remainingSeconds(180, 120), 60);
  assert.equal(remainingSeconds(180, 200), 0);
  for (const q of fixtureQuestions("mixed")) assert.ok(q.maxAnswerSeconds > 0);
});
test("recording format detection handles absent or unsupported MediaRecorder", () => {
  const original = globalThis.MediaRecorder;
  try {
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: undefined,
    });
    assert.equal(recordingMime(), undefined);
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: { isTypeSupported: (t: string) => t === "audio/mp4" },
    });
    assert.equal(recordingMime(), "audio/mp4");
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: { isTypeSupported: () => false },
    });
    assert.equal(recordingMime(), undefined);
  } finally {
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: original,
    });
  }
});
