import {
  researchRoadmaps,
  roadmapCompanyId,
} from "../shared/research-roadmaps";
import type { CSSProperties } from "react";
import type { Catalog } from "../lib/client/contracts";

export default function FutureRoadmaps({
  busy,
  catalog,
  onStart,
}: {
  busy: boolean;
  catalog: Catalog | null;
  onStart: (companyId: string) => void;
}) {
  return (
    <section
      id="future-roadmaps"
      className="future-section"
      aria-labelledby="future-heading"
    >
      <div className="company-browser-heading" data-reveal>
        <div>
          <h2 id="future-heading">Future interview roadmaps</h2>
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
        {researchRoadmaps.map((roadmap, index) => (
          <article
            className="roadmap-card"
            key={roadmap.id}
            data-reveal
            style={{ "--reveal-delay": `${index * 80}ms` } as CSSProperties}
          >
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
            <button
              className="choose-company roadmap-interview"
              disabled={
                busy ||
                !catalog?.availableInterviews.some(
                  (option) => option.companyId === roadmapCompanyId(roadmap.id),
                )
              }
              aria-label={`Start ${roadmap.title} interview`}
              onClick={() => onStart(roadmapCompanyId(roadmap.id))}
            >
              Start roadmap interview <span aria-hidden="true">↗</span>
            </button>
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
