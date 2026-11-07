import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { databaseError } from '../errors';
import type { Analysis, Paper, ResearchSource } from './types';
export class ResearchStorage {
  constructor(private db: SupabaseClient) {}
  async source(source: ResearchSource) {
    const { data, error } = await this.db.from('research_sources').upsert({ source_type: source.sourceType, publisher: source.publisher, title: source.title, url: source.url, published_at: source.publishedAt, retrieved_at: new Date().toISOString(), metadata: { quality: source.quality } }, { onConflict: 'url' }).select('id').single();
    if (error) throw databaseError(error.message);
    return { ...source, id: data.id as string };
  }
  async paper(paper: Paper, sourceId: string) {
    // Stable identifiers take precedence over a changing metadata source URL.
    let query = this.db.from('research_papers').select('id');
    if (paper.arxivId) query = query.eq('arxiv_id', paper.arxivId);
    else if (paper.doi) query = query.eq('doi', paper.doi);
    else query = query.eq('source_url', paper.sourceUrl);
    const existing = await query.maybeSingle();
    if (existing.error) throw databaseError(existing.error.message);
    const { data, error } = await this.db.from('research_papers').upsert({ id: existing.data?.id ?? paper.id,
      arxiv_id: paper.arxivId, doi: paper.doi, openalex_id: paper.openalexId, title: paper.title, abstract: paper.abstract,
      authors: paper.authors, institutions: paper.institutions, published_at: paper.publishedAt, updated_at: paper.updatedAt,
      source_url: paper.sourceUrl, fulltext_url: paper.fulltextUrl, publication_status: paper.publicationStatus, research_source_id: sourceId,
    }, { onConflict: 'id' }).select('id').single();
    if (error) throw databaseError(error.message); return data.id as string;
  }
  async analysis(paperId: string, result: Analysis, scope: 'abstract' | 'fulltext', model: string) {
    const { error } = await this.db.from('paper_analyses').upsert({ research_paper_id: paperId, relevance: result.relevance, findings: result.findings, limitations: result.limitations, technical_concepts: result.technicalConcepts, engineering_applications: result.engineeringApplications, model_version: model, analysis_scope: scope }, { onConflict: 'research_paper_id,model_version,analysis_scope' });
    if (error) throw databaseError(error.message);
  }
  async signal(sourceId: string, signal: { organization: string; signalType: string; description: string; technologies: string[]; evidenceQuote: string }, date: string) {
    const { error } = await this.db.from('industry_signals').upsert({ research_source_id: sourceId, organization: signal.organization, signal_type: signal.signalType, description: signal.description, technologies: signal.technologies, evidence: signal.evidenceQuote, signal_date: date }, { onConflict: 'research_source_id,signal_type,description' });
    if (error) throw databaseError(error.message);
  }
  async forecastRefreshCandidates(): Promise<RefreshForecast[]> {
    const { data, error } = await this.db.from('topic_forecasts')
      .select('*,evidence:forecast_evidence(research_source_id,relationship_type,stance,explanation)')
      .eq('data_mode', 'verified').order('created_at', { ascending: false }).limit(60);
    if (error) throw databaseError(error.message);
    const dimension = z.number().finite().min(0).max(100);
    const schema = z.object({ id: z.uuid(), topic: z.string(), explanation: z.string(), predicted_skills: z.array(z.string()),
      target_roles: z.array(z.string()), time_horizon_months: z.number().int(), evidence_confidence: z.enum(['weak','moderate','strong']),
      dimensions: z.object({ industryMomentum: dimension, academicMomentum: dimension, roleRelevance: dimension, technicalMaturity: dimension }),
      evidence: z.array(z.object({ research_source_id: z.uuid(), relationship_type: z.string(), stance: z.string(), explanation: z.string() })),
    });
    const topics = new Set<string>(); const result: RefreshForecast[] = [];
    for (const raw of data ?? []) {
      const parsed = schema.safeParse(raw); if (!parsed.success) continue;
      const key = parsed.data.topic.trim().toLowerCase(); if (topics.has(key)) continue;
      topics.add(key); result.push(parsed.data);
    }
    return result.slice(0, 8);
  }
  async finish(id: string, status: 'succeeded' | 'partial' | 'failed', counts: Record<string, number>, errors: string[]) {
    const { data, error } = await this.db.from('research_runs').update({ status, processed_counts: counts, error_summaries: errors, finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'running').select('id');
    if (error || !data?.length) throw databaseError(error?.message);
  }
}

/** Fields required to refresh a saved forecast's Trends score without rerunning AI research. */
export interface RefreshForecast {
  id: string; topic: string; explanation: string; predicted_skills: string[]; target_roles: string[];
  time_horizon_months: number; evidence_confidence: 'weak' | 'moderate' | 'strong';
  dimensions: { industryMomentum: number; academicMomentum: number; roleRelevance: number; technicalMaturity: number };
  evidence: { research_source_id: string; relationship_type: string; stance: string; explanation: string }[];
}
