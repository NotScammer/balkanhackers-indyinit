import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import AccountMenu from "./AccountMenu";
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
        <AccountMenu returnTo={returnTo} />
      </header>
      <div className="shell">
        <section className="panel" aria-label="Practice workspace">
          {children}
        </section>
      </div>
      <footer>
        <span>Voice interview practice.</span>
        <span>No coding questions. No company endorsement.</span>
        <ThemeToggle />
      </footer>
    </main>
  );
}
