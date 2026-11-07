import type { InterviewMode, PrivateEvaluation, QuestionKind } from '@/shared/contracts';
import type { QuestionRow } from '../storage/types';
import { INTERVIEW } from '../config';
export interface NextDecision { kind: QuestionKind; followUp: boolean; targetTopic: string; weaknesses: string[]; purpose?: string; target?: string }
const kinds: QuestionKind[] = ['behavioral', 'technical', 'system_design'];
export function decideNext(mode: InterviewMode, questions: QuestionRow[], evaluation: PrivateEvaluation | null, totalTurns: number = INTERVIEW.turns): NextDecision {
  if (questions.length >= totalTurns) throw new Error('Question budget exhausted');
  const current = questions.at(-1);
  const missing = kinds.filter(k => !questions.some(q => q.question_kind === k));
  const remaining = totalTurns - questions.length;
  let depth = 0; let q = current;
  while (q?.is_follow_up) { depth++; q = questions.find(parent => parent.id === q?.parent_question_id); }
  const proposal = evaluation?.adaptiveNextAction;
  const followUp = !!current && proposal?.action === 'follow_up' && proposal.weaknesses.length > 0 && depth < INTERVIEW.maxFollowUpDepth && (mode !== 'mixed' || remaining > missing.length);
  return {
    kind: followUp ? current!.question_kind : mode === 'mixed' ? (missing[0] ?? kinds[questions.length % kinds.length]) : mode,
    followUp, targetTopic: followUp ? current!.topic : proposal?.targetTopic ?? '',
    weaknesses: followUp ? proposal!.weaknesses : [],
  };
}
