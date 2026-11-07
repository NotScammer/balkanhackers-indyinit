"use client";
import Link from "next/link";
import NotebookShell from "./NotebookShell";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, isMock, RequestError, tokenKey } from "../lib/client/api";
import type {
  AnswerResult,
  Catalog,
  InterviewMode,
  Session,
  SessionReport,
  Submission,
  Submitted,
} from "../lib/client/contracts";
const modes: Record<
  InterviewMode,
  { title: string; description: string; limit: string }
> = {
  behavioral: {
    title: "Behavioral",
    description:
      "Tell your story. Reflect on actions, collaboration, and outcomes.",
    limit: "3 minutes",
  },
  technical: {
    title: "Technical",
    description:
      "Explain mechanisms, investigate problems, and weigh alternatives.",
    limit: "5 minutes",
  },
  system_design: {
    title: "System design",
    description:
      "Shape a small system. Connect requirements, components, and trade-offs.",
    limit: "10 minutes",
  },
  mixed: {
    title: "Mixed",
    description:
      "One behavioral, one technical, and one system design question.",
    limit: "3 / 5 / 10 minutes",
  },
};
function Feedback({ answer }: { answer: AnswerResult }) {
  const e = answer.evaluation;
  return (
    <div className="feedback">
      <div className="scoreline">
        <h3>Question feedback</h3>
        <strong>
          {e.overallScore}
          <small> / 100</small>
        </strong>
      </div>
      <div className="metrics">
        {Object.entries(e.scores).map(([k, v]) => (
          <span key={k}>
            {k} <b>{v}</b>
          </span>
        ))}
      </div>
      <h4>Strengths</h4>
      <ul>
        {e.strengths.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <h4>Try next time</h4>
      <ul>
        {e.improvements.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      {e.evidence.map((v, i) => (
        <blockquote key={i}>
          “{v.quote}”<p>{v.explanation}</p>
        </blockquote>
      ))}
      <h4>A useful answer outline</h4>
      <ol>
        {e.suggestedAnswerOutline.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <details>
        <summary>Your submitted answer</summary>
        <p className="transcript">{answer.transcript}</p>
      </details>
    </div>
  );
}
export default function InterviewApp({
  sessionId,
  results = false,
}: {
  sessionId?: string;
  results?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Submission | null>(null),
    [audioBlob, setAudioBlob] = useState<Blob | null>(null),
    [audioConsent, setAudioConsent] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [company, setCompany] = useState(""),
    [role, setRole] = useState(""),
    [round, setRound] = useState<InterviewMode>("behavioral"),
    [consent, setConsent] = useState(false);
  const [session, setSession] = useState<Session | null>(null),
    [report, setReport] = useState<SessionReport | null>(null),
    [feedback, setFeedback] = useState<Submitted | null>(null);
  const [mode, setMode] = useState<"voice" | "text">("voice"),
    [draft, setDraft] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [duration, setDuration] = useState<number | null>(null),
    [recording, setRecording] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [playing, setPlaying] = useState(false),
    [retryAt, setRetryAt] = useState(0);
  const lock = useRef(false),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    audioUrl = useRef<string | null>(null),
    cancelled = useRef(false),
    alive = useRef(true);
  const stopPlayback = useCallback(() => {
    audio.current?.pause();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
    audio.current = null;
    setPlaying(false);
  }, []);
  const task = useCallback(async (label: string, fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone permission was denied. Switch to a typed answer to continue."
          : e instanceof Error
            ? e.message
            : "Something went wrong. Please retry.",
      );
      if (e instanceof RequestError && e.retryAfter)
        setRetryAt(Date.now() + e.retryAfter);
    } finally {
      lock.current = false;
      if (alive.current) setBusy("");
    }
  }, []);
  const load = useCallback(
    () =>
      task("Loading", async () => {
        if (sessionId) {
          const s = await api.session(sessionId);
          setSession(s);
          setFeedback(null);
          setAudioConsent(
            sessionStorage.getItem(`consent:${sessionId}`) === "true",
          );
          const raw =
            s.currentTurn &&
            sessionStorage.getItem(
              `draft:${sessionId}:${s.currentTurn.question.id}`,
            );
          setPending(null);
          setAudioBlob(null);
          if (raw) {
            try {
              const d = JSON.parse(raw);
              setDraft(d.text ?? "");
              setMode(d.mode ?? "voice");
              setDuration(d.duration ?? null);
              setPending(d.pending ?? null);
            } catch {
              setDraft("");
            }
          } else {
            setDraft("");
            setDuration(null);
          }
          setConfirmed(false);
          if (s.status === "completed") {
            setReport(await api.report(sessionId));
          } else if (results) {
            setError(
              "This interview is still in progress. Return to the interview to finish.",
            );
          }
        } else {
          const c = await api.catalog();
          setCatalog(c);
          const first = c.availableInterviews[0];
          if (first) {
            setCompany(first.companyId);
            setRole(first.roleId);
            setRound(first.round);
            const saved = sessionStorage.getItem("rehearsal:setup");
            if (saved) {
              try {
                const d = JSON.parse(saved);
                if (
                  c.availableInterviews.some(
                    (a) =>
                      a.companyId === d.companyId &&
                      a.roleId === d.roleId &&
                      a.round === d.round,
                  )
                ) {
                  setCompany(d.companyId);
                  setRole(d.roleId);
                  setRound(d.round);
                  setConsent(d.audioProcessingConsent === true);
                }
              } catch {}
            }
          }
        }
      }),
    [sessionId, results, task],
  );
  useEffect(() => {
    alive.current = true;
    const loading = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(loading);
      alive.current = false;
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      audio.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, [load]);
  const q = session?.currentTurn?.question;
  useEffect(() => {
    if (!sessionId || !q || feedback) return;
    sessionStorage.setItem(
      `draft:${sessionId}:${q.id}`,
      JSON.stringify({ text: draft, mode, duration, pending: pending }),
    );
  }, [draft, mode, duration, pending, sessionId, q, feedback]);
  async function start() {
    await task("Creating your interview", async () => {
      sessionStorage.setItem(
        "rehearsal:setup",
        JSON.stringify({
          companyId: company,
          roleId: role,
          round,
          audioProcessingConsent: consent,
        }),
      );
      const s = await api.create({
        companyId: company,
        roleId: role,
        round,
        audioProcessingConsent: consent,
      });
      sessionStorage.setItem(tokenKey(s.sessionId), s.sessionToken);
      sessionStorage.setItem(`consent:${s.sessionId}`, String(consent));
      router.push(`/interview/${s.sessionId}`);
    });
  }
  async function play() {
    if (!q || !sessionId) return;
    stopPlayback();
    await task("Preparing question audio", async () => {
      const b = await api.speech(sessionId, q.id);
      audioUrl.current = URL.createObjectURL(b);
      const a = new Audio(audioUrl.current);
      audio.current = a;
      a.onended = stopPlayback;
      a.onerror = () => {
        stopPlayback();
        setError(
          "Question audio could not play. You can read the question and continue.",
        );
      };
      await a.play();
      setPlaying(true);
    });
  }
  async function transcribe(b: Blob) {
    if (!sessionId || !q) return;
    await task("Transcribing — your answer is not submitted", async () => {
      if (b.size > 25 * 1024 * 1024)
        throw Error(
          "Recording exceeds 25 MB. Record a shorter answer or switch to typing.",
        );
      const r = await api.transcribe(sessionId, q.id, b);
      if (alive.current) {
        setDraft(r.transcript);
        setConfirmed(false);
      }
    });
  }
  async function record() {
    if (!q || !sessionId || lock.current) return;
    stopPlayback();
    await task("Opening microphone", async () => {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw Error(
          "Recording is unavailable in this browser. Switch to a typed answer.",
        );
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime)
        throw Error("No supported recording format. Switch to a typed answer.");
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      const r = new MediaRecorder(s, { mimeType: mime });
      recorder.current = r;
      cancelled.current = false;
      const chunks: BlobPart[] = [];
      let bytes = 0;
      const started = Date.now();
      r.ondataavailable = (e) => {
        chunks.push(e.data);
        bytes += e.data.size;
        if (bytes > 25 * 1024 * 1024 && r.state === "recording") r.stop();
      };
      r.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        setRecording(false);
        setDuration(
          Math.min(q.maxAnswerSeconds, (Date.now() - started) / 1000),
        );
        if (!cancelled.current && alive.current) {
          const b = new Blob(chunks, { type: r.mimeType });
          setAudioBlob(b);
          void transcribe(b);
        }
      };
      r.onerror = () => {
        cancelled.current = true;
        if (r.state === "recording") r.stop();
        s.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        setRecording(false);
        setError("Recording failed. Please record again or switch to typing.");
      };
      r.start(1000);
      setElapsed(0);
      setRecording(true);
      timer.current = setInterval(() => {
        const secs = Math.floor((Date.now() - started) / 1000);
        setElapsed(secs);
        if (secs >= q.maxAnswerSeconds && r.state === "recording") r.stop();
      }, 250);
    });
  }
  function stop(cancel = false) {
    cancelled.current = cancel;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  async function submit() {
    if (!q || !sessionId || !confirmed || !draft.trim()) return;
    await task("Evaluating your confirmed answer", async () => {
      if (Date.now() < retryAt)
        throw Error("Please wait for the retry delay before submitting again.");
      const payload = pending ?? {
        clientAnswerId: crypto.randomUUID(),
        questionId: q.id,
        transcript: draft,
        inputMode: mode,
        durationSeconds: mode === "voice" ? duration : null,
      };
      setPending(payload);
      sessionStorage.setItem(
        `draft:${sessionId}:${q.id}`,
        JSON.stringify({ text: draft, mode, duration, pending: payload }),
      );
      const response = await api.submit(sessionId, payload);
      setFeedback(response);
      sessionStorage.removeItem(`draft:${sessionId}:${q.id}`);
    });
  }
  async function next() {
    if (!feedback || !sessionId) return;
    stopPlayback();
    if (feedback.nextTurn) {
      setSession((s) =>
        s
          ? {
              ...s,
              status: feedback.status,
              currentTurn: feedback.nextTurn,
              answers: [...s.answers, feedback.answer],
            }
          : s,
      );
      setFeedback(null);
      setConfirmed(false);
      setAudioBlob(null);
      setDraft("");
      setDuration(null);
      setPending(null);
    } else router.push(`/results/${sessionId}`);
  }
  async function remove() {
    if (!sessionId) return;
    await task("Deleting session", async () => {
      await api.delete(sessionId);
      sessionStorage.removeItem(tokenKey(sessionId));
      for (const k of Object.keys(sessionStorage))
        if (k.startsWith(`draft:${sessionId}:`) || k === `consent:${sessionId}`)
          sessionStorage.removeItem(k);
      router.push("/");
    });
  }
  const available =
    catalog?.availableInterviews.filter(
      (a) => a.companyId === company && a.roleId === role,
    ) ?? [];
  const disabled = !!busy || recording;
  return (
    <NotebookShell>
      <div role="status" aria-live="polite">
        {busy && <p className="notice">{busy}…</p>}
        {recording && (
          <p className="notice">
            Recording · {elapsed}s / {q?.maxAnswerSeconds}s
          </p>
        )}
      </div>
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          {!recording && (
            <button onClick={() => void load()} disabled={!!busy}>
              Reload saved state
            </button>
          )}
        </div>
      )}
      {isMock && (
        <p className="fixture">
          Demo fixtures: scores and coaching are illustrative. Audio providers
          are unavailable; typed answers complete the full journey.
        </p>
      )}
      {!sessionId && catalog && (
        <>
          <p className="eyebrow">Three questions, at your pace</p>
          <h2>Choose your practice</h2>
          <p>Choose a focus for your three-question interview.</p>
          <Link
            href="/login"
            onClick={() =>
              sessionStorage.setItem(
                "rehearsal:setup",
                JSON.stringify({
                  companyId: company,
                  roleId: role,
                  round,
                  audioProcessingConsent: consent,
                }),
              )
            }
          >
            Continue as guest or preview an account
          </Link>
          <div className="selects">
            <label>
              Company
              <select
                value={company}
                onChange={(e) => {
                  const a = catalog.availableInterviews.find(
                    (x) => x.companyId === e.target.value,
                  );
                  setCompany(e.target.value);
                  setRole(a?.roleId ?? "");
                  setRound(a?.round ?? "behavioral");
                }}
              >
                {catalog.companies
                  .filter((c) =>
                    catalog.availableInterviews.some(
                      (a) => a.companyId === c.id,
                    ),
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
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setRound(
                    catalog.availableInterviews.find(
                      (a) =>
                        a.companyId === company && a.roleId === e.target.value,
                    )!.round,
                  );
                }}
              >
                {catalog.roles
                  .filter((r) =>
                    catalog.availableInterviews.some(
                      (a) => a.companyId === company && a.roleId === r.id,
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
          <fieldset>
            <legend>What would you like to practice?</legend>
            <div className="modegrid">
              {Object.entries(modes).map(([key, v]) => (
                <label
                  className={`modecard ${round === key ? "selected" : ""}`}
                  key={key}
                >
                  <input
                    type="radio"
                    name="round"
                    value={key}
                    checked={round === key}
                    disabled={!available.some((a) => a.round === key)}
                    onChange={() => setRound(key as InterviewMode)}
                  />
                  <strong>{v.title}</strong>
                  <span>{v.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="fine">
            Up to {modes[round].limit} per answer. Review and confirm each
            transcript before it is evaluated.
          </p>
          <div className="privacy">
            <p>
              In live mode, answers are sent to AI providers for feedback.
              Consenting audio is sent for transcription and discarded by the
              app afterward. Session transcripts may be retained for up to 24
              hours; provider retention may differ.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I consent to audio processing for transcription.
            </label>
            <p className="fine">
              Optional. You can complete the interview by typing. Microphone
              permission is requested only when you record.
            </p>
          </div>
          <button
            className="primary"
            disabled={!!busy || !available.some((a) => a.round === round)}
            onClick={() => void start()}
          >
            Start my practice <span>→</span>
          </button>
        </>
      )}
      {session && !report && !feedback && q && !results && (
        <>
          <p className="eyebrow">
            Question {session.currentTurn!.questionNumber} of{" "}
            {session.currentTurn!.totalQuestions} · {modes[q.kind].title}
          </p>
          <progress
            max={3}
            value={session.answers.length}
            aria-label="Answers completed"
          />
          <h2>{q.text}</h2>
          <p className="fine">
            {q.origin === "generated"
              ? "Generated practice question"
              : (q.sourceLabel ?? "Curated practice question")}{" "}
            · State reasonable assumptions. No code required.
          </p>
          <button
            disabled={disabled}
            onClick={() => (playing ? stopPlayback() : void play())}
          >
            {playing ? "Stop audio" : "▶ Play question"}
          </button>
          <div className="tabs">
            <button
              aria-pressed={mode === "voice"}
              disabled={disabled || !!pending}
              onClick={() => {
                setMode("voice");
                setConfirmed(false);
              }}
            >
              Spoken answer
            </button>
            <button
              aria-pressed={mode === "text"}
              disabled={disabled || !!pending}
              onClick={() => {
                setMode("text");
                setConfirmed(false);
                setDuration(null);
              }}
            >
              Typed answer
            </button>
          </div>
          {mode === "voice" && (
            <div className="recordbox">
              <p>
                Up to {q.maxAnswerSeconds / 60} minutes. Stop when you are
                ready, then review your transcript.
              </p>
              {!audioConsent ? (
                <p>
                  Audio consent was not given for this session. Use a typed
                  answer, or start a new session with consent.
                </p>
              ) : recording ? (
                <>
                  <button className="primary" onClick={() => stop()}>
                    Stop & transcribe
                  </button>
                  <button onClick={() => stop(true)}>Cancel recording</button>
                </>
              ) : (
                <button
                  disabled={disabled || !!pending}
                  onClick={() => void record()}
                >
                  ● Record answer
                </button>
              )}
              {audioBlob && !recording && (
                <button
                  disabled={disabled}
                  onClick={() => void transcribe(audioBlob!)}
                >
                  Retry transcription
                </button>
              )}
            </div>
          )}
          <label className="answerlabel">
            {mode === "voice"
              ? "Review and correct your transcript"
              : "Your answer"}
            <textarea
              maxLength={10000}
              rows={8}
              value={draft}
              readOnly={!!pending}
              disabled={disabled}
              placeholder={
                mode === "voice"
                  ? "Your transcript will appear here. You can correct it before submitting."
                  : "Take your time. Explain your reasoning…"
              }
              onChange={(e) => {
                setDraft(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <p className="fine">
            {draft.length.toLocaleString()} / 10,000 characters
            {pending
              ? " · A submission is pending. Retry uses the same confirmed answer."
              : ""}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={disabled}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed this answer and am ready to submit it.
          </label>
          <button
            className="primary"
            disabled={
              disabled ||
              !confirmed ||
              !draft.trim() ||
              (mode === "voice" && duration === null)
            }
            onClick={() => void submit()}
          >
            {pending ? "Retry confirmed answer" : "Submit confirmed answer"} →
          </button>
          <p className="fine">
            Skipping is unavailable. You may submit an honest partial response
            or start a new practice.
          </p>
        </>
      )}
      {feedback && (
        <>
          <p className="eyebrow">Answer saved. Take a moment to reflect.</p>
          <Feedback answer={feedback.answer} />
          <button
            className="primary"
            disabled={!!busy}
            onClick={() => void next()}
          >
            {feedback.nextTurn ? "Next question" : "View my report"} →
          </button>
        </>
      )}
      {report && (
        <>
          <p className="eyebrow">A few notes for next time.</p>
          <h2>Your practice report</h2>
          <div className="bigscore">
            {report.overallScore}
            <span>/ 100</span>
          </div>
          <p>
            Coaching estimate · {modes[report.round].title}
            {isMock ? " · Fixed illustrative score" : ""}
          </p>
          <div className="metrics">
            {Object.entries(report.categoryAverages).map(([k, v]) => (
              <span key={k}>
                {k} <b>{v}</b>
              </span>
            ))}
          </div>
          <h3>Strengths</h3>
          <ul>
            {report.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <h3>Your next practice</h3>
          <ul>
            {report.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {report.answers.map((a, i) => (
            <details className="answerdetail" key={a.answerId}>
              <summary>
                Question {i + 1} · {modes[a.evaluation.questionKind].title} ·{" "}
                {a.evaluation.overallScore}/100
              </summary>
              <Feedback answer={a} />
            </details>
          ))}
          <Link className="primary" href="/">
            Start another practice →
          </Link>
        </>
      )}
      {session && (
        <div className="sessionactions">
          {results && !report && session.status === "active" && (
            <Link href={`/interview/${sessionId}`}>Return to interview</Link>
          )}
          <button disabled={disabled} onClick={() => void remove()}>
            Delete this session
          </button>
          <Link href="/">New practice</Link>
        </div>
      )}
    </NotebookShell>
  );
}
