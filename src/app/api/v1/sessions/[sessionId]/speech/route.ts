import { audio } from '@/server/audio';
export const runtime = 'nodejs';
export const maxDuration = 90;
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return audio(request, (await context.params).sessionId, 'speech');
}
