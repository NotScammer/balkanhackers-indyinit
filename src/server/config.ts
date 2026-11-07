import 'server-only';
import { z } from 'zod';
import { AppError } from './errors';
const envSchema = z.object({
  SUPABASE_URL: z.url(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(), ANTHROPIC_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(), OPENAI_REALTIME_MODEL: z.string().optional(), OPENAI_TRANSCRIPTION_MODEL: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(), OPENALEX_API_KEY: z.string().optional(),
  CRON_SECRET: z.preprocess(v => v === '' ? undefined : v, z.string().min(32).optional()), RATE_LIMIT_SALT: z.string().min(32),
  RESEARCH_DATA_MODE: z.enum(['verified', 'illustrative']).default('verified'),
  RESEARCH_DEADLINE_SECONDS: z.coerce.number().int().min(30).max(210).default(210),
  SESSION_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(100),
  RESEARCH_CONTACT_EMAIL: z.preprocess(v => v === '' ? undefined : v, z.email().optional()),
});
export function env() { const result = envSchema.safeParse(process.env); if (!result.success) throw new AppError('NOT_CONFIGURED', 503, 'Backend environment is missing or invalid. See .env.example and docs/SETUP.md.'); return result.data; }
export const INTERVIEW = { turns: 3, maxFollowUpDepth: 1, expiryHours: 24, leaseSeconds: 180, maxProcessingAttempts: 4 } as const;
export const SCORE_WEIGHTS = { content: 0.60, structure: 0.25, relevance: 0.15 } as const;
export const FORECAST_WEIGHTS = { industryMomentum: 0.25, academicMomentum: 0.20, roleRelevance: 0.30, technicalMaturity: 0.15, recency: 0.10 } as const;
export const FORECAST_RUBRIC = 'preparation-v1';
export const RUBRICS = {
  behavioral: { version: 'behavioral-v1', content: 'Specific personal actions, outcomes and reflection. STAR is optional; never infer honesty or fabricate outcomes.', structure: 'Clear context, action and result in any coherent order.', relevance: 'Evidence of the role competency being asked.' },
  technical: { version: 'technical-v1', content: 'Correct mechanisms, causal and diagnostic reasoning, alternatives and limitations; no code needed.', structure: 'Assumptions, ordered reasoning and conclusion.', relevance: 'Address this scenario and role constraints; accept correct alternatives.' },
  system_design: { version: 'system-design-v1', content: 'Requirements, coherent components/data flow, reliability, bottlenecks and justified trade-offs within scope.', structure: 'Requirements to architecture to failures and validation.', relevance: 'Prioritize actual scenario constraints; do not require unnecessary scale or components.' },
} as const;
