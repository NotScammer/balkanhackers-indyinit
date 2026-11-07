import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InterviewRoom } from "../src/components/LiveInterview";
import type { useLiveInterview } from "../src/hooks/useLiveInterview";
import type { LiveView } from "../src/shared/live";

const question = {
  id: "question",
  text: "Explain your individual contribution.",
  kind: "behavioral" as const,
  difficulty: "intermediate" as const,
  topic: "Teamwork",
  maxAnswerSeconds: 180,
  origin: "generated" as const,
  sourceLabel: "Generated practice",
  forecastId: null,
  evidenceIds: [],
  isFollowUp: false,
};
const view: LiveView = {
  sessionId: "session",
  revision: 0,
  status: "active",
  expiresAt: "2027-01-01T00:00:00Z",
  mainNumber: 1,
  totalMainQuestions: 3,
  followUpNumber: 0,
  currentQuestion: question,
  messages: [],
  spokenText: question.text,
  report: null,
  dataMode: "verified",
};
const defaults: ReturnType<typeof useLiveInterview> = {
  view,
  error: "",
  status: "Listening",
  connected: true,
  connecting: false,
  paused: false,
  busy: false,
  finishing: false,
  finishFailed: false,
  recapPlaying: false,
  partial: "",
  pending: [],
  editing: null,
  correction: "",
  attachAudio: () => {},
  pause: async () => {},
  resume: async () => {},
  finish: async () => {},
  nextTopic: async () => {},
  disconnect: () => {},
  playRecap: async () => {},
  deleteSession: async () => {},
  saveCorrection: () => {},
  setEditing: () => {},
  setCorrection: () => {},
  repeat: () => {},
  retry: async () => true,
  enablePlayback: () => {},
};
const render = (overrides: Partial<typeof defaults> = {}) =>
  renderToStaticMarkup(
    createElement(InterviewRoom, { room: { ...defaults, ...overrides } }),
  );

test("the active room centers speech and keeps transcripts in a closed optional panel", () => {
  const html = render();
  assert.match(html, /The floor is yours/);
  assert.match(html, />Pause<\/button>/);
  assert.match(html, />Repeat<\/button>/);
  assert.match(html, /Finish &amp; review/);
  assert.match(
    html,
    /<details class="live-history"><summary>Question, captions &amp; transcript/,
  );
  assert.doesNotMatch(html, /bigscore|Latest coaching notes|Category averages/);
  assert.match(html, /role="status"/);
});

test("paused and finishing states make microphone status and available controls clear", () => {
  assert.match(render({ paused: true }), /MICROPHONE OFF/);
  assert.match(render({ paused: true }), />Resume<\/button>/);
  assert.match(
    render({ finishing: true, paused: true }),
    /Bringing it all together/,
  );
  assert.match(
    render({ finishing: true }),
    /class="finish-interview" disabled=""/,
  );
});

test("an early report labels coverage and provides microphone-free recap controls", () => {
  const report = {
    sessionId: "session",
    status: "completed" as const,
    completedAt: "2026-11-07T00:00:00Z",
    round: "mixed" as const,
    overallScore: 83,
    categoryAverages: { content: 85, structure: 80, relevance: 84 },
    answers: [],
    strengths: ["Clear explanation"],
    nextSteps: ["Add evidence"],
    dataMode: "verified" as const,
    coverage: {
      answeredMainQuestions: 1,
      plannedMainQuestions: 3,
      finishedEarly: true,
    },
  };
  const html = render({
    view: { ...view, status: "completed", currentQuestion: null, report },
    recapPlaying: true,
    paused: true,
  });
  assert.match(html, /Finished early/);
  assert.match(html, /1 of 3 main questions answered/);
  assert.match(html, /Unanswered questions are excluded/);
  assert.match(html, /class="bigscore">83/);
  assert.match(html, /spoken recap · microphone off/);
  assert.match(html, />Skip recap<\/button>/);
  assert.doesNotMatch(html, /Three questions, completed/);
});

test("older reports without coverage metadata remain readable", () => {
  const report = {
    sessionId: "session",
    status: "completed" as const,
    completedAt: "2026-11-07T00:00:00Z",
    round: "mixed" as const,
    overallScore: 83,
    categoryAverages: { content: 85, structure: 80, relevance: 84 },
    answers: [],
    strengths: [],
    nextSteps: [],
    dataMode: "verified" as const,
  };
  assert.match(
    render({
      view: { ...view, status: "completed", report, currentQuestion: null },
    }),
    /A few notes for next time/,
  );
});

test("zero-answer completion does not render scores or a fabricated report", () => {
  const html = render({
    view: { ...view, status: "cancelled", currentQuestion: null },
  });
  assert.match(html, /Your interview has ended/);
  assert.doesNotMatch(html, /bigscore|Category averages|Play recap/);
});
