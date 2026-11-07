"use client";
import Link from "next/link";
import { useLiveInterview } from "../hooks/useLiveInterview";
import AppShell from "./AppShell";
import { ReportView } from "./FeedbackView";

export default function LiveInterview({ id }: { id: string }) {
  const room = useLiveInterview(id);
  return (
    <AppShell practice="Your interview room" returnTo={`/interview/${id}`}>
      <InterviewRoom room={room} />
    </AppShell>
  );
}

export function InterviewRoom({
  room,
}: {
  room: ReturnType<typeof useLiveInterview>;
}) {
  const {
    view,
    error,
    status,
    connected,
    connecting,
    paused,
    busy,
    finishing,
    finishFailed,
    recapPlaying,
    partial,
    pending,
    editing,
    correction,
  } = room;
  const active = view?.status === "active";
  const roomState = finishing
    ? "finishing"
    : connecting
      ? "connecting"
      : paused
        ? "paused"
        : busy
          ? "thinking"
          : connected
            ? status.includes("speaking")
              ? "speaking"
              : "listening"
            : "ready";
  const roomTitle = {
    finishing: "Bringing it all together",
    connecting: "Getting connected",
    paused: "Take your time",
    thinking: "A moment to reflect",
    speaking: "Your interviewer",
    listening: "The floor is yours",
    ready: "Find your voice",
  }[roomState];
  return (
    <>
      <audio
        ref={(element) => room.attachAudio(element)}
        autoPlay
        className="live-player"
      />
      {!view ? (
        <>
          <h1>
            {error ? "Your room is unavailable" : "Opening your interview…"}
          </h1>
          {error && (
            <>
              <p role="alert" className="error">
                {error}
              </p>
              <button onClick={() => window.location.reload()}>Retry</button>
            </>
          )}
        </>
      ) : (
        <div className="voice-room" data-state={roomState}>
          <div className="room-topline">
            <span className="tag">
              <span className="status-dot" />
              {active
                ? "A conversation about your future"
                : "Your interview, reflected"}
            </span>
            {active && (
              <div
                className="question-progress"
                aria-label={`Main question ${view.mainNumber} of ${view.totalMainQuestions}`}
              >
                {[1, 2, 3].map((n) => (
                  <span
                    key={n}
                    className={n <= view.mainNumber ? "reached" : ""}
                    aria-current={n === view.mainNumber ? "step" : undefined}
                  >
                    {n}
                  </span>
                ))}
              </div>
            )}
          </div>
          {view.dataMode === "illustrative" && (
            <p className="fixture">
              Illustrative research context · not verified research.
            </p>
          )}
          {active && (
            <>
              <section
                className="conversation-stage"
                aria-label="Voice conversation"
              >
                <div
                  className={`voice-emblem ${roomState === "speaking" || roomState === "listening" ? "is-speaking" : ""}`}
                  aria-hidden="true"
                >
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <p className="eyebrow">
                  {roomState === "paused"
                    ? "MICROPHONE OFF"
                    : roomState === "thinking" || roomState === "finishing"
                      ? "SAVING YOUR WORDS"
                      : `MAIN QUESTION ${view.mainNumber} OF 3`}
                </p>
                <h1 className="room-heading">{roomTitle}</h1>
                <p className="room-guidance">
                  {paused
                    ? "Your place is saved. Select Resume when you’re ready."
                    : "Just talk. You can think aloud, ask for clarification, or take a moment."}
                </p>
                <p className="fine">
                  Your feedback and scores arrive after you finish.
                </p>
              </section>
              <p role="status" className="live-status">
                {finishing
                  ? "Saving your last words and preparing your report…"
                  : connecting
                    ? "Connecting audio…"
                    : paused
                      ? "Paused · microphone off"
                      : busy
                        ? "Considering your answer…"
                        : connected
                          ? status
                          : "Ready to start your conversation"}
              </p>
              <div className="live-controls" aria-label="Interview controls">
                {connected && !paused ? (
                  <button
                    disabled={finishing}
                    onClick={() => void room.pause()}
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={
                      connecting || busy || finishing || pending.length > 0
                    }
                    onClick={() => void room.resume()}
                  >
                    {connecting
                      ? "Connecting…"
                      : paused
                        ? "Resume"
                        : "Start conversation"}
                  </button>
                )}
                <button
                  disabled={!connected || paused || busy || finishing}
                  onClick={() => room.repeat()}
                >
                  Repeat
                </button>
                <button disabled={busy || finishing || connecting || pending.length > 0} onClick={() => void room.nextTopic()}>
                  Next topic
                </button>
                <button
                  className="finish-interview"
                  disabled={finishing || connecting}
                  onClick={() => void room.finish()}
                >
                  {finishing
                    ? "Finishing…"
                    : finishFailed
                      ? "Retry finish"
                      : "Finish & review"}
                </button>
              </div>
              {connecting && (
                <button
                  className="quiet-control"
                  onClick={() => void room.pause(false)}
                >
                  Cancel connection
                </button>
              )}
              <p className="voice-command-hint">
                Try “repeat”, “pause”, or “finish interview”. Say “I’m done” to
                hand back the conversation.
              </p>
            </>
          )}
          {error && (
            <div role="alert" className="error">
              <p>{error}</p>
              {connected && (
                <button onClick={() => room.enablePlayback()}>
                  Enable audio playback
                </button>
              )}
              {finishFailed && !active && (
                <button disabled={finishing} onClick={() => void room.finish()}>
                  Retry finishing
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
              {pending[0].kind !== "control" && (
                <p className="transcript">{pending[0].transcript}</p>
              )}
              {!busy && (
                <>
                  <p>
                    Your microphone is off. Save the pending conversation before
                    resuming or reviewing.
                  </p>
                  <button onClick={() => void room.retry()}>
                    Retry saving
                  </button>
                </>
              )}
            </section>
          )}
          {view.report && (
            <>
              <section
                className="recap-controls"
                aria-label="Spoken interview recap"
              >
                <div>
                  <p className="eyebrow">YOUR DEBRIEF</p>
                  <p>
                    {recapPlaying
                      ? "Your spoken recap · microphone off"
                      : "Listen to a short recap, or explore your report below."}
                  </p>
                </div>
                <button
                  disabled={
                    (finishing && !recapPlaying) ||
                    (finishFailed && !recapPlaying)
                  }
                  onClick={() =>
                    recapPlaying || connecting
                      ? room.disconnect()
                      : void room.playRecap()
                  }
                >
                  {recapPlaying || connecting ? "Skip recap" : "Play recap"}
                </button>
              </section>
              <section className="live-report">
                <ReportView report={view.report} />
              </section>
            </>
          )}
          {view.status === "cancelled" && (
            <section className="empty-interview">
              <h1>Your interview has ended</h1>
              <p>
                No answers were assessed, so there is no score to show. You can
                start again whenever you’re ready.
              </p>
              <Link className="primary" href="/">
                Start another interview
              </Link>
            </section>
          )}
          <details
            className="live-history"
            open={editing !== null || undefined}
          >
            <summary>
              {active
                ? "Question, captions & transcript"
                : "Review & correct your transcript"}
            </summary>
            {active && (
              <section className="current-prompt">
                <p className="eyebrow">
                  CURRENT QUESTION
                  {view.followUpNumber
                    ? ` · FOLLOW-UP ${view.followUpNumber}`
                    : ""}
                </p>
                <h2>{view.currentQuestion?.text}</h2>
                <p className="fine">{view.currentQuestion?.sourceLabel}</p>
                <p className="transcript" aria-label="Live captions">
                  {partial || "Your words appear here as you speak."}
                </p>
              </section>
            )}
            <p className="fine">
              Correct recognition mistakes below. Corrections update the
              assessment without advancing the interview.
            </p>
            {view.messages.map((message) => (
              <article
                className={`live-message ${message.role}`}
                key={message.id}
              >
                <p className="eyebrow">
                  {message.role === "candidate" ? "You" : "Interviewer"} ·
                  Question {message.mainNumber}
                </p>
                <p className="transcript">{message.text}</p>
                {message.role === "candidate" &&
                  message.kind === "answer" &&
                  view.status !== "cancelled" && (
                    <button
                      disabled={busy || finishing || pending.length > 0}
                      onClick={async () => {
                        if (active) await room.pause(false);
                        room.setEditing(message.id);
                        room.setCorrection(message.text);
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
                        onChange={(event) =>
                          room.setCorrection(event.target.value)
                        }
                      />
                    </label>
                    <button
                      disabled={busy || !correction.trim()}
                      onClick={() => room.saveCorrection()}
                    >
                      Save correction
                    </button>
                    <button onClick={() => room.setEditing(null)}>
                      Cancel correction
                    </button>
                  </div>
                )}
              </article>
            ))}
          </details>
          <details className="room-options">
            <summary>Session options & privacy</summary>
            <p className="fine">
              AI-generated voice. While the microphone is on, audio streams to
              OpenAI. Transcripts are assessed by Claude and saved with your
              session. Pausing stops microphone capture. Provider retention may
              differ.
            </p>
            {connected && active && (
              <button
                disabled={busy || finishing}
                onClick={() => void room.pause(false).then(room.disconnect)}
              >
                Disconnect audio
              </button>
            )}
            <button
              disabled={busy || finishing || connecting}
              onClick={() => void room.deleteSession()}
            >
              Delete this session
            </button>
          </details>
        </div>
      )}
    </>
  );
}
