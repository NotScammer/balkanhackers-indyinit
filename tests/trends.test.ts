import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { TestDatabase } from "./database";
import {
  assessInterest,
  appliedTopicRelevance,
  MAX_TREND_LOOKUPS,
  TREND_METHOD,
  unknownTrend,
  type InterestPoint,
} from "../src/server/research/trends/assessment";
import {
  parseTrendSeries,
  SerpApiTrends,
  type TrendsProvider,
} from "../src/server/research/trends/provider";
import { CachedTopicTrends } from "../src/server/research/trends/cache";
import {
  forecastScore,
  rankHypothesis,
} from "../src/server/research/forecasting";
import { refreshSavedForecasts } from "../src/server/research/forecasting/refresh";
import type { RefreshForecast } from "../src/server/research/storage";

const now = Date.parse("2026-11-15T12:00:00Z");
// Synthetic monthly samples, never represented as real Google Trends measurements.
function series(baseline = 40, recent = 40, at = now): InterestPoint[] {
  const end = new Date(at);
  return Array.from({ length: 24 }, (_, i) => ({
    timestamp: new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 24 + i, 5),
    ).toISOString(),
    value: i < 12 ? baseline : recent,
  }));
}
const signal = () => new AbortController().signal;
const deadline = () => Date.now() + 210000;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("topic interest replaces publication age", () => {
  it.each([
    [40, 40, "stable"],
    [40, 80, "rising"],
    [40, 38, "stable"],
    [0, 20, "rising"],
  ] as const)(
    "awards 100 for retained interest (%i → %i)",
    (baseline, recent, direction) => {
      const result = assessInterest(
        "Memory management",
        "",
        series(baseline, recent),
        now,
      );
      expect(result).toMatchObject({
        status: "available",
        score: 100,
        direction,
        baselineAverage: baseline,
        recentAverage: recent,
      });
    },
  );
  it("scores a measured decline by the interest retained, including zero", () => {
    expect(assessInterest("Test", "", series(80, 40), now)).toMatchObject({
      score: 50,
      direction: "declining",
      retentionRatio: 0.5,
    });
    expect(assessInterest("Test", "", series(80, 0), now).score).toBe(0);
  });
  it("compares whole annual windows to avoid a seasonal month causing an age penalty", () => {
    const points = series().map((point, i) => ({
      ...point,
      value: 10 + (i % 12) * 5,
    }));
    expect(assessInterest("Seasonal topic", "", points, now).score).toBe(100);
  });
  it("requires every month and rejects an all-zero series without inventing a score", () => {
    for (const points of [[], series().slice(1), series(0, 0)]) {
      const result = assessInterest("Test", "", points, now);
      expect(result.status).toBe("insufficient_data");
      expect(result.score).toBeNull();
      expect(appliedTopicRelevance(result)).toBe(100);
    }
  });
  it("ignores the current month, future samples, and duplicate samples", () => {
    const points = [
      ...series(),
      ...series(),
      { timestamp: "2026-11-01T00:00:00Z", value: 0 },
      { timestamp: "2027-01-01T00:00:00Z", value: 0 },
    ].reverse();
    const result = assessInterest("Test", "", points, now);
    expect(result.score).toBe(100);
    expect(result.points).toHaveLength(25);
    expect(result.comparisonEnd).toBe("2026-11-01T00:00:00.000Z");
  });
  it("rejects invalid and conflicting measurements", () => {
    for (const point of [
      { timestamp: "bad", value: 10 },
      { timestamp: series()[0].timestamp, value: 101 },
      { timestamp: series()[0].timestamp, value: 11 },
    ]) {
      expect(() =>
        assessInterest("Test", "", [...series(), point], now),
      ).toThrow();
    }
  });
  it("gives a six-year-old paper the same score as a new paper on the same active topic", () => {
    const id = randomUUID();
    const source = {
      id,
      sourceType: "academic" as const,
      publisher: "arXiv",
      title: "Synthetic",
      url: "https://example.invalid/test",
      publishedAt: "2020-01-01",
      text: "Fixture",
      quality: "official" as const,
    };
    const hypothesis = {
      topic: "Memory management",
      explanation: "Fixture",
      predictedSkills: ["memory"],
      targetRoles: ["software-engineer" as const],
      timeHorizonMonths: 12,
      roleRelevance: 80,
      technicalMaturity: 70,
      evidence: [
        { sourceId: id, stance: "support" as const, explanation: "Fixture" },
      ],
    };
    const evidence = [
      { source, concepts: ["memory"], description: "Fixture", limitations: [] },
    ];
    const trend = assessInterest(hypothesis.topic, "", series(40, 80), now);
    const old = rankHypothesis(hypothesis, evidence, trend);
    const fresh = rankHypothesis(
      hypothesis,
      [{ ...evidence[0], source: { ...source, publishedAt: "2026-11-01" } }],
      trend,
    );
    expect(old.preparationScore).toBe(fresh.preparationScore);
    expect(old.dimensions.topicRelevance).toBe(100);
    expect(old.dimensions).not.toHaveProperty("recency");
    const declined = rankHypothesis(
      hypothesis,
      evidence,
      assessInterest(hypothesis.topic, "", series(80, 40), now),
    );
    expect(old.preparationScore - declined.preparationScore).toBe(5);
    expect(old.trendSnapshot).toEqual(trend);
  });
});

describe("Google Trends adapter", () => {
  const payload = {
    interest_over_time: {
      timeline_data: [
        { timestamp: "1791158400", values: [{ extracted_value: 42 }] },
        {
          timestamp: "1791763200",
          isPartial: true,
          values: [{ extracted_value: 0 }],
        },
      ],
    },
  };
  it("requests one five-year interest series with a fixed geography and excludes partial buckets", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal("fetch", fetcher);
    const points = await new SerpApiTrends("fixture-key").interestOverTime(
      "Memory management",
      "US",
      signal(),
    );
    expect(points).toEqual([
      { timestamp: new Date(1791158400000).toISOString(), value: 42 },
    ]);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://serpapi.com/search.json");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      engine: "google_trends",
      data_type: "TIMESERIES",
      q: "Memory management",
      date: "today 5-y",
      geo: "US",
      tz: "0",
    });
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
  it("rejects malformed, multi-term and out-of-range provider data", () => {
    expect(() => parseTrendSeries({})).toThrow();
    for (const values of [
      [{ extracted_value: 101 }],
      [{ extracted_value: 20 }, { extracted_value: 30 }],
    ]) {
      expect(() =>
        parseTrendSeries({
          interest_over_time: {
            timeline_data: [{ timestamp: "1791158400", values }],
          },
        }),
      ).toThrow();
    }
  });
  it("does not expose provider keys or error bodies on transport, rate-limit or parsing failure", async () => {
    for (const response of [
      new Response("secret upstream body", { status: 429 }),
      new Response("{}"),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(
        new SerpApiTrends("secret-fixture-key").interestOverTime(
          "Test",
          "",
          signal(),
        ),
      ).rejects.toMatchObject({
        code: "TRENDS_UNAVAILABLE",
        message: "Google Trends data is unavailable.",
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret-fixture-key URL")),
    );
    await expect(
      new SerpApiTrends("secret-fixture-key").interestOverTime(
        "Test",
        "",
        signal(),
      ),
    ).rejects.toMatchObject({ message: "Google Trends data is unavailable." });
  });
  it("never sends ambiguous comparison-list topics", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      new SerpApiTrends("fixture-key").interestOverTime(
        "AI, databases",
        "",
        signal(),
      ),
    ).rejects.toMatchObject({ code: "TRENDS_INVALID_QUERY" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("durable monthly Trends cache and forecast refresh", () => {
  let db: TestDatabase;
  let provider: TrendsProvider & { interestOverTime: ReturnType<typeof vi.fn> };
  const cache = (
    at = now,
    geo = "",
    supplied: TrendsProvider | null = provider,
    due = deadline(),
    abort = signal(),
  ) => new CachedTopicTrends(db, supplied, geo, abort, due, at);
  beforeAll(async () => {
    db = await TestDatabase.create();
  });
  afterAll(async () => {
    await db.sql.close();
  });
  beforeEach(async () => {
    await db.sql.exec(
      "delete from topic_trend_snapshots; delete from topic_forecasts; delete from research_sources; delete from research_runs;",
    );
    provider = { interestOverTime: vi.fn().mockResolvedValue(series()) };
  });
  it("coalesces normalized lookups and reuses saved data across instances for a month", async () => {
    const first = cache();
    const [a, b] = await Promise.all([
      first.lookup("Memory   management"),
      first.lookup(" memory management "),
    ]);
    expect(a).toEqual(b);
    expect(provider.interestOverTime).toHaveBeenCalledTimes(1);
    const saved = await cache().lookup("MEMORY MANAGEMENT");
    expect(saved).toMatchObject({
      cacheHit: true,
      fetched: false,
      assessment: { score: 100 },
    });
    expect(provider.interestOverTime).toHaveBeenCalledTimes(1);
    expect(
      (await db.sql.query("select * from topic_trend_snapshots")).rows,
    ).toHaveLength(1);
  });
  it("uses separate cache entries for new months and geographies", async () => {
    await cache().lookup("Test");
    await cache(now, "US").lookup("Test");
    const nextMonth = Date.parse("2026-12-15T12:00:00Z");
    provider.interestOverTime.mockResolvedValue(series(40, 40, nextMonth));
    await cache(nextMonth).lookup("Test");
    expect(provider.interestOverTime).toHaveBeenCalledTimes(3);
  });
  it("caches insufficient history without claiming a measured relevance score", async () => {
    provider.interestOverTime.mockResolvedValue([]);
    const first = await cache().lookup("New topic");
    const next = await cache().lookup("New topic");
    expect(first.assessment).toMatchObject({
      status: "insufficient_data",
      score: null,
    });
    expect(next.cacheHit).toBe(true);
    expect(provider.interestOverTime).toHaveBeenCalledTimes(1);
  });
  it("retries a provider outage on the next run instead of persisting a month-long failure", async () => {
    provider.interestOverTime.mockRejectedValueOnce(new Error("offline"));
    expect((await cache().lookup("Test")).assessment.status).toBe(
      "unavailable",
    );
    expect((await cache().lookup("Test")).assessment.status).toBe("available");
    expect(provider.interestOverTime).toHaveBeenCalledTimes(2);
  });
  it("retains a known decline as explicitly stale when the next month cannot be measured", async () => {
    provider.interestOverTime.mockResolvedValueOnce(series(80, 40));
    await cache().lookup("Test");
    const nextMonth = Date.parse("2026-12-15T12:00:00Z");
    provider.interestOverTime.mockRejectedValueOnce(new Error("offline"));
    const result = await cache(nextMonth).lookup("Test");
    expect(result.assessment).toMatchObject({
      status: "stale",
      score: 50,
      period: "2026-11-01",
      reasonCode: "TRENDS_UNAVAILABLE",
    });
    expect(appliedTopicRelevance(result.assessment)).toBe(50);
    const noKey = await cache(nextMonth, "", null).lookup("Test");
    expect(noKey.assessment).toMatchObject({
      status: "stale",
      score: 50,
      reasonCode: "TRENDS_NOT_CONFIGURED",
    });
  });
  it("does not use a future-month observation when assessing an older period", async () => {
    await cache().lookup("Test");
    const result = await cache(Date.parse("2026-10-15"), "", null).lookup(
      "Test",
    );
    expect(result.assessment).toMatchObject({
      status: "not_configured",
      score: null,
    });
  });
  it("makes no request without credentials, after cancellation, or near its deadline", async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await cache(now, "", null).lookup("A")).assessment.status).toBe(
      "not_configured",
    );
    expect(
      (await cache(now, "", provider, Date.now() + 1000).lookup("B")).assessment
        .status,
    ).toBe("budget_exhausted");
    expect(
      (
        await cache(now, "", provider, deadline(), controller.signal).lookup(
          "C",
        )
      ).assessment.status,
    ).toBe("budget_exhausted");
    expect(provider.interestOverTime).not.toHaveBeenCalled();
  });
  it("enforces a bounded per-run lookup budget", async () => {
    const instance = cache();
    for (let i = 0; i <= MAX_TREND_LOOKUPS; i++)
      await instance.lookup(`Topic ${i}`);
    expect(provider.interestOverTime).toHaveBeenCalledTimes(MAX_TREND_LOOKUPS);
    expect(
      (await instance.lookup(`Topic ${MAX_TREND_LOOKUPS}`)).assessment.status,
    ).toBe("budget_exhausted");
  });
  it("keeps trend tables and RPCs private while permitting the server role", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.sql.exec(`set role ${role}`);
      try {
        await expect(
          db.sql.query("select * from topic_trend_snapshots"),
        ).rejects.toThrow(/permission denied/);
        await expect(
          db.sql.query("select read_topic_trends('test','','2026-11-01',$1)", [
            TREND_METHOD,
          ]),
        ).rejects.toThrow(/permission denied/);
        await expect(
          db.sql.query(
            "select latest_topic_trends('test','',$1,'2026-11-01')",
            [TREND_METHOD],
          ),
        ).rejects.toThrow(/permission denied/);
        await expect(
          db.sql.query("select save_topic_trends($1)", [
            JSON.stringify(unknownTrend("Test")),
          ]),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.sql.exec("reset role");
      }
    }
    await db.sql.exec("set role service_role");
    try {
      expect((await cache().lookup("Test")).assessment.status).toBe(
        "available",
      );
    } finally {
      await db.sql.exec("reset role");
    }
  });
  it("refreshes an old saved forecast with its existing citations and no new AI research", async () => {
    const sourceId = randomUUID();
    await db.sql.query(
      "insert into research_sources(id,source_type,publisher,title,url,published_at) values($1,'academic','Fixture','Old fixture','https://example.invalid/old','2020-01-01')",
      [sourceId],
    );
    const saved: RefreshForecast = {
      id: randomUUID(),
      topic: "Memory management",
      explanation: "Synthetic prior hypothesis",
      predicted_skills: ["memory"],
      target_roles: ["software-engineer"],
      time_horizon_months: 12,
      evidence_confidence: "weak",
      dimensions: {
        industryMomentum: 0,
        academicMomentum: 20,
        roleRelevance: 80,
        technicalMaturity: 70,
      },
      evidence: [
        {
          research_source_id: sourceId,
          relationship_type: "academic",
          stance: "support",
          explanation: "Original citation",
        },
      ],
    };
    const store = { forecastRefreshCandidates: async () => [saved] };
    const trend = assessInterest(saved.topic, "", series(), now);
    const run = await db.rpc<{ id: string }>("acquire_research_run");
    const errors = vi.fn();
    const seen = new Set<string>();
    expect(
      await refreshSavedForecasts(
        db,
        store,
        async () => trend,
        seen,
        run.id,
        () => true,
        errors,
      ),
    ).toBe(1);
    const rows = (
      await db.sql.query<{
        dimensions: Record<string, number>;
        trend_snapshot: unknown;
        preparation_score: number;
      }>("select * from topic_forecasts")
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].dimensions.topicRelevance).toBe(100);
    expect(rows[0].preparation_score).toBe(
      forecastScore({ ...saved.dimensions, topicRelevance: 100 }),
    );
    expect(rows[0].trend_snapshot).toEqual(trend);
    expect(
      (
        await db.sql.query<{ research_source_id: string }>(
          "select * from forecast_evidence",
        )
      ).rows[0].research_source_id,
    ).toBe(sourceId);
    expect(
      await refreshSavedForecasts(
        db,
        store,
        async () => trend,
        seen,
        run.id,
        () => true,
        errors,
      ),
    ).toBe(0);
    expect(
      await refreshSavedForecasts(
        db,
        store,
        async () => trend,
        new Set(),
        run.id,
        () => false,
        errors,
      ),
    ).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    expect(provider.interestOverTime).not.toHaveBeenCalled();
  });
});

it("migration removes existing age penalties by appending a version, preserving old forecasts and citations", async () => {
  const oldId = randomUUID();
  const sourceId = randomUUID();
  const db = await TestDatabase.create(async (sql) => {
    await sql.query(
      "insert into research_sources(id,source_type,publisher,title,url,published_at) values($1,'academic','Fixture','Old fixture','https://example.invalid/old','2020-01-01')",
      [sourceId],
    );
    await sql.query(
      "insert into topic_forecasts(id,topic,explanation,predicted_skills,target_roles,time_horizon_months,preparation_score,evidence_confidence,rubric_version,dimensions,data_mode) values($1,'Memory management','Fixture',array['memory'],array['software-engineer'],12,39,'weak','preparation-v1',$2,'verified')",
      [
        oldId,
        JSON.stringify({
          industryMomentum: 0,
          academicMomentum: 20,
          roleRelevance: 80,
          technicalMaturity: 70,
          recency: 0,
        }),
      ],
    );
    await sql.query(
      "insert into forecast_evidence(forecast_id,research_source_id,relationship_type,explanation,stance) values($1,$2,'academic','Original citation','support')",
      [oldId, sourceId],
    );
  });
  try {
    const rows = (
      await db.sql.query<{
        id: string;
        preparation_score: number;
        rubric_version: string;
        dimensions: Record<string, number>;
        trend_snapshot: unknown;
      }>("select * from topic_forecasts")
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === oldId)).toMatchObject({
      preparation_score: 39,
      rubric_version: "preparation-v1",
      dimensions: { recency: 0 },
    });
    const current = rows.find((row) => row.id !== oldId)!;
    expect(current).toMatchObject({
      preparation_score: 49,
      rubric_version: "preparation-v2-trends",
      dimensions: { topicRelevance: 100 },
      trend_snapshot: {
        status: "not_checked",
        score: null,
        previousForecastId: oldId,
      },
    });
    expect(current.dimensions).not.toHaveProperty("recency");
    const citations = (
      await db.sql.query<{ research_source_id: string; forecast_id: string }>(
        "select * from forecast_evidence",
      )
    ).rows;
    expect(citations).toHaveLength(2);
    expect(citations.every((row) => row.research_source_id === sourceId)).toBe(
      true,
    );
  } finally {
    await db.sql.close();
  }
});
