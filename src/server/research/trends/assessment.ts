export const TREND_METHOD = "interest-retention-v1";
export const TREND_LOOKBACK = "today 5-y";
export const MAX_TREND_LOOKUPS = 8;
export interface InterestPoint {
  timestamp: string;
  value: number;
}
export interface TrendAssessment {
  status:
    | "available"
    | "stale"
    | "insufficient_data"
    | "not_configured"
    | "unavailable"
    | "budget_exhausted"
    | "not_checked";
  provider: "serpapi";
  query: string;
  geo: string;
  period: string;
  methodVersion: string;
  lookback: string;
  checkedAt: string;
  sourceUrl: string;
  score: number | null;
  direction: "rising" | "stable" | "declining" | null;
  recentAverage: number | null;
  baselineAverage: number | null;
  retentionRatio: number | null;
  recentStart: string;
  baselineStart: string;
  comparisonEnd: string;
  reasonCode: string | null;
  points: InterestPoint[];
}
export function trendPeriod(now: number) {
  return new Date(
    Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1),
  )
    .toISOString()
    .slice(0, 10);
}
export function normalizeTrendQuery(query: string) {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}
export function unknownTrend(
  query: string,
  geo = "",
  status: TrendAssessment["status"] = "not_checked",
  reasonCode = "AWAITING_MONTHLY_TRENDS",
  now = Date.now(),
): TrendAssessment {
  const end = new Date(trendPeriod(now));
  const url = new URL("https://trends.google.com/trends/explore");
  url.search = new URLSearchParams({
    q: query,
    date: TREND_LOOKBACK,
    ...(geo ? { geo } : {}),
  }).toString();
  return {
    status,
    provider: "serpapi",
    query,
    geo,
    period: trendPeriod(now),
    methodVersion: TREND_METHOD,
    lookback: TREND_LOOKBACK,
    checkedAt: new Date(now).toISOString(),
    sourceUrl: url.href,
    score: null,
    direction: null,
    recentAverage: null,
    baselineAverage: null,
    retentionRatio: null,
    recentStart: new Date(
      Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), 1),
    ).toISOString(),
    baselineStart: new Date(
      Date.UTC(end.getUTCFullYear() - 2, end.getUTCMonth(), 1),
    ).toISOString(),
    comparisonEnd: end.toISOString(),
    reasonCode,
    points: [],
  };
}
/** Compare two complete twelve-month periods within ONE normalized Trends series.
 * Publication age never participates. Five-percent variation is treated as noise.
 */
export function assessInterest(
  query: string,
  geo: string,
  input: InterestPoint[],
  now = Date.now(),
): TrendAssessment {
  const result = unknownTrend(
    query,
    geo,
    "insufficient_data",
    "INSUFFICIENT_TRENDS_HISTORY",
    now,
  );
  const end = Date.parse(result.comparisonEnd);
  const start = Date.parse(result.baselineStart);
  const months = new Map<string, number[]>();
  const seen = new Map<number, number>();
  for (const point of input) {
    const time = Date.parse(point.timestamp);
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(point.value) ||
      point.value < 0 ||
      point.value > 100
    )
      throw new Error("Invalid Trends point");
    if (seen.has(time) && seen.get(time) !== point.value)
      throw new Error("Conflicting Trends points");
    seen.set(time, point.value);
  }
  result.points = [...seen]
    .sort((a, b) => a[0] - b[0])
    .filter(([time]) => time <= now)
    .map(([time, value]) => ({
      timestamp: new Date(time).toISOString(),
      value,
    }));
  for (const point of result.points) {
    const time = Date.parse(point.timestamp);
    // Exclude the current month and a potentially unfinished most-recent weekly bucket.
    if (time < start || time >= end || time > now - 7 * 86400000) continue;
    const key = point.timestamp.slice(0, 7);
    const values = months.get(key) ?? [];
    values.push(point.value);
    months.set(key, values);
  }
  const endDate = new Date(end);
  const means: number[] = [];
  for (let offset = -24; offset < 0; offset++) {
    const key = new Date(
      Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + offset, 1),
    )
      .toISOString()
      .slice(0, 7);
    const values = months.get(key);
    if (!values?.length) return result;
    means.push(values.reduce((sum, n) => sum + n, 0) / values.length);
  }
  const average = (values: number[]) =>
    values.reduce((sum, n) => sum + n, 0) / values.length;
  const baseline = average(means.slice(0, 12));
  const recent = average(means.slice(12));
  if (baseline === 0 && recent === 0)
    return { ...result, reasonCode: "INSUFFICIENT_SEARCH_INTEREST" };
  const ratio = baseline === 0 ? null : recent / baseline;
  const declining = ratio !== null && ratio < 0.95;
  return {
    ...result,
    status: "available",
    reasonCode: null,
    baselineAverage: baseline,
    recentAverage: recent,
    retentionRatio: ratio,
    score: declining ? Math.round(Math.max(0, Math.min(1, ratio!)) * 100) : 100,
    direction: declining
      ? "declining"
      : baseline === 0 || ratio! > 1.05
        ? "rising"
        : "stable",
  };
}
/** Unknown data never becomes a fabricated Trends measurement or an age penalty. */
export function appliedTopicRelevance(trend: TrendAssessment): number {
  return (trend.status === "available" || trend.status === "stale") &&
    trend.score !== null
    ? trend.score
    : 100;
}
