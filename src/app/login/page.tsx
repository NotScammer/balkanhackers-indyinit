"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import NotebookShell from "../../components/NotebookShell";
import {
  accountPreview,
  safeReturnPath,
} from "../../lib/client/account-preview";
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const enter = () => {
    accountPreview.continueAsGuest();
    router.push(
      safeReturnPath(
        new URLSearchParams(window.location.search).get("returnTo"),
      ),
    );
  };
  return (
    <NotebookShell practice="Welcome">
      <p className="eyebrow">A place to practice</p>
      <h1>Come as you are.</h1>
      <p>
        You don’t need an account to work through an interview. Choose a focus,
        take your time, and see what you can improve.
      </p>
      <button className="primary" onClick={enter}>
        Continue as guest
      </button>
      <p className="fine">
        Guest practice stays in this browser tab. An account will eventually let
        you keep your history across visits.
      </p>
      <hr />
      <h2>Save your practice, later</h2>
      <p className="notice">
        Account preview · Real sign-in, account creation, and saved history are
        not connected yet.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            setMessage((await accountPreview.requestEmailLink(email)).message);
            setEmail("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button disabled={busy}>Preview email sign-in / create account</button>
      </form>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </NotebookShell>
  );
}
