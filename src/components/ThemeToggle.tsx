"use client";
import { useSyncExternalStore } from "react";
const key = "rehearsal:theme";
function subscribe(listener: () => void) {
  const sync = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    document.documentElement.dataset.theme =
      event.newValue === "light" ? "light" : "dark";
    listener();
  };
  window.addEventListener("storage", sync);
  window.addEventListener("rehearsal-theme", listener);
  return () => {
    window.removeEventListener("storage", sync);
    window.removeEventListener("rehearsal-theme", listener);
  };
}
const snapshot = () => document.documentElement.dataset.theme === "light";
export default function ThemeToggle() {
  const light = useSyncExternalStore(subscribe, snapshot, () => false);
  function toggle() {
    const theme = light ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(key, theme);
    } catch {
      /* Theme still works when storage is unavailable. */
    }
    window.dispatchEvent(new Event("rehearsal-theme"));
  }
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {light ? (
          <path d="M20.5 13A8.5 8.5 0 0111 3.5 8.5 8.5 0 1020.5 13Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          </>
        )}
      </svg>
      {light ? "Dark mode" : "Light mode"}
    </button>
  );
}
