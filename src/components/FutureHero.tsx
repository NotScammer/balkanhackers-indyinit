export default function FutureHero() {
  return (
    <section className="practice-intro" aria-labelledby="hero-heading">
      <div>
        <h1 id="hero-heading">Practice your next interview.</h1>
        <p>
          Choose a company and role, or a future roadmap, to start your
          interview.
        </p>
      </div>
      <nav aria-label="Explore interview preparation">
        <a href="#company-history">Company guides</a>
        <a href="#future-roadmaps">Research roadmaps</a>
      </nav>
    </section>
  );
}
