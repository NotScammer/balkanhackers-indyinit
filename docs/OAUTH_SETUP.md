# Required Google OAuth with Supabase

This branch requires a verified Supabase Google identity before interview creation or any private interview operation. The front page, company guides, research roadmaps and catalog are public, including when Auth is unconfigured or unavailable. Private interview and results pages redirect signed-out visitors to `/login`. Browsing does not create an interview. The separately secret-protected research cron remains available without a user login.

The existing interview Bearer capability remains an additional session-specific check. A private request must have both the signed-in owner's Supabase cookie and the correct interview token. Keep sending the existing `Authorization: Bearer <sessionToken>` header. The browser automatically includes its same-origin Auth cookie. A stolen interview token alone no longer grants access.

## Environment

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SERVICE_ROLE_KEY
SUPABASE_PUBLISHABLE_KEY=YOUR_PROJECT_PUBLISHABLE_KEY
APP_URL=http://localhost:3000
```

Use the publishable key from Supabase Project Settings → API Keys (a legacy `anon` key also works in `SUPABASE_PUBLISHABLE_KEY`). The Auth client uses this key; the existing database client separately uses the service-role key. They are never interchangeable. All Auth work is server-side, so neither key needs a `NEXT_PUBLIC_` prefix. Google client secrets are configured in Supabase, never in browser code.

`APP_URL` is the exact app origin with no path/query/fragment. Local HTTP is accepted only on localhost/127.0.0.1. In Vercel use the deployment's HTTPS origin. Configure Preview and Production separately and rebuild/redeploy after changing environment settings. Missing Auth configuration disables sign-in and does not open guest access. Other backend/model variables from `.env.example` are still required to run interviews.

## Google and Supabase dashboard setup

1. Create a Google OAuth client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials). Choose a Web application. Configure its consent screen and test users if the app is in testing mode.
2. In Supabase → Authentication → Sign In / Providers → Google, enable Google. Copy the **Supabase callback URL** shown there, normally `https://YOUR_PROJECT.supabase.co/auth/v1/callback`, into Google's authorized redirect URIs.
3. Enter the Google client ID and client secret in the Supabase Google provider settings. Do not put the Google secret into this repository.
4. In Supabase → Authentication → URL Configuration, set the production Site URL. Add exact allowed application callback URLs, including `http://localhost:3000/auth/callback` for development and `https://YOUR_APP/auth/callback` for deployment. Include the callback's permitted `returnTo` query variants or a narrowly scoped `/auth/callback**` allowlist entry if your dashboard matches the complete URL. Avoid broad production wildcards across unrelated domains.
5. Leave anonymous sign-ins disabled. This app only offers Google sign-in and rejects anonymous users and accounts without a Google identity.
6. Set `APP_URL` to the app origin matching those callback settings. The application does not derive its OAuth destination from client-supplied forwarded-host headers.

There are two callbacks: Google returns to **Supabase**, and Supabase then returns to the application's **`/auth/callback`**. Swapping these is a common setup error.

Official references: [Google sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Next.js server-side clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [server-side verification](https://supabase.com/docs/reference/javascript/auth-getuser).

## Apply migration 004

Apply migrations 001, 002, 003, then **`supabase/migrations/202611070004_oauth_ownership.sql`** in order. Use Supabase SQL Editor or the CLI workflow in [SETUP.md](SETUP.md). Migration 004 relies on Supabase's existing `auth.users` table.

It adds `interview_sessions.owner_id`, a foreign key to `auth.users(id)` with deletion cascading, an owner/date index, and a requirement for newly inserted/updated interviews to have an owner. The server-only `create_interview` function now requires the owner ID. Only the API derives it from the verified Auth user; a client-supplied `ownerId` is rejected by request validation.

Existing anonymous rows are preserved with a null owner and cannot be accessed through the OAuth API. We do not automatically claim legacy interviews for the next person to sign in. They remain eligible for normal expiry cleanup. Coordinate the database migration with deployment: older application versions cannot create new ownerless sessions after migration 004. Supabase account deletion cascades through that account's interview data; the app does not introduce a self-service account-deletion endpoint.

RLS stays enabled with no direct anonymous/authenticated browser access to sensitive tables or backend RPCs. Account ownership is checked in the server API, which uses the service role for storage. No broad user-readable policies are added.

Hosted migrations have not been applied or verified here. Automated database tests emulate `auth.users` only for the foreign-key behavior.

## End-to-end flow

1. A guest visits `/` to browse companies, interview processes and research roadmaps. Starting an interview sends them to sign-in while preserving their setup choices. Direct visits to `/interview/:id` or `/results/:id` redirect to `/login` with a strictly allowlisted local return path.
2. The Google button POSTs to `/auth/login`. An Origin check prevents cross-site login submissions. A per-request `@supabase/ssr` client starts Google OAuth using PKCE and stores the verifier cookie.
3. Google/Supabase redirect to `/auth/callback?code=...`. The callback exchanges the one-time code using the matching verifier, verifies the user with `auth.getUser()`, confirms the Google identity, and redirects to `/` or an allowed interview/results path. Failed/cancelled/replayed codes return a generic login error without exposing upstream details.
4. Supabase session cookies are HttpOnly, SameSite=Lax, path `/`, and Secure on HTTPS deployments. The browser never needs to read access/refresh tokens. This implementation intentionally uses server-only Auth clients, not `createBrowserClient`.
5. Proxy verifies users and refreshes cookies on page/API requests, preserving updated cookies on redirects. Private endpoints independently call `getUser()` and verify ownership, capability token and expiry; the redirect alone is not the authorization boundary. An unverified cookie or `getSession()` result is never trusted as identity.
6. Creating an interview records the verified user's ID. Usage is bounded per account as well as by existing global/IP budgets. All typed, compatibility, live, Realtime-token, speech, transcription, report, end and delete routes require the owner.
7. `/api/v1/auth/me` returns only `{ user: { id, email } }`; it never returns provider tokens. Header UI displays the account and offers a POST `/auth/logout` form. Sign-out revokes the current Auth session locally and clears Auth cookies. The UI also removes tab-local interview tokens/drafts while preserving the appearance setting.
8. The client API includes `credentials:'same-origin'` and redirects to sign-in on HTTP 401 while preserving the original pending answer for expiry/re-authentication. Explicit sign-out intentionally clears local drafts. Switching accounts cannot authorize the other account's interviews even when its tab token is known.

Cookie-based mutation requests with a foreign Origin or `Sec-Fetch-Site: cross-site` are rejected. Login/logout require an Origin header. Non-browser interview API clients must supply the owner's authenticated cookie jar plus interview token; no Google password, service-role key, arbitrary user ID or unverified JWT header replaces this requirement.

The interview token remains tab-local; signing in does not add cross-device history/recovery. Interview expiry remains 24 hours. This change adds account identity and ownership without changing question/scoring/research behavior.

## Verification and deployment rehearsal

Verified locally: 110 tests (22 frontend, 88 backend), typecheck, lint, production build and the production HTTP smoke check. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run smoke`. Unit/integration tests use mocked Auth responses and actual SQL migrations. They cover unauthorized creation, ownership with a stolen capability, all private API variants, Origin checks, callback errors, redirect safety, cookie attributes/refresh, sign-out and account-deletion cleanup. The production smoke check runs the actual SSR SDK against a local mock Auth authority, verifies the PKCE verifier/challenge exchange and cookie handling, and checks sign-out and guest gating. These checks do not spend API credits or establish that a real Google provider is configured.

Before a live demonstration:

- Configure the Supabase Google provider, Google consent/test users, app callback allowlist and exact `APP_URL`.
- Apply migration 004 and verify no browser read/RPC policies were added.
- Confirm the home page and company guides load while signed out; private interview/results pages redirect and direct API creation is denied without a login.
- Complete Google sign-in, start an interview, refresh it, sign out, and confirm its API is denied.
- Sign in as a second Google account; even with the first account's interview token, reads/voice credentials/deletion must be denied.
- Verify cookie refresh and error recovery on the actual deployed HTTPS origin.

No real Google consent flow or hosted Supabase migration success is claimed without those external credentials and dashboard settings.
