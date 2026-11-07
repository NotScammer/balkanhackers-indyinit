import Link from "next/link";
import { isMock } from "../lib/client/api";
export default function AppShell({
  children,
  practice = "Interview practice",
  returnTo,
}: {
  children: React.ReactNode;
  practice?: string;
  returnTo?: string;
}) {
  return (
    <main>
      <header>
        <Link className="brand" href="/">
          Rehearsal<span>Interview practice</span>
        </Link>
        <span className="practice-name">{practice}</span>
        <Link
          href={
            returnTo
              ? `/login?returnTo=${encodeURIComponent(returnTo)}`
              : "/login"
          }
          className="account-link"
        >
          Guest · Account preview
        </Link>
      </header>
      <div className="shell">
        <section className="panel" aria-label="Practice workspace">
          {isMock && (
            <p className="fixture">
              Practice demo · Questions and feedback are fixtures, not AI
              assessment. Questions use browser speech; answer transcription
              requires the real API.
            </p>
          )}
          {children}
        </section>
      </div>
      <footer>
        <span>Voice interview practice.</span>
        <span>No coding questions. No company endorsement.</span>
      </footer>
    </main>
  );
}
