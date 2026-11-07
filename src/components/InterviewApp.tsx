"use client";
import LiveInterview from "./LiveInterview";
import AppShell from "./AppShell";
import SetupView from "./SetupView";
export default function InterviewApp({
  sessionId,
}: {
  sessionId?: string;
  results?: boolean;
}) {
  return sessionId ? (
    <LiveInterview key={sessionId} id={sessionId} />
  ) : (
    <AppShell>
      <SetupView />
    </AppShell>
  );
}
