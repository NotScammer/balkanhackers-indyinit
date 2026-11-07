import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveAudio } from "../src/lib/client/live-audio";
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
  connectionState = "connected";
  ontrack: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() {
    peer = this;
  }
  addTrack() {}
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
  vi.unstubAllGlobals();
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
