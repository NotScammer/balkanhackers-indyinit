"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, tokenKey } from "../lib/client/api";
import type { LiveRequest, LiveView } from "@/shared/live";
import { LiveAudio } from "../lib/client/live-audio";
import { liveApi } from "../lib/client/live-api";
import { RequestError } from "../lib/client/api";
import AppShell from "./AppShell";
import { ReportView } from "./FeedbackView";

export default function LiveInterview({ id }: { id: string }) {
  const router = useRouter();
  const [view, setView] = useState<LiveView | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Opening your interview");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [pending, setPending] = useState<LiveRequest[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const current = useRef<LiveView | null>(null);
  const mounted = useRef(true);
  const audioElement = useRef<HTMLAudioElement>(null);
  const audio = useRef<LiveAudio | null>(null);
  const queue = useRef<LiveRequest[]>([]);
  const working = useRef(false);
  const connectionAttempt = useRef(false);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = `live-pending:${id}`;
  function update(next: LiveView) {
    current.current = next;
    if (mounted.current) setView(next);
  }
  function persist() {
    sessionStorage.setItem(key, JSON.stringify(queue.current));
    if (mounted.current) setPending([...queue.current]);
  }
  function disconnect() {
    audio.current?.close();
    audio.current = null;
    connectionAttempt.current = false;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    if (mounted.current) {
      setConnected(false);
      setConnecting(false);
      setMuted(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let active = true;
    liveApi
      .get(id)
      .then((next) => {
        if (!active) return;
        current.current = next;
        setView(next);
        setStatus(
          next.status === "active" ? "Ready to connect" : "Interview ended",
        );
        try {
          const saved = JSON.parse(sessionStorage.getItem(key) ?? "[]");
          if (Array.isArray(saved)) {
            queue.current = saved;
            setPending(saved);
          }
        } catch {}
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not open your interview.",
          );
      });
    return () => {
      active = false;
      mounted.current = false;
      audio.current?.close();
      connectionAttempt.current = false;
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [id, key]);
  async function processQueue() {
    if (working.current || !queue.current.length || !mounted.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setStatus("Considering your answer");
    try {
      const input = queue.current[0];
      const result = await liveApi.turn(id, input);
      const next =
        current.current && result.revision < current.current.revision
          ? await liveApi.get(id)
          : result;
      if (!mounted.current) return;
      update(next);
      queue.current.shift();
      // Later queued utterances have not been sent yet. Preserve their speech-start question, but use the newly saved revision.
      if (queue.current.length)
        queue.current[0] = { ...queue.current[0], revision: next.revision };
      persist();
      audio.current?.speak(next.spokenText);
      if (next.status !== "active") {
        audio.current?.mute(true);
        setMuted(true);
        // Leave playback open for the final spoken feedback, then release all tracks.
        if (expiryTimer.current) clearTimeout(expiryTimer.current);
        expiryTimer.current = setTimeout(disconnect, 60000);
      }
    } catch (e) {
      if (mounted.current) {
        const message =
          e instanceof Error
            ? e.message
            : "Could not save this turn. Your transcript is preserved.";
        setError(message);
        audio.current?.mute(true);
        setMuted(true);
        if (e instanceof RequestError && e.code === "QUESTION_OUT_OF_ORDER") {
          const fresh = await liveApi.get(id).catch(() => null);
          if (fresh && mounted.current) update(fresh);
        }
      }
      return;
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
    if (queue.current.length) void processQueue();
  }
  function enqueue(input: LiveRequest) {
    queue.current.push(input);
    persist();
    void processQueue();
  }
  async function connect() {
    if (
      connectionAttempt.current ||
      !current.current ||
      current.current.status !== "active"
    )
      return;
    connectionAttempt.current = true;
    setConnecting(true);
    setError("");
    try {
      const fresh = await liveApi.get(id);
      if (!mounted.current || !connectionAttempt.current) return;
      update(fresh);
      const token = await liveApi.token(id);
      if (
        !mounted.current ||
        !connectionAttempt.current ||
        !audioElement.current
      )
        return;
      const connection = new LiveAudio(audioElement.current, {
        questionId: () => current.current?.currentQuestion?.id ?? null,
        onTranscript: (_itemId, text, questionId) => {
          const saved = current.current;
          if (
            !mounted.current ||
            !saved ||
            saved.status !== "active" ||
            !questionId
          )
            return;
          enqueue({
            kind: "utterance",
            clientRequestId: crypto.randomUUID(),
            revision: saved.revision,
            questionId,
            transcript: text,
          });
        },
        onPartial: (delta) => {
          if (mounted.current)
            setPartial((previous) => (delta ? previous + delta : ""));
        },
        onStatus: (next) => {
          if (!mounted.current) return;
          setStatus(next);
        },
        onPlaybackEnd: () => {
          if (current.current?.status === "completed") disconnect();
        },
        onDisconnected: () => {
          if (mounted.current) {
            setConnected(false);
            setConnecting(false);
          }
        },
        onError: (message) => {
          if (mounted.current) setError(message);
        },
      });
      audio.current?.close();
      audio.current = connection;
      await connection.connect(
        token.clientSecret,
        fresh.revision === 0
          ? fresh.spokenText
          : `Welcome back. ${fresh.currentQuestion?.text ?? ""}`,
      );
      if (!mounted.current || audio.current !== connection) {
        connection.close();
        return;
      }
      setConnected(true);
      setMuted(false);
      if (pending.length) {
        connection.mute(true);
        setMuted(true);
      }
      const remaining = Math.min(
        30 * 60 * 1000,
        Date.parse(fresh.expiresAt) - Date.now(),
      );
      expiryTimer.current = setTimeout(
        () => {
          disconnect();
          setStatus(
            "Audio paused. Reconnect to continue if the session is still available.",
          );
        },
        Math.max(0, remaining),
      );
    } catch (e) {
      disconnect();
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Live audio could not connect.",
        );
    } finally {
      connectionAttempt.current = false;
      if (mounted.current) setConnecting(false);
    }
  }
  async function end() {
    disconnect();
    setBusy(true);
    setError("");
    try {
      await liveApi.end(id);
      update(await liveApi.get(id));
      setStatus("Interview ended");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save the end of your interview. Audio is disconnected.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function deleteSession() {
    disconnect();
    setBusy(true);
    try {
      await api.delete(id);
      sessionStorage.removeItem(key);
      sessionStorage.removeItem(tokenKey(id));
      router.push("/");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not delete the session.",
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function saveCorrection() {
    if (!editing || !correction.trim() || !current.current) return;
    enqueue({
      kind: "correct",
      clientRequestId: crypto.randomUUID(),
      revision: current.current.revision,
      answerId: editing,
      transcript: correction.trim(),
    });
    setEditing(null);
  }
  function appendPendingToLastAnswer() {
    const saved = current.current;
    const last = saved?.messages.findLast(
      (m) => m.role === "candidate" && m.kind === "answer",
    );
    const input = queue.current[0];
    if (!saved || !last || input?.kind !== "utterance") return;
    queue.current.shift();
    queue.current.unshift({
      kind: "correct",
      clientRequestId: crypto.randomUUID(),
      revision: saved.revision,
      answerId: last.id,
      transcript: `${last.text}\n\n${input.transcript}`,
    });
    persist();
    void processQueue();
  }
  const active = view?.status === "active";
  const latestFeedback = view?.messages.findLast((m) => m.kind === "feedback");
  return (
    <AppShell practice="Live interview">
      <audio
        ref={audioElement}
        autoPlay
        aria-label="Interviewer audio playback"
        className="live-player"
        hidden
      />
      {!view ? (
        <>
          <p role="status">Opening your interview…</p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button onClick={() => window.location.reload()}>Retry</button>
        </>
      ) : (
        <>
          <div className="room-topline">
            <span className="tag">
              <span className="status-dot" />
              Your Talk To Future room
            </span>
            <div
              className="question-progress"
              aria-label={`Main question ${view.mainNumber} of 3`}
            >
              {[1, 2, 3].map((n) => (
                <span key={n} className={n <= view.mainNumber ? "reached" : ""}>
                  {n}
                </span>
              ))}
            </div>
          </div>
          <p className="eyebrow room-position">
            Live conversation · Main question {view.mainNumber} of 3
            {view.followUpNumber > 0
              ? ` · Follow-up ${view.followUpNumber} of 2`
              : ""}
          </p>
          {view.dataMode === "illustrative" && (
            <p className="fixture">
              Illustrative research context · not verified research.
            </p>
          )}
          {active && (
            <section className="conversation-stage">
              <div
                className={`voice-emblem ${connected && !muted && status.includes("speaking") ? "is-speaking" : ""}`}
                aria-hidden="true"
              >
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <p className="eyebrow">
                {muted ? "MICROPHONE MUTED" : busy ? "THINKING IT THROUGH" : connected ? (status.includes("speaking") ? "YOUR INTERVIEWER" : "YOUR TURN") : "TAKE A BREATH. YOU’VE GOT THIS."}
              </p>
              <h1 className="question-heading">{view.currentQuestion?.text}</h1>
              <p className="fine">{view.currentQuestion?.sourceLabel}</p>
              <p>
                Just talk. Ask me to clarify, explore an idea, or take a moment
                to think.
              </p>
            </section>
          )}
          <p role="status" className="live-status">
            {busy
              ? "Considering your answer…"
              : connecting
                ? "Connecting live audio…"
                : connected
                  ? status
                  : active
                    ? "Ready when you are"
                    : "Interview ended"}
          </p>
          {partial && (
            <p className="transcript" aria-label="Live transcript">
              {partial}
            </p>
          )}
          <div className="live-controls">
            {active && !connected && (
              <button
                className="primary"
                disabled={connecting || busy}
                onClick={() => void connect()}
              >
                {connecting ? "Connecting…" : "Start conversation"}
              </button>
            )}
            {connecting && (
              <button onClick={disconnect}>Cancel connection</button>
            )}
            {connected && active && (
              <>
                <button
                  aria-pressed={muted}
                  onClick={() => {
                    audio.current?.mute(!muted);
                    setMuted(!muted);
                  }}
                >
                  {muted ? "Unmute microphone" : "Mute microphone"}
                </button>
                <button onClick={() => audio.current?.speak(view.spokenText)}>
                  Repeat interviewer
                </button>
                <button onClick={disconnect}>Disconnect audio</button>
              </>
            )}
            {active && (
              <button disabled={busy} onClick={() => void end()}>
                End interview
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              {connected && (
                <button
                  onClick={() =>
                    void audioElement.current
                      ?.play()
                      .catch(() =>
                        setError(
                          "Your browser blocked playback. Check its audio permissions.",
                        ),
                      )
                  }
                >
                  Enable interviewer audio
                </button>
              )}
            </div>
          )}
          {pending.length > 0 && (
            <section
              className="live-recovery"
              aria-label="Unsaved conversation"
            >
              <h2>{busy ? "Saving your words" : "Your words are preserved"}</h2>
              <p className="transcript">{pending[0].transcript}</p>
              {!busy && (
                <>
                  <p>
                    The microphone is paused after an error. Retry the same
                    request, then unmute. If you continued a previous answer
                    while feedback was loading, you can add these words to that
                    answer.
                  </p>
                  <button onClick={() => void processQueue()}>
                    Retry saving
                  </button>
                  {pending[0].kind === "utterance" &&
                    view.messages.some(
                      (m) => m.role === "candidate" && m.kind === "answer",
                    ) && (
                      <button onClick={appendPendingToLastAnswer}>
                        Add to my previous answer
                      </button>
                    )}
                </>
              )}
            </section>
          )}
          {latestFeedback && (
            <section className="live-notes">
              <h2>Latest coaching notes</h2>
              <p>{latestFeedback.text}</p>
              <p className="fine">
                Notes update after each answer. Combined scores appear when all
                three main questions are complete.
              </p>
            </section>
          )}
          <details open={editing !== null} className="live-history">
            <summary>Conversation history ({view.messages.length})</summary>
            <p className="fine">
              Transcripts are assessed automatically. Correct recognition
              mistakes here; the assessment updates without advancing the
              interview. Earlier spoken feedback remains in the conversation
              history.
            </p>
            {view.messages.map((message) => (
              <article
                className={`live-message ${message.role}`}
                key={message.id}
              >
                <p className="eyebrow">
                  {message.role === "candidate" ? "You" : "Interviewer"} ·
                  Question {message.mainNumber} · {message.kind}
                </p>
                <p className="transcript">{message.text}</p>
                {message.role === "candidate" &&
                  message.kind === "answer" &&
                  view.status !== "cancelled" && (
                    <button
                      disabled={busy || pending.length > 0}
                      onClick={() => {
                        audio.current?.mute(true);
                        setMuted(true);
                        setEditing(message.id);
                        setCorrection(message.text);
                      }}
                    >
                      Correct transcript
                    </button>
                  )}
                {editing === message.id && (
                  <div className="live-correction">
                    <label>
                      Corrected transcript
                      <textarea
                        value={correction}
                        maxLength={10000}
                        onChange={(e) => setCorrection(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy || !correction.trim()}
                      onClick={saveCorrection}
                    >
                      Save correction and reassess
                    </button>
                    <button onClick={() => setEditing(null)}>
                      Cancel correction
                    </button>
                  </div>
                )}
              </article>
            ))}
          </details>
          {view.report && (
            <section className="live-report">
              <ReportView report={view.report} />
            </section>
          )}
          {view.status === "cancelled" && (
            <>
              <h1>Interview ended</h1>
              <p>
                Your completed conversation remains available until this session
                expires. A combined report requires completing all three main
                questions.
              </p>
              <Link href="/">Start another interview</Link>
            </>
          )}
          <button disabled={busy} onClick={() => void deleteSession()}>
            Delete this session
          </button>
          <p className="fine">
            AI-generated voice. While connected and unmuted, your microphone
            streams to OpenAI. Transcripts are sent to Claude for feedback and
            saved with your session. Provider retention may differ. Reconnects
            resume saved progress.
          </p>
        </>
      )}
    </AppShell>
  );
}
