import type { CreateSessionRequest, GeneratedQuestion, PrivateEvaluation, SessionReport, CompleteTurnResponse } from '@/shared/contracts';
export interface ForecastEvidence { id: string; research_source_id: string; explanation: string; stance: 'support' | 'contradiction'; relationship_type: string; source: { title: string; url: string; published_at: string; publisher: string; source_type: string } }
export interface Forecast {
  id: string; topic: string; explanation: string; predicted_skills: string[]; target_roles: string[];
  preparation_score: number; evidence_confidence: 'weak' | 'moderate' | 'strong'; data_mode: 'verified' | 'illustrative';
  created_at: string; evidence: ForecastEvidence[];
}
export interface SavedQuestion extends GeneratedQuestion {
  id: string; generationModel: string; forecastSnapshot: Forecast | null; isFollowUp: boolean; parentQuestionId: string | null;
}
export interface QuestionRow {
  id: string; session_id: string; turn_index: number; question_text: string; question_kind: GeneratedQuestion['kind'];
  topic: string; difficulty: GeneratedQuestion['difficulty']; forecast_id: string | null; forecast_snapshot: Forecast | null;
  assessment_guidance: string; expected_concepts: string[]; evidence_ids: string[]; generation_model: string;
  is_follow_up: boolean; parent_question_id: string | null;
}
export interface SessionRow {
  owner_id: string | null;
  id: string; company_id: string; role_id: string; interview_mode: CreateSessionRequest['round']; difficulty: CreateSessionRequest['difficulty'];
  status: 'active' | 'completed' | 'cancelled'; current_turn_index: number; total_turns: number; current_question_id: string | null;
  session_token_hash: string; audio_processing_consent: boolean; data_mode: Forecast['data_mode']; expires_at: string;
}
export interface AnswerRow {
  id: string; session_id: string; question_id: string; client_answer_id: string; transcript: string; input_mode: 'text' | 'voice';
  processing_status: 'processing' | 'failed' | 'done'; lease_token: string; payload_hash: string;
  next_question_checkpoint: SavedQuestion | null; response_data: CompleteTurnResponse | null; evaluation: PrivateEvaluation | null;
}
export interface Snapshot { session: SessionRow; questions: QuestionRow[]; answers: AnswerRow[]; report: SessionReport | null }
export interface Database {
  rpc<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  snapshot(id: string): Promise<Snapshot | null>;
  forecasts(roleId: string, mode: Forecast['data_mode']): Promise<Forecast[]>;
  deleteSession(id: string): Promise<void>;
}
