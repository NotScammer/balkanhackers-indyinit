# Google Trends topic relevance

Preparation priority uses the existing 25% industry, 20% academic, 30% role and 15% maturity weights. The remaining 10% now measures retained topic interest, replacing publication-date recency. An old paper on an active topic receives the same topic-interest contribution as a new paper on that topic. This is rubric `preparation-v2-trends`.

## Calculation

The monthly job looks up the forecast's topic name, not its paper title or publication date. It requests one five-year Google Trends interest-over-time series with a consistent geography. All comparison values come from that one series, avoiding comparisons between independently normalized requests.

1. Exclude the current UTC month and potentially unfinished latest weekly buckets. Explicitly partial provider buckets are also discarded.
2. Average the samples within each completed calendar month. Require observations in all 24 comparison months.
3. Average the latest 12 monthly means and the preceding 12 monthly means, weighting each month equally to reduce seasonal noise.
4. Compute `retentionRatio = recentAverage / baselineAverage`.
5. If the ratio is at least 0.95, award 100. Interest that is stable or increasing has no penalty. A decline of at most 5% is treated as noise.
6. Otherwise award `round(retentionRatio × 100)`, bounded to 0–100. An 80-to-40 change earns 50, contributing 5 of the 10 possible preparation points.

A zero baseline followed by positive interest earns 100. All-zero or incomplete history is insufficient data, not proof of lost relevance. Google Trends is relative search interest, not absolute searches, technical correctness, or hiring demand. Topic phrasing can be ambiguous; a forecast name is currently used as a search term, without automated entity/topic-ID resolution.

## Unknown and stale data

If there is insufficient history, no configured provider, an outage, or an exhausted budget, no new measurement is invented. A previous available measurement for the same query/geography/method is reused with `status: stale`, its original measurement period, and the current failure reason. Otherwise `score` stays null and the ranking applies 100 as a **no-penalty default**, explicitly distinct from a measured score of 100. Evidence confidence is unchanged by this fallback.

Insufficient-data responses are cached for the month. Transport/provider failures are not cached as monthly observations, so a later authorized manual run can retry. Removing the API key does not discard existing cached observations. Application logs/run errors contain sanitized codes, not provider response bodies or URLs containing keys.

## Storage and monthly reuse

- `topic_trend_snapshots`: immutable monthly assessments, including points, query, geography, comparison averages/windows, direction, score, source URL, check time, and method version. Unique cache key: normalized query + geography + UTC month + method.
- `topic_forecasts.trend_snapshot`: the exact assessment applied to that forecast version. `dimensions.topicRelevance` is the number used in the weighted preparation score.
- `research_runs.processed_counts`: `trendsFetched`, `trendsCached`, `trendsUnavailable`, and `refreshedForecasts`; run errors identify missing configuration, outages and exhausted budgets.
- Existing question snapshots keep the forecast version they originally used.

Repeated topic lookups in one run share an in-flight promise. Separate runs/instances reuse PostgreSQL snapshots for the current calendar month. The existing research-run lock prevents overlapping scans. New months request new measurements; a different geography uses a separate cache entry.

After new hypotheses are saved, the job considers up to eight latest distinct saved verified topics from the latest 60 forecast rows. It refreshes their interest using existing dimensions and citations, appending forecast versions without rerunning AI paper analysis. Already processed topics are skipped. This lets older discoveries stay current independently of the new-paper discovery date window. Coverage is bounded and best effort: new-topic lookups share the eight-request budget with saved topics. If the budget expires, saved measurements are retained as stale or the explicit unknown policy applies.

There are at most eight external lookups per run, each with an eight-second HTTP timeout and a bounded response size. Research/AI work reserves the last 60 seconds for ranking; lookups and refresh stop starting with fewer than 15 seconds remaining. The total configured deadline takes precedence. Missing configuration or an outage is recorded as a partial/failed run rather than an unqualified success.

**Interview/question generation only reads saved forecasts and evidence.** It never imports the Trends provider/cache or starts a lookup. There is no search request per question or per user.

## Setup and migration

Apply `supabase/migrations/202611070005_topic_trends.sql` after migrations 001–004. It enables RLS, restricts the table and RPCs to the server role, and extends atomic forecast persistence. It also appends new versions of the latest v1 forecasts with `topicRelevance: 100` and `status: not_checked`, removing existing age penalties while preserving historical rows and citations. It makes no external requests or claim of measured interest. Seeding likewise records unmeasured relevance; run the monthly job for actual observations.

Set `SERPAPI_API_KEY` in server environment settings. `GOOGLE_TRENDS_GEO` defaults to worldwide (empty string); `US` scopes interest to the United States. Invoke the protected monthly endpoint using the existing `CRON_SECRET`, or let the production monthly cron run. Deploying code does not apply the migration or configure the key.

Google's [official Trends API](https://developers.google.com/search/apis/trends) is access-gated in alpha. This implementation uses SerpApi's documented [Google Trends API](https://serpapi.com/google-trends-api) and [interest-over-time response](https://serpapi.com/google-trends-interest-over-time) to obtain Google Trends data; it is a separate provider requiring its own account/key. No undocumented Google endpoint or official-API access is assumed. Automated checks use synthetic provider fixtures and actual PostgreSQL migrations; no live Trends request or hosted migration is claimed.

## Code references

- [Interest windows, ratio and no-penalty policy](../src/server/research/trends/assessment.ts)
- [Provider request and response validation](../src/server/research/trends/provider.ts)
- [Persistent monthly lookup and stale fallback](../src/server/research/trends/cache.ts)
- [Weighted forecast ranking](../src/server/research/forecasting/index.ts)
- [Previously saved topic refresh](../src/server/research/forecasting/refresh.ts)
- [Monthly orchestration and counters](../src/server/research/run-monthly.ts)
- [Schema, restricted RPCs and historical backfill](../supabase/migrations/202611070005_topic_trends.sql)
- [Calculation, provider, cache, refresh and migration tests](../tests/trends.test.ts)
