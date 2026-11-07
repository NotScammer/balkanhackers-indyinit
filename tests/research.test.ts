import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TestDatabase } from './database';
import { collectArxiv, collectOpenAlex, deduplicatePapers, normalizeDoi, parseArxiv, parseOpenAlex, INSTITUTIONS } from '../src/server/research/academic';
import { allowedUrl, canonicalUrl, inWindow, SourceReader } from '../src/server/research/http';
import { deduplicateSources, TavilySearch } from '../src/server/research/industry';
import { forecastScore, rankHypothesis, normalizeConcept } from '../src/server/research/forecasting';
import type { EvidenceInput, Paper, ResearchSource } from '../src/server/research/types';

const window = { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z' };
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2610.12345v2</id><title>Fixture title: not a real paper</title><summary>Synthetic abstract for parsing tests.</summary><published>2026-10-12T12:00:00Z</published><updated>2026-10-14T12:00:00Z</updated><author><name>Test author</name></author><arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.0000/test-only</arxiv:doi></entry></feed>`;
const source = (id = randomUUID()): ResearchSource => ({ id, sourceType: 'academic', publisher: 'arXiv', title: 'Fixture only', url: 'https://example.invalid/fixture', publishedAt: '2026-10-12T12:00:00Z', text: 'Synthetic evidence.', quality: 'official' });
const openalexFixture = { results: [{ id: 'https://openalex.org/W9999999999', doi: 'https://doi.org/10.0000/TEST-ONLY', display_name: 'Synthetic title', publication_date: '2026-10-12', type: 'preprint', abstract_inverted_index: { 'Test': [0], 'abstract': [1] }, primary_location: { landing_page_url: 'https://arxiv.org/abs/2610.12345' }, authorships: [{ author: { display_name: 'Test author' }, institutions: [{ id: 'https://openalex.org/I123', display_name: 'Fixture University' }] }] }] };

describe('academic adapters and source safety', () => {
  it('parses a singleton Atom entry, removes versions, preserves preprint status and never infers institutions', () => {
    const papers = parseArxiv(atom, window); expect(papers).toHaveLength(1);
    expect(papers[0].arxivId).toBe('2610.12345'); expect(papers[0].institutions).toEqual([]); expect(papers[0].publicationStatus).toBe('preprint');
    expect(parseArxiv(atom, { ...window, start: '2026-10-20' })).toHaveLength(0);
  });
  it('reconstructs OpenAlex abstracts and preserves actual affiliation records', () => {
    const papers = parseOpenAlex(openalexFixture, window);
    expect(papers[0].abstract).toBe('Test abstract'); expect(papers[0].doi).toBe('10.0000/test-only');
    expect(papers[0].institutions[0].name).toBe('Fixture University');
    expect(deduplicatePapers([...parseArxiv(atom, window), ...papers])).toHaveLength(1);
    expect(normalizeDoi('https://doi.org/10.1/ABC')).toBe('10.1/abc');
  });
  it('merges bridge records across DOI and arXiv identifiers', () => {
    const a = parseArxiv(atom, window)[0];
    const doiOnly: Paper = { ...a, arxivId: null, sourceUrl: 'https://example.invalid/doi', openalexId: 'https://openalex.org/W999' };
    const arxivOnly: Paper = { ...a, doi: null };
    const bridge: Paper = { ...a, openalexId: doiOnly.openalexId };
    expect(deduplicatePapers([doiOnly, arxivOnly, bridge])).toHaveLength(1);
  });
  it('deduplicates sources with tracking URLs and rejects arbitrary fetch targets', () => {
    const a = source(); const b = { ...a, id: randomUUID(), url: `${a.url}?utm_source=x#fragment` };
    expect(deduplicateSources([a, b])).toHaveLength(1);
    expect(canonicalUrl(b.url)).toBe(a.url);
    for (const url of ['http://arxiv.org/abs/a', 'https://127.0.0.1/', 'https://arxiv.org.evil.test/', 'https://user:password@arxiv.org/abs/a', 'https://arxiv.org:8080/']) expect(() => allowedUrl(url)).toThrow();
    expect(inWindow('invalid date', window)).toBe(false);
  });
  it('uses bounded arXiv/OpenAlex requests with institution and date filters', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(atom)).mockResolvedValueOnce(new Response(JSON.stringify(openalexFixture)));
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(await collectArxiv(window, new AbortController().signal)).toHaveLength(1);
      const arxiv = new URL(fetcher.mock.calls[0][0]); expect(arxiv.searchParams.get('max_results')).toBe('60'); expect(arxiv.searchParams.get('search_query')).toContain('submittedDate:');
      await collectOpenAlex(window, new AbortController().signal, 'test-not-a-key');
      const openalex = new URL(fetcher.mock.calls[1][0]); expect(openalex.searchParams.get('filter')).toContain(INSTITUTIONS[0].id); expect(openalex.searchParams.get('per-page')).toBe('40');
    } finally { vi.unstubAllGlobals(); }
  });
  it('honors robots exclusions and never fetches a disallowed article', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('User-agent: *\nDisallow: /news/'));
    vi.stubGlobal('fetch', fetcher);
    try { await expect(new SourceReader(new AbortController().signal).get('https://openai.com/news/test')).rejects.toMatchObject({ code: 'ROBOTS_DENIED' }); expect(fetcher).toHaveBeenCalledTimes(1); }
    finally { vi.unstubAllGlobals(); }
  });
  it('requires dates on search results and does not fetch arbitrary result URLs', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ title: 'Synthetic', url: 'https://external.example/one', content: 'Snippet only', published_date: '2026-10-10' }, { title: 'No date', url: 'https://external.example/two', content: 'Skip me' }] })));
    vi.stubGlobal('fetch', fetcher);
    try { const rows = await new TavilySearch('test-not-a-key').search('OpenAI', window, new AbortController().signal); expect(rows).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(1); }
    finally { vi.unstubAllGlobals(); }
  });
});

describe('forecast ranking', () => {
  it('calculates the versioned preparation weights independently of confidence', () => {
    expect(forecastScore({ industryMomentum: 100, academicMomentum: 50, roleRelevance: 80, technicalMaturity: 60, recency: 90 })).toBe(77);
    expect(normalizeConcept('  KV-Cache  ')).toBe('kv cache');
    const evidence: EvidenceInput[] = [{ source: source(), concepts: ['efficiency'], description: 'Fixture only', limitations: [] }];
    const hypothesis = { topic: 'Efficiency', explanation: 'Test hypothesis', predictedSkills: ['memory'], targetRoles: ['software-engineer' as const], timeHorizonMonths: 12, roleRelevance: 90, technicalMaturity: 50, evidence: [{ sourceId: evidence[0].source.id, stance: 'support' as const, explanation: 'Synthetic relation' }] };
    expect(rankHypothesis(hypothesis, evidence).evidenceConfidence).toBe('weak');
    expect(() => rankHypothesis({ ...hypothesis, evidence: [{ ...hypothesis.evidence[0], sourceId: randomUUID() }] }, evidence)).toThrow();
    expect(() => rankHypothesis({ ...hypothesis, evidence: [...hypothesis.evidence, ...hypothesis.evidence] }, evidence)).toThrow();
  });
});

describe('actual PostgreSQL locks and policies', () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await TestDatabase.create(); });
  afterAll(async () => { await db.sql.close(); });
  beforeEach(async () => { await db.sql.exec('delete from research_runs; delete from rate_buckets;'); });
  it('blocks overlapping scans and recovers expired runs without treating partial scans as success', async () => {
    const run = await db.rpc<{ id: string; window_start: string }>('acquire_research_run');
    await expect(db.rpc('acquire_research_run')).rejects.toMatchObject({ code: 'RESEARCH_IN_PROGRESS' });
    await db.sql.query("update research_runs set lease_until=now()-interval '1 second' where id=$1", [run.id]);
    const recovered = await db.rpc<{ id: string }>('acquire_research_run'); expect(recovered.id).not.toBe(run.id);
    const old = await db.sql.query<{ status: string }>('select status from research_runs where id=$1', [run.id]); expect(old.rows[0].status).toBe('partial');
  });
  it('starts from last successful scan with three-day overlap', async () => {
    const end = '2026-10-01T00:00:00Z';
    await db.sql.query("insert into research_runs(status,window_start,window_end,lease_until) values('succeeded','2026-09-01',$1,now())", [end]);
    const run = await db.rpc<{ window_start: string }>('acquire_research_run'); expect(Date.parse(run.window_start)).toBe(Date.parse(end) - 3 * 86400000);
  });
  it('enforces database-backed request budgets', async () => {
    expect(await db.rpc('consume_rate', { p_key: 'test', p_limit: 1, p_seconds: 60 })).toBe(true);
    expect(await db.rpc('consume_rate', { p_key: 'test', p_limit: 1, p_seconds: 60 })).toBe(false);
    await db.sql.exec("update rate_buckets set expires_at=now()-interval '1 second'");
    expect(await db.rpc('consume_rate', { p_key: 'test', p_limit: 1, p_seconds: 60 })).toBe(true);
  });
  it('denies anonymous table reads and RPC execution', async () => {
    await db.sql.exec('set role anon;');
    try {
      await expect(db.sql.query('select * from interview_sessions')).rejects.toThrow(/permission denied/);
      await expect(db.sql.query('select interview_snapshot($1)', [randomUUID()])).rejects.toThrow(/permission denied/);
    } finally { await db.sql.exec('reset role;'); }
    const result = await db.sql.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname='answer_evaluations'"); expect(result.rows[0].relrowsecurity).toBe(true);
  });
  it('rolls back an entire forecast when a citation is invalid', async () => {
    await expect(db.rpc('save_forecast', { p_forecast: { topic: 'Test', explanation: 'Fixture', predictedSkills: ['test'], targetRoles: ['software-engineer'], timeHorizonMonths: 12, preparationScore: 50, evidenceConfidence: 'weak', rubricVersion: 'test', dimensions: {}, dataMode: 'verified' }, p_evidence: [{ sourceId: randomUUID(), relationshipType: 'academic', explanation: 'Missing source', stance: 'support' }] })).rejects.toThrow();
    expect((await db.sql.query('select * from topic_forecasts')).rows).toHaveLength(0);
  });
});
