// Exercise production HTTP routes and the real Supabase SSR/PKCE adapter against a
// local mock Auth authority. No Google, hosted Supabase, or paid AI calls are made.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const port = 3107;
const origin = `http://127.0.0.1:${port}`;
let expectedChallenge;
let verificationCalls = 0;
const upstreamErrors = [];
const timestamp = Math.floor(Date.now() / 1000);
const user = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  aud: "authenticated",
  role: "authenticated",
  email: "smoke@example.invalid",
  email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: {},
  is_anonymous: false,
  created_at: new Date().toISOString(),
  identities: [
    {
      identity_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      id: "smoke-google-id",
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: "google",
      identity_data: { sub: "smoke-google-id" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
};
const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", exp: timestamp + 3600, iat: timestamp, app_metadata: user.app_metadata })).toString("base64url")}.test-signature`;
const authority = createServer(async (request, response) => {
  try {
    assert.equal(request.headers.apikey, "sb_publishable_smoke_test");
    const url = new URL(request.url, "http://localhost");
    response.setHeader("Content-Type", "application/json");
    if (url.pathname === "/auth/v1/token") {
      assert.equal(url.searchParams.get("grant_type"), "pkce");
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const payload = JSON.parse(raw);
      assert.equal(payload.auth_code, "smoke-code");
      assert.equal(
        createHash("sha256").update(payload.code_verifier).digest("base64url"),
        expectedChallenge,
      );
      response.end(
        JSON.stringify({
          access_token: jwt,
          refresh_token: "smoke-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          user,
        }),
      );
    } else if (url.pathname === "/auth/v1/user") {
      assert.equal(request.headers.authorization, `Bearer ${jwt}`);
      verificationCalls++;
      response.end(JSON.stringify(user));
    } else if (url.pathname === "/auth/v1/logout") {
      assert.equal(request.headers.authorization, `Bearer ${jwt}`);
      response.writeHead(204);
      response.end();
    } else throw new Error(`Unexpected mocked upstream path: ${url.pathname}`);
  } catch (error) {
    upstreamErrors.push(error.message);
    response.writeHead(500);
    response.end(JSON.stringify({ message: "Mock Auth assertion failed" }));
  }
});
await new Promise((resolve) => authority.listen(0, "127.0.0.1", resolve));
const authOrigin = `http://127.0.0.1:${authority.address().port}`;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    stdio: "ignore",
    env: {
      ...process.env,
      APP_URL: origin,
      SUPABASE_URL: authOrigin,
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_smoke_test",
      SUPABASE_SERVICE_ROLE_KEY: "smoke-server-key-never-used-for-auth",
      RATE_LIMIT_SALT: "smoke-test-rate-salt-with-at-least-32-characters",
      CRON_SECRET: "smoke-test-secret-with-at-least-32-characters",
    },
  },
);
const jar = new Map();
function remember(response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0];
    const index = pair.indexOf("=");
    if (index >= 0) {
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
  }
}
const cookieHeader = () =>
  [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${origin}/api/v1/catalog`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "Production server did not become ready");
  const catalog = await fetch(`${origin}/api/v1/catalog`);
  assert.equal(catalog.status, 200);
  const interviewCatalog = await catalog.json();
  assert(interviewCatalog.interviewModes.includes("mixed"));
  for (const id of ["agents", "retrieval", "inference"]) {
    assert(interviewCatalog.availableInterviews.some((option) =>
      option.companyId === `roadmap-${id}` && option.roleId === "software-engineer" && option.round === "system_design",
    ));
  }
  const guest = await fetch(origin, { redirect: "manual" });
  assert.equal(guest.status, 200);
  assert.equal(guest.headers.get("location"), null);
  const publicHome = await guest.text();
  assert(!publicHome.includes('id="practice-setup"'));
  assert.equal((publicHome.match(/Start roadmap interview/g) ?? []).length, 3);
  for (const content of [
    'id="company-history"',
    'id="future-roadmaps"',
    'id="company-google"',
    'id="company-microsoft"',
    'id="company-monzo"',
    'id="company-gitlab"',
  ])
    assert(publicHome.includes(content), `Public home is missing ${content}`);
  for (const path of ["/interview/opaque-id", "/results/opaque-id"]) {
    const privatePage = await fetch(`${origin}${path}`, { redirect: "manual" });
    assert.equal(privatePage.status, 307);
    const destination = new URL(privatePage.headers.get("location"), origin);
    assert.equal(destination.pathname, "/login");
    assert.equal(destination.searchParams.get("returnTo"), path);
  }
  const signInPage = await fetch(`${origin}/login`);
  assert.equal(signInPage.status, 200);
  const html = await signInPage.text();
  assert(html.includes("Continue with Google"));
  assert(!html.includes("Continue as guest"));
  const privateCreate = await fetch(`${origin}/api/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: "{}",
  });
  assert.equal(privateCreate.status, 401);
  const privateError = await privateCreate.json();
  assert.equal(
    privateError.error.requestId,
    privateCreate.headers.get("x-request-id"),
  );
  const cron = await fetch(`${origin}/api/cron/monthly-research`);
  assert.equal(cron.status, 401);
  assert.match(cron.headers.get("cache-control"), /no-store/);
  const csrf = await fetch(`${origin}/auth/login`, {
    method: "POST",
    headers: { Origin: "https://evil.example" },
    redirect: "manual",
    body: new URLSearchParams({ returnTo: "/" }),
  });
  assert.equal(csrf.status, 403);
  const login = await fetch(`${origin}/auth/login`, {
    method: "POST",
    headers: { Origin: origin },
    redirect: "manual",
    body: new URLSearchParams({ returnTo: "/" }),
  });
  assert.equal(login.status, 303);
  remember(login);
  const destination = new URL(login.headers.get("location"));
  assert.equal(destination.origin, authOrigin);
  assert.equal(destination.searchParams.get("provider"), "google");
  expectedChallenge = destination.searchParams.get("code_challenge");
  assert(expectedChallenge);
  assert(
    login.headers
      .getSetCookie()
      .some(
        (value) => value.includes("HttpOnly") && value.includes("SameSite=lax"),
      ),
  );
  const callback = await fetch(`${origin}/auth/callback?code=smoke-code`, {
    headers: { Cookie: cookieHeader() },
    redirect: "manual",
  });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("location"), `${origin}/`);
  remember(callback);
  const me = await fetch(`${origin}/api/v1/auth/me`, {
    headers: { Cookie: cookieHeader() },
  });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), {
    user: { id: user.id, email: user.email },
  });
  remember(me);
  const signedInPage = await fetch(origin, {
    headers: { Cookie: cookieHeader() },
    redirect: "manual",
  });
  assert.equal(signedInPage.status, 200);
  const verifiedCreate = await fetch(`${origin}/api/v1/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookieHeader(),
    },
    body: "{}",
  });
  assert.equal(verifiedCreate.status, 400); // Identity accepted; malformed interview rejected before any paid/DB call.
  const logout = await fetch(`${origin}/auth/logout`, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookieHeader() },
    redirect: "manual",
  });
  assert.equal(logout.status, 303);
  remember(logout);
  const afterLogout = await fetch(`${origin}/api/v1/auth/me`, {
    headers: { Cookie: cookieHeader() },
  });
  assert.equal(afterLogout.status, 401);
  const publicAfterLogout = await fetch(origin, { redirect: "manual" });
  assert.equal(publicAfterLogout.status, 200);
  assert(verificationCalls > 0);
  assert.deepEqual(upstreamErrors, []);
  console.log(
    "Production HTTP smoke passed: public company guides and roadmaps, private interview gate, OAuth PKCE exchange, HttpOnly cookies, verified identity, sign-out, CSRF protection, cron protection and request IDs. Auth authority was mocked locally.",
  );
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => authority.close(resolve));
}
