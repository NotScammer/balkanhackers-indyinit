import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, authConfig, authCookieOptions } from "./config";
import { isGoogleUser } from "./identity";
import { safeReturnPath } from "@/lib/auth-paths";
export async function updateAuth(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "no-store, private");
  // Browsing companies and research must not depend on an Auth session or
  // provider availability. Private pages and APIs still verify the owner.
  if (
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname === "/api/v1/catalog"
  )
    return response;
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const isLogin = request.nextUrl.pathname === "/login";
  const loginRedirect = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("returnTo", safeReturnPath(request.nextUrl.pathname));
    const result = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
    result.headers.set("Cache-Control", "no-store, private");
    return result;
  };
  // Missing setup must not enable anonymous practice. APIs return their structured setup error.
  if (!authConfigured()) return isApi || isLogin ? response : loginRedirect();
  const config = authConfig();
  const client = createServerClient(config.url, config.key, {
    cookieOptions: authCookieOptions(),
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        for (const { name, value } of values) request.cookies.set(name, value);
        const previous = response.cookies.getAll();
        response = NextResponse.next({ request });
        for (const cookie of previous) response.cookies.set(cookie);
        for (const { name, value, options } of values)
          response.cookies.set(name, value, options);
        response.headers.set("Cache-Control", "no-store, private");
      },
    },
  });
  const { data, error } = await client.auth.getUser();
  const authenticated = !error && isGoogleUser(data.user);
  if (!authenticated && !isApi && !isLogin) return loginRedirect();
  if (authenticated && isLogin) {
    const result = NextResponse.redirect(
      new URL(
        safeReturnPath(request.nextUrl.searchParams.get("returnTo")),
        config.origin,
      ),
    );
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
    result.headers.set("Cache-Control", "no-store, private");
    return result;
  }
  return response;
}
