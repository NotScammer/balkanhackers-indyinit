"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { acquireMicrophone } from "../lib/client/media";
export type AudioStage =
  "idle" | "opening microphone" | "recording" | "reviewing recording";
export function recordingMime() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ].find((t) => MediaRecorder.isTypeSupported(t));
}
export function canRecord() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!recordingMime()
  );
}
export function useRecorder() {
  const [stage, setStage] = useState<AudioStage>("idle"),
    [blob, setBlob] = useState<Blob | null>(null),
    [url, setUrl] = useState<string | null>(null),
    [seconds, setSeconds] = useState(0),
    [level, setLevel] = useState(0),
    [error, setError] = useState("");
  const resources = useRef<{
    stream?: MediaStream;
    recorder?: MediaRecorder;
    context?: AudioContext;
    timer?: ReturnType<typeof setInterval>;
    cancel: boolean;
    dead: boolean;
    url?: string;
    opening: boolean;
    generation: number;
  }>({ cancel: false, dead: false, opening: false, generation: 0 });
  const release = useCallback(() => {
    const r = resources.current;
    r.stream?.getTracks().forEach((t) => t.stop());
    if (r.timer) clearInterval(r.timer);
    void r.context?.close().catch(() => {});
    r.stream = undefined;
    r.timer = undefined;
    r.context = undefined;
  }, []);
  const discard = useCallback(() => {
    const r = resources.current;
    if (r.url) URL.revokeObjectURL(r.url);
    r.url = undefined;
    setUrl(null);
    setBlob(null);
    setSeconds(0);
    setStage("idle");
    setLevel(0);
  }, []);
  const stop = useCallback((cancel = false) => {
    const r = resources.current;
    r.cancel = cancel;
    if (r.opening) {
      r.generation++;
      r.opening = false;
      setStage("idle");
      setError("Microphone request cancelled. You can type instead.");
    }
    if (r.recorder?.state === "recording") r.recorder.stop();
  }, []);
  const start = useCallback(
    async (limit: number, check = false) => {
      const r = resources.current;
      if (r.opening || r.recorder?.state === "recording") return;
      r.opening = true;
      const generation = ++r.generation;
      r.cancel = false;
      setError("");
      discard();
      setStage("opening microphone");
      try {
        const mime = recordingMime();
        if (!mime || !navigator.mediaDevices?.getUserMedia)
          throw Error(
            "Recording is unavailable in this browser. You can type your answer.",
          );
        if (limit <= 0)
          throw Error(
            "You have used the recording time for this question. You can still type.",
          );
        const stream = await acquireMicrophone(
          () => navigator.mediaDevices.getUserMedia({ audio: true }),
          () => !r.dead && r.generation === generation,
        );
        if (r.dead || r.generation !== generation) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        r.stream = stream;
        const recorder = new MediaRecorder(stream, { mimeType: mime });
        r.recorder = recorder;
        let analyser: AnalyserNode | undefined;
        try {
          r.context = new AudioContext();
          void r.context.resume().catch(() => {});
          analyser = r.context.createAnalyser();
          analyser.fftSize = 256;
          r.context.createMediaStreamSource(stream).connect(analyser);
        } catch {
          /* Recording remains usable if a meter is unavailable. */
        }
        const data = new Uint8Array(256),
          chunks: BlobPart[] = [];
        let size = 0;
        const begun = Date.now();
        recorder.ondataavailable = (e) => {
          if (!check) chunks.push(e.data);
          size += e.data.size;
          if (size > 25 * 1024 * 1024 && recorder.state === "recording")
            recorder.stop();
        };
        recorder.onstop = () => {
          const used = Math.min(limit, (Date.now() - begun) / 1000);
          release();
          if (r.dead) return;
          setLevel(0);
          if (r.cancel || check) {
            discard();
            if (check && !r.cancel)
              setError(
                "Microphone check finished. No audio was saved or uploaded.",
              );
            return;
          }
          setSeconds(used);
          const b = new Blob(chunks, { type: recorder.mimeType });
          setBlob(b);
          r.url = URL.createObjectURL(b);
          setUrl(r.url);
          setStage("reviewing recording");
          if (b.size > 25 * 1024 * 1024)
            setError(
              "This recording exceeds 25 MB. Discard it and record less, or type your answer.",
            );
        };
        recorder.onerror = () => {
          r.cancel = true;
          release();
          if (recorder.state === "recording") recorder.stop();
          if (!r.dead) {
            discard();
            setError(
              "The microphone stopped working. Try again or type your answer.",
            );
          }
        };
        recorder.start(250);
        setStage("recording");
        r.timer = setInterval(() => {
          if (r.dead) return;
          const used = (Date.now() - begun) / 1000;
          setSeconds(Math.min(limit, used));
          if (analyser) {
            analyser.getByteTimeDomainData(data);
            setLevel(
              Math.min(
                1,
                Math.sqrt(
                  data.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) /
                    data.length,
                ) * 4,
              ),
            );
          }
          if (used >= limit && recorder.state === "recording") recorder.stop();
        }, 100);
      } catch (e) {
        if (r.generation === generation) release();
        if (!r.dead && r.generation === generation) {
          setStage("idle");
          setError(
            e instanceof DOMException && e.name === "NotAllowedError"
              ? "Microphone permission was declined. You can type instead."
              : e instanceof Error
                ? e.message
                : "Could not open the microphone. You can type instead.",
          );
        }
      } finally {
        if (r.generation === generation) r.opening = false;
      }
    },
    [discard, release],
  );
  useEffect(() => {
    const r = resources.current;
    r.dead = false;
    return () => {
      r.dead = true;
      r.cancel = true;
      if (r.recorder?.state === "recording") r.recorder.stop();
      release();
      if (r.url) URL.revokeObjectURL(r.url);
    };
  }, [release]);
  return { stage, blob, url, seconds, level, error, start, stop, discard };
}
