import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors';
export function json(data: unknown, status = 200) {
  return new Response(data === null && status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'Vary': 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
export async function handle(run: () => Promise<Response>) {
  const requestId = randomUUID();
  try { const response = await run(); if (!response.headers.has('X-Request-Id')) response.headers.set('X-Request-Id', requestId); return response; }
  catch (error) {
    const e = error instanceof AppError ? error : error instanceof z.ZodError || error instanceof SyntaxError
      ? new AppError('INVALID_REQUEST', 400, 'Request validation failed.')
      : new AppError('INTERNAL_ERROR', 500, 'Request failed.', true);
    const response = json({ error: { code: e.code, message: e.message, retryable: e.retryable, requestId } }, e.status);
    response.headers.set('X-Request-Id', requestId);
    if (e.code === 'RATE_LIMITED') response.headers.set('Retry-After', '60');
    return response;
  }
}
export async function body<T>(request: Request, schema: z.ZodType<T>, maxBytes = 65536): Promise<T> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('INVALID_REQUEST', 400, 'Use application/json.');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('INVALID_REQUEST', 400, 'JSON body required.');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new AppError('PAYLOAD_TOO_LARGE', 413, 'Request body is too large.'); }
    chunks.push(value);
  }
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
export function sessionId(id: string) { return z.uuid().parse(id); }
