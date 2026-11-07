import { spokenControl } from "@/shared/live";

/** A short quiet window joins adjacent VAD segments without changing their question. */
export class LiveTurnBuffer {
  private segments: { questionId: string; transcript: string }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private speaking = false;
  constructor(
    private answer: (questionId: string, transcript: string) => void,
    private control: (action: "repeat" | "pause" | "finish") => void,
    private changed: (
      segments: { questionId: string; transcript: string }[],
    ) => void,
  ) {}
  restore(segments: { questionId: string; transcript: string }[]) {
    this.segments = segments;
  }
  speech(active: boolean) {
    this.speaking = active;
    clearTimeout(this.timer);
    if (!active) this.schedule();
  }
  add(questionId: string, transcript: string) {
    const command = spokenControl(transcript);
    if (command) {
      this.flush();
      if (command !== "handoff") this.control(command);
      return;
    }
    const handoff =
      /[.!?,]\s+(?:i['’]?m done|i am done|done answering|that['’]?s my answer)[.!?]*$/i;
    const hasHandoff = handoff.test(transcript);
    if (hasHandoff) transcript = transcript.replace(handoff, "").trim();
    const last = this.segments.at(-1);
    if (last?.questionId === questionId) last.transcript += ` ${transcript}`;
    else this.segments.push({ questionId, transcript });
    this.changed([...this.segments]);
    if (hasHandoff) this.flush();
    else this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.speaking && this.segments.length)
      this.timer = setTimeout(() => this.flush(), 1000);
  }
  get pending() {
    return this.segments.length > 0;
  }
  flush() {
    clearTimeout(this.timer);
    const saved = this.segments;
    this.segments = [];
    // Enqueue durably before removing the draft from storage.
    for (const segment of saved)
      this.answer(segment.questionId, segment.transcript);
    this.changed([]);
  }
  dispose() {
    clearTimeout(this.timer);
  }
}
