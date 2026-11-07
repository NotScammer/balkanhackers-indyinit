import type { InterviewMode } from "./contracts";

export type CompanyGroup = "big-tech" | "mid-sized" | "ai-labs";
export interface ProcessRound {
  label: string;
  detail: string;
  count: number | null;
  mode: Exclude<InterviewMode, "mixed">;
}
export interface CompanyGuide {
  id: string;
  name: string;
  group: CompanyGroup;
  sector: string;
  scope: string;
  summary: string;
  rounds: ProcessRound[];
  note: string;
  source?: { label: string; url: string; published?: string };
}

export const companyGroups: {
  id: CompanyGroup;
  title: string;
  description: string;
}[] = [
  {
    id: "big-tech",
    title: "Big tech",
    description: "Engineering at a global scale.",
  },
  {
    id: "mid-sized",
    title: "Mid-sized companies",
    description: "Product teams with a more focused footprint.",
  },
  {
    id: "ai-labs",
    title: "AI labs",
    description: "Research meets production engineering.",
  },
];

// Editorial snapshots, checked November 7, 2026. A null count means the
// source does not establish a fixed number of interviews in that category.
// Company groups are browsing categories, not employee-count claims.
export const companyGuides: CompanyGuide[] = [
  {
    id: "google",
    name: "Google",
    group: "big-tech",
    sector: "Search · Cloud · Platforms",
    scope: "Technical candidate guide",
    summary: "Coding & design interviews",
    rounds: [
      {
        label: "Technical",
        detail: "Coding & problem solving",
        count: null,
        mode: "technical",
      },
      {
        label: "Systems",
        detail: "Design discussions · role dependent",
        count: null,
        mode: "system_design",
      },
    ],
    note: "The virtual interview guide covers coding and design formats, but does not publish a fixed round breakdown. Ask your recruiter for your specific loop.",
    source: {
      label: "Google · Technical interview guide",
      url: "https://services.google.com/fh/files/misc/technical_virtual_interviews_candidate_resource.pdf",
    },
  },
  {
    id: "microsoft",
    name: "Microsoft",
    group: "big-tech",
    sector: "Cloud · Enterprise · AI",
    scope: "Engineering interview guide",
    summary: "Technical + experience discussions",
    rounds: [
      {
        label: "Behavioural",
        detail: "Experience & role-related scenarios",
        count: null,
        mode: "behavioral",
      },
      {
        label: "Technical",
        detail: "Coding, testing & CS fundamentals",
        count: null,
        mode: "technical",
      },
      {
        label: "Systems",
        detail: "Architecture & distributed systems",
        count: null,
        mode: "system_design",
      },
    ],
    note: "Published topics include coding, testing, design and past experience. These are areas assessed, not a confirmed sequence of separate interviews.",
    source: {
      label: "Microsoft · Technical interviewing",
      url: "https://careers.microsoft.com/v2/global/en/hiring-tips/technical-interviewing",
    },
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    group: "big-tech",
    sector: "GPUs · Systems · AI infrastructure",
    scope: "Company hiring overview",
    summary: "Team interviews + technical exercise",
    rounds: [
      {
        label: "Team discussions",
        detail: "Hiring manager & prospective peers",
        count: null,
        mode: "behavioral",
      },
      {
        label: "Technical",
        detail: "Coding exercise · role dependent",
        count: null,
        mode: "technical",
      },
    ],
    note: "NVIDIA describes phone interviews followed by virtual or in-person interviews. Technical roles may include coding; the number and format vary by team.",
    source: {
      label: "NVIDIA · How we hire",
      url: "https://www.nvidia.com/en-gb/about-nvidia/careers/how-we-hire/",
    },
  },
  {
    id: "monzo",
    name: "Monzo",
    group: "mid-sized",
    sector: "Fintech · Consumer banking",
    scope: "Backend engineer · 2022 account",
    summary: "1 behavioural · 2 technical · 1 systems",
    rounds: [
      {
        label: "Behavioural",
        detail: "Experience & collaboration",
        count: 1,
        mode: "behavioral",
      },
      {
        label: "Technical",
        detail: "Take-home coding + code review",
        count: 2,
        mode: "technical",
      },
      {
        label: "Systems",
        detail: "System design discussion",
        count: 1,
        mode: "system_design",
      },
    ],
    note: "A Monzo engineer's historical account: recruiter call, take-home exercise, code-review discussion, then systems and behavioural interviews. The technical count includes the take-home assessment. This is one account, not a universal current loop.",
    source: {
      label: "Monzo · Engineer's interview account",
      url: "https://monzo.com/blog/2022/02/17/my-first-6-months-at-monzo-as-a-backend-engineer",
      published: "2022",
    },
  },
  {
    id: "gitlab",
    name: "GitLab",
    group: "mid-sized",
    sector: "Developer tools · DevSecOps",
    scope: "Generalist engineering · India pilot",
    summary: "1 behavioural · 2 technical + assessment",
    rounds: [
      {
        label: "Assessment",
        detail: "CodeSignal take-home",
        count: 1,
        mode: "technical",
      },
      {
        label: "Technical",
        detail: "Two live coding interviews",
        count: 2,
        mode: "technical",
      },
      {
        label: "Behavioural",
        detail: "Hiring manager & engineering judgment",
        count: 1,
        mode: "behavioral",
      },
    ],
    note: "Published generalist process: recruiter screen, take-home, two technical interviews, hiring manager, then debrief and team matching. The handbook describes an India-only pilot; specialist roles use a different process.",
    source: {
      label: "GitLab · Generalist engineering hiring",
      url: "https://handbook.gitlab.com/handbook/engineering/workflow/hiring/generalist-hiring/",
      published: "Updated Oct 20, 2026",
    },
  },
  {
    id: "ziprecruiter",
    name: "ZipRecruiter",
    group: "mid-sized",
    sector: "Hiring marketplace · Matching",
    scope: "Historical process not yet sourced",
    summary: "Practice available · history pending",
    rounds: [],
    note: "A sourced historical round breakdown has not been added yet. You can still choose company-context practice in the interview setup above.",
  },
  {
    id: "openai",
    name: "OpenAI",
    group: "ai-labs",
    sector: "AI research · Products",
    scope: "Published engineering hiring guide",
    summary: "4–6 final interviews · format varies",
    rounds: [
      {
        label: "Technical",
        detail: "Engineering solutions, code & tests",
        count: null,
        mode: "technical",
      },
      {
        label: "Collaboration",
        detail: "Communication & problem solving",
        count: null,
        mode: "behavioral",
      },
    ],
    note: "The published guide describes 4–6 hours with 4–6 people in the final stage. It does not assign fixed counts to each interview type. The guide also describes introductory calls and skills assessments.",
    source: {
      label: "OpenAI · Interview guide",
      url: "https://openai.com/interview-guide/",
    },
  },
  {
    id: "anthropic",
    name: "Anthropic",
    group: "ai-labs",
    sector: "AI safety · Research · Products",
    scope: "Company hiring overview",
    summary: "Live coding + experience discussions",
    rounds: [
      {
        label: "Technical",
        detail: "Live coding · technical roles",
        count: null,
        mode: "technical",
      },
      {
        label: "Behavioural",
        detail: "Experience & motivation",
        count: null,
        mode: "behavioral",
      },
    ],
    note: "The careers page describes live coding for technical roles and discussions of experience and motivation. A fixed round count is not published; formats depend on the role.",
    source: {
      label: "Anthropic · How we hire",
      url: "https://www.anthropic.com/careers",
    },
  },
];
