import type { InterviewMode } from "./contracts";
export const modes: Record<
  InterviewMode,
  { title: string; description: string; limit: string }
> = {
  behavioral: {
    title: "Behavioral",
    description:
      "Talk through your experiences, choices, and what you learned.",
    limit: "3 minutes",
  },
  technical: {
    title: "Technical",
    description:
      "Explain how things work and how you would investigate a problem.",
    limit: "5 minutes",
  },
  system_design: {
    title: "System design",
    description: "Describe a small system and explain the trade-offs.",
    limit: "10 minutes",
  },
  mixed: {
    title: "Mixed",
    description: "One question from each of the three practice types.",
    limit: "3, 5, and 10 minutes",
  },
};
export type InterviewPhase =
  | "loading"
  | "ready"
  | "playing question"
  | "recording"
  | "reviewing recording"
  | "transcribing"
  | "reviewing transcript"
  | "evaluating"
  | "feedback"
  | "complete";
export function highlightParts(
  text: string,
  quotes: string[],
): { text: string; marked: boolean }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const quote of quotes) {
    if (!quote) continue;
    let start = 0;
    while ((start = text.indexOf(quote, start)) !== -1) {
      ranges.push({ start, end: start + quote.length });
      start += quote.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const parts: { text: string; marked: boolean }[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor)
      parts.push({ text: text.slice(cursor, r.start), marked: false });
    parts.push({ text: text.slice(r.start, r.end), marked: true });
    cursor = r.end;
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), marked: false });
  return parts;
}
export function remainingSeconds(limit: number, used: number) {
  return Math.max(0, limit - used);
}
