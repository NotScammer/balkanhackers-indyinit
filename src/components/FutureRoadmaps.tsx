import { researchRoadmaps } from "../shared/research-roadmaps";

export default function FutureRoadmaps() {
  return (
    <section
      id="future-roadmaps"
      className="future-section"
      aria-labelledby="future-heading"
    >
      <div className="company-browser-heading">
        <div>
          <p className="eyebrow">02 / BEYOND THE USUAL QUESTIONS</p>
          <h2 id="future-heading">Prepare for what they could ask next.</h2>
        </div>
        <span className="research-label">
          <span aria-hidden="true">✧</span> Research outlook
        </span>
      </div>
      <p className="section-description">
        Emerging technology, translated into a practical learning path. These
        are editorial hypotheses grounded in foundational research, not
        historical interview reports or validated predictions.
      </p>
      <div className="roadmap-grid">
        {researchRoadmaps.map((roadmap) => (
          <article className="roadmap-card" key={roadmap.id}>
            <div className="roadmap-topline">
              <span>{roadmap.number} / RESEARCH ROADMAP</span>
              <span aria-hidden="true">↗</span>
            </div>
            <p className="roadmap-category">{roadmap.category}</p>
            <h3>{roadmap.title}</h3>
            <div className="skill-tags">
              {roadmap.skills.map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
            <p className="roadmap-rationale">{roadmap.rationale}</p>
            <details className="roadmap-details">
              <summary>
                Explore the roadmap <span aria-hidden="true">+</span>
              </summary>
              <ol>
                {roadmap.steps.map((step) => (
                  <li key={step.title}>
                    <strong>{step.title}</strong>
                    <p>{step.detail}</p>
                  </li>
                ))}
              </ol>
              <div className="future-question">
                <span className="eyebrow">
                  POSSIBLE FUTURE QUESTION · ORIGINAL EXAMPLE
                </span>
                <p>“{roadmap.question}”</p>
              </div>
            </details>
            <div className="roadmap-source">
              <span>Research foundation · {roadmap.source.date}</span>
              <a href={roadmap.source.url} target="_blank" rel="noreferrer">
                {roadmap.source.title} <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>
        ))}
      </div>
      <p className="history-caption">
        Research informs the preparation topics. It does not establish that any
        company will ask these questions. Paper dates refer to the original
        research, not a newly measured hiring trend.
      </p>
    </section>
  );
}
