import { backend } from "@/server/api";
import { handle } from "@/server/http";
export const runtime = "nodejs";
export const maxDuration = 180;
export function GET(request: Request) {
  return handle(() => backend().profile.get(request));
}
export function PUT(request: Request) {
  return handle(() => backend().profile.save(request));
}
export function DELETE(request: Request) {
  return handle(() => backend().profile.remove(request));
}
