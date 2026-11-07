"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import LiveInterview from "./LiveInterview";
import { useRouter } from "next/navigation";
import { api, isMock, tokenKey } from "../lib/client/api";
import { useInterview } from "../hooks/useInterview";
import { useRecorder } from "../hooks/useRecorder";
import { modes, remainingSeconds } from "../lib/client/interview-model";
import AppShell from "./AppShell";
import ConversationHistory from "./ConversationHistory";
import SetupView from "./SetupView";
import DialogueView, { type DialogueSnapshot } from "./DialogueView";
import { dialogueEnabled } from "../lib/client/dialogue";
import { AnswerFeedback, ReportView } from "./FeedbackView";
export default function InterviewApp({
  sessionId,
  results = false,
}: {
  sessionId?: string;
  results?: boolean;
}) {
  if (sessionId && !isMock) return <LiveInterview key={sessionId} id={sessionId} />;
  return sessionId ? (
    <VoiceRoom
      key={`${sessionId}:${results}`}
      id={sessionId}
      results={results}
    />
  ) : (
    <AppShell>
      <SetupView />
    </AppShell>
  );
}
function Microphone({ stop = false }: { stop?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="30"
      height="30"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      {stop ? (
        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
      ) : (
        <>
          <rect x="9" y="2" width="6" height="13" rx="3" />
          <path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8" />
        </>
      )}
    </svg>
  );
}
function VoiceRoom({ id, results }: { id: string; results: boolean }) {
  const router = useRouter(),
    {
      state: s,
      dispatch,
      question: q,
      run,
      load,
      submit,
    } = useInterview(id, results),
    mic = useRecorder();
  const [playing, setPlaying] = useState(false),
    [recordingReview, setRecordingReview] = useState(false),
    [transcribed, setTranscribed] = useState(false),
    [target, setTarget] = useState<"answer" | "followup">("answer"),
    [followupTranscript, setFollowupTranscript] = useState<
      string | undefined
    >(),
    [dialogue, setDialogue] = useState<
      (DialogueSnapshot & { questionId: string }) | null
    >(null);
  const audio = useRef<HTMLAudioElement | null>(null),
    url = useRef<string | null>(null),
    localAudio = useRef<HTMLAudioElement | null>(null),
    heading = useRef<HTMLHeadingElement | null>(null);
  const onDialogue = useCallback(
    (v: DialogueSnapshot) => {
      setDialogue({ ...v, questionId: q?.id ?? "" });
      dispatch({ type: "confirm", value: false });
    },
    [q?.id, dispatch],
  );
  const active = dialogue?.questionId === q?.id ? dialogue : null,
    fullTranscript = active?.transcript ?? s.draft;
  const recording = mic.stage === "recording",
    opening = mic.stage === "opening microphone",
    disabled = !!s.busy || recording || opening;
  const stopSpeech = useCallback(() => {
    audio.current?.pause();
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    audio.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setPlaying(false);
  }, []);
  useEffect(
    () => () => {
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
      window.speechSynthesis?.cancel();
    },
    [],
  );
  useEffect(() => {
    heading.current?.focus();
  }, [q?.id, s.feedback?.answer.answerId]);
  function speakPreview(text: string) {
    stopSpeech();
    localAudio.current?.pause();
    if (!window.speechSynthesis) {
      dispatch({
        type: "failure",
        message:
          "Speech playback is unavailable. Try a browser with speech support.",
      });
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.94;
    utterance.onstart = () => setPlaying(true);
    utterance.onend = () => setPlaying(false);
    utterance.onerror = (event) => {
      if (event.error === "canceled" || event.error === "interrupted") return;
      setPlaying(false);
      dispatch({
        type: "failure",
        message: "Speech playback stopped. Choose Listen again to retry.",
      });
    };
    setPlaying(true);
    window.speechSynthesis.speak(utterance);
  }
  async function play() {
    if (!q) return;
    stopSpeech();
    localAudio.current?.pause();
    if (isMock) {
      speakPreview(q.text);
      return;
    }
    await run("Preparing the question", async () => {
      const b = await api.speech(id, q.id);
      url.current = URL.createObjectURL(b);
      const a = new Audio(url.current);
      audio.current = a;
      a.onended = stopSpeech;
      a.onerror = () => {
        stopSpeech();
        dispatch({
          type: "failure",
          message:
            "Question audio could not play. Retry Listen when you’re ready.",
        });
      };
      try {
        await a.play();
        setPlaying(true);
      } catch {
        stopSpeech();
        throw Error("Question audio could not play. Please try again.");
      }
    });
  }
  async function record(forTarget: "answer" | "followup" = "answer") {
    if (!q) return;
    stopSpeech();
    localAudio.current?.pause();
    setTarget(forTarget);
    setTranscribed(false);
    setRecordingReview(true);
    dispatch({ type: "confirm", value: false });
    const started = await mic.start(
      remainingSeconds(q.maxAnswerSeconds, s.duration),
    );
    if (!started) setRecordingReview(false);
  }
  function discard() {
    localAudio.current?.pause();
    mic.discard();
    setRecordingReview(false);
    setTranscribed(false);
  }
  async function transcribe() {
    if (!q || !mic.blob) return;
    localAudio.current?.pause();
    await run(
      "Listening back to your answer…",
      async () => {
        if (mic.blob!.size > 25 * 1024 * 1024)
          throw Error(
            "This recording is too large. Discard it and record a shorter answer.",
          );
        const r = await api.transcribe(id, q.id, mic.blob!);
        dispatch({
          type: "restore",
          value: {
            ...(target === "answer" ? { draft: r.transcript } : {}),
            mode: "voice",
            duration: s.duration + mic.seconds,
            confirmed: false,
            phase: "reviewing transcript",
          },
        });
        if (target === "followup") setFollowupTranscript(r.transcript);
        setTranscribed(true);
        setRecordingReview(false);
      },
      "transcribing",
    );
  }
  function next() {
    if (!s.feedback) return;
    sessionStorage.setItem(`read:${id}`, String(s.session!.answers.length));
    stopSpeech();
    discard();
    setDialogue(null);
    setTarget("answer");
    setFollowupTranscript(undefined);
    if (s.feedback.nextTurn) {
      dispatch({ type: "next" });
      void play();
    } else router.push(`/results/${id}`);
  }
  async function remove() {
    stopSpeech();
    await run("Deleting this session", async () => {
      await api.delete(id);
      sessionStorage.removeItem(tokenKey(id));
      for (const k of Object.keys(sessionStorage))
        if (k.includes(id) && !k.startsWith("token:"))
          sessionStorage.removeItem(k);
      router.push("/");
    });
  }
  return (
    <AppShell
      returnTo={`/${results ? "results" : "interview"}/${id}`}
      practice={
        s.session ? `${modes[s.session.round].title} interview` : "Connecting"
      }
    >
      <div className="statusline" role="status" aria-live="polite">
        {s.busy ||
          (recording
            ? "I’m listening."
            : opening
              ? "Waiting for your microphone…"
              : playing
                ? "Speaking…"
                : recordingReview && mic.blob
                  ? "Listen back when you’re ready."
                  : "")}
      </div>
      {s.error && (
        <div role="alert" className="error">
          <p>{s.error}</p>
          <button disabled={disabled} onClick={() => void load()}>
            Reload saved interview
          </button>
        </div>
      )}
      {s.report ? (
        <ReportView report={s.report} />
      ) : s.feedback ? (
        <>
          <p className="eyebrow">
            Answer {s.session?.answers.length} of 3 saved
          </p>
          <h1 ref={heading} tabIndex={-1}>
            Here’s what I noticed.
          </h1>
          <AnswerFeedback answer={s.feedback.answer} />
          <button className="primary" disabled={disabled} onClick={next}>
            {s.feedback.nextTurn
              ? "Continue the conversation"
              : "See my results"}
          </button>
        </>
      ) : q && !results ? (
        <>
          <section className="voice-stage" aria-label="Spoken interview">
            <p className="eyebrow">
              {modes[q.kind].title} · {s.session!.currentTurn!.questionNumber} /
              3
            </p>
            <h1 ref={heading} tabIndex={-1} className="question-heading">
              {q.text}
            </h1>
            <p className="voice-prompt">
              {recording
                ? "Take your time. Tap stop when you’re finished."
                : opening
                  ? "Your microphone needs permission."
                  : playing
                    ? "Listen, then take a moment to think."
                    : s.draft
                      ? "Want to add something? You can record again."
                      : "Whenever you’re ready, answer out loud."}
            </p>
            <button
              className="listen-button"
              disabled={disabled}
              onClick={() => (playing ? stopSpeech() : void play())}
            >
              {playing ? "Stop speaking" : "Listen to the question"}
            </button>
            <div className="voice-controls">
              {opening ? (
                <>
                  <span className="fine">Waiting for permission…</span>
                  <button
                    onClick={() => {
                      mic.stop(true);
                      setRecordingReview(false);
                    }}
                  >
                    Cancel microphone request
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={`mic-button ${recording ? "is-recording" : ""}`}
                    aria-label={
                      recording ? "Stop recording" : "Record your answer"
                    }
                    disabled={
                      !!s.busy ||
                      !!s.pending ||
                      !s.consent ||
                      (!recording &&
                        remainingSeconds(q.maxAnswerSeconds, s.duration) <= 0)
                    }
                    onClick={() => (recording ? mic.stop() : void record())}
                  >
                    <Microphone stop={recording} />
                  </button>
                  <span>
                    {recording
                      ? "Stop recording"
                      : mic.blob
                        ? "Record again"
                        : "Tap to speak"}
                  </span>
                  {recording && (
                    <>
                      <label className="voice-level">
                        Microphone level
                        <meter min={0} max={1} value={mic.level} />
                      </label>
                      <span className="fine">
                        {Math.ceil(mic.seconds)} seconds
                      </span>
                      <button
                        onClick={() => {
                          mic.stop(true);
                          setRecordingReview(false);
                        }}
                      >
                        Cancel recording
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
            <p className="fine">
              {Math.ceil(remainingSeconds(q.maxAnswerSeconds, s.duration))}{" "}
              seconds available · No coding required
            </p>
            {!s.consent && (
              <p role="alert">
                This session doesn’t have audio consent.{" "}
                <Link href="/">Start a voice interview</Link> to continue.
              </p>
            )}
            {mic.error && (
              <p role="status" className="error">
                {mic.error}
              </p>
            )}
          </section>
          {mic.url && !recording && !opening && (
            <section className="audio-review">
              <h2>
                Your recording{target === "followup" ? " · follow-up" : ""}
              </h2>
              <audio
                ref={localAudio}
                controls
                src={mic.url}
                onPlay={stopSpeech}
                onError={() =>
                  dispatch({
                    type: "failure",
                    message:
                      "Recording playback failed. Retry playback, transcribe the recording, or record again.",
                  })
                }
              />
              <div className="actions">
                <button
                  className="primary"
                  disabled={!!s.busy || transcribed || !!s.pending}
                  onClick={() => void transcribe()}
                >
                  {s.busy ? "Working…" : "Transcribe this recording"}
                </button>
                <button disabled={!!s.busy || !!s.pending} onClick={discard}>
                  Discard recording
                </button>
              </div>
              <p className="fine">
                Nothing is submitted until you confirm the transcript.
              </p>
            </section>
          )}
          {s.draft && (
            <>
              <details open className="transcript-review">
                <summary>Review your transcript</summary>
                <p className="transcript">{fullTranscript}</p>
                <p className="fine">
                  If this doesn’t reflect what you said, record the answer
                  again.{" "}
                  {s.pending
                    ? "A pending answer stays unchanged for safe retries."
                    : ""}
                </p>
              </details>
              <DialogueView
                key={q.id}
                id={id}
                question={q}
                base={s.draft}
                disabled={disabled || !!s.pending || recordingReview}
                onChange={onDialogue}
                recordedResponse={followupTranscript}
                onRecordFollowup={() => void record("followup")}
                onListen={speakPreview}
              />
              {fullTranscript.length > 10000 && (
                <p role="alert">
                  Your answer is too long. Record a shorter answer before
                  continuing.
                </p>
              )}
              <button
                className="primary send-answer"
                disabled={
                  disabled ||
                  recordingReview ||
                  !s.duration ||
                  active?.valid === false ||
                  fullTranscript.length > 10000
                }
                onClick={() => {
                  stopSpeech();
                  localAudio.current?.pause();
                  void submit(
                    dialogueEnabled && active?.context.length
                      ? {
                          inputMode: "voice",
                          transcript: fullTranscript,
                          baseTranscript: s.draft,
                          dialogueContext: active.context,
                        }
                      : { inputMode: "voice" },
                    true,
                  );
                }}
              >
                {s.pending
                  ? "Retry confirmed answer"
                  : "Confirm transcript & send answer"}
              </button>
            </>
          )}
        </>
      ) : s.session?.status === "active" && results ? (
        <>
          <h1>Your interview is still in progress</h1>
          <Link href={`/interview/${id}`}>Return to the conversation</Link>
        </>
      ) : !s.busy && !s.error ? (
        <p>Connecting…</p>
      ) : null}
      {s.session && s.session.answers.length > 0 && !s.report && (
        <ConversationHistory
          key={s.session.answers.length}
          id={id}
          answers={s.session.answers}
        />
      )}
      <div className="sessionactions">
        <Link href="/">New interview</Link>
        {s.session && (
          <button disabled={disabled} onClick={() => void remove()}>
            Delete session
          </button>
        )}
      </div>
    </AppShell>
  );
}
