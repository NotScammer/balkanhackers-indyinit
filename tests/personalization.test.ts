import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { TestDatabase, forecast, seedTestForecast } from "./database";
import { testUser, otherUser } from "./identity";
import { createApi } from "../src/server/api";
import { resumeText, validateResumeText } from "../src/server/profiles";
import { questionWithinLimit } from "../src/server/questions";
import { AppError } from "../src/server/errors";
import type { StructuredAI } from "../src/server/providers/anthropic";
import JSZip from "jszip";
const profile = {
  experience: ["Built an inventory service"],
  projects: ["Stockroom"],
  skills: ["TypeScript"],
  accomplishments: ["Reduced update latency"],
};
let db: TestDatabase;
let fail = false;
const contexts: Record<string, unknown>[] = [];
const ai: StructuredAI = {
  model: "personalization-fixture",
  async generate<T>(schema: z.ZodType<T>, _instruction: string, raw: unknown) {
    if (fail) throw new AppError("AI_UNAVAILABLE", 502, "Unavailable", true);
    const data = raw as Record<string, unknown>;
    contexts.push(data);
    if ("resume" in data) return schema.parse(profile);
    return schema.parse({
      text: "Explain capacity planning for an inventory update service.",
      kind: data.kind,
      difficulty: data.difficulty,
      topic: forecast.topic,
      forecastId: forecast.id,
      evidenceIds: [forecast.evidence[0].id],
      assessmentGuidance: "Assess the requested explanation only.",
      expectedConcepts: ["Capacity"],
    });
  },
};
const api = (owner = testUser) =>
  createApi({
    db,
    ai: () => ai,
    authenticate: async () => owner,
    dataMode: "illustrative",
    rateSalt: "test",
    dailyLimit: 100,
    realtime: async () => ({}),
  });
const req = (data?: unknown) =>
  new Request("http://localhost/api/v1/profile", {
    method: data ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
beforeAll(async () => {
  db = await TestDatabase.create();
  await seedTestForecast(db);
});
afterAll(async () => {
  await db?.sql.close();
});
beforeEach(async () => {
  fail = false;
  contexts.length = 0;
  await db.sql.exec(
    "delete from candidate_profiles; delete from interview_sessions; delete from rate_buckets;",
  );
});
it("saves edits and replacements, isolates owners, and removes profiles", async () => {
  expect((await api().profile.save(req(profile))).status).toBe(200);
  expect(await (await api().profile.get(req())).json()).toEqual(profile);
  expect(await (await api(otherUser).profile.get(req())).json()).toBeNull();
  const edited = { ...profile, skills: ["Rust"] };
  await api().profile.save(req(edited));
  expect(await (await api().profile.get(req())).json()).toEqual(edited);
  await api(otherUser).profile.remove(req());
  expect(await (await api().profile.get(req())).json()).toEqual(edited);
  expect((await api().profile.remove(req())).status).toBe(204);
  expect(await (await api().profile.get(req())).json()).toBeNull();
});
it("requires sign-in and restricts direct profile table access", async () => {
  const unauthorized = createApi({
    db,
    ai: () => ai,
    authenticate: async () => {
      throw new AppError("UNAUTHORIZED", 401, "Sign in");
    },
    dataMode: "illustrative",
    rateSalt: "test",
    dailyLimit: 100,
    realtime: async () => ({}),
  });
  expect((await unauthorized.profile.get(req())).status).toBe(401);
  await db.sql.exec("set role authenticated");
  try {
    await expect(
      db.sql.query("select * from candidate_profiles"),
    ).rejects.toThrow();
  } finally {
    await db.sql.exec("reset role");
  }
});
it("returns an extraction draft without saving and handles provider failure", async () => {
  expect(
    await (
      await api().profile.extract(req({ text: "Built an inventory service" }))
    ).json(),
  ).toEqual(profile);
  expect(await (await api().profile.get(req())).json()).toBeNull();
  fail = true;
  expect((await api().profile.extract(req({ text: "My resume" }))).status).toBe(
    502,
  );
  expect(await (await api().profile.get(req())).json()).toBeNull();
});
it("rate-limits extraction", async () => {
  for (let i = 0; i < 10; i++)
    expect((await api().profile.extract(req({ text: "Resume" }))).status).toBe(
      200,
    );
  expect((await api().profile.extract(req({ text: "Resume" }))).status).toBe(
    429,
  );
});
it("stores a session snapshot without exposing it and retains generic behavior", async () => {
  const input = {
    companyId: "google",
    roleId: "software-engineer",
    round: "technical",
    audioProcessingConsent: true,
  };
  const personalization = {
    profile,
    jobDescription: "Build reliable inventory services",
  };
  const response = await api().create(req({ ...input, personalization }));
  expect(response.status).toBe(201);
  const session = await response.json();
  expect(session.personalization).toBeUndefined();
  expect(contexts.at(-1)?.personalization).toEqual(personalization);
  await api().profile.save(req({ ...profile, skills: ["Rust"] }));
  await api().profile.remove(req());
  expect(
    (await db.snapshot(session.sessionId))?.session.personalization,
  ).toEqual(personalization);
  const generic = await (await api().create(req(input))).json();
  expect(
    (await db.snapshot(generic.sessionId))?.session.personalization,
  ).toBeNull();
});
it("validates text and word limits", () => {
  expect(validateResumeText("  hello  ")).toBe("hello");
  expect(() => validateResumeText(" ")).toThrow();
  expect(() => validateResumeText("a".repeat(30001))).toThrow();
  expect(questionWithinLimit("word ".repeat(35), false)).toBe(true);
  expect(questionWithinLimit("word ".repeat(36), false)).toBe(false);
  expect(questionWithinLimit("word ".repeat(25), true)).toBe(true);
  expect(questionWithinLimit("word ".repeat(26), true)).toBe(false);
});
function pdf(text: string) {
  const content = `BT /F1 12 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new File([output], "resume.pdf", { type: "application/pdf" });
}
it("extracts an actual PDF and rejects an empty scanned-style PDF", async () => {
  expect(await resumeText(pdf("Built an inventory service"))).toContain(
    "Built an inventory service",
  );
  await expect(resumeText(pdf(""))).rejects.toThrow();
});
it("extracts an actual DOCX", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Built an inventory service</w:t></w:r></w:p></w:body></w:document>',
  );
  const bytes = await zip.generateAsync({ type: "uint8array" });
  expect(
    await resumeText(new File([new Uint8Array(bytes)], "resume.docx")),
  ).toContain("Built an inventory service");
});
it("rejects unsupported, corrupt and oversized files", async () => {
  for (const name of ["resume.txt", "resume.pdf", "resume.docx"])
    await expect(resumeText(new File(["corrupt"], name))).rejects.toMatchObject(
      { code: "RESUME_UNREADABLE" },
    );
  await expect(
    resumeText(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "resume.pdf")),
  ).rejects.toMatchObject({ status: 413 });
});
