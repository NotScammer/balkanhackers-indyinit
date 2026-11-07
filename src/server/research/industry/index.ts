import 'server-only';
import { randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { load } from 'cheerio';
import { z } from 'zod';
import { canonicalUrl, fetchText, inWindow, pageText, SourceReader } from '../http';
import type { ResearchSource, Window } from '../types';
export const MONITORED_COMPANIES = [
  { name: 'OpenAI', domain: 'openai.com', feed: 'https://openai.com/news/rss.xml' },
  { name: 'Anthropic', domain: 'anthropic.com', feed: null },
  { name: 'NVIDIA', domain: 'nvidia.com', feed: 'https://blogs.nvidia.com/feed/' },
] as const;
export interface SearchResult { title: string; url: string; text: string; publishedAt: string }
export interface SearchProvider { search(company: string, window: Window, signal: AbortSignal): Promise<SearchResult[]> }
export class TavilySearch implements SearchProvider {
  constructor(private key: string) {}
  async search(company: string, window: Window, signal: AbortSignal) {
    const raw = JSON.parse(await fetchText('https://api.tavily.com/search', signal, {
      method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `${company} engineering research infrastructure investment partnership acquisition hiring`, topic: 'news', search_depth: 'basic', max_results: 4, start_date: window.start.slice(0, 10), end_date: window.end.slice(0, 10), include_answer: false, include_raw_content: false }),
    }));
    const data = z.object({ results: z.array(z.object({ title: z.string(), url: z.url(), content: z.string(), published_date: z.string().optional() })) }).parse(raw);
    return data.results.flatMap(r => r.published_date && inWindow(r.published_date, window) && new URL(r.url).protocol === 'https:'
      ? [{ title: r.title, url: canonicalUrl(r.url), text: r.content, publishedAt: new Date(r.published_date).toISOString() }] : []);
  }
}
export function deduplicateSources(sources: ResearchSource[]) { return [...new Map(sources.map(s => [canonicalUrl(s.url), { ...s, url: canonicalUrl(s.url) }])).values()]; }
export async function officialSources(company: typeof MONITORED_COMPANIES[number], reader: SourceReader, window: Window): Promise<ResearchSource[]> {
  if (company.feed) {
    const xml = await reader.get(company.feed);
    const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(xml);
    const raw = parsed?.rss?.channel?.item ?? [];
    const items = Array.isArray(raw) ? raw : [raw];
    const candidates = items.flatMap((r: Record<string, unknown>) => {
      const item = z.object({ title: z.string(), link: z.url(), pubDate: z.string(), description: z.string().optional() }).safeParse(r);
      if (!item.success || !inWindow(item.data.pubDate, window)) return [];
      const hostname = new URL(item.data.link).hostname;
      if (!(hostname === company.domain || hostname.endsWith(`.${company.domain}`))) return [];
      return [{ id: randomUUID(), sourceType: 'industry' as const, publisher: company.name, organization: company.name, title: item.data.title, url: canonicalUrl(item.data.link), publishedAt: new Date(item.data.pubDate).toISOString(), text: pageText(item.data.description ?? ''), quality: 'official' as const }];
    }).slice(0, 3);
    for (const c of candidates.slice(0, 1)) {
      // Feed evidence remains usable if article retrieval is restricted/unavailable.
      try { c.text = pageText(await reader.get(c.url)).slice(0, 14000) || c.text; } catch { /* retain original feed excerpt */ }
    }
    return candidates.filter(c => c.text.length > 40);
  }
  const html = await reader.get('https://www.anthropic.com/news'); const $ = load(html);
  const links = [...new Set($('a[href^="/news/"]').map((_, el) => $(el).attr('href')).get())].slice(0, 2);
  const sources: ResearchSource[] = [];
  for (const link of links) {
    const url = new URL(link, 'https://www.anthropic.com').href;
    const page = await reader.get(url); const document = load(page);
    const date = document('meta[property="article:published_time"]').attr('content') ?? document('time[datetime]').first().attr('datetime');
    if (!date || !inWindow(date, window)) continue;
    sources.push({ id: randomUUID(), sourceType: 'industry', organization: company.name, publisher: company.name, title: document('h1').first().text().trim(), url: canonicalUrl(url), publishedAt: new Date(date).toISOString(), text: pageText(page).slice(0, 14000), quality: 'official' });
  }
  return sources;
}
export async function collectIndustry(window: Window, reader: SourceReader, signal: AbortSignal, search: SearchProvider | null, onError: (error: unknown) => void) {
  const sources: ResearchSource[] = [];
  for (const company of MONITORED_COMPANIES) {
    try { sources.push(...await officialSources(company, reader, window)); } catch (e) { onError(e); }
    if (search && !signal.aborted) {
      try {
        const results = await search.search(company.name, window, signal);
        sources.push(...results.map(r => ({ id: randomUUID(), sourceType: 'industry' as const, publisher: new URL(r.url).hostname, organization: company.name, title: r.title, url: r.url, publishedAt: r.publishedAt, text: r.text.slice(0, 10000), quality: 'secondary' as const })));
      } catch (e) { onError(e); }
    }
    if (signal.aborted) break;
  }
  // Targeted search results are used as bounded excerpts; arbitrary third-party pages are never fetched.
  return deduplicateSources(sources).slice(0, 20);
}
