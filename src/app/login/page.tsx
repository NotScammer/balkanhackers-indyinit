import AppShell from "../../components/AppShell";
import { safeReturnPath } from "@/lib/auth-paths";
import { authConfigured } from "@/server/oauth/config";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const params = await searchParams;
  const configured = authConfigured();
  return (
    <AppShell practice="Welcome">
      <p className="eyebrow">Your interview practice</p>
      <h1>Sign in to Rehearsal.</h1>
      <p>
        Continue with Google to start an interview. Your questions, answers, and
        feedback are private to your signed-in account and interview session.
      </p>
      {params.error && (
        <p className="notice" role="alert">
          Sign-in was cancelled or could not be completed. Please try again.
        </p>
      )}
      {!configured && (
        <p className="notice" role="status">
          Sign-in is temporarily unavailable. Please try again later.
        </p>
      )}
      <form action="/auth/login" method="post">
        <input
          type="hidden"
          name="returnTo"
          value={safeReturnPath(params.returnTo)}
        />
        <button className="primary" type="submit" disabled={!configured}>
          Continue with Google
        </button>
      </form>
      <p className="fine">
        Google handles your sign-in. Rehearsal never receives your Google
        password. Interview sessions expire after 24 hours.
      </p>
    </AppShell>
  );
}
