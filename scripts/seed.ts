/** Explicitly executed; never runs at application startup or deployment. */
import { randomUUID } from 'node:crypto';
import { SupabaseDatabase } from '../src/server/storage/supabase';
import { ResearchStorage } from '../src/server/research/storage';
import { parseArxiv } from '../src/server/research/academic';
import { fetchText } from '../src/server/research/http';
import { FORECAST_RUBRIC } from '../src/server/config';
import { forecastScore } from '../src/server/research/forecasting';
import { unknownTrend } from '../src/server/research/trends/assessment';

const db = new SupabaseDatabase();
const illustrative = process.argv.includes('--illustrative');
const dimensions = { industryMomentum: 0, academicMomentum: 20, roleRelevance: 80, technicalMaturity: 50, topicRelevance: 100 };
if (illustrative) {
  const { data, error } = await db.client.from('research_sources').upsert({ source_type: 'illustrative', publisher: 'DEMO fixture', title: 'ILLUSTRATIVE inference capacity scenario; synthetic evidence', url: 'https://example.invalid/illustrative-inference', published_at: new Date().toISOString(), metadata: { synthetic: true } }, { onConflict: 'url' }).select('id').single();
  if (error) throw new Error('Unable to save illustrative source. Apply migrations and verify server credentials.');
  await db.rpc('save_forecast', { p_forecast: { topic: 'Inference capacity planning (ILLUSTRATIVE)', explanation: 'Synthetic integration-test hypothesis. No actual paper, company signal, or verified prediction is claimed.', predictedSkills: ['capacity planning', 'latency/throughput trade-offs'], targetRoles: ['software-engineer'], timeHorizonMonths: 12, preparationScore: forecastScore(dimensions), evidenceConfidence: 'weak', rubricVersion: FORECAST_RUBRIC, dimensions, trendSnapshot: unknownTrend('Inference capacity planning (ILLUSTRATIVE)'), dataMode: 'illustrative' }, p_evidence: [{ sourceId: data.id, relationshipType: 'illustrative', stance: 'support', explanation: 'Synthetic fixture only; not real research.' }] });
  console.log('Loaded ILLUSTRATIVE data. Set RESEARCH_DATA_MODE=illustrative intentionally; Claude credentials are still required for questions/evaluation.');
} else {
  const ids = ['2309.06180', '2312.00752'];
  const signal = AbortSignal.timeout(15000);
  const xml = await fetchText(`https://export.arxiv.org/api/query?id_list=${ids.join(',')}`, signal);
  const papers = parseArxiv(xml, { start: '1970-01-01T00:00:00Z', end: new Date().toISOString() });
  if (papers.length !== ids.length) throw new Error('Seed metadata could not be verified; nothing synthetic will be substituted. Use --illustrative explicitly if needed.');
  const store = new ResearchStorage(db.client);
  for (const paper of papers) {
    const source = await store.source({ id: randomUUID(), sourceType: 'academic', publisher: 'arXiv', title: paper.title, url: paper.sourceUrl, publishedAt: paper.publishedAt, text: paper.abstract, quality: 'official' });
    await store.paper(paper, source.id);
    const paged = paper.arxivId === '2309.06180';
    const topic = paged ? 'KV cache memory efficiency' : 'Sequence-model efficiency trade-offs';
    const skills = paged ? ['memory fragmentation', 'batching', 'throughput/latency measurement'] : ['state-space models', 'long-context resource budgets', 'model architecture trade-offs'];
    await db.rpc('save_forecast', { p_forecast: { topic, explanation: `Original preparation hypothesis grounded in verified metadata for “${paper.title}”. Practicing ${skills.join(', ')} may be useful. This older seed paper is not a newly discovered trend, verified company question, or calibrated prediction; no industry momentum is asserted. Full paper results have not been independently checked.`, predictedSkills: skills, targetRoles: ['software-engineer'], timeHorizonMonths: 12, preparationScore: forecastScore(dimensions), evidenceConfidence: 'weak', rubricVersion: FORECAST_RUBRIC, dimensions, trendSnapshot: unknownTrend(topic), dataMode: 'verified' }, p_evidence: [{ sourceId: source.id, relationshipType: 'academic', stance: 'support', explanation: 'Live arXiv title/abstract metadata supports the competency theme; the forecast is an original, provisional hypothesis.' }] });
  }
  console.log(`Saved ${papers.length} source-backed preparation hypotheses using live arXiv metadata. No interview questions are seeded.`);
}
