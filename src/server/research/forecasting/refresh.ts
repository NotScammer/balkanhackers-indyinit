import "server-only";
import type { Database } from "@/server/storage/types";
import { FORECAST_RUBRIC } from "@/server/config";
import {
  appliedTopicRelevance,
  type TrendAssessment,
} from "../trends/assessment";
import type { ResearchStorage } from "../storage";
import { forecastScore, normalizeConcept } from "./index";
/** Previously discovered topics also get refreshed, even when their papers are years old. */
export async function refreshSavedForecasts(
  db: Pick<Database, "rpc">,
  store: Pick<ResearchStorage, "forecastRefreshCandidates">,
  trendFor: (topic: string) => Promise<TrendAssessment>,
  seen: Set<string>,
  runId: string,
  canContinue: () => boolean,
  onError: (error: unknown) => void,
) {
  let refreshed = 0;
  const candidates = await store.forecastRefreshCandidates();
  for (const saved of candidates) {
    const key = normalizeConcept(saved.topic);
    if (seen.has(key) || !saved.evidence.length || !canContinue()) continue;
    try {
      const trend = await trendFor(saved.topic);
      const dimensions = {
        ...saved.dimensions,
        topicRelevance: appliedTopicRelevance(trend),
      };
      await db.rpc("save_forecast", {
        p_run_id: runId,
        p_forecast: {
          topic: saved.topic,
          explanation: saved.explanation,
          predictedSkills: saved.predicted_skills,
          targetRoles: saved.target_roles,
          timeHorizonMonths: saved.time_horizon_months,
          dimensions,
          preparationScore: forecastScore(dimensions),
          evidenceConfidence: saved.evidence_confidence,
          rubricVersion: FORECAST_RUBRIC,
          dataMode: "verified",
          trendSnapshot: trend,
        },
        p_evidence: saved.evidence.map((e) => ({
          sourceId: e.research_source_id,
          relationshipType: e.relationship_type,
          stance: e.stance,
          explanation: e.explanation,
        })),
      });
      seen.add(key);
      refreshed++;
    } catch (error) {
      onError(error);
    }
  }
  return refreshed;
}
