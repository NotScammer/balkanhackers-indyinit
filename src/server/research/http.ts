import 'server-only';
import robotsParser from 'robots-parser';
import { load } from 'cheerio';
import { AppError } from '../errors';
export const AGENT = 'InterviewResearchBot';
const OFFICIAL_HOSTS = ['openai.com', 'www.anthropic.com', 'anthropic.com', 'blogs.nvidia.com', 'nvidianews.nvidia.com', 'arxiv.org', 'export.arxiv.org'];
export function allowedUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !OFFICIAL_HOSTS.includes(url.hostname)) throw new AppError('SOURCE_REJECTED', 400, 'Research URL is outside the approved source hosts.');
  return url;
}
export async function fetchText(url: string, signal: AbortSignal, options: RequestInit = {}, maxBytes = 1200000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), redirect: 'error', headers: { 'User-Agent': AGENT, ...options.headers } });
  if (!response.ok) throw new AppError('SOURCE_UNAVAILABLE', 502, `Research source returned HTTP ${response.status}.`, true);
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new AppError('SOURCE_TOO_LARGE', 502, 'Research source exceeds the bounded retrieval size.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export class SourceReader {
  private robots = new Map<string, ReturnType<typeof robotsParser>>();
  private lastRequest = new Map<string, number>();
  constructor(private signal: AbortSignal) {}
  async get(raw: string) {
    const url = allowedUrl(raw);
    let robots = this.robots.get(url.origin);
    if (!robots) {
      // Failure to retrieve access rules skips this source; never assume permission on failure.
      const text = await fetchText(`${url.origin}/robots.txt`, this.signal, {}, 200000);
      this.lastRequest.set(url.origin, Date.now());
      robots = robotsParser(`${url.origin}/robots.txt`, text); this.robots.set(url.origin, robots);
    }
    if (robots.isAllowed(url.href, AGENT) === false) throw new AppError('ROBOTS_DENIED', 502, 'Source access rules disallow this request.');
    const delay = Math.max(url.hostname.includes('arxiv.org') ? 3100 : 1000, (robots.getCrawlDelay(AGENT) ?? 0) * 1000);
    const wait = delay - (Date.now() - (this.lastRequest.get(url.origin) ?? 0));
    if (wait > 0) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new AppError('RESEARCH_DEADLINE', 503, 'Research deadline reached.', true)); };
      const timer = setTimeout(() => { this.signal.removeEventListener('abort', abort); resolve(); }, wait);
      if (this.signal.aborted) abort(); else this.signal.addEventListener('abort', abort, { once: true });
    });
    this.lastRequest.set(url.origin, Date.now());
    return fetchText(url.href, this.signal);
  }
}
export function pageText(html: string) { const $ = load(html); $('script,style,nav,footer,header,noscript').remove(); return $('article,main').first().text().trim().replace(/\s+/g, ' ') || $('body').text().trim().replace(/\s+/g, ' '); }
export function canonicalUrl(raw: string) {
  const u = new URL(raw); u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (key.startsWith('utm_') || ['ref','source'].includes(key)) u.searchParams.delete(key);
  u.pathname = u.pathname.replace(/\/$/, '') || '/'; return u.href;
}
export function inWindow(date: string, window: { start: string; end: string }) {
  const time = Date.parse(date); return Number.isFinite(time) && time >= Date.parse(window.start) && time <= Date.parse(window.end) && time <= Date.now();
}
