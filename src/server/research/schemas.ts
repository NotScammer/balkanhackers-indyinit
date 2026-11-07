import { z } from 'zod';
const notes = z.array(z.string().min(1).max(1200)).max(10);
export const signalBatchSchema = z.object({ signals: z.array(z.object({
  sourceId: z.uuid(), organization: z.string().min(1).max(100),
  signalType: z.enum(['technical_priority','investment','acquisition','partnership','infrastructure','hiring','research','product']),
  description: z.string().min(1).max(1500), technologies: z.array(z.string().min(1).max(100)).max(10),
  evidenceQuote: z.string().min(1).max(2000), commitment: z.enum(['confirmed','reported','speculative']),
}).strict()).max(12) }).strict();
export const screeningSchema = z.object({ papers: z.array(z.object({ paperId: z.uuid(), relevance: z.number().int().min(0).max(100), reasoning: z.string().min(1).max(1000) }).strict()).max(100) }).strict();
export const analysisSchema = z.object({
  relevance: z.number().int().min(0).max(100), findings: notes, limitations: notes,
  technicalConcepts: z.array(z.string().min(1).max(100)).max(12), engineeringApplications: notes,
  evidenceQuotes: z.array(z.string().min(1).max(1000)).max(8),
}).strict();
export const hypothesesSchema = z.object({ forecasts: z.array(z.object({
  topic: z.string().min(1).max(200), explanation: z.string().min(1).max(2000),
  predictedSkills: z.array(z.string().min(1).max(200)).min(1).max(10), targetRoles: z.array(z.literal('software-engineer')).min(1).max(1),
  timeHorizonMonths: z.number().int().min(1).max(60), roleRelevance: z.number().int().min(0).max(100), technicalMaturity: z.number().int().min(0).max(100),
  evidence: z.array(z.object({ sourceId: z.uuid(), stance: z.enum(['support','contradiction']), explanation: z.string().min(1).max(1000) }).strict()).min(1).max(20),
}).strict()).max(8) }).strict();
