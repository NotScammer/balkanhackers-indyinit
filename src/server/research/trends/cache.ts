import "server-only";
import type { Database } from "@/server/storage/types";
import {
  MAX_TREND_LOOKUPS,
  normalizeTrendQuery,
  TREND_METHOD,
  trendPeriod,
  unknownTrend,
  assessInterest,
  type TrendAssessment,
} from "./assessment";
import type { TrendsProvider } from "./provider";
export interface TrendLookup {
  assessment: TrendAssessment;
  cacheHit: boolean;
  fetched: boolean;
}
export class CachedTopicTrends {
  private requests = new Map<string, Promise<TrendLookup>>();
  private lookups = 0;
  constructor(
    private db: Pick<Database, "rpc">,
    private provider: TrendsProvider | null,
    private geo: string,
    private signal: AbortSignal,
    private deadline: number,
    private now = Date.now(),
  ) {}
  lookup(query: string): Promise<TrendLookup> {
    const key = normalizeTrendQuery(query);
    let pending = this.requests.get(key);
    if (!pending) {
      pending = this.load(query, key);
      this.requests.set(key, pending);
    }
    return pending;
  }
  private async load(query: string, key: string): Promise<TrendLookup> {
    const cached = await this.db.rpc<TrendAssessment | null>(
      "read_topic_trends",
      {
        p_query_key: key,
        p_geo: this.geo,
        p_period: trendPeriod(this.now),
        p_method: TREND_METHOD,
      },
    );
    if (cached)
      return {
        assessment: await this.withLastMeasurement(cached, key),
        cacheHit: true,
        fetched: false,
      };
    if (!this.provider)
      return {
        assessment: await this.withLastMeasurement(
          unknownTrend(
            query,
            this.geo,
            "not_configured",
            "TRENDS_NOT_CONFIGURED",
            this.now,
          ),
          key,
        ),
        cacheHit: false,
        fetched: false,
      };
    if (
      this.lookups >= MAX_TREND_LOOKUPS ||
      this.signal.aborted ||
      Date.now() > this.deadline - 15000
    ) {
      return {
        assessment: await this.withLastMeasurement(
          unknownTrend(
            query,
            this.geo,
            "budget_exhausted",
            "TRENDS_BUDGET_EXHAUSTED",
            this.now,
          ),
          key,
        ),
        cacheHit: false,
        fetched: false,
      };
    }
    this.lookups++;
    try {
      const points = await this.provider.interestOverTime(
        query,
        this.geo,
        this.signal,
      );
      const assessment = assessInterest(query, this.geo, points, this.now);
      await this.db.rpc("save_topic_trends", { p_assessment: assessment });
      return {
        assessment: await this.withLastMeasurement(assessment, key),
        cacheHit: false,
        fetched: true,
      };
    } catch {
      // Do not cache outages as a full-month measurement; an explicit retry can recover.
      return {
        assessment: await this.withLastMeasurement(
          unknownTrend(
            query,
            this.geo,
            "unavailable",
            "TRENDS_UNAVAILABLE",
            this.now,
          ),
          key,
        ),
        cacheHit: false,
        fetched: true,
      };
    }
  }
  private async withLastMeasurement(
    current: TrendAssessment,
    key: string,
  ): Promise<TrendAssessment> {
    if (current.status === "available") return current;
    const previous = await this.db.rpc<TrendAssessment | null>(
      "latest_topic_trends",
      {
        p_query_key: key,
        p_geo: this.geo,
        p_method: TREND_METHOD,
        p_period: trendPeriod(this.now),
      },
    );
    return previous
      ? { ...previous, status: "stale", reasonCode: current.reasonCode }
      : current;
  }
}
