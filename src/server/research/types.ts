import type { z } from 'zod';
import type { analysisSchema } from './schemas';
export interface Window { start: string; end: string }
export interface ResearchSource {
  id: string; sourceType: 'industry' | 'academic'; publisher: string; title: string; url: string;
  publishedAt: string; text: string; quality: 'official' | 'secondary'; organization?: string;
}
export interface Paper {
  id: string; arxivId: string | null; doi: string | null; openalexId: string | null;
  title: string; abstract: string; authors: string[]; institutions: { id: string; name: string }[];
  publishedAt: string; updatedAt: string; sourceUrl: string; fulltextUrl: string | null;
  publicationStatus: 'preprint' | 'published' | 'unknown';
}
export type Analysis = z.infer<typeof analysisSchema>;
export interface EvidenceInput { source: ResearchSource; concepts: string[]; description: string; limitations: string[]; organization?: string }
export interface Run { id: string; window_start: string; window_end: string; status: string }
