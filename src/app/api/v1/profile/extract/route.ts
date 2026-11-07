import { backend } from "@/server/api";
import { handle } from "@/server/http";
export const runtime = "nodejs";
export const maxDuration = 180;
export function POST(request: Request) {
  return handle(() => backend().profile.extract(request));
}
