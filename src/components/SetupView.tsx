"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, RequestError, tokenKey } from "../lib/client/api";
import type { Catalog, Setup, InterviewMode } from "../lib/client/contracts";
import {
  companyGroups,
  companyGuides,
  type CompanyGroup,
} from "../shared/company-guides";
import FutureRoadmaps from "./FutureRoadmaps";
import FutureHero from "./FutureHero";

const consentKey = "talk-to-future:audio-consent";
const pendingKey = "talk-to-future:pending-interview";

export default function SetupView() {
  const router = useRouter();
  const consentDialog = useRef<HTMLDialogElement>(null);
  const starting = useRef(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [pending, setPending] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<CompanyGroup | "all">("all");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .catalog()
      .then((c) => {
        if (live) setCatalog(c);
      })
      .catch(() => {
        if (live) setError("Could not load interviews. Please try again.");
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!catalog) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
      sessionStorage.removeItem(pendingKey);
      if (
        saved?.audioProcessingConsent === true &&
        catalog.availableInterviews.some(
          (option) =>
            option.companyId === saved.companyId &&
            option.roleId === saved.roleId &&
            option.round === saved.round,
        )
      ) {
        const next: Setup = {
          companyId: saved.companyId,
          roleId: saved.roleId,
          round: saved.round,
          audioProcessingConsent: true,
        };
        setPending(next);
        void begin(next);
      }
    } catch {}
    // Resume a deliberate selection once the catalog is ready after sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  useEffect(() => {
    const dialog = consentDialog.current;
    if (pending && !pending.audioProcessingConsent) {
      if (!dialog?.open) dialog?.showModal();
    } else if (dialog?.open) dialog.close();
  }, [pending]);

  function chooseInterview(
    companyId: string,
    roleId: string,
    round: InterviewMode,
  ) {
    if (!catalog || starting.current) return;
    const choice =
      catalog.availableInterviews.find(
        (option) =>
          option.companyId === companyId &&
          option.roleId === roleId &&
          option.round === round,
      ) ??
      catalog.availableInterviews.find(
        (option) => option.companyId === companyId && option.roleId === roleId,
      );
    if (!choice) return;
    setError("");
    let consent = false;
    try {
      consent = sessionStorage.getItem(consentKey) === "true";
    } catch {}
    const next: Setup = { ...choice, audioProcessingConsent: consent };
    setPending(next);
    if (consent) void begin(next);
  }

  async function begin(selection: Setup) {
    if (starting.current || !selection.audioProcessingConsent) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof RTCPeerConnection === "undefined"
    ) {
      setError(
        "Live interviews need a browser with microphone support. Open this page in a supported browser to continue.",
      );
      return;
    }
    starting.current = true;
    setBusy(true);
    setError("");
    try {
      // Kept only across an authentication redirect; all other outcomes clear it.
      sessionStorage.setItem(pendingKey, JSON.stringify(selection));
      const s = await api.create(selection);
      sessionStorage.removeItem(pendingKey);
      sessionStorage.setItem(tokenKey(s.sessionId), s.sessionToken);
      sessionStorage.setItem(`consent:${s.sessionId}`, "true");
      sessionStorage.setItem(`input:${s.sessionId}`, "voice");
      sessionStorage.setItem(`autostart:${s.sessionId}`, "true");
      router.push(`/interview/${s.sessionId}`);
    } catch (cause) {
      if (cause instanceof RequestError && cause.code === "UNAUTHORIZED")
        return;
      sessionStorage.removeItem(pendingKey);
      setError(
        "Could not start the interview. Please select it again to retry.",
      );
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="company-browser">
      <FutureHero />
      <div className="interview-browser-status" aria-live="polite">
        {!catalog && !error && <p role="status">Loading interviews…</p>}
        {busy && <p role="status">Preparing your interview…</p>}
        {error && (!pending || pending.audioProcessingConsent) && (
          <div className="error" role="alert">
            <p>{error}</p>
            {!catalog && (
              <button
                onClick={() => {
                  setError("");
                  setAttempt((value) => value + 1);
                }}
              >
                Retry interviews
              </button>
            )}
          </div>
        )}
      </div>

      <section
        id="company-history"
        className="history-section"
        aria-labelledby="history-heading"
      >
        <div className="company-browser-heading" data-reveal>
          <div>
            <h2 id="history-heading">Company interviews</h2>
          </div>
          <span className="section-label">
            Historical & published processes
          </span>
        </div>
        <p className="section-description">
          Select a company and role to start. Each interview includes
          behavioral, technical and system design questions, with adaptive
          follow-ups. Published process guides are below; ↔ means the count
          varies or is unpublished.
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
                    const selected = pending?.companyId === company.id;
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
                            Start an interview for this company below.
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
                        <div className="company-interview-actions">
                          {catalog ? (
                            catalog.roles
                              .filter((role) =>
                                catalog.availableInterviews.some(
                                  (option) =>
                                    option.companyId === company.id &&
                                    option.roleId === role.id,
                                ),
                              )
                              .map((role) => (
                                <button
                                  key={role.id}
                                  className="choose-company"
                                  disabled={busy}
                                  aria-label={`Start ${company.name} ${role.name} interview`}
                                  onClick={() =>
                                    chooseInterview(
                                      company.id,
                                      role.id,
                                      "mixed",
                                    )
                                  }
                                >
                                  {busy && selected
                                    ? "Starting interview…"
                                    : `${company.name} · ${role.name}`}
                                  <span aria-hidden="true">↗</span>
                                </button>
                              ))
                          ) : (
                            <button className="choose-company" disabled>
                              Loading interview…
                            </button>
                          )}
                        </div>
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

      <FutureRoadmaps
        busy={busy}
        catalog={catalog}
        onStart={(companyId) =>
          chooseInterview(companyId, "software-engineer", "system_design")
        }
      />
      <dialog
        ref={consentDialog}
        className="interview-consent"
        aria-labelledby="consent-heading"
        aria-describedby="consent-description"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setPending(null);
        }}
        onClose={() => {
          if (!busy) setPending(null);
        }}
      >
        <h2 id="consent-heading">Ready for your interview?</h2>
        <p className="consent-target">
          {
            catalog?.companies.find(
              (company) => company.id === pending?.companyId,
            )?.name
          }
          {" · "}
          {catalog?.roles.find((role) => role.id === pending?.roleId)?.name}
        </p>
        <p id="consent-description">
          This interview uses your microphone. Audio streams to OpenAI.
          Transcripts go to Claude and are saved with your session. Provider
          retention may differ.
        </p>
        <p className="fine">
          Sign in with Google if prompted. Your interview will continue
          automatically.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="consent-actions">
          <button disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              if (!pending) return;
              try {
                sessionStorage.setItem(consentKey, "true");
              } catch {}
              void begin({ ...pending, audioProcessingConsent: true });
            }}
          >
            {busy ? "Starting interview…" : "Agree and start interview"}
          </button>
        </div>
      </dialog>
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
