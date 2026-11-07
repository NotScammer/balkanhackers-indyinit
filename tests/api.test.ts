import assert from "node:assert/strict";
import { test } from "node:test";
import { realApi, RequestError, tokenKey } from "../src/lib/client/api";
const values = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  },
});
test("real adapter sends exact endpoint, authorization and stable answer payload", async () => {
  values.set(tokenKey("opaque-id"), "private-token");
  const answer = {
    clientAnswerId: "stable-uuid",
    questionId: "q1",
    transcript: "My answer",
    inputMode: "text" as const,
    durationSeconds: null,
  };
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(input, "/api/v1/sessions/opaque-id/answers");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer private-token",
    );
    assert.equal(init?.cache, "no-store");
    assert.deepEqual(JSON.parse(init?.body as string), answer);
    return Response.json({
      sessionId: "opaque-id",
      status: "active",
      answer: {},
      nextTurn: null,
    });
  };
  try {
    await realApi.submit("opaque-id", answer);
    await realApi.submit("opaque-id", answer);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
test("rate limits retain structured retry information without exposing provider messages", async () => {
  const original = globalThis.fetch;
  values.set(tokenKey("id"), "token");
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "private provider details",
          retryable: true,
          requestId: "request",
        },
      },
      { status: 429, headers: { "Retry-After": "3" } },
    );
  try {
    await assert.rejects(
      () => realApi.session("id"),
      (e: unknown) =>
        e instanceof RequestError &&
        e.retryAfter === 3000 &&
        e.retryable &&
        !e.message.includes("private provider"),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("transcription uses multipart with questionId and detected audio format", async () => {
  const original = globalThis.fetch;
  values.set(tokenKey("id"), "token");
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "/api/v1/sessions/id/transcriptions");
    assert.equal(new Headers(init?.headers).has("Content-Type"), false);
    const form = init?.body as FormData;
    assert.equal(form.get("questionId"), "q1");
    assert.equal((form.get("audio") as File).name, "answer.ogg");
    return Response.json({ transcript: "Draft only" });
  };
  try {
    assert.deepEqual(
      await realApi.transcribe(
        "id",
        "q1",
        new Blob(["audio"], { type: "audio/ogg" }),
      ),
      { transcript: "Draft only" },
    );
  } finally {
    globalThis.fetch = original;
  }
});

 test("invalid AI responses explain how to recover without exposing provider details", async () => {
  const original = globalThis.fetch;
  values.set(tokenKey("id"), "token");
  globalThis.fetch = async () => Response.json({ error: { code: "AI_INVALID_OUTPUT", message: "private details", retryable: true } }, { status: 502 });
  try {
    await assert.rejects(() => realApi.session("id"), (e: unknown) => e instanceof RequestError && e.retryable && e.message.includes("Retry saving") && !e.message.includes("private details"));
  } finally { globalThis.fetch = original; }
});
