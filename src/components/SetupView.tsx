"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, tokenKey } from "../lib/client/api";
import type { Catalog, Setup, InterviewMode } from "../lib/client/contracts";
import { modes } from "../lib/client/interview-model";
export default function SetupView() {
  const router = useRouter();
  const companiesRail = useRef<HTMLDivElement>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [setup, setSetup] = useState<Setup | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [supported, setSupported] = useState(false);
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
            sessionStorage.getItem("rehearsal:setup") ?? "null",
          );
          if (
            saved &&
            c.availableInterviews.some(
              (a) =>
                a.companyId === saved.companyId &&
                a.roleId === saved.roleId &&
                a.round === saved.round,
            )
          )
            selected = {
              ...saved,
              audioProcessingConsent: saved.audioProcessingConsent === true,
            };
        } catch {}
        setSetup(selected);
      })
      .catch(() => {
        if (live)
          setError("Could not load practice options. Refresh to try again.");
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (setup) sessionStorage.setItem("rehearsal:setup", JSON.stringify(setup));
  }, [setup]);

  if (!setup || !catalog)
    return <p role={error ? "alert" : "status"}>{error || "Connecting…"}</p>;
  const companies = catalog.companies.filter((company) =>
    catalog.availableInterviews.some(
      (option) => option.companyId === company.id,
    ),
  );
  const selectedCompany = companies.find(
    (company) => company.id === setup.companyId,
  );
  const selectedRole = catalog.roles.find((role) => role.id === setup.roleId);
  const interviewOrder: InterviewMode[] = [
    "technical",
    "behavioral",
    "system_design",
    "mixed",
  ];
  const descriptions: Record<InterviewMode, string> = {
    technical: "Concepts, reasoning & problem solving",
    behavioral: "Your experience, decisions & impact",
    system_design: "Architecture, scale & trade-offs",
    mixed: "A little of every interview type",
  };
  const change = (patch: Partial<Setup>) => {
    setSetup({ ...setup, ...patch });
  };
  async function begin() {
    if (busy) return;
    if (!setup?.audioProcessingConsent || !supported) {
      setError(
        "Allow live audio and use a browser with microphone access to start.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const s = await api.create(setup!);
      sessionStorage.setItem(tokenKey(s.sessionId), s.sessionToken);
      sessionStorage.setItem(
        `consent:${s.sessionId}`,
        String(setup!.audioProcessingConsent),
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
      <section className="company-browser-intro">
        <span className="tag">
          <span className="status-dot" /> Live conversations. Real confidence.
        </span>
        <h1>
          Your next opportunity.
          <br />
          <em>Your kind of practice.</em>
        </h1>
        <p>Choose a company, pick an interview, and start talking.</p>
      </section>
      <div className="company-browser-heading">
        <div>
          <p className="eyebrow">FIND YOUR NEXT REHEARSAL</p>
          <h2>Where do you want to go?</h2>
        </div>
        <div className="rail-navigation">
          <span>Explore companies</span>
          <button
            aria-label="Scroll companies left"
            onClick={() =>
              companiesRail.current?.scrollBy({
                left: -330,
                behavior: "smooth",
              })
            }
          >
            ←
          </button>
          <button
            aria-label="Scroll companies right"
            onClick={() =>
              companiesRail.current?.scrollBy({ left: 330, behavior: "smooth" })
            }
          >
            →
          </button>
        </div>
      </div>
      <fieldset className="company-picker" disabled={busy}>
        <legend className="visually-hidden">
          Choose a company and interview type
        </legend>
        <div
          className="company-rail"
          ref={companiesRail}
          tabIndex={0}
          role="region"
          aria-label="Company interview options. Scroll horizontally to explore."
        >
          {companies.map((company, index) => {
            const choices = catalog.availableInterviews.filter(
              (option) => option.companyId === company.id,
            );
            const roleIds = [
              ...new Set(choices.map((option) => option.roleId)),
            ];
            const roleId = roleIds.includes(setup.roleId)
              ? setup.roleId
              : roleIds[0];
            const role = catalog.roles.find(
              (candidate) => candidate.id === roleId,
            );
            return (
              <section
                className={`company-group company-color-${index % 6} ${setup.companyId === company.id ? "has-selection" : ""}`}
                aria-labelledby={`company-${company.id}`}
                key={company.id}
              >
                <div className="company-group-header">
                  <span className="company-monogram" aria-hidden="true">
                    {company.name === "ZipRecruiter"
                      ? "Z"
                      : company.name.slice(0, 1)}
                  </span>
                  <span className="company-count">
                    {
                      choices.filter((option) => option.roleId === roleId)
                        .length
                    }{" "}
                    interviews
                  </span>
                </div>
                <h3 id={`company-${company.id}`}>{company.name}</h3>
                <p className="company-role">{role?.name}</p>
                {roleIds.length > 1 && (
                  <label className="company-role-select">
                    Role
                    <select
                      value={roleId}
                      onChange={(event) => {
                        const choice = choices.find(
                          (option) => option.roleId === event.target.value,
                        )!;
                        change({
                          companyId: company.id,
                          roleId: choice.roleId,
                          round: choice.round,
                        });
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
                <div className="company-interviews">
                  {interviewOrder
                    .filter((round) =>
                      choices.some(
                        (option) =>
                          option.roleId === roleId && option.round === round,
                      ),
                    )
                    .map((round) => {
                      const selected =
                        setup.companyId === company.id &&
                        setup.roleId === roleId &&
                        setup.round === round;
                      return (
                        <label
                          key={round}
                          className={`company-interview ${selected ? "selected" : ""}`}
                        >
                          <input
                            type="radio"
                            name="company-interview"
                            value={`${company.id}:${roleId}:${round}`}
                            checked={selected}
                            aria-label={`${company.name} ${modes[round].title}`}
                            onChange={() =>
                              change({ companyId: company.id, roleId, round })
                            }
                          />
                          <span className="interview-copy">
                            <strong>{modes[round].title}</strong>
                            <small>{descriptions[round]}</small>
                          </span>
                          <span
                            className="interview-indicator"
                            aria-hidden="true"
                          >
                            {selected ? "✓" : "↗"}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </section>
            );
          })}
        </div>
      </fieldset>
      <section
        className="selection-checkout"
        aria-label="Your selected interview"
      >
        <div className="selection-summary" aria-live="polite">
          <p className="eyebrow">YOUR REHEARSAL</p>
          <h2>
            {selectedCompany?.name} <span> / </span>
            {modes[setup.round].title}
          </h2>
          <p>{selectedRole?.name} · 3 main questions · Adaptive follow-ups</p>
        </div>
        <div className="selection-start">
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
                Audio streams to OpenAI. Transcripts go to Claude and are saved
                with your session. Provider retention may differ.
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
        </div>
      </section>
      {!supported && (
        <p role="alert" className="error">
          Live audio needs microphone access and a supported browser.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="company-browser-footnote">
        <span>
          Practice inspired by company context. No company endorsement or actual
          interview questions.
        </span>
        <Link href="/login">Guest · Preview an account</Link>
      </div>
    </div>
  );
}
