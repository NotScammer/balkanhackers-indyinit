import Link from "next/link";
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
          <span className="brand-mark" aria-hidden="true">
            r.
          </span>
          Rehearsal
        </Link>
        <span className="practice-name">
          <span className="status-dot" />
          {practice}
        </span>
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
