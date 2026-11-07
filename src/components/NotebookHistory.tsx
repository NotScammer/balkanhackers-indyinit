"use client";
import { useState } from "react";
import type { AnswerResult } from "../lib/client/contracts";
import { AnswerFeedback } from "./FeedbackView";
import { modes } from "../lib/client/interview-model";
import { dialogueEnabled } from "../lib/client/dialogue";
import { readDialogueDraft } from "./DialogueView";
export default function NotebookHistory({
  id,
  answers,
}: {
  id: string;
  answers: AnswerResult[];
}) {
  const [questions] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`question-cache:${id}`) ?? "{}");
    } catch {
      return {};
    }
  });
  return (
    <details>
      <summary>Your conversation so far · {answers.length} answered</summary>
      {answers.map((a, i) => {
        const dialogue = dialogueEnabled
          ? readDialogueDraft(id, a.questionId)
          : null;
        return (
          <section key={a.answerId}>
            <h3>
              Question {i + 1} · {modes[a.evaluation.questionKind].title}
            </h3>
            <p>
              {questions[a.questionId] ??
                "Original question text is unavailable in this tab."}
            </p>
            {dialogue?.interactions.map((d) => (
              <blockquote key={d.id}>
                <p>
                  {d.kind === "clarification" ? "Clarification" : "Follow-up"} ·
                  Scripted fixture
                </p>
                {d.kind === "clarification" && (
                  <p>You asked: {dialogue.clarification}</p>
                )}
                {d.text}
                {d.kind === "follow_up" && dialogue.declined && (
                  <p>You chose to continue without answering this follow-up.</p>
                )}
              </blockquote>
            ))}
            <AnswerFeedback answer={a} />
          </section>
        );
      })}
    </details>
  );
}
