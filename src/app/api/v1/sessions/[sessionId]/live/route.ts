import { backend } from "@/server/api";
import { handle } from "@/server/http";
export const runtime = "nodejs";
export const maxDuration = 180;
type Context = { params: Promise<{ sessionId: string }> };
export function GET(request: Request, context: Context) {
  return handle(async () =>
    backend().live.get(request, (await context.params).sessionId),
  );
}
export function POST(request: Request, context: Context) {
  return handle(async () =>
    backend().live.turn(request, (await context.params).sessionId),
  );
}
