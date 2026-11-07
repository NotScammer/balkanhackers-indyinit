import 'server-only';
export class AppError extends Error {
  constructor(public code: string, public status: number, message: string, public retryable = false) { super(message); }
}
const dbCodes: Record<string, [number, string, boolean]> = {
  SESSION_UNAVAILABLE: [404, 'Session unavailable or expired.', false],
  IDEMPOTENCY_CONFLICT: [409, 'This answer ID was already used with another payload.', false],
  EVALUATION_IN_PROGRESS: [409, 'A turn is being processed. Retry the same answer ID.', true],
  QUESTION_OUT_OF_ORDER: [409, 'Reload the saved session before submitting.', false],
  SESSION_INCOMPLETE: [409, 'A completed report is not available.', false],
  AUDIO_CONSENT_REQUIRED: [403, 'Audio processing consent is required.', false],
  ATTEMPT_LIMIT: [429, 'Answer processing attempt limit reached. End this session and start again.', false],
  RESEARCH_IN_PROGRESS: [409, 'A research scan is already running.', true],
};
export function databaseError(message?: string): AppError {
  const code = message && Object.keys(dbCodes).find(c => message.includes(c));
  if (code) { const [status, text, retryable] = dbCodes[code]; return new AppError(code, status, text, retryable); }
  return new AppError('DATABASE_UNAVAILABLE', 503, 'Database operation failed.', true);
}
