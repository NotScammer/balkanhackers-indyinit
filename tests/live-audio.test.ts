import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveAudio } from "../src/lib/client/live-audio";
import { LiveTurnBuffer } from "../src/lib/client/live-turn-buffer";
import { spokenControl } from "../src/shared/live";
class Channel {
  readyState = "open";
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = "closed";
  }
  addEventListener() {}
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}
let peer: Peer;
let channel: Channel;
class Peer {
  sender = { replaceTrack: vi.fn().mockResolvedValue(undefined) };
  addTransceiver = vi.fn();
  connectionState = "connected";
  ontrack: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() {
    peer = this;
  }
  addTrack() {
    return this.sender;
  }
  createDataChannel() {
    channel = new Channel();
    return channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "test-sdp" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {
    this.connectionState = "closed";
  }
}
const track = { enabled: true, stop: vi.fn() };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
let callbacks = {
  questionId: vi.fn<() => string | null>().mockReturnValue("question-one"),
  onTranscript: vi.fn(),
  onPartial: vi.fn(),
  onStatus: vi.fn(),
  onError: vi.fn(),
  onPlaybackEnd: vi.fn(),
  onDisconnected: vi.fn(),
};
let connection: LiveAudio;
beforeEach(() => {
  vi.clearAllMocks();
  track.enabled = true;
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("sdp-answer")));
  callbacks = {
    questionId: vi.fn<() => string | null>().mockReturnValue("question-one"),
    onTranscript: vi.fn(),
    onPartial: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onPlaybackEnd: vi.fn(),
    onDisconnected: vi.fn(),
  };
  connection = new LiveAudio(
    {
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      srcObject: null,
    } as unknown as HTMLAudioElement,
    callbacks,
  );
});
afterEach(() => {
  connection.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("plays a recap with receive-only audio without requesting microphone permission", async () => {
  await connection.connect(
    "recap-token",
    "Your practice score is 80 out of 100.",
    false,
  );
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(peer.addTransceiver).toHaveBeenCalledWith("audio", {
    direction: "recvonly",
  });
  channel.onopen!();
  channel.emit({ type: "output_audio_buffer.started" });
  channel.emit({ type: "response.done", response: { status: "completed" } });
  channel.emit({ type: "output_audio_buffer.stopped" });
  expect(callbacks.onPlaybackEnd).toHaveBeenCalledOnce();
});

it("stops capture immediately but waits for in-flight transcription before finishing", async () => {
  await connection.connect("test", "Question");
  channel.onopen!();
  channel.emit({
    type: "input_audio_buffer.speech_started",
    item_id: "last-words",
  });
  const settling = connection.settleInput();
  let settled = false;
  void settling.then(() => {
    settled = true;
  });
  expect(track.stop).toHaveBeenCalled();
  expect(channel.sent).toContainEqual({ type: "input_audio_buffer.commit" });
  expect(channel.sent).toContainEqual({ type: "response.cancel" });
  await Promise.resolve();
  expect(settled).toBe(false);
  channel.emit({ type: "input_audio_buffer.committed", item_id: "last-words" });
  channel.emit({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "last-words",
    transcript: "My final important point.",
  });
  await settling;
  expect(callbacks.onTranscript).toHaveBeenCalledWith(
    "last-words",
    "My final important point.",
    "question-one",
  );
  expect(settled).toBe(true);
});

it("reacquires a stopped microphone on resume without creating another peer or token", async () => {
  await connection.connect("test", "Question");
  const originalPeer = peer;
  await connection.settleInput();
  await connection.resumeInput();
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  expect(peer).toBe(originalPeer);
  expect(peer.sender.replaceTrack).toHaveBeenCalledWith(track);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps capture stopped after a denied resume and stops late streams after cancellation", async () => {
  await connection.connect("test", "Question");
  await connection.settleInput();
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
    Error("Permission denied"),
  );
  await expect(connection.resumeInput()).rejects.toThrow("Permission denied");
  let resolve!: (value: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const resuming = connection.resumeInput();
  connection.close();
  resolve(stream as unknown as MediaStream);
  await expect(resuming).rejects.toThrow("cancelled");
  expect(track.stop).toHaveBeenCalled();
});

it("blocks finishing when the last transcription fails rather than omitting it", async () => {
  await connection.connect("test", "Question");
  channel.emit({
    type: "input_audio_buffer.speech_started",
    item_id: "failed",
  });
  channel.emit({ type: "input_audio_buffer.committed", item_id: "failed" });
  const settling = connection.settleInput();
  channel.emit({
    type: "conversation.item.input_audio_transcription.failed",
    item_id: "failed",
  });
  await expect(settling).rejects.toThrow("Resume and repeat");
  await expect(connection.settleInput()).rejects.toThrow("Resume and repeat");
  await connection.resumeInput();
  channel.emit({
    type: "input_audio_buffer.speech_started",
    item_id: "replacement",
  });
  channel.emit({
    type: "input_audio_buffer.speech_stopped",
    item_id: "replacement",
  });
  channel.emit({
    type: "input_audio_buffer.committed",
    item_id: "replacement",
  });
  channel.emit({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "replacement",
    transcript: "Repeated missing words.",
  });
  await expect(connection.settleInput()).resolves.toBeUndefined();
});

it("does not treat a disconnect during final transcription as a successful finish", async () => {
  await connection.connect("test", "Question");
  channel.emit({ type: "input_audio_buffer.speech_started", item_id: "late" });
  const settling = connection.settleInput();
  connection.close();
  await expect(settling).rejects.toThrow(
    "disconnected before your last words were saved",
  );
});

it("flushes an explicit handoff at the end of an answer without scoring the cue", () => {
  vi.useFakeTimers();
  const answer = vi.fn();
  const buffer = new LiveTurnBuffer(
    answer,
    () => {},
    () => {},
  );
  buffer.add("one", "I measured latency. I'm done.");
  expect(answer).toHaveBeenCalledWith("one", "I measured latency");
  expect(buffer.pending).toBe(false);
});

it("joins short voice segments patiently and preserves each speech-start question", () => {
  vi.useFakeTimers();
  const answer = vi.fn(),
    control = vi.fn(),
    changed = vi.fn();
  const buffer = new LiveTurnBuffer(answer, control, changed);
  buffer.add("one", "First thought.");
  vi.advanceTimersByTime(600);
  buffer.speech(true);
  vi.advanceTimersByTime(1500);
  expect(answer).not.toHaveBeenCalled();
  buffer.speech(false);
  buffer.add("one", "More detail.");
  buffer.add("two", "Another question.");
  vi.advanceTimersByTime(1000);
  expect(answer.mock.calls).toEqual([
    ["one", "First thought. More detail."],
    ["two", "Another question."],
  ]);
  expect(buffer.pending).toBe(false);
  buffer.dispose();
});

it("flushes pending words before a finish command and consumes handoff cues without scoring them", () => {
  vi.useFakeTimers();
  const order: string[] = [];
  const buffer = new LiveTurnBuffer(
    (_question, text) => order.push(text),
    (action) => order.push(action),
    () => {},
  );
  buffer.add("one", "My saved answer.");
  buffer.add("one", "I'm done.");
  expect(order).toEqual(["My saved answer."]);
  buffer.add("one", "A final detail.");
  buffer.add("one", "Finish interview.");
  expect(order).toEqual(["My saved answer.", "A final detail.", "finish"]);
  vi.runAllTimers();
  expect(order).toHaveLength(3);
  buffer.dispose();
});

it("preserves buffered drafts on disposal and restores them with their original question", () => {
  vi.useFakeTimers();
  const answer = vi.fn(),
    changed = vi.fn();
  const buffer = new LiveTurnBuffer(answer, () => {}, changed);
  buffer.add("original", "Preserved before refresh.");
  buffer.dispose();
  vi.runAllTimers();
  expect(answer).not.toHaveBeenCalled();
  const restored = new LiveTurnBuffer(
    answer,
    () => {},
    () => {},
  );
  restored.restore(changed.mock.lastCall![0]);
  restored.flush();
  expect(answer).toHaveBeenCalledWith("original", "Preserved before refresh.");
});

it("matches whole spoken commands without interpreting command-like narrative as a control", () => {
  expect(spokenControl("Could you repeat the question please?")).toBe("repeat");
  expect(spokenControl("Can you pause the interview please?")).toBe("pause");
  expect(spokenControl("Finish my interview.")).toBe("finish");
  expect(spokenControl("I'm done!")).toBe("handoff");
  expect(
    spokenControl("I am done with that project, so we can discuss the result."),
  ).toBeNull();
  expect(
    spokenControl("I asked the interviewer to repeat the question."),
  ).toBeNull();
});
it("negotiates WebRTC using a short-lived credential and reads only approved text without candidate context", async () => {
  await connection.connect("ephemeral-test", "Approved question");
  channel.onopen!();
  expect(fetch).toHaveBeenCalledWith(
    "https://api.openai.com/v1/realtime/calls",
    expect.objectContaining({
      headers: {
        Authorization: "Bearer ephemeral-test",
        "Content-Type": "application/sdp",
      },
    }),
  );
  const event = channel.sent.find((e) => e.type === "response.create")!;
  expect(event.response).toMatchObject({
    input: [],
    output_modalities: ["audio"],
  });
  expect(JSON.stringify(event)).toContain("Approved question");
});
it("orders asynchronous transcripts by committed audio and deduplicates completed events", async () => {
  await connection.connect("test", "Question");
  for (const id of ["a", "b"]) {
    channel.emit({ type: "input_audio_buffer.speech_started", item_id: id });
    channel.emit({ type: "input_audio_buffer.committed", item_id: id });
  }
  channel.emit({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "b",
    transcript: "Second",
  });
  expect(callbacks.onTranscript).not.toHaveBeenCalled();
  channel.emit({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "a",
    transcript: "First",
  });
  channel.emit({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "a",
    transcript: "First",
  });
  expect(callbacks.onTranscript.mock.calls).toEqual([
    ["a", "First", "question-one"],
    ["b", "Second", "question-one"],
  ]);
});
it("interrupts speech and clears queued audio when the candidate starts talking", async () => {
  await connection.connect("test", "Question");
  channel.onopen!();
  channel.emit({ type: "input_audio_buffer.speech_started", item_id: "a" });
  expect(channel.sent).toContainEqual({ type: "response.cancel" });
  expect(channel.sent).toContainEqual({ type: "output_audio_buffer.clear" });
});
it("mutes microphone tracks and releases every resource on disconnect", async () => {
  await connection.connect("test", "Question");
  connection.mute(true);
  expect(track.enabled).toBe(false);
  connection.mute(false);
  expect(track.enabled).toBe(true);
  connection.close();
  expect(track.stop).toHaveBeenCalled();
  expect(peer.connectionState).toBe("closed");
  expect(channel.readyState).toBe("closed");
});
it("stops late microphone streams after a cancelled connection", async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  });
  const opening = connection.connect("test", "Question");
  connection.close();
  resolve(stream);
  await expect(opening).rejects.toThrow(/cancelled/);
  expect(track.stop).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("disconnects and offers recovery when the peer connection fails", async () => {
  await connection.connect("test", "Question");
  peer.connectionState = "failed";
  peer.onconnectionstatechange!();
  expect(track.stop).toHaveBeenCalled();
  expect(callbacks.onDisconnected).toHaveBeenCalled();
  expect(callbacks.onError).toHaveBeenCalledWith(
    expect.stringContaining("Reconnect"),
  );
});
