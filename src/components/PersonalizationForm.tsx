"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/client/api";
import type {
  CandidateProfile,
  Personalization,
} from "@/shared/personalization";
const empty: CandidateProfile = {
  experience: [],
  projects: [],
  skills: [],
  accomplishments: [],
};
export default function PersonalizationForm({
  onStart,
  disabled,
}: {
  onStart: (context?: Personalization) => void;
  disabled: boolean;
}) {
  const [profile, setProfile] = useState<CandidateProfile>(empty);
  const [resume, setResume] = useState("");
  const [job, setJob] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request<CandidateProfile | null>("/profile")
      .then((p) => {
        if (active && p) setProfile(p);
      })
      .catch(() => {
        if (active)
          setError(
            "Could not load your saved profile. You can still start without personalization.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function extract(file?: File) {
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      if (file && file.size > 4 * 1024 * 1024)
        throw Error("Resume must be at most 4 MiB.");
      const form = new FormData();
      if (file) form.append("file", file);
      const result = await request<CandidateProfile>("/profile/extract", {
        method: "POST",
        body: file ? form : JSON.stringify({ text: resume }),
      });
      setProfile(result);
      setResume("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not read your resume. Paste up to 30,000 characters and retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await request("/profile", { method: "DELETE" });
      setProfile(empty);
      setConfirmed(false);
      setResume("");
    } catch {
      setError("Could not remove your saved profile. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setError("");
    try {
      const clean = Object.fromEntries(
        Object.entries(profile).map(([key, values]) => [
          key,
          values.map((v) => v.trim()).filter(Boolean),
        ]),
      ) as CandidateProfile;
      await request("/profile", { method: "PUT", body: JSON.stringify(clean) });
      onStart({ profile: clean, jobDescription: job });
    } catch {
      setError(
        "Could not save your profile. Please retry or start without personalization.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="personalization-form"
      aria-labelledby="personalization-heading"
    >
      <h3 id="personalization-heading">
        Make it personal <span className="fine">(optional)</span>
      </h3>
      <p>
        Use your experience to shape questions. Your confirmed summary is saved
        to your account. Uploads and extracted source text are discarded after
        processing. Resume text goes to Claude to create the summary.
      </p>
      <fieldset disabled={busy || disabled}>
        <label>
          Resume (PDF or DOCX, up to 4 MiB)
          <input
            type="file"
            accept=".pdf,.docx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void extract(file);
              e.target.value = "";
            }}
          />
        </label>
        <label>
          Or paste your experience
          <textarea
            maxLength={30000}
            value={resume}
            onChange={(e) => setResume(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!resume.trim()}
          onClick={() => void extract()}
        >
          Create editable summary
        </button>
        {(Object.keys(empty) as (keyof CandidateProfile)[]).map((key) => (
          <label key={key}>
            {key[0].toUpperCase() + key.slice(1)} (one item per line)
            <textarea
              value={profile[key].join("\n")}
              onChange={(e) => {
                setConfirmed(false);
                setProfile({ ...profile, [key]: e.target.value.split("\n") });
              }}
            />
          </label>
        ))}
        <label>
          Job description for this interview
          <textarea
            maxLength={30000}
            value={job}
            onChange={(e) => setJob(e.target.value)}
          />
        </label>
        <label className="profile-confirmation">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I reviewed this summary and confirm it can be saved and used for my
          interview.
        </label>
        <button type="button" onClick={() => void remove()}>
          Remove saved profile
        </button>
        <p className="fine">
          Profile changes apply to future interviews. Existing interviews keep
          their context until you delete those interviews.
        </p>
      </fieldset>
      {busy && <p role="status">Preparing your profile…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="consent-actions">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => onStart()}
        >
          Agree and start without personalization
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || disabled || !confirmed}
          onClick={() => void start()}
        >
          Save profile and start interview
        </button>
      </div>
    </section>
  );
}
