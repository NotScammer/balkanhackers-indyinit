import { testUser } from "./identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TestDatabase, forecast, seedTestForecast } from "./database";
import { createApi } from "../src/server/api";
import type { StructuredAI } from "../src/server/providers/anthropic";
import type { LiveRequest, LiveView } from "../src/shared/live";
import type { CreateSessionResponse } from "../src/shared/contracts";
import { AppError } from "../src/server/errors";
import { hashToken } from "../src/server/auth";
import { realtimeConfig } from "../src/server/realtime";
import type { LiveState } from "../src/server/live/service";
let failNext = false;
let exploreStrength = false;
let moveOn = false;
let generationContext: Record<string, unknown> = {};
let db: TestDatabase;
let api: ReturnType<typeof createApi>;
let calls = 0;
let serial = 0;
const texts = [
  "Describe a difficult project and explain your individual contribution and lessons learned.",
  "Explain the trade-offs you considered when prioritizing work under an urgent deadline.",
  "Discuss your process for resolving disagreement with a colleague about requirements.",
  "Explain memory bandwidth constraints in an inference deployment and useful measurements.",
  "Describe how you would investigate poor cache locality during model serving.",
  "Discuss compute utilization and batching strategies under variable demand.",
  "Design a reliable inference gateway with capacity limits and graceful recovery.",
  "Describe the storage and queueing components needed for asynchronous inference.",
  "Which performance assumption would you validate first and why?",
  "What failure would change your original approach most?",
  "How would you measure adoption after releasing the service?",
  "Explain how observability would help detect and isolate failures in this architecture.",
];
const ai: StructuredAI = {
  model: "live-test-no-network",
  async generate<T>(
    schema: z.ZodType<T>,
    _instruction: string,
    raw: unknown,
  ): Promise<T> {
    calls++;
    if (failNext) {
      failNext = false;
      throw new AppError("AI_UNAVAILABLE", 502, "Test provider outage.", true);
    }
    const data = raw as Record<string, unknown>;
    if ("utterance" in data) {
      const utterance = String(data.utterance);
      return schema.parse({
        intent:
          utterance === "clarify please"
            ? "clarification"
            : utterance === "repeat"
              ? "repeat"
              : "answer",
        explanation:
          utterance === "clarify please"
            ? "Please explain your own reasoning within the scope of the question."
            : "",
      });
    }
    if ("confirmedTranscript" in data) {
      const kind = (data.question as { kind: string }).kind;
      const good = String(data.confirmedTranscript).includes("corrected");
      return schema.parse({
        questionKind: kind,
        rubricVersion:
          kind === "system_design" ? "system-design-v1" : `${kind}-v1`,
        scores: { content: good ? 90 : 70, structure: 80, relevance: 80 },
        evidence: [
          {
            category: "content",
            quote: String(data.confirmedTranscript).split(" ")[0],
            explanation: "Specific evidence.",
          },
        ],
        strengths: ["You explained your reasoning."],
        weaknesses: ["Explain verification."],
        improvements: ["Explain how you would verify your assumptions."],
        suggestedAnswerOutline: ["Context", "Reasoning", "Validation"],
        understoodConcepts: ["Reasoning"],
        missingConcepts: ["Verification"],
        reasoningGaps: [],
        misconceptions: [],
        adaptiveNextAction: {
          action: moveOn ? "new_topic" : "follow_up",
          purpose: "explore_strength", target: "Measured latency",
          weaknesses: exploreStrength ? [] : ["Verification"],
          reasoning: "Probe verification.",
          targetTopic: forecast.topic,
        },
      });
    }
    generationContext = data;
    const kind = data.kind;
    const behavioral = kind === "behavioral";
    return schema.parse({
      text: texts[serial++],
      kind,
      topic: forecast.topic,
      difficulty: data.difficulty,
      forecastId: behavioral ? null : forecast.id,
      evidenceIds: behavioral ? [] : [forecast.evidence[0].id],
      assessmentGuidance: "Assess reasoning and verification privately.",
      expectedConcepts: ["Verification"],
    });
  },
};
const request = (token?: string, input?: unknown) =>
  new Request("http://localhost", {
    method: input ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
let session: CreateSessionResponse;
let view: LiveView;
async function utterance(
  text = "I measured latency and verified results.",
  extra: Partial<Extract<LiveRequest, { kind: "utterance" }>> = {},
) {
  const input: LiveRequest = {
    kind: "utterance",
    clientRequestId: randomUUID(),
    revision: view.revision,
    questionId: view.currentQuestion!.id,
    transcript: text,
    ...extra,
  };
  const response = await api.live.turn(
    request(session.sessionToken, input),
    session.sessionId,
  );
  const result = await response.json();
  if (response.ok) view = result;
  return { response, result, input };
}
beforeAll(async () => {
  db = await TestDatabase.create();
  await seedTestForecast(db);
});
afterAll(async () => {
  await db?.sql.close();
});
beforeEach(async () => {
  failNext = false;
  calls = 0;
  serial = 0; exploreStrength = false; moveOn = false;
  await db.sql.exec(
    "delete from interview_sessions; delete from rate_buckets;",
  );
  api = createApi({
    authenticate: async () => testUser,
    db,
    ai: () => ai,
    dataMode: "illustrative",
    rateSalt: "test",
    dailyLimit: 100,
    realtime: async () => ({ clientSecret: "test-ephemeral" }),
  });
  const created = await api.create(
    request(undefined, {
      companyId: "google",
      roleId: "software-engineer",
      round: "mixed",
      audioProcessingConsent: true,
    }),
  );
  session = await created.json();
  expect(created.status).toBe(201);
  view = await (
    await api.live.get(request(session.sessionToken), session.sessionId)
  ).json();
});
describe("live interview persistence and progression", () => {
  it("covers three main kinds with three extra follow-ups each, withholding all coaching and scores until completion", async () => {
    const kinds: string[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      kinds.push(view.currentQuestion!.kind);
      ids.push(view.currentQuestion!.id);
      const { response } = await utterance();
      expect(response.status).toBe(200);
      expect(view.messages.filter((m) => m.kind === "feedback")).toHaveLength(
        0,
      );
      if (i < 11) {
        expect(view.report).toBeNull();
        expect(JSON.stringify(view)).not.toContain(
          "You explained your reasoning.",
        );
        expect(JSON.stringify(view)).not.toContain(
          "Explain how you would verify your assumptions.",
        );
        expect(JSON.stringify(view)).not.toMatch(
          /"overallScore":|"adaptiveNextAction":|"assessment_guidance":|"scores":|"expectedConcepts":/,
        );
      }
    }
    expect(new Set(ids).size).toBe(12);
    expect(kinds).toEqual([
      "behavioral",
      "behavioral",
      "behavioral",
      "behavioral",
      "technical",
      "technical",
      "technical",
      "technical",
      "system_design",
      "system_design",
      "system_design",
      "system_design",
    ]);
    expect(view.status).toBe("completed");
    expect(view.report!.coverage).toEqual({
      answeredMainQuestions: 3,
      plannedMainQuestions: 3,
      finishedEarly: false,
    });
    expect(view.spokenText).toContain(
      "One strength: You explained your reasoning.",
    );
    expect(view.report!.answers).toHaveLength(3);
    expect(
      view.report!.answers.every(
        (a) => a.transcript.split("\n\n").length === 4,
      ),
    ).toBe(true);
    expect((await db.snapshot(session.sessionId))!.session.status).toBe(
      "completed",
    );
    expect(
      (await api.live.token(request(session.sessionToken), session.sessionId))
        .status,
    ).toBe(409);
    expect(
      (
        await (
          await api.report(request(session.sessionToken), session.sessionId)
        ).json()
      ).answers,
    ).toHaveLength(3);
  });
  it.each(["behavioral", "technical", "system_design"])(
    "keeps all live main questions and follow-ups in %s mode",
    async (round) => {
      serial = 0;
      const created = await api.create(
        request(undefined, {
          companyId: "google",
          roleId: "software-engineer",
          round,
          audioProcessingConsent: true,
        }),
      );
      session = await created.json();
      view = await (
        await api.live.get(request(session.sessionToken), session.sessionId)
      ).json();
      for (let i = 0; i < 12; i++) {
        expect(view.currentQuestion!.kind).toBe(round);
        expect((await utterance()).response.status).toBe(200);
      }
      expect(view.report!.answers).toHaveLength(3);
      expect(
        view.report!.answers.every(
          (answer) => answer.evaluation.questionKind === round,
        ),
      ).toBe(true);
    },
  );
  it("clarifies and repeats without scoring or using a follow-up", async () => {
    const prompt = view.currentQuestion!.id;
    const before = calls;
    await utterance("clarify please");
    await utterance("repeat");
    expect(view.currentQuestion!.id).toBe(prompt);
    expect(view.followUpNumber).toBe(0);
    expect(calls - before).toBe(1);
    expect(view.messages.some((m) => m.kind === "answer")).toBe(false);
    expect(view.spokenText).toBe(view.currentQuestion!.text);
  });
  it("deduplicates successful turns and rejects altered retry payloads and stale progression", async () => {
    const { input, result } = await utterance();
    const count = calls;
    expect(
      await (
        await api.live.turn(
          request(session.sessionToken, input),
          session.sessionId,
        )
      ).json(),
    ).toEqual(result);
    expect(calls).toBe(count);
    const conflict = await api.live.turn(
      request(session.sessionToken, { ...input, transcript: "changed" }),
      session.sessionId,
    );
    expect(conflict.status).toBe(409);
    const stale = await utterance("late words", { revision: 0 });
    expect(stale.response.status).toBe(409);
  });
  it("corrects a saved transcript and recomputes the grouped assessment without advancing", async () => {
    await utterance();
    const answer = view.messages.find(
      (m) => m.role === "candidate" && m.kind === "answer",
    )!;
    const questionId = view.currentQuestion!.id;
    const correction: LiveRequest = {
      kind: "correct",
      clientRequestId: randomUUID(),
      revision: view.revision,
      answerId: answer.id,
      transcript: "corrected transcript with real details",
    };
    const response = await api.live.turn(
      request(session.sessionToken, correction),
      session.sessionId,
    );
    expect(response.status).toBe(200);
    view = await response.json();
    expect(view.currentQuestion!.id).toBe(questionId);
    expect(view.followUpNumber).toBe(1);
    expect(view.report).toBeNull();
    expect(view.messages.find((m) => m.id === answer.id)!.text).toBe(
      correction.transcript,
    );
    const restored = await (
      await api.live.get(request(session.sessionToken), session.sessionId)
    ).json();
    expect(restored).toEqual(view);
  });
  it("keeps completed reports correctable and updates the persisted report", async () => {
    for (let i = 0; i < 12; i++) await utterance();
    const previousScore = view.report!.overallScore;
    const answer = view.messages.find(
      (m) => m.role === "candidate" && m.kind === "answer",
    )!;
    const response = await api.live.turn(
      request(session.sessionToken, {
        kind: "correct",
        clientRequestId: randomUUID(),
        revision: view.revision,
        answerId: answer.id,
        transcript: "corrected factual transcript",
      }),
      session.sessionId,
    );
    expect(response.status).toBe(200);
    view = await response.json();
    expect(view.report!.overallScore).toBeGreaterThan(previousScore);
    expect(view.report!.answers).toHaveLength(3);
    expect((await db.snapshot(session.sessionId))!.report!.overallScore).toBe(
      view.report!.overallScore,
    );
  });
  it("rejects legacy answer submission while live progression owns the session", async () => {
    const response = await api.complete(
      request(session.sessionToken, {
        clientAnswerId: randomUUID(),
        questionId: session.currentTurn!.question.id,
        transcript: "I measured latency.",
        inputMode: "text",
      }),
      session.sessionId,
    );
    expect(response.status).toBe(409);
  });
  it("enforces capability access, expiry, end and cascading deletion", async () => {
    expect((await api.live.get(request(), session.sessionId)).status).toBe(401);
    expect(
      (
        await api.live.get(
          request("wrong-but-long-enough-token"),
          session.sessionId,
        )
      ).status,
    ).toBe(404);
    await api.end(request(session.sessionToken), session.sessionId);
    expect((await utterance()).response.status).toBe(404);
    const ended = await (
      await api.live.get(request(session.sessionToken), session.sessionId)
    ).json();
    expect(ended.status).toBe("cancelled");
    await api.remove(request(session.sessionToken), session.sessionId);
    expect(
      await db.rpc("read_live", { p_session_id: session.sessionId }),
    ).toBeNull();
  });
  it("keeps a late continuation attached to its original question without consuming another follow-up", async () => {
    const originalQuestion = view.currentQuestion!.id;
    await utterance();
    const nextQuestion = view.currentQuestion!.id;
    const result = await utterance("I also verified the failure paths.", {
      questionId: originalQuestion,
    });
    expect(result.response.status).toBe(200);
    expect(view.currentQuestion!.id).toBe(nextQuestion);
    expect(view.followUpNumber).toBe(1);
    expect(view.messages.filter((m) => m.kind === "answer")).toHaveLength(2);
    expect(view.spokenText).toContain("earlier answer");
  });
  it("preserves saved state through provider failure and safely retries the same request", async () => {
    failNext = true;
    const { input, response } = await utterance();
    expect(response.status).toBe(502);
    const saved = await (
      await api.live.get(request(session.sessionToken), session.sessionId)
    ).json();
    expect(saved.revision).toBe(0);
    expect(saved.messages).toHaveLength(1);
    const retry = await api.live.turn(
      request(session.sessionToken, input),
      session.sessionId,
    );
    expect(retry.status).toBe(200);
    expect((await retry.json()).revision).toBe(1);
  });
  it("denies expired sessions and prevents anonymous direct database access", async () => {
    await db.sql.exec("set role anon");
    try {
      await expect(
        db.sql.query("select state from live_interviews"),
      ).rejects.toThrow();
      await expect(
        db.sql.query("select read_live($1)", [session.sessionId]),
      ).rejects.toThrow();
    } finally {
      await db.sql.exec("reset role");
    }
    await db.sql.query(
      "update interview_sessions set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where id=$1",
      [session.sessionId],
    );
    expect(
      (await api.live.get(request(session.sessionToken), session.sessionId))
        .status,
    ).toBe(404);
    expect(
      (await api.live.token(request(session.sessionToken), session.sessionId))
        .status,
    ).toBe(404);
  });
  it("serializes concurrent work with a durable lease", async () => {
    const lease = randomUUID();
    const req = randomUUID();
    await db.rpc("claim_live", {
      p_session_id: session.sessionId,
      p_request_id: req,
      p_hash: hashToken("test"),
      p_revision: 0,
      p_lease: lease,
    });
    expect((await utterance()).response.status).toBe(409);
    await db.rpc("release_live", {
      p_session_id: session.sessionId,
      p_lease: lease,
    });
    expect((await utterance()).response.status).toBe(200);
  });
});

async function control(action: "repeat" | "pause" | "finish") {
  const input: LiveRequest = {
    kind: "control",
    clientRequestId: randomUUID(),
    revision: view.revision,
    action,
  };
  const response = await api.live.turn(
    request(session.sessionToken, input),
    session.sessionId,
  );
  const result = await response.json();
  if (response.ok) view = result;
  return { response, result, input };
}

describe("conversation controls and end-only feedback", () => {
  it("pauses and repeats without assessment or advancement, and deduplicates controls", async () => {
    const questionId = view.currentQuestion!.id;
    const before = calls;
    const paused = await control("pause");
    expect(view.control).toBe("pause");
    const replay = await api.live.turn(
      request(session.sessionToken, paused.input),
      session.sessionId,
    );
    expect(await replay.json()).toEqual(paused.result);
    await control("repeat");
    expect(view.control).toBeUndefined();
    expect(view.currentQuestion!.id).toBe(questionId);
    expect(
      view.messages.filter((message) => message.kind === "answer"),
    ).toHaveLength(0);
    expect(calls).toBe(before);
    expect(view.report).toBeNull();
  });
  it("finishes early with a persisted report averaged over answered groups only", async () => {
    for (let i = 0; i < 4; i++) await utterance();
    expect(view.mainNumber).toBe(2);
    const { response, input, result } = await control("finish");
    expect(response.status).toBe(200);
    expect(view.report!.answers).toHaveLength(1);
    expect(view.report!.coverage).toEqual({
      answeredMainQuestions: 1,
      plannedMainQuestions: 3,
      finishedEarly: true,
    });
    expect(view.report!.overallScore).toBe(
      view.report!.answers[0].evaluation.overallScore,
    );
    expect(view.report!.categoryAverages.content).toBe(70);
    expect(view.spokenText).toContain("You finished early");
    expect(view.spokenText).toContain("One strength");
    expect((await db.snapshot(session.sessionId))!.report).toEqual(view.report);
    expect(
      await (
        await api.live.turn(
          request(session.sessionToken, input),
          session.sessionId,
        )
      ).json(),
    ).toEqual(result);
    expect(
      await (
        await api.live.get(request(session.sessionToken), session.sessionId)
      ).json(),
    ).toEqual(view);
  });
  it("finishes with zero answers without manufacturing a score and can retry", async () => {
    const { response, input } = await control("finish");
    expect(response.status).toBe(200);
    expect(view.status).toBe("cancelled");
    expect(view.report).toBeNull();
    expect((await db.snapshot(session.sessionId))!.session.status).toBe(
      "cancelled",
    );
    expect(
      (
        await api.live.turn(
          request(session.sessionToken, input),
          session.sessionId,
        )
      ).status,
    ).toBe(200);
    expect(
      (await api.report(request(session.sessionToken), session.sessionId))
        .status,
    ).toBe(409);
  });
  it("recognizes spoken controls but retains command-like narrative as answer evidence", async () => {
    await utterance("Can you pause the interview please?");
    expect(view.control).toBe("pause");
    expect(
      view.messages.filter((message) => message.kind === "answer"),
    ).toHaveLength(0);
    await utterance(
      "I asked my teammate to pause the interview process and finish the project first.",
    );
    expect(
      view.messages.filter((message) => message.kind === "answer"),
    ).toHaveLength(1);
    await utterance("Finish interview.");
    expect(view.status).toBe("completed");
    expect(view.report!.answers).toHaveLength(1);
  });
  it("keeps corrections private, then refreshes the report and recap after early completion", async () => {
    await utterance();
    const answerId = view.messages.find(
      (message) => message.kind === "answer",
    )!.id;
    const correct = async (transcript: string) => {
      const response = await api.live.turn(
        request(session.sessionToken, {
          kind: "correct",
          clientRequestId: randomUUID(),
          revision: view.revision,
          answerId,
          transcript,
        }),
        session.sessionId,
      );
      expect(response.status).toBe(200);
      view = await response.json();
    };
    await correct("corrected transcript with details");
    expect(view.messages.some((message) => message.kind === "feedback")).toBe(
      false,
    );
    expect(JSON.stringify(view)).not.toContain("You explained your reasoning.");
    await control("finish");
    const score = view.report!.overallScore;
    await correct("I measured the actual result.");
    expect(view.report!.overallScore).toBeLessThan(score);
    expect(view.spokenText).toContain(
      `${view.report!.overallScore} out of 100`,
    );
    expect((await db.snapshot(session.sessionId))!.report).toEqual(view.report);
  });
  it("filters legacy coaching on restore and on successful cached retries", async () => {
    const { input } = await utterance();
    const saved = await db.rpc<LiveState>("read_live", {
      p_session_id: session.sessionId,
    });
    const feedback = {
      ...saved.messages[0],
      id: randomUUID(),
      kind: "feedback" as const,
      text: "PRIVATE COACHING FROM AN OLD SESSION",
    };
    saved.messages.push(feedback);
    saved.spokenText = feedback.text;
    await db.sql.query(
      "update live_interviews set state=$2 where session_id=$1",
      [session.sessionId, JSON.stringify(saved)],
    );
    const staleResponse = {
      ...view,
      messages: saved.messages,
      spokenText: saved.spokenText,
    };
    await db.sql.query(
      "update live_requests set response=$3 where session_id=$1 and request_id=$2",
      [session.sessionId, input.clientRequestId, JSON.stringify(staleResponse)],
    );
    const restored = await (
      await api.live.get(request(session.sessionToken), session.sessionId)
    ).json();
    const replay = await (
      await api.live.turn(
        request(session.sessionToken, input),
        session.sessionId,
      )
    ).json();
    for (const response of [restored, replay]) {
      expect(JSON.stringify(response)).not.toContain(feedback.text);
      expect(response.spokenText).toBe(view.currentQuestion!.text);
      expect(response.report).toBeNull();
    }
  });
  it("issues recap credentials only for completed reports and disables input turn detection", async () => {
    expect(
      (
        await api.live.token(
          request(session.sessionToken, { purpose: "recap" }),
          session.sessionId,
        )
      ).status,
    ).toBe(409);
    await utterance();
    await control("finish");
    expect(
      (await api.live.token(request(session.sessionToken), session.sessionId))
        .status,
    ).toBe(409);
    expect(
      (
        await api.live.token(
          request(session.sessionToken, { purpose: "recap" }),
          session.sessionId,
        )
      ).status,
    ).toBe(200);
    const config = realtimeConfig(
      (await db.snapshot(session.sessionId))!,
      "test-voice",
      "test-transcription",
      "recap",
    );
    expect(config.audio.input.turn_detection).toBeNull();
    expect(config.audio.input).not.toHaveProperty("transcription");
    expect(config.instructions).toContain("Your practice score");
    expect(
      (
        await api.live.token(
          request(undefined, { purpose: "recap" }),
          session.sessionId,
        )
      ).status,
    ).toBe(401);
  });
});

it("explores strengths with answer context even without weakness notes", async () => {
 exploreStrength = true;
 expect((await utterance("I measured p99 latency using a load generator.")).response.status).toBe(200);
 expect(view.followUpNumber).toBe(1);
 expect(generationContext.followUp).toMatchObject({purpose:"explore_strength",target:"Measured latency",weaknesses:[]});
 expect(generationContext.context).toMatchObject({history:[{answer:"I measured p99 latency using a load generator."}]});
});
it("moves on when there is sufficient evidence", async () => {
 moveOn = true;
 await utterance();
 expect(view.mainNumber).toBe(2);
 expect(view.followUpNumber).toBe(0);
});
it("skips unanswered topics without inventing evidence and deduplicates next-topic controls", async () => {
 const input = {kind:"control",action:"next_topic",clientRequestId:randomUUID(),revision:view.revision};
 const response = await api.live.turn(request(session.sessionToken,input),session.sessionId);
 expect(response.status).toBe(200); view = await response.json();
 expect(view.mainNumber).toBe(2);
 expect(view.messages.filter(m=>m.kind==="answer")).toHaveLength(0);
 const retry = await api.live.turn(request(session.sessionToken,input),session.sessionId);
 expect(await retry.json()).toEqual(view);
 moveOn = true;
 await utterance(); await utterance();
 expect(view.status).toBe("completed");
 expect(view.report?.answers).toHaveLength(2);
 expect(view.report?.coverage).toMatchObject({answeredMainQuestions:2,finishedEarly:true});
});
