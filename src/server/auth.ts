import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';
import type { Database, Snapshot } from './storage/types';
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function newCapability() { const token = randomBytes(32).toString('base64url'); return { token, hash: hashToken(token) }; }
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(hashToken(a), 'hex'); const y = Buffer.from(hashToken(b), 'hex');
  return timingSafeEqual(x, y);
}
export function bearer(request: Request): string {
  const match = /^Bearer ([^\s]{20,512})$/.exec(request.headers.get('authorization') ?? '');
  if (!match) throw new AppError('UNAUTHORIZED', 401, 'A valid Bearer credential is required.');
  return match[1];
}
/** Replace this capability authorizer with Supabase Auth later; storage remains private. */
export async function authorize(db: Database, id: string, request: Request): Promise<Snapshot> {
  const token = bearer(request);
  const state = await db.snapshot(id);
  if (!state || !safeEqual(state.session.session_token_hash, hashToken(token)) || Date.parse(state.session.expires_at) <= Date.now()) {
    throw new AppError('SESSION_UNAVAILABLE', 404, 'Session unavailable or expired.');
  }
  return state;
}
export function authorizeCron(request: Request, secret: string | undefined) {
  if (!secret) throw new AppError('NOT_CONFIGURED', 503, 'Monthly research is not configured.');
  if (!safeEqual(bearer(request), secret)) throw new AppError('UNAUTHORIZED', 401, 'Invalid cron credential.');
}
