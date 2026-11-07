import type { Question, SessionView, SessionReport, Evaluation, Category } from '@/shared/contracts';
import type { QuestionRow, Snapshot, SavedQuestion } from '../storage/types';
export function publicQuestion(q: QuestionRow | SavedQuestion): Question {
  const row = 'question_text' in q;
  const snapshot = row ? q.forecast_snapshot : q.forecastSnapshot;
  const kind = row ? q.question_kind : q.kind;
  return { id: q.id, text: row ? q.question_text : q.text, kind, topic: q.topic, difficulty: q.difficulty,
    maxAnswerSeconds: { behavioral: 180, technical: 300, system_design: 600 }[kind], origin: 'generated',
    sourceLabel: snapshot?.data_mode === 'illustrative' ? 'DEMO / ILLUSTRATIVE forecast; synthetic evidence' : snapshot ? 'Generated practice grounded in cited research; forecast is a hypothesis' : 'Generated behavioral practice',
    forecastId: row ? q.forecast_id : q.forecastId, evidenceIds: row ? q.evidence_ids : q.evidenceIds, isFollowUp: row ? q.is_follow_up : q.isFollowUp,
  };
}
export function sessionView(state: Snapshot): SessionView {
  const s = state.session; const q = state.questions.find(q => q.id === s.current_question_id);
  return { sessionId: s.id, round: s.interview_mode, status: s.status, assessedTurns: s.current_turn_index, totalQuestions: s.total_turns,
    currentTurn: s.status === 'active' && q ? { question: publicQuestion(q), questionNumber: s.current_turn_index + 1, totalQuestions: s.total_turns } : null,
    expiresAt: s.expires_at, reportAvailable: s.status === 'completed', dataMode: s.data_mode,
  };
}
export function buildReport(state: Snapshot, completedAt = new Date().toISOString()): SessionReport {
  const answers = state.answers.filter(a => a.evaluation).map(a => {
    const e = a.evaluation!;
    // Explicit projection: no adaptive reasoning, provider prompts, or private assessment guidance.
    const evaluation: Evaluation = { questionKind: e.questionKind, rubricVersion: e.rubricVersion, scores: e.scores, overallScore: e.overallScore, evidence: e.evidence, strengths: e.strengths, weaknesses: e.weaknesses, improvements: e.improvements, suggestedAnswerOutline: e.suggestedAnswerOutline };
    return { answerId: a.id, questionId: a.question_id, transcript: a.transcript, question: publicQuestion(state.questions.find(q => q.id === a.question_id)!), evaluation };
  });
  if (answers.length !== state.session.total_turns) throw new Error('Cannot report an incomplete session');
  const average = (values: number[]) => Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
  const categories: Category[] = ['content', 'structure', 'relevance'];
  return { sessionId: state.session.id, status: 'completed', round: state.session.interview_mode, completedAt,
    overallScore: average(answers.map(a => a.evaluation.overallScore)),
    categoryAverages: Object.fromEntries(categories.map(c => [c, average(answers.map(a => a.evaluation.scores[c]))])) as Record<Category, number>,
    answers, strengths: [...new Set(answers.flatMap(a => a.evaluation.strengths))].slice(0, 6), nextSteps: [...new Set(answers.flatMap(a => a.evaluation.improvements))].slice(0, 6), dataMode: state.session.data_mode,
  };
}
