import { backend } from "@/server/api";
import { handle } from "@/server/http";
export const runtime = "nodejs";
export const maxDuration = 30;
export function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  return handle(async () =>
    backend().live.token(request, (await context.params).sessionId),
  );
}
