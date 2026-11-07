import { backend } from '@/server/api';
import { handle } from '@/server/http';
export const runtime = 'nodejs';
export const maxDuration = 180;
export function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handle(async () => backend().report(request, (await context.params).sessionId));
}
