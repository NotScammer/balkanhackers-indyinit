import type { AnswerResult, SessionReport } from "../lib/client/contracts";
import { highlightParts, modes } from "../lib/client/interview-model";
import Link from "next/link";
export function AnswerFeedback({ answer }: { answer: AnswerResult }) {
  const e = answer.evaluation;
  return (
    <>
      <h3>What worked</h3>
      <p>{e.strengths[0] ?? "No strength was identified in this feedback."}</p>
      <h3>One thing to work on</h3>
      <p>{e.improvements[0] ?? "No improvement was provided."}</p>
      <details>
        <summary>Scores and coaching notes · {e.overallScore}/100</summary>
        <p className="fine">A coaching estimate, not a hiring prediction.</p>
        <div className="metrics">
          {Object.entries(e.scores).map(([k, v]) => (
            <span key={k}>
              {k}: <b>{v}</b>
            </span>
          ))}
        </div>
        {e.strengths.slice(1).map((s, i) => (
          <p key={`s${i}`}>{s}</p>
        ))}
        {e.improvements.slice(1).map((s, i) => (
          <p key={`i${i}`}>{s}</p>
        ))}
        <h4>Evidence from your answer</h4>
        {e.evidence.length === 0 && <p>No evidence excerpts were returned.</p>}
        {e.evidence.map((v, i) => (
          <blockquote key={i}>
            “{v.quote}”<p>{v.explanation}</p>
            {!answer.transcript.includes(v.quote) && (
              <p>
                Unmatched excerpt: this text does not appear exactly in your
                submitted answer.
              </p>
            )}
          </blockquote>
        ))}
        <h4>An outline to try</h4>
        <ol>
          {e.suggestedAnswerOutline.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </details>
      <details>
        <summary>Your submitted answer, with evidence highlighted</summary>
        <p className="transcript">
          {highlightParts(
            answer.transcript,
            e.evidence.map((e) => e.quote),
          ).map((part, i) =>
            part.marked ? (
              <mark key={i}>{part.text}</mark>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      </details>
    </>
  );
}
export function ReportView({ report }: { report: SessionReport }) {
  return (
    <>
      <p className="eyebrow">Three questions, completed</p>
      <h1>A few notes for next time</h1>
      <div className="bigscore">
        {report.overallScore}
        <span>/ 100</span>
      </div>
      <p className="fine">Coaching estimate · {modes[report.round].title}</p>
      <h2>What to keep doing</h2>
      <ul>
        {report.strengths.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <h2>Your next practice</h2>
      <ul>
        {report.nextSteps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <details>
        <summary>Category averages</summary>
        <div className="metrics">
          {Object.entries(report.categoryAverages).map(([k, v]) => (
            <span key={k}>
              {k}: {v}
            </span>
          ))}
        </div>
      </details>
      {report.answers.map((a, i) => (
        <details key={a.answerId}>
          <summary>
            Question {i + 1} · {modes[a.evaluation.questionKind].title}
          </summary>
          <AnswerFeedback answer={a} />
        </details>
      ))}
      <Link className="primary" href="/">
        Practice again
      </Link>
      <hr />
      <h3>Save your practice</h3>
      <p>
        Accounts are still a preview. You can read this report without signing
        in.
      </p>
      <Link
        href={`/login?returnTo=${encodeURIComponent(`/results/${report.sessionId}`)}`}
      >
        Preview an account
      </Link>
    </>
  );
}
