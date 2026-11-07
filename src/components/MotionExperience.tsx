"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribe = (listener: () => void) => {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const reducedSnapshot = () => window.matchMedia(motionQuery).matches;

export default function MotionExperience({
  children,
}: {
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const reduced = useSyncExternalStore(subscribe, reducedSnapshot, () => false);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const updateProgress = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const distance =
          document.documentElement.scrollHeight - window.innerHeight;
        element.style.setProperty(
          "--reading-progress",
          String(
            distance > 0
              ? Math.min(1, Math.max(0, window.scrollY / distance))
              : 0,
          ),
        );
      });
    };
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    updateProgress();

    // Content remains readable without JavaScript or IntersectionObserver.
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                (entry.target as HTMLElement).dataset.revealed = "true";
                observer?.unobserve(entry.target);
              });
            },
            { threshold: 0.06, rootMargin: "0px 0px -24px 0px" },
          );
    const observed = new WeakSet<Element>();
    const observeContent = () => {
      element
        .querySelectorAll<HTMLElement>("[data-reveal]")
        .forEach((target) => {
          if (observed.has(target)) return;
          observed.add(target);
          observer?.observe(target);
        });
      updateProgress();
    };
    if (observer) element.dataset.revealReady = "true";
    observeContent();
    const mutations = new MutationObserver(observeContent);
    mutations.observe(element, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
      delete element.dataset.revealReady;
    };
  }, []);

  return (
    <div
      className="motion-experience"
      data-motion={paused || reduced ? "paused" : "running"}
      ref={root}
    >
      <div className="reading-progress" aria-hidden="true" />
      {children}
      <button
        className="motion-toggle"
        type="button"
        aria-pressed={paused || reduced}
        aria-label={
          reduced
            ? "Animations disabled by your reduced-motion preference"
            : paused
              ? "Resume animations"
              : "Pause animations"
        }
        disabled={reduced}
        onClick={() => setPaused((value) => !value)}
      >
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="currentColor"
          aria-hidden="true"
        >
          {paused || reduced ? (
            <path d="m5 3 8 5-8 5Z" />
          ) : (
            <path d="M4 3h3v10H4zm5 0h3v10H9z" />
          )}
        </svg>
        {paused || reduced ? "Motion paused" : "Motion on"}
      </button>
    </div>
  );
}
