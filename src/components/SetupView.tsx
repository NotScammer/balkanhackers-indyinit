"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, tokenKey, isMock } from "../lib/client/api";
import type { Catalog, Setup } from "../lib/client/contracts";
import { modes } from "../lib/client/interview-model";
import { canRecord, useRecorder } from "../hooks/useRecorder";
export default function SetupView() {
  const router = useRouter(),
    mic = useRecorder();
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [setup, setSetup] = useState<Setup | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [welcome, setWelcome] = useState(false),
    [supported, setSupported] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .catalog()
      .then((c) => {
        if (!live) return;
        setCatalog(c);
        setSupported(isMock ? canRecord() : !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== 'undefined');
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
    setWelcome(false);
  };
  async function begin() {
    if (busy) return;
    if (!setup?.audioProcessingConsent || !supported) {
      setError(
        "Allow audio processing and use a browser with microphone recording to start.",
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
    <>
      <p className="eyebrow">Voice interview</p>
      <h1>Before we begin</h1>
      <p>
        Choose your interview. You’ll hear each question and answer out loud.
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
        Three main questions, with up to two deeper follow-ups each. No coding required.
      </p>
      <div className="privacy">
        <p>
          When you connect live audio, your microphone streams to OpenAI while unmuted. Transcripts go to Claude for questions, clarification and feedback, and are saved with your session. Audio is not stored by this application; provider retention may differ.
        </p>
        <label className="check">
          <input
            disabled={busy}
            type="checkbox"
            checked={setup.audioProcessingConsent}
            onChange={(e) =>
              change({ audioProcessingConsent: e.target.checked })
            }
          />
          I consent to audio processing for transcription.
        </label>
        <p>
          Your microphone opens when you connect live audio, then stays open until you mute, disconnect or end the interview.
        </p>
      </div>
      {!supported && (
        <p role="alert" className="error">
          Microphone recording is unavailable in this browser. Open this
          interview in a supported browser to continue.
        </p>
      )}
      {!welcome ? (
        <button
          className="primary"
          disabled={busy}
          onClick={() => setWelcome(true)}
        >
          Continue
        </button>
      ) : (
        <div className="welcome">
          <h2>Let’s take it one question at a time.</h2>
          <p>
            {isMock ? "This is the recorded-answer fixture preview." : "Speak naturally and interrupt whenever you need clarification. Answers advance automatically; you can correct recognition mistakes in the transcript. Feedback is spoken and shown after each answer, with scores at the end."}
          </p>
          <p>
            {setup.audioProcessingConsent
              ? "You’ll answer out loud. Clarify, pause or correct your transcript whenever you need to."
              : "Allow audio processing above to start a voice interview."}
          </p>
          {setup.audioProcessingConsent && (
            <>
              <button
                disabled={busy || mic.stage === "opening microphone"}
                onClick={() =>
                  mic.stage === "recording"
                    ? mic.stop(true)
                    : void mic.start(5, true)
                }
              >
                {mic.stage === "recording"
                  ? "Stop microphone check"
                  : "Check my microphone (5 seconds)"}
              </button>
              {mic.stage === "opening microphone" && (
                <>
                  <p role="status">
                    Waiting for microphone permission. You can cancel and retry
                    when you’re ready.
                  </p>
                  <button onClick={() => mic.stop(true)}>
                    Cancel microphone request
                  </button>
                </>
              )}
              {mic.stage === "recording" && (
                <label>
                  Microphone level
                  <meter min={0} max={1} value={mic.level} />
                </label>
              )}
              <p role="status">{mic.error}</p>
            </>
          )}
          <button
            className="primary"
            disabled={
              busy ||
              !setup.audioProcessingConsent ||
              !supported ||
              mic.stage === "recording" ||
              mic.stage === "opening microphone"
            }
            onClick={() => void begin()}
          >
            {busy ? "Starting…" : "Ready to begin"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="fine">
        Practicing as a guest. <Link href="/login">Preview an account</Link> if
        you’d like to see what’s coming.
      </p>
    </>
  );
}
