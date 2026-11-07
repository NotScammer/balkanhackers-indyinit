"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, tokenKey, RequestError } from "../lib/client/api";
import {
  liveRequestSchema,
  reportRecap,
  type LiveRequest,
  type LiveView,
} from "@/shared/live";
import { LiveAudio } from "../lib/client/live-audio";
import { LiveTurnBuffer } from "../lib/client/live-turn-buffer";
import { liveApi } from "../lib/client/live-api";

export function useLiveInterview(id: string) {
  const router = useRouter();
  const [view, setView] = useState<LiveView | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Opening your interview");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);
  const [recapPlaying, setRecapPlaying] = useState(false);
  const [partial, setPartial] = useState("");
  const [pending, setPending] = useState<LiveRequest[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const current = useRef<LiveView | null>(null);
  const mounted = useRef(true);
  const audioElement = useRef<HTMLAudioElement>(null);
  const attachAudio = useCallback((element: HTMLAudioElement | null) => {
    audioElement.current = element;
  }, []);
  const audio = useRef<LiveAudio | null>(null);
  const queue = useRef<LiveRequest[]>([]);
  const processing = useRef<Promise<boolean> | null>(null);
  const pausedRef = useRef(false);
  const finalizing = useRef(false);
  const finishWanted = useRef(false);
  const connectingRef = useRef(false);
  const generation = useRef(0);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = `live-pending:${id}`;
  const pauseKey = `live-paused:${id}`;
  const draftKey = `live-draft:${id}`;
  const finishKey = `live-finish:${id}`;
  const [buffer] = useState(
    () =>
      new LiveTurnBuffer(
        (questionId, transcript) =>
          enqueue({
            kind: "utterance",
            clientRequestId: crypto.randomUUID(),
            revision: current.current?.revision ?? 0,
            questionId,
            transcript,
          }),
        (action) => {
          if (action === "finish") void finish();
          else if (action === "pause") void pause();
          else control("repeat");
        },
        (segments) =>
          sessionStorage.setItem(draftKey, JSON.stringify(segments)),
      ),
  );

  function update(next: LiveView) {
    current.current = next;
    if (mounted.current) setView(next);
  }
  function persist() {
    sessionStorage.setItem(key, JSON.stringify(queue.current));
    if (mounted.current) setPending([...queue.current]);
  }
  function markPaused(value: boolean) {
    pausedRef.current = value;
    sessionStorage.setItem(pauseKey, String(value));
    if (mounted.current) setPaused(value);
  }
  function disconnect() {
    generation.current++;
    audio.current?.close();
    audio.current = null;
    connectingRef.current = false;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    if (mounted.current) {
      setConnected(false);
      setConnecting(false);
      setRecapPlaying(false);
    }
  }
  function enqueue(input: LiveRequest) {
    queue.current.push(input);
    persist();
    void processQueue();
  }
  function control(action: "repeat" | "pause" | "finish" | "next_topic") {
    if (!current.current) return;
    enqueue({
      kind: "control",
      clientRequestId: crypto.randomUUID(),
      revision: current.current.revision,
      action,
    });
  }
  function processQueue(): Promise<boolean> {
    if (processing.current) return processing.current;
    if (!queue.current.length || !mounted.current) return Promise.resolve(true);
    setBusy(true);
    setError("");
    const run = async () => {
      try {
        while (queue.current.length && mounted.current) {
          const input = queue.current[0];
          const result = await liveApi.turn(id, input);
          const next =
            current.current && result.revision < current.current.revision
              ? await liveApi.get(id)
              : result;
          if (!mounted.current) return false;
          update(next);
          queue.current.shift();
          if (queue.current.length)
            queue.current[0] = { ...queue.current[0], revision: next.revision };
          persist();
          if (next.control === "pause") {
            markPaused(true);
            audio.current?.stopMicrophone();
            audio.current?.stopPlayback();
          }
          if (
            next.status === "active" &&
            !queue.current.length &&
            !buffer.pending &&
            !pausedRef.current &&
            !finalizing.current
          )
            audio.current?.speak(next.spokenText);
          if (next.status !== "active") audio.current?.stopMicrophone();
        }
        return true;
      } catch (e) {
        if (mounted.current) {
          markPaused(true);
          audio.current?.stopMicrophone();
          audio.current?.stopPlayback();
          setError(
            e instanceof Error
              ? e.message
              : "Could not save your words. They are preserved for retry.",
          );
          if (e instanceof RequestError && e.code === "QUESTION_OUT_OF_ORDER") {
            const fresh = await liveApi.get(id).catch(() => null);
            if (fresh && mounted.current) {
              update(fresh);
              const input = queue.current[0];
              if (input && fresh.revision > input.revision) {
                // A stale revision did not commit this request. Keep its speech-start context.
                queue.current[0] = {
                  ...input,
                  revision: fresh.revision,
                  clientRequestId: crypto.randomUUID(),
                };
                persist();
              }
            }
          }
        }
        return false;
      } finally {
        processing.current = null;
        if (mounted.current) setBusy(false);
      }
    };
    processing.current = run();
    void processing.current.then((ok) => {
      if (
        ok &&
        mounted.current &&
        current.current?.status === "completed" &&
        !finalizing.current
      )
        void finish();
    });
    return processing.current;
  }
  async function pause(saveControl = true) {
    markPaused(true);
    audio.current?.stopMicrophone();
    audio.current?.stopPlayback();
    if (connectingRef.current) disconnect();
    try {
      await audio.current?.settleInput();
      if (!mounted.current) return;
      buffer.flush();
      if (saveControl && current.current?.status === "active") control("pause");
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "Could not save your last words. Retry before continuing.",
        );
    }
  }
  async function resume() {
    if (
      processing.current ||
      queue.current.length ||
      finalizing.current ||
      connectingRef.current
    )
      return;
    finishWanted.current = false;
    sessionStorage.removeItem(finishKey);
    setFinishFailed(false);
    setError("");
    if (!audio.current) {
      await connect();
      return;
    }
    connectingRef.current = true;
    const attempt = generation.current;
    const connection = audio.current;
    const valid = () =>
      mounted.current &&
      attempt === generation.current &&
      audio.current === connection;
    setConnecting(true);
    try {
      await connection.resumeInput();
      if (!valid()) return;
      markPaused(false);
      control("repeat");
    } catch (e) {
      if (valid())
        setError(
          e instanceof Error
            ? e.message
            : "Microphone access was denied. Try Resume again.",
        );
    } finally {
      if (valid()) {
        connectingRef.current = false;
        setConnecting(false);
      }
    }
  }
  async function finish() {
    if (finalizing.current || !mounted.current) return;
    finalizing.current = true;
    finishWanted.current = true;
    sessionStorage.setItem(finishKey, "true");
    setFinishing(true);
    setFinishFailed(false);
    markPaused(true);
    setError("");
    if (connectingRef.current) disconnect();
    try {
      await audio.current?.settleInput();
      if (!mounted.current) return;
      buffer.flush();
      if (!(await processQueue()))
        throw Error(
          "Your words are preserved. Retry finishing to save them before reviewing.",
        );
      if (current.current?.status === "active") {
        if (
          !queue.current.some(
            (input) => input.kind === "control" && input.action === "finish",
          )
        )
          control("finish");
        if (!(await processQueue()))
          throw Error(
            "Could not finish your interview. Retry with your saved progress.",
          );
      }
      if (!mounted.current) return;
      sessionStorage.removeItem(finishKey);
      finishWanted.current = false;
      if (current.current?.status === "completed") await playRecap();
      else disconnect();
    } catch (e) {
      if (mounted.current) {
        setFinishFailed(true);
        setError(
          e instanceof Error
            ? e.message
            : "Could not finish. Your saved answers are preserved.",
        );
      }
    } finally {
      finalizing.current = false;
      if (mounted.current) setFinishing(false);
    }
  }
  async function playRecap() {
    const report = current.current?.report;
    if (!report || !mounted.current) return;
    setError("");
    setRecapPlaying(true);
    if (audio.current) {
      audio.current.stopMicrophone();
      audio.current.stopPlayback();
      audio.current.speak(reportRecap(report));
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(disconnect, 60000);
    } else await connect(true);
  }
  async function connect(recap = false) {
    if (
      connectingRef.current ||
      !current.current ||
      (recap
        ? current.current.status !== "completed"
        : current.current.status !== "active")
    )
      return;
    connectingRef.current = true;
    const attempt = ++generation.current;
    const valid = () => mounted.current && attempt === generation.current;
    setConnecting(true);
    setError("");
    try {
      const fresh = await liveApi.get(id);
      if (!valid()) return;
      update(fresh);
      const token = await liveApi.token(id, recap ? "recap" : "interview");
      if (!valid() || !audioElement.current) return;
      const connection = new LiveAudio(audioElement.current, {
        questionId: () => current.current?.currentQuestion?.id ?? null,
        onTranscript: (_itemId, text, questionId) => {
          if (valid() && questionId) buffer.add(questionId, text);
        },
        onPartial: (delta) => {
          if (valid())
            setPartial((previous) => (delta ? previous + delta : ""));
        },
        onSpeech: (active) => buffer.speech(active),
        onStatus: (next) => {
          if (valid()) setStatus(next);
        },
        onPlaybackEnd: () => {
          if (current.current?.status === "completed") disconnect();
        },
        onDisconnected: () => {
          if (valid()) {
            markPaused(true);
            buffer.flush();
            setConnected(false);
            setRecapPlaying(false);
            audio.current = null;
          }
        },
        onError: (message) => {
          if (valid()) setError(message);
        },
      });
      audio.current?.close();
      audio.current = connection;
      await connection.connect(
        token.clientSecret,
        recap && fresh.report
          ? reportRecap(fresh.report)
          : fresh.revision === 0
            ? fresh.spokenText
            : `Welcome back. ${fresh.currentQuestion?.text ?? ""}`,
        !recap,
      );
      if (!valid()) {
        connection.close();
        return;
      }
      setConnected(true);
      setRecapPlaying(recap);
      if (!recap) {
        markPaused(false);
        if (queue.current.length || finishWanted.current) {
          markPaused(true);
          connection.stopMicrophone();
          connection.stopPlayback();
        }
      }
      const remaining = Math.min(
        recap ? 60000 : 30 * 60 * 1000,
        Date.parse(fresh.expiresAt) - Date.now(),
      );
      expiryTimer.current = setTimeout(
        () => {
          void pause(false).finally(() => {
            disconnect();
            if (mounted.current)
              setStatus(
                "Audio disconnected. Reconnect to continue your saved interview.",
              );
          });
        },
        Math.max(0, remaining),
      );
    } catch (e) {
      if (valid()) {
        disconnect();
        markPaused(true);
        setError(
          e instanceof Error
            ? e.message
            : "Audio could not connect. Your saved progress is available.",
        );
      }
    } finally {
      if (attempt === generation.current) {
        connectingRef.current = false;
        if (mounted.current) setConnecting(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const connectionGeneration = generation;
    const load = async () => {
      try {
        const savedQueue = JSON.parse(sessionStorage.getItem(key) ?? "[]");
        queue.current = Array.isArray(savedQueue)
          ? savedQueue
              .map((item) => liveRequestSchema.safeParse(item))
              .filter((item) => item.success)
              .map((item) => item.data!)
          : [];
        persist();
        const savedDraft = JSON.parse(sessionStorage.getItem(draftKey) ?? "[]");
        if (Array.isArray(savedDraft))
          buffer.restore(
            savedDraft.filter(
              (segment) =>
                typeof segment?.questionId === "string" &&
                typeof segment?.transcript === "string",
            ),
          );
        const next = await liveApi.get(id);
        if (!active) return;
        update(next);
        finishWanted.current = sessionStorage.getItem(finishKey) === "true";
        setFinishFailed(finishWanted.current);
        if (finishWanted.current)
          setError(
            "Finishing was interrupted. Retry finishing to save any remaining words and prepare your recap.",
          );
        const shouldPause =
          sessionStorage.getItem(pauseKey) === "true" ||
          next.control === "pause" ||
          queue.current.length > 0 ||
          buffer.pending ||
          finishWanted.current;
        markPaused(shouldPause);
        setStatus(
          next.status === "active"
            ? "Ready when you are"
            : "Interview finished",
        );
        const autoStart = sessionStorage.getItem(`autostart:${id}`) === "true";
        sessionStorage.removeItem(`autostart:${id}`);
        if (autoStart && !shouldPause && next.status === "active")
          void connect();
        if (buffer.pending) buffer.flush();
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not open your interview.",
          );
      }
    };
    void load();
    return () => {
      active = false;
      mounted.current = false;
      connectionGeneration.current++;
      buffer.dispose();
      audio.current?.close();
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
    // The room is keyed by session; callbacks read current state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, buffer]);

  async function deleteSession() {
    disconnect();
    setBusy(true);
    try {
      await api.delete(id);
      [key, pauseKey, draftKey, finishKey, tokenKey(id)].forEach((entry) =>
        sessionStorage.removeItem(entry),
      );
      router.push("/");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not delete the session.",
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function saveCorrection() {
    if (!editing || !correction.trim() || !current.current) return;
    enqueue({
      kind: "correct",
      clientRequestId: crypto.randomUUID(),
      revision: current.current.revision,
      answerId: editing,
      transcript: correction.trim(),
    });
    setEditing(null);
  }
  return {
    view,
    error,
    status,
    connected,
    connecting,
    paused,
    busy,
    finishing,
    finishFailed,
    recapPlaying,
    partial,
    pending,
    editing,
    correction,
    attachAudio,
    pause,
    resume,
    finish,
    disconnect,
    playRecap,
    deleteSession,
    saveCorrection,
    setEditing,
    setCorrection,
    nextTopic: async () => {
      const mainNumber = current.current?.mainNumber;
      await pause(false);
      if (await processQueue() && current.current?.mainNumber === mainNumber) control("next_topic");
    },
    repeat: () => {
      buffer.flush();
      control("repeat");
    },
    retry: () => (finishWanted.current ? finish() : processQueue()),
    enablePlayback: () => {
      void audioElement.current
        ?.play()
        .catch(() =>
          setError("Check your browser’s audio playback permissions."),
        );
    },
  };
}
