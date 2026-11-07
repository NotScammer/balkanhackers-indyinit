"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, tokenKey } from "../lib/client/api";
import type { Catalog, Setup } from "../lib/client/contracts";
import { modes } from "../lib/client/interview-model";
export default function SetupView() {
  const router = useRouter();
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
  const available = catalog.availableInterviews.filter(
    (a) => a.companyId === setup.companyId && a.roleId === setup.roleId,
  );
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
    <div className="setup-layout">
      <section className="setup-intro">
        <span className="tag">
          <span className="status-dot" /> A conversation, not a questionnaire
        </span>
        <h1>
          A little practice.
          <br />
          <em>A lot more confidence.</em>
        </h1>
        <p className="intro-description">
          Meet your AI interviewer. Think out loud, ask questions, and find your
          rhythm before the real thing.
        </p>
        <div className="intro-voice" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="feature-list">
          <p>
            <b>01</b> Speak naturally. Interrupt anytime.
          </p>
          <p>
            <b>02</b> Go deeper with thoughtful follow-ups.
          </p>
          <p>
            <b>03</b> Leave with feedback you can use.
          </p>
        </div>
        <p className="intro-footnote">
          Your space to get better. One conversation at a time.
        </p>
      </section>
      <section className="setup-card" aria-label="Set up your interview">
        <p className="eyebrow">YOUR NEXT REHEARSAL</p>
        <h2>Make it your interview.</h2>
        <p className="fine">
          Pick a direction. We’ll take the conversation from there.
        </p>
        <div className="selects">
          <label>
            Company
            <select
              disabled={busy}
              value={setup.companyId}
              onChange={(e) => {
                const a = catalog.availableInterviews.find(
                  (a) => a.companyId === e.target.value,
                )!;
                change({
                  companyId: a.companyId,
                  roleId: a.roleId,
                  round: a.round,
                });
              }}
            >
              {catalog.companies
                .filter((c) =>
                  catalog.availableInterviews.some((a) => a.companyId === c.id),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Role
            <select
              disabled={busy}
              value={setup.roleId}
              onChange={(e) => {
                const a = catalog.availableInterviews.find(
                  (a) =>
                    a.companyId === setup.companyId &&
                    a.roleId === e.target.value,
                )!;
                change({ roleId: a.roleId, round: a.round });
              }}
            >
              {catalog.roles
                .filter((r) =>
                  catalog.availableInterviews.some(
                    (a) => a.companyId === setup.companyId && a.roleId === r.id,
                  ),
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <fieldset disabled={busy}>
          <legend>What would you like to work on?</legend>
          <div className="modegrid">
            {Object.entries(modes).map(([key, v]) => (
              <label
                key={key}
                className={`modecard ${setup.round === key ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="round"
                  checked={setup.round === key}
                  disabled={!available.some((a) => a.round === key)}
                  onChange={() => change({ round: key as Setup["round"] })}
                />
                <strong>{v.title}</strong>
                <span>{v.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="fine">
          Three main questions, with up to two deeper follow-ups each. No coding
          required.
        </p>
        <div className="privacy">
          <label className="check">
            <input
              disabled={busy}
              type="checkbox"
              checked={setup.audioProcessingConsent}
              onChange={(e) =>
                change({ audioProcessingConsent: e.target.checked })
              }
            />
            <span>
              I agree to live audio processing.
              <small>
                Your microphone opens when you connect. Audio streams to OpenAI;
                transcripts go to Claude for feedback and are saved with your
                session. Provider retention may differ.
              </small>
            </span>
          </label>
        </div>
        {!supported && (
          <p role="alert" className="error">
            Live audio needs microphone access and a supported browser.
          </p>
        )}
        <button
          className="primary start-button"
          disabled={busy || !setup.audioProcessingConsent || !supported}
          onClick={() => void begin()}
        >
          {busy ? "Preparing your interview…" : "Let’s talk"}
          <span aria-hidden="true">↗</span>
        </button>
        <p className="fine setup-promise">
          Three main questions · Adaptive follow-ups · Feedback as you go
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p className="fine">
          Practicing as a guest. <Link href="/login">Preview an account</Link>{" "}
          if you’d like to see what’s coming.
        </p>
      </section>
    </div>
  );
}
