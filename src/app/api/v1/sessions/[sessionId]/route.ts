import { backend } from '@/server/api';
import { handle } from '@/server/http';
export const runtime = 'nodejs';
type Context = { params: Promise<{ sessionId: string }> };
export function GET(request: Request, context: Context) { return handle(async () => backend().get(request, (await context.params).sessionId)); }
export function DELETE(request: Request, context: Context) { return handle(async () => backend().remove(request, (await context.params).sessionId)); }
