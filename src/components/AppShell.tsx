import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import AccountMenu from "./AccountMenu";
import MotionExperience from "./MotionExperience";
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
    <MotionExperience>
      <main className="experience-shell">
        <header className="site-header">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              t.
            </span>
            Talk To Future
          </Link>
          {practice === "Interview practice" ? (
            <nav className="site-navigation" aria-label="Main navigation">
              <Link href="/#company-history">The companies</Link>
              <Link href="/#future-roadmaps">What’s next</Link>
              <Link href="/#practice-setup">
                Your practice <span aria-hidden="true">↗</span>
              </Link>
            </nav>
          ) : (
            <span className="practice-name">
              <span className="status-dot" />
              {practice}
            </span>
          )}
          <AccountMenu returnTo={returnTo} />
        </header>
        <div className="shell">
          <section className="panel" aria-label="Practice workspace">
            {children}
          </section>
        </div>
        <footer>
          <div className="footer-signoff">
            <span>Here’s to</span> <em>your next chapter.</em>
            <span className="footer-arrow" aria-hidden="true">
              ↗
            </span>
          </div>
          <div className="footer-meta">
            <span>Talk To Future · A space to find your voice.</span>
            <span>Independent interview preparation.</span>
            <ThemeToggle />
          </div>
        </footer>
      </main>
    </MotionExperience>
  );
}
