"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, tokenKey } from "../lib/client/api";
import type { Catalog, Setup, InterviewMode } from "../lib/client/contracts";
import { modes } from "../lib/client/interview-model";
import {
  companyGroups,
  companyGuides,
  type CompanyGroup,
} from "../shared/company-guides";
import FutureRoadmaps from "./FutureRoadmaps";
import FutureHero from "./FutureHero";

const interviewOrder: InterviewMode[] = [
  "behavioral",
  "technical",
  "system_design",
  "mixed",
];
const descriptions: Record<InterviewMode, string> = {
  behavioral: "Experience, decisions & impact",
  technical: "Explain concepts & problem solving",
  system_design: "Architecture, scale & trade-offs",
  mixed: "A little of every interview type",
};

export default function SetupView() {
  const router = useRouter();
  const checkout = useRef<HTMLElement>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(false);
  const [filter, setFilter] = useState<CompanyGroup | "all">("all");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .catalog()
      .then((c) => {
        if (!live) return;
        setCatalog(c);
        setSupported(
          !!navigator.mediaDevices?.getUserMedia &&
            typeof RTCPeerConnection !== "undefined",
        );
        const first = c.availableInterviews[0];
        if (!first) {
          setError("No practice is available yet. Please try again later.");
          return;
        }
        let selected: Setup = { ...first, audioProcessingConsent: false };
        try {
          const saved = JSON.parse(
            sessionStorage.getItem("talk-to-future:setup") ?? "null",
          );
          if (
            saved &&
            c.availableInterviews.some(
              (a) =>
                a.companyId === saved.companyId &&
                a.roleId === saved.roleId &&
                a.round === saved.round,
            )
          ) {
            selected = {
              companyId: saved.companyId,
              roleId: saved.roleId,
              round: saved.round,
              audioProcessingConsent: saved.audioProcessingConsent === true,
            };
          }
        } catch {}
        setSetup(selected);
      })
      .catch(() => {
        if (live)
          setError(
            "Could not load practice options. You can still explore the guides and roadmaps.",
          );
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (setup) {
      try {
        sessionStorage.setItem("talk-to-future:setup", JSON.stringify(setup));
      } catch {}
    }
  }, [setup]);

  const selectedCompany = catalog?.companies.find(
    (company) => company.id === setup?.companyId,
  );
  const selectedRole = catalog?.roles.find((role) => role.id === setup?.roleId);
  const selectedOptions =
    catalog?.availableInterviews.filter(
      (option) => option.companyId === setup?.companyId,
    ) ?? [];
  const roleIds = [...new Set(selectedOptions.map((option) => option.roleId))];
  const change = (patch: Partial<Setup>) => {
    if (setup) setSetup({ ...setup, ...patch });
  };
  function chooseCompany(companyId: string) {
    if (!catalog || !setup || busy) return;
    const choices = catalog.availableInterviews.filter(
      (option) => option.companyId === companyId,
    );
    const choice =
      choices.find(
        (option) =>
          option.roleId === setup.roleId && option.round === setup.round,
      ) ??
      choices.find((option) => option.roleId === setup.roleId) ??
      choices[0];
    if (!choice) return;
    change(choice);
    checkout.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
    checkout.current?.focus({ preventScroll: true });
  }
  async function begin() {
    if (busy || !setup) return;
    if (!setup.audioProcessingConsent || !supported) {
      setError(
        "Allow live audio and use a browser with microphone access to start.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const s = await api.create(setup);
      sessionStorage.setItem(tokenKey(s.sessionId), s.sessionToken);
      sessionStorage.setItem(
        `consent:${s.sessionId}`,
        String(setup.audioProcessingConsent),
      );
      sessionStorage.setItem(`input:${s.sessionId}`, "voice");
      router.push(`/interview/${s.sessionId}`);
    } catch {
      setError(
        "Could not start the interview. Your choices are saved; please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="company-browser">
      <FutureHero />

      <section
        id="company-history"
        className="history-section"
        aria-labelledby="history-heading"
      >
        <div className="company-browser-heading" data-reveal>
          <div>
            <p className="eyebrow">01 / THE INTERVIEW PLAYBOOK</p>
            <h2 id="history-heading">
              Find your kind
              <br />
              of <em>company.</em>
            </h2>
          </div>
          <span className="section-label">
            Historical & published processes
          </span>
        </div>
        <p className="section-description">
          Round breakdowns and assessment formats, grouped by company. Counts
          appear where documented; ↔ means the count varies or is unpublished.
        </p>
        <div
          className="company-filters"
          role="group"
          aria-label="Filter companies"
        >
          {[{ id: "all", title: "All companies" }, ...companyGroups].map(
            (group) => (
              <button
                key={group.id}
                aria-pressed={filter === group.id}
                onClick={() => setFilter(group.id as CompanyGroup | "all")}
              >
                {group.title}
                <span>
                  {group.id === "all"
                    ? companyGuides.length
                    : companyGuides.filter(
                        (company) => company.group === group.id,
                      ).length}
                </span>
              </button>
            ),
          )}
        </div>

        {companyGroups
          .filter((group) => filter === "all" || filter === group.id)
          .map((group) => (
            <section
              className="company-category"
              key={`${filter}-${group.id}`}
              aria-labelledby={`group-${group.id}`}
            >
              <div className="category-heading">
                <h3 id={`group-${group.id}`}>{group.title}</h3>
                <p>{group.description}</p>
              </div>
              <div className="company-grid">
                {companyGuides
                  .filter((company) => company.group === group.id)
                  .map((company) => {
                    const index = companyGuides.findIndex(
                      (guide) => guide.id === company.id,
                    );
                    const selected = setup?.companyId === company.id;
                    const available = catalog?.availableInterviews.some(
                      (option) => option.companyId === company.id,
                    );
                    return (
                      <article
                        className={`company-group company-color-${index % 6} ${selected ? "has-selection" : ""}`}
                        data-reveal
                        style={
                          {
                            "--reveal-delay": `${(index % 3) * 65}ms`,
                          } as CSSProperties
                        }
                        key={company.id}
                        aria-labelledby={`company-${company.id}`}
                      >
                        <div className="company-group-header">
                          <span className="company-monogram" aria-hidden="true">
                            {company.name.slice(0, 1)}
                          </span>
                          <span
                            className={`history-badge ${company.source ? "" : "pending"}`}
                          >
                            {company.source
                              ? "Published process"
                              : "History pending"}
                          </span>
                        </div>
                        <h4 id={`company-${company.id}`}>{company.name}</h4>
                        <p className="company-role">{company.sector}</p>
                        <p className="process-scope">{company.scope}</p>
                        <p className="process-summary">{company.summary}</p>
                        {company.rounds.length ? (
                          <ul className="process-rounds">
                            {company.rounds.map((round) => (
                              <li key={round.label}>
                                <span
                                  className={`round-count round-${round.mode}`}
                                  aria-label={
                                    round.count === null
                                      ? "Round count varies or unpublished"
                                      : `${round.count} ${round.count === 1 ? "round" : "rounds"}`
                                  }
                                >
                                  {round.count ?? "↔"}
                                </span>
                                <span>
                                  <strong>{round.label}</strong>
                                  <small>{round.detail}</small>
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="history-empty">
                            A historical breakdown is on our research list.
                            Company-context practice is available below.
                          </p>
                        )}
                        <details className="process-details">
                          <summary>
                            Process context <span aria-hidden="true">+</span>
                          </summary>
                          <p>{company.note}</p>
                        </details>
                        <div className="process-source">
                          {company.source ? (
                            <>
                              <a
                                href={company.source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {company.source.label}{" "}
                                <span aria-hidden="true">↗</span>
                              </a>
                              <span>
                                {company.source.published
                                  ? `${company.source.published} · `
                                  : ""}
                                Checked Nov 7, 2026
                              </span>
                            </>
                          ) : (
                            <span>No sourced round counts yet.</span>
                          )}
                        </div>
                        <button
                          className="choose-company"
                          disabled={busy || !available}
                          aria-pressed={selected}
                          onClick={() => chooseCompany(company.id)}
                        >
                          {selected
                            ? "Practice selected company"
                            : `Practice with ${company.name}`}
                          <span aria-hidden="true">{selected ? "✓" : "↗"}</span>
                        </button>
                      </article>
                    );
                  })}
              </div>
            </section>
          ))}
        <p className="history-caption">
          Snapshots describe the source’s role and scope, including assessments.
          Processes can change by team, seniority and location.
        </p>
      </section>

      <section
        id="practice-setup"
        className="selection-checkout"
        data-reveal
        ref={checkout}
        tabIndex={-1}
        aria-labelledby="practice-heading"
      >
        <div className="selection-summary" key={setup?.companyId}>
          <p className="eyebrow">YOUR AMBITION. YOUR VOICE.</p>
          <h2 id="practice-heading">
            {selectedCompany?.name ?? "Your next Talk To Future interview"}
          </h2>
          <p>
            {selectedRole?.name ?? "Choose a company to begin"} · 3 main
            questions · Adaptive follow-ups
          </p>
          <p className="practice-explanation">
            Practice is a generated voice conversation. Technical rounds focus
            on spoken reasoning; historical coding assessments are shown for
            context.
          </p>
          <div className="practice-doodle" aria-hidden="true">
            <svg viewBox="0 0 240 90" fill="none">
              <path d="M7 68c51-66 79-35 88-13 12 30-35 15-17-8 35-44 87-28 134-5m-17-21 20 21-24 13" />
            </svg>
            <span>You’ve got this.</span>
          </div>
        </div>
        <div className="selection-start">
          {setup && catalog ? (
            <>
              {roleIds.length > 1 && (
                <label>
                  Role
                  <select
                    disabled={busy}
                    value={setup.roleId}
                    onChange={(event) => {
                      const option =
                        selectedOptions.find(
                          (option) =>
                            option.roleId === event.target.value &&
                            option.round === setup.round,
                        ) ??
                        selectedOptions.find(
                          (option) => option.roleId === event.target.value,
                        );
                      if (option) change(option);
                    }}
                  >
                    {roleIds.map((id) => (
                      <option key={id} value={id}>
                        {catalog.roles.find((role) => role.id === id)?.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <fieldset className="practice-modes" disabled={busy}>
                <legend>Choose your practice round</legend>
                {interviewOrder
                  .filter((round) =>
                    selectedOptions.some(
                      (option) =>
                        option.roleId === setup.roleId &&
                        option.round === round,
                    ),
                  )
                  .map((round) => (
                    <label
                      key={round}
                      className={`company-interview ${setup.round === round ? "selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="practice-round"
                        value={round}
                        checked={setup.round === round}
                        onChange={() => change({ round })}
                      />
                      <span className="interview-copy">
                        <strong>{modes[round].title}</strong>
                        <small>{descriptions[round]}</small>
                      </span>
                      <span className="interview-indicator" aria-hidden="true">
                        {setup.round === round ? "✓" : "○"}
                      </span>
                    </label>
                  ))}
              </fieldset>
              <label className="check">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={setup.audioProcessingConsent}
                  onChange={(event) =>
                    change({ audioProcessingConsent: event.target.checked })
                  }
                />
                <span>
                  I agree to live audio processing.
                  <small>
                    Audio streams to OpenAI. Transcripts go to Claude and are
                    saved with your session. Provider retention may differ.
                  </small>
                </span>
              </label>
              <button
                className="primary start-button"
                disabled={busy || !setup.audioProcessingConsent || !supported}
                onClick={() => void begin()}
              >
                {busy ? "Preparing your interview…" : "Start this interview"}
                <span aria-hidden="true">↗</span>
              </button>
              {!supported && (
                <p className="fine" role="status">
                  Live audio needs microphone access and a supported browser.
                </p>
              )}
            </>
          ) : (
            !error && <p role="status">Loading practice options…</p>
          )}
          {error && (
            <div className="error" role="alert">
              <p>{error}</p>
              {!setup && (
                <button
                  onClick={() => {
                    setError("");
                    setAttempt((value) => value + 1);
                  }}
                >
                  Retry practice options
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <FutureRoadmaps />
      <div className="company-browser-footnote">
        <span>
          Independent preparation. No company endorsement. Practice questions
          are generated, not actual company questions.
        </span>
        <Link href="/login">Your account</Link>
      </div>
    </div>
  );
}
