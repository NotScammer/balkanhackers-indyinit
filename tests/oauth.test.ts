import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
  client: vi.fn(),
  createServerClient: vi.fn(),
}));
vi.mock("../src/server/oauth/client", () => ({ authClient: mocks.client }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
import {
  authConfig,
  authConfigured,
  authCookieOptions,
} from "../src/server/oauth/config";
import { requireUser } from "../src/server/oauth/identity";
import { login, callback, logout, me } from "../src/server/oauth/routes";
import { updateAuth } from "../src/server/oauth/proxy";
import { testUser } from "./identity";
const user = {
  ...testUser,
  is_anonymous: false,
  identities: [{ provider: "google" }],
} as User;
const client = { auth: mocks };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://auth-test.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_only");
  vi.stubEnv("APP_URL", "https://app.example.invalid");
  mocks.client.mockResolvedValue(client);
  mocks.createServerClient.mockReturnValue(client);
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.signInWithOAuth.mockResolvedValue({
    data: {
      url: "https://auth-test.supabase.co/auth/v1/authorize?provider=google",
    },
    error: null,
  });
  mocks.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
const formRequest = (
  path: string,
  origin: string | null = "https://app.example.invalid",
  returnTo = "/",
) =>
  new Request(`https://app.example.invalid${path}`, {
    method: "POST",
    headers: {
      ...(origin ? { Origin: origin } : {}),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ returnTo }),
  });
it("starts Google OAuth with a server-side PKCE client and an allowlisted return path", async () => {
  const response = await login(
    formRequest("/auth/login", undefined, "/interview/opaque-id"),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toContain("provider=google");
  expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
    provider: "google",
    options: {
      redirectTo:
        "https://app.example.invalid/auth/callback?returnTo=%2Finterview%2Fopaque-id",
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it.each(["https://evil.example", null])(
  "rejects cross-site or missing-Origin sign-in POSTs (%s)",
  async (origin) => {
    expect((await login(formRequest("/auth/login", origin))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  },
);
it("exchanges a callback code, verifies the Google identity and redirects only within the app", async () => {
  const response = await callback(
    new Request(
      "https://app.example.invalid/auth/callback?code=one-time-code&returnTo=%2Fresults%2Fopaque-id",
    ),
  );
  expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
  expect(mocks.getUser).toHaveBeenCalled();
  expect(response.headers.get("location")).toBe(
    "https://app.example.invalid/results/opaque-id",
  );
});
it.each([
  "//evil.example",
  "https://evil.example",
  "/auth/login",
  "/interview/id?redirect=evil",
])("blocks open redirects (%s)", async (target) => {
  const response = await callback(
    new Request(
      `https://app.example.invalid/auth/callback?code=test&returnTo=${encodeURIComponent(target)}`,
    ),
  );
  expect(response.headers.get("location")).toBe("https://app.example.invalid/");
});
it("handles provider cancellation and missing codes without exchanging a session", async () => {
  const response = await callback(
    new Request(
      "https://app.example.invalid/auth/callback?error=access_denied",
    ),
  );
  expect(response.headers.get("location")).toBe(
    "https://app.example.invalid/login?error=oauth_failed",
  );
  expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
});
it("rejects failed or replayed callback codes without exposing provider errors", async () => {
  mocks.exchangeCodeForSession.mockResolvedValue({
    error: { message: "sensitive upstream error" },
  });
  const response = await callback(
    new Request("https://app.example.invalid/auth/callback?code=already-used"),
  );
  expect(response.headers.get("location")).toBe(
    "https://app.example.invalid/login?error=oauth_failed",
  );
  expect(await response.text()).not.toContain("sensitive upstream error");
});
it("requires a server-verified Google identity rather than trusting cookie contents", async () => {
  const request = new Request("https://app.example.invalid/api/v1/auth/me", {
    headers: { Cookie: "forged-user=someone-else" },
  });
  expect(await requireUser(request)).toEqual(testUser);
  expect(mocks.getUser).toHaveBeenCalledTimes(1);
  expect(mocks.getSession).not.toHaveBeenCalled();
  expect(await (await me(request)).json()).toEqual({ user: testUser });
});
it.each([
  { ...user, is_anonymous: true },
  {
    ...user,
    identities: [{ provider: "email" }],
    user_metadata: { provider: "google" },
  },
  null,
])("rejects anonymous, non-OAuth and absent users", async (untrusted) => {
  mocks.getUser.mockResolvedValue({ data: { user: untrusted }, error: null });
  expect(
    (await me(new Request("https://app.example.invalid/api/v1/auth/me")))
      .status,
  ).toBe(401);
});
it("returns a retryable auth-service error without granting access", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: null },
    error: { status: 503 },
  });
  const response = await me(
    new Request("https://app.example.invalid/api/v1/auth/me"),
  );
  expect(response.status).toBe(503);
  expect((await response.json()).error.retryable).toBe(true);
});
it("checks the Origin of authenticated writes", async () => {
  const response = await me(
    formRequest("/api/v1/auth/me", "https://evil.example"),
  );
  expect(response.status).toBe(403);
  expect(mocks.getUser).not.toHaveBeenCalled();
});
it("signs out through a same-origin POST and rejects cross-site logout", async () => {
  expect(
    (await logout(formRequest("/auth/logout", "https://evil.example"))).status,
  ).toBe(403);
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(
    (await logout(formRequest("/auth/logout"))).headers.get("location"),
  ).toBe("https://app.example.invalid/login");
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("uses HttpOnly, SameSite=Lax, HTTPS-secure cookies and rejects unsafe application origins", () => {
  expect(authCookieOptions()).toEqual({
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  vi.stubEnv("APP_URL", "http://localhost:3000");
  expect(authCookieOptions().secure).toBe(false);
  vi.stubEnv("APP_URL", "http://public.example");
  expect(authConfigured()).toBe(false);
  expect(() => authConfig()).toThrow();
});
it("redirects guests away from setup, interview and results pages", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: null },
    error: { status: 400 },
  });
  for (const path of ["/", "/interview/opaque-id", "/results/opaque-id"]) {
    const response = await updateAuth(
      new NextRequest(`https://app.example.invalid${path}`),
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnTo")).toBe(path);
  }
});
it("does not render private pages when Auth is unconfigured", async () => {
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
  expect(
    (
      await updateAuth(new NextRequest("https://app.example.invalid/"))
    ).headers.get("location"),
  ).toContain("/login");
  expect(mocks.getUser).not.toHaveBeenCalled();
});
it("passes refreshed cookies to the browser even when redirecting away from login", async () => {
  mocks.getUser.mockImplementationOnce(async () => {
    const options = mocks.createServerClient.mock.calls[0][2];
    options.cookies.setAll([
      {
        name: "refreshed-session",
        value: "new-test-token",
        options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
      },
    ]);
    return { data: { user }, error: null };
  });
  const response = await updateAuth(
    new NextRequest(
      "https://app.example.invalid/login?returnTo=%2Fresults%2Fopaque-id",
    ),
  );
  expect(response.headers.get("location")).toBe(
    "https://app.example.invalid/results/opaque-id",
  );
  expect(response.cookies.get("refreshed-session")?.value).toBe(
    "new-test-token",
  );
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
