"use client";

import type { PointerEvent } from "react";
import { companyGuides } from "../shared/company-guides";

export default function FutureHero() {
  function move(event: PointerEvent<HTMLDivElement>) {
    if (
      event.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      event.currentTarget.closest("[data-motion='paused']")
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--hero-x",
      `${((event.clientX - rect.left) / rect.width - 0.5) * 10}deg`,
    );
    event.currentTarget.style.setProperty(
      "--hero-y",
      `${((event.clientY - rect.top) / rect.height - 0.5) * -8}deg`,
    );
  }

  return (
    <>
      <section className="future-hero" aria-labelledby="hero-heading">
        <div className="hero-copy">
          <p className="hero-kicker">
            <span className="status-dot" /> A little practice. A world of
            possibility.
          </p>
          <h1 id="hero-heading">
            <span className="hero-line">
              <span>Your future,</span>
            </span>
            <span className="hero-line">
              <span>
                in <em>your</em>
              </span>
            </span>
            <span className="hero-line">
              <span>
                <em>own words.</em>
              </span>
            </span>
          </h1>
          <p className="hero-description">
            Get to know the interview.
            <br />
            Get comfortable being you.
          </p>
          <nav
            className="hero-actions"
            aria-label="Explore interview preparation"
          >
            <a className="editorial-cta" href="#company-history">
              Find your starting point <span aria-hidden="true">↗</span>
            </a>
            <a className="hero-secondary" href="#future-roadmaps">
              Explore the future <span aria-hidden="true">→</span>
            </a>
          </nav>
          <div className="hero-footnote">
            <span className="tiny-wave" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>Real conversations. More confident beginnings.</span>
          </div>
        </div>

        <div
          className="hero-stage"
          aria-hidden="true"
          onPointerMove={move}
          onPointerLeave={(event) => {
            event.currentTarget.style.setProperty("--hero-x", "0deg");
            event.currentTarget.style.setProperty("--hero-y", "0deg");
          }}
        >
          <div className="hero-art">
            <div className="hero-grid-paper" />
            <svg className="hero-scribble" viewBox="0 0 540 520" fill="none">
              <path
                className="scribble-path"
                d="M64 118c-25-57 16-90 57-67 29 17 8 58-17 47-24-11 16-64 54-50m266 300c67-23 113 3 92 33-19 28-64-3-38-19 32-20 42 25 1 51"
              />
              <path d="m438 72 5 17 16-10-10 15 18 7-20 1 2 20-10-17-14 13 7-19-18-6 21-3Zm-393 336 13 10-13 10m-20-10h31" />
            </svg>
            <div className="hero-note hero-note-top">
              <span className="note-icon">↗</span>
              <span>
                That next chapter?
                <br />
                <strong>It sounds like you.</strong>
              </span>
            </div>
            <div className="conversation-paper">
              <div className="paper-topline">
                <span className="paper-brand">t.</span>
                <span>A SPACE TO FIND YOUR VOICE</span>
                <span>↗</span>
              </div>
              <div className="paper-rule" />
              <p className="paper-eyebrow">YOUR NEXT OPPORTUNITY</p>
              <p className="paper-title">
                Good things
                <br />
                start with
                <br />
                <em>a conversation.</em>
              </p>
              <div className="paper-wave">
                {Array.from({ length: 19 }, (_, i) => (
                  <i key={i} style={{ "--bar": i } as React.CSSProperties} />
                ))}
              </div>
              <div className="paper-bottomline">
                <span>YOU + A LITTLE PRACTICE</span>
                <span>ENDLESS POSSIBILITIES</span>
              </div>
            </div>
            <div className="hero-note hero-note-bottom">
              <span className="note-check">✓</span>
              <span>
                Not a perfect answer.
                <br />
                <strong>Your best one.</strong>
              </span>
            </div>
            <div className="hero-round-stamp">
              <span>BE READY FOR</span>
              <strong>
                what’s
                <br />
                <em>next.</em>
              </strong>
              <span className="stamp-arrow">↗</span>
            </div>
          </div>
        </div>
        <a className="hero-scroll" href="#company-history">
          <span>LET’S LOOK AHEAD</span>
          <span aria-hidden="true">↓</span>
        </a>
      </section>
      <div className="company-ribbon" data-reveal>
        <p>
          Your ambition
          <br />
          <strong>has options.</strong>
        </p>
        <div
          className="ribbon-window"
          role="img"
          aria-label={`Explore interviews at ${companyGuides.map((company) => company.name).join(", ")}`}
        >
          <div className="ribbon-track" aria-hidden="true">
            {[0, 1].map((copy) => (
              <div className="ribbon-set" key={copy}>
                {companyGuides.map((company) => (
                  <span key={company.id}>
                    {company.name}
                    <i>✳</i>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
