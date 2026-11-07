import { personalizationSchema } from "./personalization";
import { z } from 'zod';

export const interviewModeSchema = z.enum(['behavioral', 'technical', 'system_design', 'mixed']);
export const questionKindSchema = z.enum(['behavioral', 'technical', 'system_design']);
export const difficultySchema = z.enum(['beginner', 'intermediate', 'advanced']);
export const createSessionSchema = z.object({
  companyId: z.string().min(1).max(60), roleId: z.string().min(1).max(60),
  round: interviewModeSchema, difficulty: difficultySchema.default('intermediate'),
  personalization: personalizationSchema.optional(),
  audioProcessingConsent: z.boolean().default(false),
}).strict();
export const completeTurnSchema = z.object({
  clientAnswerId: z.uuid(), questionId: z.uuid(),
  transcript: z.string().trim().min(1).max(10000), inputMode: z.enum(['text', 'voice']),
  durationSeconds: z.number().finite().min(0).max(3600).nullable().optional(),
}).strict();
export const categoryScoresSchema = z.object({
  content: z.number().int().min(0).max(100), structure: z.number().int().min(0).max(100), relevance: z.number().int().min(0).max(100),
}).strict();
const notes = z.array(z.string().min(1).max(1000)).max(12);
export const adaptiveDecisionSchema = z.object({
  action: z.enum(['follow_up', 'new_topic']), weaknesses: notes,
  purpose: z.enum(['ownership', 'decision', 'trade_off', 'outcome', 'reasoning_gap', 'explore_strength']).optional(), target: z.string().max(1000).optional(),
  reasoning: z.string().min(1).max(2000), targetTopic: z.string().min(1).max(200),
}).strict();
export const generatedQuestionSchema = z.object({
  text: z.string().min(20).max(1800), kind: questionKindSchema,
  topic: z.string().min(1).max(200), difficulty: difficultySchema,
  forecastId: z.uuid().nullable(), evidenceIds: z.array(z.uuid()).max(20),
  assessmentGuidance: z.string().min(10).max(4000), expectedConcepts: notes,
}).strict();
export const aiEvaluationSchema = z.object({
  questionKind: questionKindSchema, rubricVersion: z.enum(['behavioral-v1', 'technical-v1', 'system-design-v1']),
  scores: categoryScoresSchema,
  evidence: z.array(z.object({ category: z.enum(['content', 'structure', 'relevance']), quote: z.string().min(1).max(2000), explanation: z.string().min(1).max(1000) }).strict()).max(12),
  strengths: notes, weaknesses: notes, improvements: notes, suggestedAnswerOutline: notes,
  understoodConcepts: notes, missingConcepts: notes, reasoningGaps: notes, misconceptions: notes,
  adaptiveNextAction: adaptiveDecisionSchema,
}).strict();
