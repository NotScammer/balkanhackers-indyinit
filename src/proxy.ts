import type { NextRequest } from "next/server";
import { updateAuth } from "@/server/oauth/proxy";
export function proxy(request: NextRequest) {
  return updateAuth(request);
}
export const config = {
  matcher: [
    "/",
    "/login",
    "/interview/:path*",
    "/results/:path*",
    "/api/v1/:path*",
  ],
};
