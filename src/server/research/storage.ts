import 'server-only';
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
  async finish(id: string, status: 'succeeded' | 'partial' | 'failed', counts: Record<string, number>, errors: string[]) {
    const { data, error } = await this.db.from('research_runs').update({ status, processed_counts: counts, error_summaries: errors, finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'running').select('id');
    if (error || !data?.length) throw databaseError(error?.message);
  }
}
