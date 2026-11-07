import Link from "next/link";
import { isMock } from "../lib/client/api";
export default function NotebookShell({
  children,
  practice = "Your practice notebook",
}: {
  children: React.ReactNode;
  practice?: string;
}) {
  return (
    <main>
      <header>
        <Link className="brand" href="/">
          Rehearsal<span>Interview practice</span>
        </Link>
        <span className="practice-name">{practice}</span>
        <Link href="/login" className="account-link">
          Guest · Account preview
        </Link>
      </header>
      <div className="shell">
        <section className="panel" aria-label="Practice workspace">
          {isMock && (
            <p className="fixture">
              Practice demo · Questions and feedback are fixtures, not AI
              assessment. Voice providers are not connected.
            </p>
          )}
          {children}
        </section>
      </div>
      <footer>
        <span>Make a little room to practice.</span>
        <span>No coding questions. No company endorsement.</span>
      </footer>
    </main>
  );
}
