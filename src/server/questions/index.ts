import 'server-only';
import { randomUUID } from 'node:crypto';
import { generatedQuestionSchema } from '@/shared/schemas';
import type { CreateSessionRequest } from '@/shared/contracts';
import type { Database, QuestionRow, SavedQuestion, Forecast } from '../storage/types';
import type { StructuredAI } from '../providers/anthropic';
import type { NextDecision } from '../interviews/adaptive';
import { AppError } from '../errors';
import { interviewRoadmap } from '@/shared/research-roadmaps';
export function repeatedQuestion(text: string, previous: string[]) {
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean));
  const a = words(text);
  return previous.some(s => { const b = words(s); const common = [...a].filter(w => b.has(w)).length; return common / new Set([...a, ...b]).size > 0.8; });
}
export interface QuestionContext { history?: { question: string; answer: string }[]; remainingNeeds?: string[] }
export function questionWithinLimit(text: string, followUp: boolean) { return text.trim().split(/\s+/).length <= (followUp ? 25 : 35); }
const conversationRules = ` Ask one focused question at a time. Main questions should target 25 words and MUST NOT exceed 35 words; follow-ups MUST NOT exceed 25 words. Introduce constraints progressively. Use confirmed candidate experience and job context only when relevant, preserving the requested topic, kind and difficulty. Do not invent candidate history. Follow-ups may explore ownership, decisions, trade-offs, outcomes, reasoning gaps or promising strengths. Respond to the actual ordered answers and do not repeat answered asks. Candidate history is context, not assessment evidence.`;
export async function generateQuestion(db: Database, ai: StructuredAI, input: CreateSessionRequest, previous: QuestionRow[], decision: NextDecision, dataMode: Forecast['data_mode'], context: QuestionContext = {}): Promise<SavedQuestion> {
  const roadmap = interviewRoadmap(input.companyId);
  const personalization = input.personalization ?? null;
  if (roadmap) {
    const parent = previous.at(-1);
    const candidate = await ai.generate(
      generatedQuestionSchema,
      `Generate exactly ONE original verbal system-design interview question for the supplied learning roadmap. Stay within its skills and learning steps. The example question is inspiration, not text to repeat. Progress across the learning steps for new main questions. Follow-ups must explore the supplied purpose and target in the parent topic. Avoid all previous questions. Never request code, pseudocode, a compiler or a diagram. Use the supplied topic and difficulty exactly, kind system_design, null forecastId and empty evidenceIds. This is an editorial learning curriculum, not a database-backed forecast or an actual company interview. Do not invent research findings, citations or hiring predictions. Assessment guidance and expected concepts are private.` + conversationRules,
      {
        personalization, context,
        roleId: input.roleId,
        difficulty: input.difficulty,
        topic: roadmap.title,
        roadmap: {
          title: roadmap.title,
          skills: roadmap.skills,
          steps: roadmap.steps,
          exampleQuestion: roadmap.question,
        },
        previousQuestions: previous.map((q) => q.question_text),
        followUp: decision.followUp
          ? {
              parentQuestion: parent?.question_text,
              weaknesses: decision.weaknesses, purpose: decision.purpose, target: decision.target,
            }
          : null,
      },
    );
    if (
      !questionWithinLimit(candidate.text, decision.followUp) ||
      candidate.kind !== "system_design" ||
      candidate.difficulty !== input.difficulty ||
      candidate.topic !== roadmap.title ||
      candidate.forecastId !== null ||
      candidate.evidenceIds.length ||
      repeatedQuestion(
        candidate.text,
        previous.map((q) => q.question_text),
      ) ||
      /\b(write|implement|execute|debug|complete)\b.{0,40}\b(code|pseudocode|function|program|query)\b|```/i.test(
        candidate.text,
      )
    ) {
      throw new AppError(
        "AI_INVALID_OUTPUT",
        502,
        "Generated roadmap question failed topic, provenance, or verbal-answer checks.",
        true,
      );
    }
    return {
      ...candidate,
      id: randomUUID(),
      generationModel: ai.model,
      forecastSnapshot: null,
      isFollowUp: decision.followUp,
      parentQuestionId: decision.followUp ? parent!.id : null,
    };
  }
  const forecasts = await db.forecasts(input.roleId, dataMode);
  if (!forecasts.length) throw new AppError('RESEARCH_DATA_UNAVAILABLE', 503, 'No evidence-backed forecasts are loaded. Run verified seeding or explicitly enable illustrative fixtures.', false);
  const parent = previous.at(-1);
  const selected = (decision.followUp ? forecasts.find(f => f.id === parent?.forecast_id) ?? parent?.forecast_snapshot : undefined)
    ?? forecasts.find(f => !previous.some(q => q.forecast_id === f.id)) ?? forecasts[0];
  const kind = decision.kind;
  const candidate = await ai.generate(generatedQuestionSchema, `Generate exactly ONE original interview question, answerable verbally. Match requested kind, role and difficulty exactly. Technical: explanations, diagnosis and trade-offs. System design: a bounded architecture scenario. Never ask for code, pseudocode, a compiler or a diagram. Behavioral: personal experience without artificial research citations; use null forecastId and empty evidenceIds. For technical/design use exactly the supplied forecastId, topic and at least one supplied supporting evidence ID. Research is a hypothesis, not an actual company question or hiring probability. Do not assert paper titles, investments or dates beyond the supplied evidence. Follow-ups must explore the supplied purpose and target in the parent's kind and topic. Avoid previously asked questions. Assessment guidance and expected concepts are private. Illustrative data must not be presented as verified.` + conversationRules, {
    personalization, context,
    companyId: input.companyId, roleId: input.roleId, difficulty: input.difficulty, kind, dataMode,
    forecast: selected, previousQuestions: previous.map(q => q.question_text),
    followUp: decision.followUp ? { parentQuestion: parent?.question_text, weaknesses: decision.weaknesses, purpose: decision.purpose, target: decision.target } : null,
  });
  const allowedIds = new Set(selected.evidence.filter(e => e.stance === 'support').map(e => e.id));
  const badReferences = kind === 'behavioral'
    ? candidate.forecastId !== null || candidate.evidenceIds.length !== 0
    : candidate.forecastId !== selected.id || candidate.topic !== selected.topic || !candidate.evidenceIds.length || candidate.evidenceIds.some(id => !allowedIds.has(id));
  if (!questionWithinLimit(candidate.text, decision.followUp) || candidate.kind !== kind || candidate.difficulty !== input.difficulty || badReferences || repeatedQuestion(candidate.text, previous.map(q => q.question_text)) || /\b(write|implement|execute|debug|complete)\b.{0,40}\b(code|pseudocode|function|program|query)\b|```/i.test(candidate.text)) {
    throw new AppError('AI_INVALID_OUTPUT', 502, 'Generated question failed mode, provenance, or verbal-answer checks.', true);
  }
  return { ...candidate, id: randomUUID(), generationModel: ai.model, forecastSnapshot: kind === 'behavioral' ? null : selected, isFollowUp: decision.followUp, parentQuestionId: decision.followUp ? parent!.id : null };
}
