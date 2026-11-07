"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, tokenKey } from "../lib/client/api";
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
    [preference, setPreference] = useState("voice"),
    [supported, setSupported] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .catalog()
      .then((c) => {
        if (!live) return;
        setCatalog(c);
        setSupported(canRecord());
        setPreference(
          sessionStorage.getItem("rehearsal:preferred-input") ?? "voice",
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
  useEffect(() => {
    if (setup) sessionStorage.setItem("rehearsal:preferred-input", preference);
  }, [setup, preference]);
  if (!setup || !catalog)
    return (
      <p role={error ? "alert" : "status"}>
        {error || "Opening your notebook…"}
      </p>
    );
  const available = catalog.availableInterviews.filter(
    (a) => a.companyId === setup.companyId && a.roleId === setup.roleId,
  );
  const change = (patch: Partial<Setup>) => {
    setSetup({ ...setup, ...patch });
    setWelcome(false);
  };
  async function begin() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const s = await api.create(setup!);
      sessionStorage.setItem(tokenKey(s.sessionId), s.sessionToken);
      sessionStorage.setItem(
        `consent:${s.sessionId}`,
        String(setup!.audioProcessingConsent),
      );
      sessionStorage.setItem(
        `input:${s.sessionId}`,
        setup!.audioProcessingConsent && canRecord() && preference === "voice"
          ? "voice"
          : "text",
      );
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
      <p className="eyebrow">Your practice notebook</p>
      <h1>Choose your practice</h1>
      <p>
        Three questions. A little time to think. A few useful notes for next
        time.
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
        Up to {modes[setup.round].limit} per answer. No coding required.
      </p>
      <div className="privacy">
        <p>
          In live practice, confirmed answers go to AI providers for feedback.
          With your consent, recordings are uploaded for transcription. The
          backend is responsible for discarding uploaded audio and enforcing
          session retention; provider retention may differ. You can delete your
          session.
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
          You can always type instead. Your microphone opens only when you
          choose to use it.
        </p>
      </div>
      <fieldset disabled={busy}>
        <legend>How would you like to answer?</legend>
        <label className="check">
          <input
            type="radio"
            name="input-preference"
            checked={
              !setup.audioProcessingConsent ||
              !supported ||
              preference === "text"
            }
            onChange={() => setPreference("text")}
          />
          Type my answers
        </label>
        <label className="check">
          <input
            type="radio"
            name="input-preference"
            disabled={!setup.audioProcessingConsent || !supported}
            checked={
              setup.audioProcessingConsent &&
              supported &&
              preference === "voice"
            }
            onChange={() => setPreference("voice")}
          />
          Speak, then review the transcript
        </label>
        {!supported && (
          <p className="fine">
            Recording is unavailable in this browser. Typing is ready to use.
          </p>
        )}
      </fieldset>
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
            I’ll show you a question, then give you room to answer. You’ll
            review your words before anything is evaluated. Feedback stays on
            screen until you’re ready to move on.
          </p>
          <p>
            {setup.audioProcessingConsent
              ? "You can speak or type."
              : "You’ll start with typed answers. To record, enable audio consent above."}
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
                    Waiting for microphone permission. You can cancel and
                    continue by typing.
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
