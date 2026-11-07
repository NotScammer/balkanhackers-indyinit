import 'server-only';
import { randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { fetchText, inWindow } from '../http';
import type { Paper, Window } from '../types';
export const ARXIV_CATEGORIES = ['cs.AI','cs.LG','cs.CL','cs.CV','cs.RO','cs.DC','cs.SE','stat.ML'];
// Institution IDs are taken from OpenAlex institution records, not inferred from arXiv categories.
export const INSTITUTIONS = [{ id: 'I63966007', name: 'Massachusetts Institute of Technology' }, { id: 'I97018004', name: 'Stanford University' }, { id: 'I74973139', name: 'Carnegie Mellon University' }];
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const atomEntry = z.object({ id: z.string(), title: z.string(), summary: z.string(), published: z.string(), updated: z.string(), author: z.union([z.object({ name: z.string() }), z.array(z.object({ name: z.string() }))]).optional(), 'arxiv:doi': z.string().optional() });
export function parseArxiv(xml: string, window: Window): Paper[] {
  const parsed = new XMLParser({ ignoreAttributes: true, processEntities: false }).parse(xml);
  return array(parsed?.feed?.entry).flatMap(entry => {
    const result = atomEntry.safeParse(entry); if (!result.success) return [];
    const e = result.data;
    if (!inWindow(e.published, window)) return [];
    const arxivId = e.id.split('/abs/')[1]?.replace(/v\d+$/, '');
    if (!arxivId || !/^(\d{4}\.\d{4,5}|[a-z-]+\/\d{7})$/.test(arxivId)) return [];
    return [{ id: randomUUID(), arxivId, doi: normalizeDoi(e['arxiv:doi']), openalexId: null, title: e.title.replace(/\s+/g, ' ').trim(), abstract: e.summary.trim(), authors: array(e.author).map(a => a.name), institutions: [], publishedAt: e.published, updatedAt: e.updated, sourceUrl: `https://arxiv.org/abs/${arxivId}`, fulltextUrl: `https://arxiv.org/html/${arxivId}`, publicationStatus: 'preprint' as const }];
  });
}
export async function collectArxiv(window: Window, signal: AbortSignal, contact?: string) {
  const stamp = (d: string) => new Date(d).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const query = `(${ARXIV_CATEGORIES.map(c => `cat:${c}`).join(' OR ')}) AND submittedDate:[${stamp(window.start)} TO ${stamp(window.end)}]`;
  const url = new URL('https://export.arxiv.org/api/query');
  url.search = new URLSearchParams({ search_query: query, start: '0', max_results: '60', sortBy: 'submittedDate', sortOrder: 'descending' }).toString();
  // One request per monthly run. No pagination or bursts; fulltext reader separately respects >=3.1s intervals.
  return parseArxiv(await fetchText(url.href, signal, { headers: { 'User-Agent': `InterviewResearchBot${contact ? ` (mailto:${contact})` : ''}` } }), window);
}
export function normalizeDoi(raw?: string | null) { return raw?.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim() || null; }
const openAlexWork = z.object({
  id: z.string(), doi: z.string().nullable().optional(), display_name: z.string(), publication_date: z.string(), type: z.string().optional(),
  abstract_inverted_index: z.record(z.string(), z.array(z.number().int().nonnegative())).nullable().optional(),
  primary_location: z.object({ landing_page_url: z.string().nullable().optional() }).nullable().optional(),
  best_oa_location: z.object({ landing_page_url: z.string().nullable().optional() }).nullable().optional(),
  authorships: z.array(z.object({ author: z.object({ display_name: z.string() }), institutions: z.array(z.object({ id: z.string(), display_name: z.string() })) })),
});
export function parseOpenAlex(payload: unknown, window: Window): Paper[] {
  const data = z.object({ results: z.array(openAlexWork) }).parse(payload);
  return data.results.filter(w => inWindow(w.publication_date, window)).map(w => {
    const positions = Object.entries(w.abstract_inverted_index ?? {}).flatMap(([word, places]) => places.filter(p => p < 20000).map(p => ({ p, word })));
    const landing = w.primary_location?.landing_page_url ?? w.best_oa_location?.landing_page_url;
    const arxivId = landing?.match(/arxiv\.org\/abs\/((?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7}))(?:v\d+)?/)?.[1] ?? null;
    return { id: randomUUID(), arxivId, doi: normalizeDoi(w.doi), openalexId: w.id, title: w.display_name, abstract: positions.sort((a, b) => a.p - b.p).map(p => p.word).join(' '), authors: w.authorships.map(a => a.author.display_name), institutions: [...new Map(w.authorships.flatMap(a => a.institutions).map(i => [i.id, { id: i.id, name: i.display_name }])).values()], publishedAt: new Date(w.publication_date).toISOString(), updatedAt: new Date().toISOString(), sourceUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : w.id, fulltextUrl: arxivId ? `https://arxiv.org/html/${arxivId}` : null, publicationStatus: w.type === 'preprint' ? 'preprint' as const : w.type === 'article' ? 'published' as const : 'unknown' as const };
  });
}
export async function collectOpenAlex(window: Window, signal: AbortSignal, key: string) {
  const url = new URL('https://api.openalex.org/works');
  url.search = new URLSearchParams({ api_key: key, filter: `from_publication_date:${window.start.slice(0, 10)},to_publication_date:${window.end.slice(0, 10)},institutions.id:${INSTITUTIONS.map(i => i.id).join('|')}`, 'per-page': '40', sort: 'publication_date:desc' }).toString();
  return parseOpenAlex(JSON.parse(await fetchText(url.href, signal, {}, 3000000)), window);
}
export function deduplicatePapers(papers: Paper[]) {
  const groups: Paper[] = [];
  const match = (a: Paper, b: Paper) => (a.arxivId && a.arxivId === b.arxivId) || (a.doi && a.doi === b.doi) || (a.openalexId && a.openalexId === b.openalexId) || a.sourceUrl === b.sourceUrl;
  for (const paper of papers) {
    const merged = { ...paper, institutions: [...paper.institutions] };
    let found = true;
    while (found) {
      const index = groups.findIndex(p => match(p, merged));
      found = index >= 0;
      if (!found) break;
      const [other] = groups.splice(index, 1);
      merged.arxivId ??= other.arxivId; merged.doi ??= other.doi; merged.openalexId ??= other.openalexId;
      merged.fulltextUrl ??= other.fulltextUrl;
      merged.institutions = [...new Map([...merged.institutions, ...other.institutions].map(i => [i.id, i])).values()];
      if (other.abstract.length > merged.abstract.length) merged.abstract = other.abstract;
    }
    if (merged.arxivId) { merged.sourceUrl = `https://arxiv.org/abs/${merged.arxivId}`; merged.publicationStatus = 'preprint'; }
    groups.push(merged);
  }
  return groups.slice(0, 100);
}
