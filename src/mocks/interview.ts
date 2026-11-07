import type {
  AnswerResult,
  Catalog,
  InterviewApi,
  InterviewMode,
  Question,
  QuestionKind,
  Session,
  SessionReport,
  Setup,
  Submission,
  Submitted,
} from "../lib/client/contracts";
const prompts: Record<QuestionKind, string[]> = {
  behavioral: [
    "Describe a technical disagreement with a teammate. What did you do, and what happened?",
    "Tell me about taking ownership of a problem outside your assignment.",
    "Describe a decision that did not work out and what you changed afterward.",
  ],
  technical: [
    "Explain what happens when a browser requests a secure web page.",
    "A database-backed page becomes slow. How would you investigate and choose an improvement?",
    "Explain how caching improves an API and how you would handle stale data.",
  ],
  system_design: [
    "Design a small order notification service. Explain the main flow and failure handling.",
    "Design a URL-shortening service. Explain storage, resolution, and one scaling concern.",
    "Design rate limiting for a public API. Explain identity, counting, and rejection.",
  ],
};
const modes: InterviewMode[] = [
  "behavioral",
  "technical",
  "system_design",
  "mixed",
];
export const fixtureCatalog: Catalog = {
  companies: [{ id: "google", name: "Google" }],
  roles: [{ id: "software-engineer", name: "Software Engineer" }],
  availableInterviews: modes.map((round) => ({
    companyId: "google",
    roleId: "software-engineer",
    round,
  })),
};
export function fixtureQuestions(round: InterviewMode): Question[] {
  return [0, 1, 2].map((i) => {
    const kind: QuestionKind =
      round === "mixed"
        ? (["behavioral", "technical", "system_design"] as const)[i]
        : round;
    return {
      id: `${kind}-${i}`,
      text: prompts[kind][i],
      kind,
      topic: kind.replace("_", " "),
      maxAnswerSeconds: { behavioral: 180, technical: 300, system_design: 600 }[
        kind
      ],
      origin: "curated",
      sourceLabel: "README practice fixture",
    };
  });
}
interface Stored {
  session: Session;
  questions: Question[];
  setup: Setup;
  token: string;
  submissions: Record<string, { payload: string; result: Submitted }>;
  report?: SessionReport;
}
const key = (id: string) => `fixture:${id}`;
function read(id: string): Stored {
  const raw = sessionStorage.getItem(key(id));
  if (!raw) throw Error("Session unavailable. Start a new practice.");
  const s: Stored = JSON.parse(raw);
  if (
    Date.parse(s.session.expiresAt) < Date.now() ||
    sessionStorage.getItem(`token:mock:${id}`) !== s.token
  )
    throw Error("Session unavailable or expired. Start a new practice.");
  return s;
}
function save(s: Stored) {
  sessionStorage.setItem(key(s.session.sessionId), JSON.stringify(s));
}
export const mockApi: InterviewApi = {
  async catalog() {
    return fixtureCatalog;
  },
  async create(setup) {
    const id = crypto.randomUUID(),
      token = crypto.randomUUID(),
      questions = fixtureQuestions(setup.round);
    const session: Session = {
      sessionId: id,
      round: setup.round,
      status: "active",
      currentTurn: {
        question: questions[0],
        questionNumber: 1,
        totalQuestions: 3,
      },
      answers: [],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    save({ session, questions, setup, token, submissions: {} });
    return { ...session, sessionToken: token };
  },
  async session(id) {
    return read(id).session;
  },
  async submit(id, a: Submission) {
    const s = read(id),
      payload = JSON.stringify(a);
    if (s.submissions[a.clientAnswerId]) {
      if (s.submissions[a.clientAnswerId].payload !== payload)
        throw Error("Retry payload changed. Reload session.");
      return s.submissions[a.clientAnswerId].result;
    }
    const q = s.session.currentTurn?.question;
    if (!q || q.id !== a.questionId)
      throw Error("Question out of order. Reload session.");
    if (!a.transcript.trim() || a.transcript.length > 10000)
      throw Error("Enter 1–10,000 characters.");
    const answer: AnswerResult = {
      answerId: crypto.randomUUID(),
      questionId: q.id,
      transcript: a.transcript,
      evaluation: {
        rubricVersion: `${q.kind}-v1`,
        questionKind: q.kind,
        scores: { content: 75, structure: 75, relevance: 75 },
        overallScore: 75,
        evidence: [
          {
            category: "content",
            quote: a.transcript.slice(0, 100),
            explanation:
              "Illustrative excerpt only; fixture mode does not assess answer quality.",
          },
        ],
        strengths: [
          "Example feedback: explain your reasoning in a clear sequence.",
        ],
        improvements: [
          "Example coaching: add a specific outcome and a trade-off.",
        ],
        suggestedAnswerOutline: [
          "State context and assumptions",
          "Explain your decisions",
          "Describe the outcome or validation",
        ],
      },
    };
    s.session.answers.push(answer);
    const i = s.session.answers.length;
    s.session.currentTurn =
      i < 3
        ? { question: s.questions[i], questionNumber: i + 1, totalQuestions: 3 }
        : null;
    s.session.status = i === 3 ? "completed" : "active";
    const result: Submitted = {
      sessionId: id,
      status: s.session.status,
      answer,
      nextTurn: s.session.currentTurn,
    };
    s.submissions[a.clientAnswerId] = { payload, result };
    if (i === 3)
      s.report = {
        sessionId: id,
        status: "completed",
        completedAt: new Date().toISOString(),
        round: s.session.round,
        overallScore: 75,
        categoryAverages: { content: 75, structure: 75, relevance: 75 },
        answers: s.session.answers,
        strengths: ["Illustrative report — no AI scoring has occurred."],
        nextSteps: [
          "Practice making your assumptions explicit.",
          "Include a measurable outcome or validation step.",
        ],
      };
    save(s);
    return result;
  },
  async report(id) {
    const s = read(id);
    if (!s.report)
      throw Error("Complete all three answers to see your report.");
    return s.report;
  },
  async transcribe() {
    throw Error(
      "Fixture mode has no transcription provider. Use a typed answer to continue.",
    );
  },
  async speech() {
    throw Error(
      "Fixture mode has no speech provider. Read the question above.",
    );
  },
  async delete(id) {
    read(id);
    sessionStorage.removeItem(key(id));
  },
};
