import "server-only";
import { z } from "zod";
import { fetchText } from "../http";
import { AppError } from "@/server/errors";
import { TREND_LOOKBACK, type InterestPoint } from "./assessment";
export interface TrendsProvider {
  interestOverTime(
    query: string,
    geo: string,
    signal: AbortSignal,
  ): Promise<InterestPoint[]>;
}
const responseSchema = z.object({
  interest_over_time: z.object({
    timeline_data: z
      .array(
        z.object({
          timestamp: z.union([
            z.string().regex(/^\d+$/),
            z.number().finite().positive(),
          ]),
          isPartial: z.boolean().optional(),
          is_partial: z.boolean().optional(),
          values: z
            .array(
              z.object({
                extracted_value: z.number().finite().min(0).max(100),
              }),
            )
            .length(1),
        }),
      )
      .max(2000),
  }),
});
export function parseTrendSeries(payload: unknown): InterestPoint[] {
  return responseSchema
    .parse(payload)
    .interest_over_time.timeline_data.filter(
      (point) => !point.isPartial && !point.is_partial,
    )
    .map((point) => ({
      timestamp: new Date(Number(point.timestamp) * 1000).toISOString(),
      value: point.values[0].extracted_value,
    }));
}
/** SerpApi supplies Google Trends data; this is not Google's access-gated official API. */
export class SerpApiTrends implements TrendsProvider {
  constructor(private key: string) {}
  async interestOverTime(query: string, geo: string, signal: AbortSignal) {
    // A single topic per request avoids comparison-normalization and query-list ambiguity.
    if (!query.trim() || query.length > 200 || /[,\r\n]/.test(query))
      throw new AppError(
        "TRENDS_INVALID_QUERY",
        502,
        "Topic cannot be used as a single Trends search term.",
      );
    const url = new URL("https://serpapi.com/search.json");
    url.search = new URLSearchParams({
      engine: "google_trends",
      data_type: "TIMESERIES",
      q: query,
      date: TREND_LOOKBACK,
      tz: "0",
      hl: "en",
      ...(geo ? { geo } : {}),
      api_key: this.key,
    }).toString();
    try {
      return parseTrendSeries(JSON.parse(await fetchText(url.href, signal)));
    } catch {
      // Never expose a request URL, upstream body or API key through errors/logs.
      throw new AppError(
        "TRENDS_UNAVAILABLE",
        503,
        "Google Trends data is unavailable.",
        true,
      );
    }
  }
}
