import 'server-only';
import { env, FORECAST_RUBRIC } from '../config';
import { AppError } from '../errors';
import { AnthropicAI, type StructuredAI } from '../providers/anthropic';
import { SupabaseDatabase } from '../storage/supabase';
import { collectArxiv, collectOpenAlex, deduplicatePapers } from './academic';
import { collectIndustry, MONITORED_COMPANIES, TavilySearch } from './industry';
import { normalizeConcept, rankHypothesis } from './forecasting';
import { analysisSchema, hypothesesSchema, screeningSchema, signalBatchSchema } from './schemas';
import { pageText, SourceReader } from './http';
import { ResearchStorage } from './storage';
import type { EvidenceInput, Paper, ResearchSource, Run } from './types';

export async function runMonthly(db = new SupabaseDatabase(), ai: StructuredAI = new AnthropicAI()) {
  const config = env();
  const run = await db.rpc<Run>('acquire_research_run', { p_seconds: 240 });
  const store = new ResearchStorage(db.client);
  const signal = AbortSignal.timeout(config.RESEARCH_DEADLINE_SECONDS * 1000);
  const deadline = Date.now() + config.RESEARCH_DEADLINE_SECONDS * 1000;
  const reader = new SourceReader(signal);
  const errors: string[] = []; const counts = { industrySources: 0, industrySignals: 0, papers: 0, screened: 0, analysed: 0, fulltext: 0, forecasts: 0 };
  const recordError = (error: unknown) => {
    // No URLs with API keys, external response bodies, transcripts, or raw error dumps are recorded.
    const code = error instanceof AppError ? error.code : 'RESEARCH_STAGE_FAILED';
    errors.push(code); console.warn(JSON.stringify({ event: 'research_stage_failed', runId: run.id, code }));
  };
  const hasBudget = () => !signal.aborted && Date.now() < deadline - 30000;
  const window = { start: run.window_start, end: run.window_end };
  const evidence: EvidenceInput[] = [];
  try {
    await db.rpc('cleanup_expired');
    const collected = await collectIndustry(window, reader, signal, config.TAVILY_API_KEY ? new TavilySearch(config.TAVILY_API_KEY) : null, recordError);
    const industry: ResearchSource[] = [];
    for (const source of collected) { if (!hasBudget()) break; industry.push(await store.source(source)); counts.industrySources++; }
    if (industry.length && hasBudget()) {
      try {
        const output = await ai.generate(signalBatchSchema, 'Extract only source-supported engineering signals. Every evidenceQuote MUST be an exact excerpt from the source text. Use supplied sourceId and organization only. Do not convert speculation into a confirmed commitment. Skip unsupported investments, figures, dates, or facts. Return at most 12 signals.', industry, signal);
        for (const item of output.signals) {
          const source = industry.find(s => s.id === item.sourceId);
          if (!source || !source.text.includes(item.evidenceQuote) || item.organization !== source.organization || !MONITORED_COMPANIES.some(c => c.name === item.organization)) { errors.push('INVALID_SIGNAL_REFERENCE'); continue; }
          if (item.commitment === 'speculative') continue;
          const description = `${item.commitment === 'confirmed' && source.quality === 'official' ? 'Official source' : 'Reported, not independently verified'}: ${item.description}`;
          await store.signal(source.id, { ...item, description }, source.publishedAt); counts.industrySignals++;
          evidence.push({ source, concepts: item.technologies.map(normalizeConcept), description, limitations: source.quality === 'secondary' ? ['Search-provider excerpt; not independently verified.'] : [], organization: item.organization });
        }
      } catch (e) { recordError(e); }
    }
    let papers: Paper[] = [];
    if (hasBudget()) { try { papers.push(...await collectArxiv(window, signal, config.RESEARCH_CONTACT_EMAIL)); } catch (e) { recordError(e); } }
    if (hasBudget() && config.OPENALEX_API_KEY) { try { papers.push(...await collectOpenAlex(window, signal, config.OPENALEX_API_KEY)); } catch (e) { recordError(e); } }
    papers = deduplicatePapers(papers);
    const paperSources = new Map<string, ResearchSource>(); const paperIds = new Map<string, string>();
    for (const paper of papers) {
      if (!hasBudget()) { errors.push('RESEARCH_BUDGET_EXHAUSTED'); break; }
      const source = await store.source({ id: paper.id, sourceType: 'academic', publisher: paper.arxivId ? 'arXiv' : 'OpenAlex', title: paper.title, url: paper.sourceUrl, publishedAt: paper.publishedAt, text: paper.abstract, quality: 'official' });
      paperSources.set(paper.id, source); paperIds.set(paper.id, await store.paper(paper, source.id)); counts.papers++;
    }
    if (papers.length && hasBudget()) {
      try {
        const screening = await ai.generate(screeningSchema, 'Screen titles/abstracts for emerging engineering relevance to software engineers. Return only supplied paperId values with relevance 0-100 and a concise reason. Do not infer university affiliation from categories; preprints are not necessarily peer reviewed.', papers.filter(p => paperIds.has(p.id)).map(p => ({ paperId: p.id, title: p.title, abstract: p.abstract.slice(0, 5000), institutions: p.institutions, publicationStatus: p.publicationStatus })), signal);
        const valid = [...new Map(screening.papers.filter(p => paperIds.has(p.paperId)).map(p => [p.paperId, p])).values()]; counts.screened = valid.length;
        const selected = valid.filter(p => p.relevance >= 60).sort((a, b) => b.relevance - a.relevance).slice(0, 5);
        for (const selectedPaper of selected) {
          if (!hasBudget()) { errors.push('RESEARCH_BUDGET_EXHAUSTED'); break; }
          const paper = papers.find(p => p.id === selectedPaper.paperId)!;
          let text = paper.abstract; let scope: 'abstract' | 'fulltext' = 'abstract';
          if (paper.fulltextUrl) {
            try {
              const full = pageText(await reader.get(paper.fulltextUrl));
              if (full.length > 1000) { text = full.slice(0, 45000); scope = 'fulltext'; counts.fulltext++; }
            } catch { /* HTML unavailable/restricted: accurately analyse abstract only. */ }
          }
          if (signal.aborted) break;
          try {
            const analysis = await ai.generate(analysisSchema, 'Analyse methods, findings, limitations, technical concepts and plausible engineering applications using only the provided text. Every evidenceQuote must be an exact substring. Distinguish observed results from speculation. If scope is abstract, explicitly limit claims to the abstract and record incomplete methods/limitations. Fulltext may be a bounded excerpt; do not claim to have read unavailable sections.', { title: paper.title, scope, excerptMayBeTruncated: scope === 'fulltext', publicationStatus: paper.publicationStatus, text }, signal);
            if (analysis.evidenceQuotes.some(q => !text.includes(q))) { errors.push('INVALID_PAPER_QUOTE'); continue; }
            if (scope === 'abstract') analysis.limitations.push('Abstract-only analysis; methods and results were not verified against full text.');
            await store.analysis(paperIds.get(paper.id)!, analysis, scope, ai.model); counts.analysed++;
            evidence.push({ source: paperSources.get(paper.id)!, concepts: analysis.technicalConcepts.map(normalizeConcept), description: analysis.findings.join(' '), limitations: analysis.limitations });
          } catch (e) { recordError(e); }
        }
      } catch (e) { recordError(e); }
    }
    if (evidence.length && hasBudget()) {
      try {
        const output = await ai.generate(hypothesesSchema, 'Group related normalized technical concepts into emerging competency hypotheses, connecting industry and academia when supported. Allow industry-only or academic-only hypotheses. Use only supplied source IDs and summaries; include contradictory evidence when present. Do not invent citations, dates, funding figures or results. Distinguish preparation priority from evidence confidence and hiring probability. roleRelevance 0-100 means fit to software engineering work; technicalMaturity 0-100 means evidence of practical applicability (0 speculative, 50 prototype, 100 operationally established). These are provisional heuristics. Avoid duplicate topics.', evidence.map(e => ({ sourceId: e.source.id, sourceType: e.source.sourceType, publisher: e.source.publisher, date: e.source.publishedAt, concepts: e.concepts, findings: e.description, limitations: e.limitations })), signal);
        const topics = new Set<string>();
        for (const hypothesis of output.forecasts) {
          if (topics.has(normalizeConcept(hypothesis.topic))) continue;
          try {
            const ranking = rankHypothesis(hypothesis, evidence);
            await db.rpc('save_forecast', { p_run_id: run.id, p_forecast: { ...hypothesis, ...ranking, rubricVersion: FORECAST_RUBRIC, dataMode: 'verified' }, p_evidence: hypothesis.evidence.map(e => ({ ...e, relationshipType: evidence.find(item => item.source.id === e.sourceId)!.source.sourceType })) });
            topics.add(normalizeConcept(hypothesis.topic)); counts.forecasts++;
          } catch (e) { recordError(e); }
        }
      } catch (e) { recordError(e); }
    } else errors.push(hasBudget() ? 'NO_USABLE_EVIDENCE' : 'RESEARCH_BUDGET_EXHAUSTED');
  } catch (e) { recordError(e); }
  if (signal.aborted && !errors.includes('RESEARCH_BUDGET_EXHAUSTED')) errors.push('RESEARCH_BUDGET_EXHAUSTED');
  if (counts.forecasts === 0) errors.push('NO_FORECASTS_SAVED');
  const status = errors.length ? counts.industrySources + counts.papers > 0 ? 'partial' : 'failed' : 'succeeded';
  await store.finish(run.id, status, counts, errors);
  return { runId: run.id, status, counts, errors };
}
