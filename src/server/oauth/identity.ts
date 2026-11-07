import "server-only";
import type { User } from "@supabase/supabase-js";
import { AppError } from "../errors";
import { authClient } from "./client";
import { authConfig } from "./config";
export interface AuthenticatedUser {
  id: string;
  email: string | null;
}
export type Authenticator = (request: Request) => Promise<AuthenticatedUser>;
export function isGoogleUser(user: User | null): user is User {
  return (
    !!user &&
    user.is_anonymous !== true &&
    !!user.identities?.some((identity) => identity.provider === "google")
  );
}
export function assertSameOrigin(request: Request, required = false) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && origin !== authConfig().origin) ||
    (required && !origin)
  ) {
    throw new AppError(
      "FORBIDDEN",
      403,
      "Cross-site requests are not allowed.",
    );
  }
}
export const requireUser: Authenticator = async (request) => {
  assertSameOrigin(request);
  const client = await authClient();
  // getUser asks Supabase to validate the session. Never trust cookie data/getSession alone.
  const { data, error } = await client.auth.getUser();
  if (error && (!error.status || error.status >= 500))
    throw new AppError(
      "AUTH_UNAVAILABLE",
      503,
      "Sign-in verification is temporarily unavailable.",
      true,
    );
  if (error || !isGoogleUser(data.user))
    throw new AppError(
      "UNAUTHORIZED",
      401,
      "Sign in with Google to use interviews.",
    );
  return { id: data.user.id, email: data.user.email ?? null };
};
