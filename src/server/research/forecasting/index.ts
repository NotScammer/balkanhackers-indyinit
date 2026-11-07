import 'server-only';
import type { z } from 'zod';
import type { hypothesesSchema } from '../schemas';
import type { EvidenceInput } from '../types';
import { FORECAST_WEIGHTS } from '@/server/config';
export type Hypothesis = z.infer<typeof hypothesesSchema>['forecasts'][number];
export interface Dimensions { industryMomentum: number; academicMomentum: number; roleRelevance: number; technicalMaturity: number; recency: number }
export function forecastScore(d: Dimensions) { return Math.round(Object.entries(FORECAST_WEIGHTS).reduce((sum, [key, weight]) => sum + Math.max(0, Math.min(100, d[key as keyof Dimensions])) * weight, 0)); }
export function normalizeConcept(s: string) { return s.toLowerCase().trim().replace(/[-_]/g, ' ').replace(/\s+/g, ' '); }
export function rankHypothesis(h: Hypothesis, evidence: EvidenceInput[], now = Date.now()) {
  const refs = new Set(h.evidence.filter(e => e.stance === 'support').map(e => e.sourceId));
  const support = evidence.filter(e => refs.has(e.source.id));
  if (!support.length || h.evidence.some(e => !evidence.some(item => item.source.id === e.sourceId)) || new Set(h.evidence.map(e => e.sourceId)).size !== h.evidence.length) throw new Error('Invalid forecast references');
  const industry = support.filter(e => e.source.sourceType === 'industry');
  const academic = support.filter(e => e.source.sourceType === 'academic');
  const dimensions: Dimensions = {
    industryMomentum: Math.min(100, new Set(industry.map(e => e.organization ?? e.source.publisher)).size * 30 + industry.length * 10),
    academicMomentum: Math.min(100, academic.length * 20), roleRelevance: h.roleRelevance, technicalMaturity: h.technicalMaturity,
    recency: Math.round(support.reduce((sum, e) => sum + Math.max(0, 100 - Math.max(0, now - Date.parse(e.source.publishedAt)) / 86400000 * 1.5), 0) / support.length),
  };
  const publishers = new Set(support.map(e => e.source.publisher));
  const contradicted = h.evidence.some(e => e.stance === 'contradiction');
  const evidenceConfidence = !contradicted && publishers.size >= 3 && industry.some(e => e.source.quality === 'official') && academic.length > 0
    ? 'strong' : !contradicted && publishers.size >= 2 ? 'moderate' : 'weak';
  return { dimensions, preparationScore: forecastScore(dimensions), evidenceConfidence };
}
