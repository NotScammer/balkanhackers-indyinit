"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, tokenKey } from "../lib/client/api";
import { useInterview } from "../hooks/useInterview";
import { useRecorder } from "../hooks/useRecorder";
import { modes, remainingSeconds } from "../lib/client/interview-model";
import NotebookShell from "./NotebookShell";
import NotebookHistory from "./NotebookHistory";
import SetupView from "./SetupView";
import DialogueView, { type DialogueSnapshot } from "./DialogueView";
import { dialogueEnabled } from "../lib/client/dialogue";
import { AnswerFeedback, ReportView } from "./FeedbackView";
import Link from "next/link";
import { useRouter } from "next/navigation";
export default function InterviewApp({
  sessionId,
  results = false,
}: {
  sessionId?: string;
  results?: boolean;
}) {
  return sessionId ? (
    <InterviewRoom
      key={`${sessionId}:${results}`}
      id={sessionId}
      results={results}
    />
  ) : (
    <NotebookShell>
      <SetupView />
    </NotebookShell>
  );
}
function InterviewRoom({ id, results }: { id: string; results: boolean }) {
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
    [transcribed, setTranscribed] = useState(false);
  const playback = useRef<HTMLAudioElement | null>(null),
    playUrl = useRef<string | null>(null),
    heading = useRef<HTMLHeadingElement | null>(null),
    localAudio = useRef<HTMLAudioElement | null>(null);
  const [welcome, setWelcome] = useState(true);
  const [dialogue, setDialogue] = useState<
    (DialogueSnapshot & { questionId: string }) | null
  >(null);
  const [recordTarget, setRecordTarget] = useState("answer"),
    [followupTranscript, setFollowupTranscript] = useState<
      string | undefined
    >();
  const onDialogue = useCallback(
    (value: DialogueSnapshot) => {
      setDialogue({ ...value, questionId: q?.id ?? "" });
      dispatch({ type: "confirm", value: false });
    },
    [q?.id, dispatch],
  );
  const activeDialogue = dialogue?.questionId === q?.id ? dialogue : null;
  const fullTranscript = activeDialogue?.transcript ?? s.draft;
  const dialogueValid = activeDialogue?.valid ?? true;
  const isRecording = mic.stage === "recording",
    audioBusy = isRecording || mic.stage === "opening microphone";
  const disabled = !!s.busy || audioBusy;
  const phase = s.feedback
    ? "feedback"
    : s.busy
      ? s.phase
      : isRecording
        ? "recording"
        : recordingReview
          ? "reviewing recording"
          : playing
            ? "playing question"
            : s.phase;
  const stopPlayback = () => {
    playback.current?.pause();
    if (playUrl.current) URL.revokeObjectURL(playUrl.current);
    playback.current = null;
    playUrl.current = null;
    setPlaying(false);
  };
  useEffect(
    () => () => {
      playback.current?.pause();
      if (playUrl.current) URL.revokeObjectURL(playUrl.current);
    },
    [],
  );
  useEffect(() => {
    heading.current?.focus();
  }, [q?.id, s.feedback?.answer.answerId, s.report?.sessionId]);
  async function play() {
    if (!q) return;
    localAudio.current?.pause();
    stopPlayback();
    await run("Preparing question audio", async () => {
      const b = await api.speech(id, q.id);
      playUrl.current = URL.createObjectURL(b);
      const a = new Audio(playUrl.current);
      playback.current = a;
      a.onended = stopPlayback;
      a.onerror = () => {
        stopPlayback();
        dispatch({
          type: "failure",
          message:
            "Question audio could not play. Read the question and continue.",
        });
      };
      try {
        await a.play();
        setPlaying(true);
      } catch {
        stopPlayback();
        throw Error(
          "Question audio could not play. Read the question and continue.",
        );
      }
    });
  }
  async function record() {
    if (!q) return;
    stopPlayback();
    localAudio.current?.pause();
    setTranscribed(false);
    setRecordingReview(true);
    dispatch({ type: "confirm", value: false });
    await mic.start(remainingSeconds(q.maxAnswerSeconds, s.duration));
  }
  async function transcribe() {
    if (!q || !mic.blob) return;
    localAudio.current?.pause();
    await run(
      "Transcribing your recording",
      async () => {
        if (mic.blob!.size > 25 * 1024 * 1024)
          throw Error(
            "This recording is too large. Discard it and record less, or type.",
          );
        const r = await api.transcribe(id, q.id, mic.blob!);
        dispatch({
          type: "restore",
          value: {
            ...(recordTarget === "followup" && activeDialogue?.hasFollowup
              ? {}
              : { draft: r.transcript }),
            duration: s.duration + mic.seconds,
            confirmed: false,
            phase: "reviewing transcript",
          },
        });
        if (recordTarget === "followup" && activeDialogue?.hasFollowup)
          setFollowupTranscript(r.transcript);
        setTranscribed(true);
        setRecordingReview(false);
      },
      "transcribing",
    );
  }
  function discardRecording() {
    localAudio.current?.pause();
    mic.discard();
    setRecordingReview(false);
    setTranscribed(false);
  }
  function next() {
    if (!s.feedback) return;
    sessionStorage.setItem(`read:${id}`, String(s.session!.answers.length));
    stopPlayback();
    discardRecording();
    setRecordTarget("answer");
    setFollowupTranscript(undefined);
    setDialogue(null);
    if (s.feedback.nextTurn) {
      dispatch({ type: "next" });
    } else router.push(`/results/${id}`);
  }
  async function remove() {
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
    <NotebookShell
      returnTo={`/${results ? "results" : "interview"}/${id}`}
      practice={
        s.session
          ? `${modes[s.session.round].title} practice`
          : "Opening practice"
      }
    >
      <div role="status" aria-live="polite" className="statusline">
        {s.busy ||
          (isRecording
            ? "Recording your answer"
            : playing
              ? "Reading the question aloud"
              : phase === "reviewing recording"
                ? "Review your recording"
                : phase === "reviewing transcript"
                  ? "Review your words before submitting"
                  : "")}
      </div>
      {s.error && (
        <div role="alert" className="error">
          <p>{s.error}</p>
          <button disabled={disabled} onClick={() => void load()}>
            Reload saved practice
          </button>
          <Link href="/">Start a new practice</Link>
        </div>
      )}
      {s.report ? (
        <ReportView report={s.report} />
      ) : s.feedback ? (
        <>
          <p className="eyebrow">Answer saved</p>
          <h1 ref={heading} tabIndex={-1}>
            A moment to reflect
          </h1>
          <AnswerFeedback answer={s.feedback.answer} />
          <button className="primary" disabled={disabled} onClick={next}>
            {s.feedback.nextTurn ? "Next question" : "Read my report"}
          </button>
        </>
      ) : q && !results ? (
        <>
          {welcome && s.session?.answers.length === 0 && (
            <div className="welcome">
              <h1>Take a moment to think.</h1>
              <p>
                We’ll work through three questions. Speak or type, review your
                words, then ask for feedback. You decide when to move on.
              </p>
              <button onClick={() => setWelcome(false)}>I’m ready</button>
            </div>
          )}
          <p className="eyebrow">
            Question {s.session!.currentTurn!.questionNumber} of 3 ·{" "}
            {modes[q.kind].title}
          </p>
          <progress
            max={3}
            value={s.session!.answers.length}
            aria-label="Questions completed"
          />
          <p className="interviewer">Your practice interviewer</p>
          <h2 className="question-heading" ref={heading} tabIndex={-1}>
            {q.text}
          </h2>
          <p className="fine">
            {q.origin === "generated"
              ? "Generated practice question"
              : (q.sourceLabel ?? "Curated practice question")}
            . State reasonable assumptions; no code is required.
          </p>
          <button
            disabled={disabled}
            onClick={() => (playing ? stopPlayback() : void play())}
          >
            {playing ? "Stop question audio" : "Listen to the question"}
          </button>
          <div className="tabs">
            <button
              aria-pressed={s.mode === "voice"}
              disabled={disabled || !!s.pending || !s.consent}
              onClick={() => {
                dispatch({ type: "mode", mode: "voice" });
              }}
            >
              Speak
            </button>
            <button
              aria-pressed={s.mode === "text"}
              disabled={disabled || !!s.pending}
              onClick={() => {
                stopPlayback();
                discardRecording();
                dispatch({ type: "mode", mode: "text" });
              }}
            >
              Type instead
            </button>
          </div>
          {!s.consent && (
            <p className="fine">
              Typing is available. To use recording, start a new practice with
              audio consent.
            </p>
          )}
          {s.mode === "voice" && (
            <div className="recordbox">
              {activeDialogue?.hasFollowup && (
                <label>
                  Record for
                  <select
                    value={recordTarget}
                    disabled={disabled || !!s.pending}
                    onChange={(e) => {
                      discardRecording();
                      setRecordTarget(e.target.value);
                    }}
                  >
                    <option value="answer">Original answer</option>
                    <option value="followup">Follow-up answer</option>
                  </select>
                </label>
              )}
              <p>
                {Math.ceil(remainingSeconds(q.maxAnswerSeconds, s.duration))}{" "}
                seconds of recording available for this question.
              </p>
              {audioBusy ? (
                <>
                  <p>
                    {isRecording && <span className="recording-dot" />}
                    {mic.stage} · {Math.ceil(mic.seconds)} seconds
                  </p>
                  <label>
                    Microphone level
                    <meter min={0} max={1} value={mic.level} />
                  </label>
                  <button disabled={!isRecording} onClick={() => mic.stop()}>
                    Stop recording
                  </button>
                  <button
                    onClick={() => {
                      mic.stop(true);
                      setRecordingReview(false);
                    }}
                  >
                    Cancel recording
                  </button>
                </>
              ) : (
                <button
                  disabled={
                    disabled ||
                    !!s.pending ||
                    remainingSeconds(q.maxAnswerSeconds, s.duration) <= 0
                  }
                  onClick={() => void record()}
                >
                  {mic.blob ? "Record again" : "Record my answer"}
                </button>
              )}
              {mic.error && <p role="status">{mic.error}</p>}
              {mic.url && !audioBusy && (
                <>
                  <h3>Review your recording</h3>
                  <audio
                    ref={localAudio}
                    controls
                    src={mic.url}
                    onPlay={stopPlayback}
                    onError={() =>
                      dispatch({
                        type: "failure",
                        message:
                          "Recording playback is unavailable. You may still transcribe it or type instead.",
                      })
                    }
                  />
                  <p className="fine">
                    Kept in memory in this tab. Nothing is uploaded until you
                    choose transcription.
                  </p>
                  <button
                    disabled={disabled || transcribed || !!s.pending}
                    onClick={() => void transcribe()}
                  >
                    {s.draft
                      ? "Transcribe / retry transcription"
                      : "Transcribe this recording"}
                  </button>
                  <button
                    disabled={disabled || !!s.pending}
                    onClick={discardRecording}
                  >
                    Discard recording
                  </button>
                </>
              )}
            </div>
          )}
          <label>
            {s.mode === "voice"
              ? "Review and correct your transcript"
              : "Your answer"}
            <textarea
              rows={7}
              maxLength={10000}
              value={s.draft}
              disabled={disabled}
              readOnly={!!s.pending}
              placeholder="Take your time. Explain your reasoning…"
              onChange={(e) => dispatch({ type: "edit", text: e.target.value })}
            />
          </label>
          <p className="fine">
            {s.draft.length.toLocaleString()} / 10,000 characters.{" "}
            {s.pending
              ? "Your submitted answer is held unchanged for a safe retry."
              : "Your draft is saved in this tab."}
          </p>
          <DialogueView
            key={q.id}
            id={id}
            question={q}
            base={s.draft}
            disabled={disabled || !!s.pending || recordingReview}
            onChange={onDialogue}
            recordedResponse={followupTranscript}
          />
          {activeDialogue && activeDialogue.hasFollowup && (
            <>
              <h3>Your complete answer for review</h3>
              <p className="answer-preview">{fullTranscript}</p>
            </>
          )}
          {fullTranscript.length > 10000 && (
            <p role="alert">
              Your complete answer exceeds 10,000 characters. Please shorten it.
            </p>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={s.confirmed}
              disabled={
                disabled ||
                !s.draft.trim() ||
                recordingReview ||
                !dialogueValid ||
                fullTranscript.length > 10000
              }
              onChange={(e) =>
                dispatch({ type: "confirm", value: e.target.checked })
              }
            />
            I reviewed my complete answer and am ready for feedback.
          </label>
          <button
            className="primary"
            disabled={
              disabled ||
              !s.confirmed ||
              !s.draft.trim() ||
              recordingReview ||
              !dialogueValid ||
              fullTranscript.length > 10000 ||
              (s.mode === "voice" && s.duration === 0)
            }
            onClick={() => {
              stopPlayback();
              localAudio.current?.pause();
              void submit(
                dialogueEnabled && activeDialogue?.context.length
                  ? {
                      transcript: fullTranscript,
                      baseTranscript: s.draft,
                      dialogueContext: activeDialogue.context,
                    }
                  : undefined,
              );
            }}
          >
            {s.pending ? "Retry the same answer" : "Get feedback"}
          </button>
          <p className="fine">
            You can submit an honest partial answer. Skipping questions is not
            available.
          </p>
        </>
      ) : s.session?.status === "active" && results ? (
        <>
          <h1>This practice is still in progress</h1>
          <Link href={`/interview/${id}`}>Return to your interview</Link>
        </>
      ) : !s.busy && !s.error ? (
        <p>Opening your notebook…</p>
      ) : null}
      {s.session && s.session.answers.length > 0 && !s.report && (
        <NotebookHistory
          key={s.session.answers.length}
          id={id}
          answers={s.session.answers}
        />
      )}
      {s.session && (
        <div className="sessionactions">
          <Link href="/">New practice</Link>
          <button disabled={disabled} onClick={() => void remove()}>
            Delete this session
          </button>
        </div>
      )}
    </NotebookShell>
  );
}
