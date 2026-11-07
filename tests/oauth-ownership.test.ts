import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApi } from "../src/server/api";
import { AppError } from "../src/server/errors";
import { authorize, hashToken } from "../src/server/auth";
import { TestDatabase, forecast, seedTestForecast } from "./database";
import { otherUser, testUser } from "./identity";
import type { CreateSessionResponse } from "../src/shared/contracts";
import type { StructuredAI } from "../src/server/providers/anthropic";
let db: TestDatabase;
beforeAll(async () => {
  db = await TestDatabase.create();
  await seedTestForecast(db);
});
afterAll(async () => {
  await db.sql.close();
});
const request = (token?: string, payload?: unknown) =>
  new Request("http://localhost/api", {
    method: payload ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
const ai: StructuredAI = {
  model: "test-only",
  generate: async <T>(schema: z.ZodType<T>): Promise<T> =>
    schema.parse({
      text: "Explain inference capacity planning and the measurements needed to validate a deployment.",
      kind: "technical",
      topic: forecast.topic,
      difficulty: "intermediate",
      forecastId: forecast.id,
      evidenceIds: [forecast.evidence[0].id],
      assessmentGuidance: "Assess the assumptions and validation steps.",
      expectedConcepts: ["Capacity"],
    }),
};
function apiFor(user = testUser) {
  return createApi({
    db,
    ai: () => ai,
    authenticate: async () => user,
    dataMode: "illustrative",
    rateSalt: "test",
    dailyLimit: 100,
    realtime: async () => ({}),
  });
}
async function create() {
  const response = await apiFor().create(
    request(undefined, {
      companyId: "google",
      roleId: "software-engineer",
      round: "technical",
      audioProcessingConsent: true,
    }),
  );
  expect(response.status).toBe(201);
  return response.json() as Promise<CreateSessionResponse>;
}
it("rejects unauthenticated creation before database budgets, research reads or AI calls", async () => {
  const untouched = vi.spyOn(db, "rpc");
  const api = createApi({
    db,
    ai: () => {
      throw new Error("AI must not run");
    },
    authenticate: async () => {
      throw new AppError("UNAUTHORIZED", 401, "Sign in.");
    },
    dataMode: "verified",
    rateSalt: "test",
    dailyLimit: 100,
    realtime: async () => ({}),
  });
  const response = await api.create(
    request(undefined, {
      companyId: "google",
      roleId: "software-engineer",
      round: "technical",
    }),
  );
  expect(response.status).toBe(401);
  expect(untouched).not.toHaveBeenCalled();
  untouched.mockRestore();
});
it("binds the owner from verified identity and rejects client-supplied owner fields", async () => {
  const session = await create();
  expect((await db.snapshot(session.sessionId))!.session.owner_id).toBe(
    testUser.id,
  );
  const response = await apiFor().create(
    request(undefined, {
      companyId: "google",
      roleId: "software-engineer",
      round: "technical",
      ownerId: otherUser.id,
    }),
  );
  expect(response.status).toBe(400);
});
it("denies another account even if it has the valid interview capability, across all private API variants", async () => {
  const session = await create();
  const attacker = apiFor(otherUser);
  const req = () => request(session.sessionToken);
  for (const endpoint of [
    attacker.get,
    attacker.frontendGet,
    attacker.frontendComplete,
    attacker.complete,
    attacker.report,
    attacker.end,
    attacker.remove,
    attacker.realtime,
    attacker.live.get,
    attacker.live.turn,
    attacker.live.token,
  ]) {
    const response = await endpoint(req(), session.sessionId);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("SESSION_UNAVAILABLE");
  }
  expect((await db.snapshot(session.sessionId))!.session.status).toBe("active");
});
it("requires both the OAuth session and interview capability for private reads", async () => {
  const session = await create();
  expect((await apiFor().get(request(), session.sessionId)).status).toBe(401);
  expect(
    (await apiFor().get(request(session.sessionToken), session.sessionId))
      .status,
  ).toBe(200);
  await expect(
    authorize(
      db,
      session.sessionId,
      request(session.sessionToken),
      async () => {
        throw new AppError("UNAUTHORIZED", 401, "Signed out.");
      },
    ),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
it("prevents creating ownerless interviews even with a service-role database call", async () => {
  await expect(
    db.rpc("create_interview", { p_s: {}, p_q: {} }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
it("cascades interview data when the owning Supabase user is deleted", async () => {
  const session = await create();
  await db.sql.query("delete from auth.users where id=$1", [testUser.id]);
  expect(await db.snapshot(session.sessionId)).toBeNull();
  expect(
    (
      await db.sql.query(
        "select * from session_questions where session_id=$1",
        [session.sessionId],
      )
    ).rows,
  ).toHaveLength(0);
});

it("preserves pre-migration anonymous data without assigning it to a new account", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFile } = await import("node:fs/promises");
  const sql = new PGlite();
  try {
    await sql.exec(
      "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);",
    );
    for (const name of [
      "202611070001_backend.sql",
      "202611070002_research_persistence.sql",
      "202611070003_live_conversation.sql",
    ]) {
      await sql.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    }
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await sql.query(
      `insert into interview_sessions(id,company_id,role_id,interview_mode,difficulty,total_turns,session_token_hash,audio_processing_consent,data_mode,expires_at)
      values($1,'google','software-engineer','behavioral','intermediate',3,$2,false,'illustrative',now()+interval '24 hours')`,
      [id, hashToken("legacy-capability-token")],
    );
    await sql.exec(
      await readFile(
        "supabase/migrations/202611070004_oauth_ownership.sql",
        "utf8",
      ),
    );
    const result = await sql.query<{ owner_id: string | null }>(
      "select owner_id from interview_sessions where id=$1",
      [id],
    );
    expect(result.rows).toEqual([{ owner_id: null }]);
    await expect(
      authorize(
        new TestDatabase(sql),
        id,
        request("legacy-capability-token"),
        async () => testUser,
      ),
    ).rejects.toMatchObject({ code: "SESSION_UNAVAILABLE" });
  } finally {
    await sql.close();
  }
});
