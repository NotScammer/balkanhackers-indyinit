import "server-only";
import { NextResponse } from "next/server";
import { safeReturnPath } from "@/lib/auth-paths";
import { authClient } from "./client";
import { authConfig } from "./config";
import { assertSameOrigin, isGoogleUser, requireUser } from "./identity";
import { handle, json } from "../http";
import { AppError } from "../errors";
function redirect(path: string) {
  const response = NextResponse.redirect(
    new URL(path, authConfig().origin),
    303,
  );
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
export function login(request: Request) {
  return handle(async () => {
    assertSameOrigin(request, true);
    const form = await request.formData();
    const returnTo = safeReturnPath(
      typeof form.get("returnTo") === "string"
        ? (form.get("returnTo") as string)
        : null,
    );
    const callback = new URL("/auth/callback", authConfig().origin);
    callback.searchParams.set("returnTo", returnTo);
    const client = await authClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.href,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error || !data.url)
      throw new AppError(
        "AUTH_UNAVAILABLE",
        503,
        "Google sign-in could not be started. Please try again.",
        true,
      );
    const response = NextResponse.redirect(data.url, 303);
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  });
}
export async function callback(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error"))
      return redirect("/login?error=oauth_failed");
    const client = await authClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) return redirect("/login?error=oauth_failed");
    const verified = await client.auth.getUser();
    if (verified.error || !isGoogleUser(verified.data.user)) {
      await client.auth.signOut({ scope: "local" });
      return redirect("/login?error=oauth_failed");
    }
    return redirect(safeReturnPath(url.searchParams.get("returnTo")));
  });
}
export function logout(request: Request) {
  return handle(async () => {
    assertSameOrigin(request, true);
    const client = await authClient();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error)
      throw new AppError(
        "AUTH_UNAVAILABLE",
        503,
        "Sign-out could not complete. Please try again.",
        true,
      );
    return redirect("/login");
  });
}
export function me(request: Request) {
  return handle(async () => json({ user: await requireUser(request) }));
}
