"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { safeReturnPath } from "@/lib/auth-paths";
import { clearInterviewStorage } from "@/lib/client/account";
export default function AccountMenu({ returnTo }: { returnTo?: string }) {
  const [user, setUser] = useState<{ email: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) setUser((await response.json()).user);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!user)
    return (
      <Link
        href={`/login?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`}
        className="account-link"
      >
        Sign in
      </Link>
    );
  return (
    <form
      action="/auth/logout"
      method="post"
      className="account-link"
      onSubmit={() => clearInterviewStorage(sessionStorage)}
    >
      <span>{user.email ?? "Signed in"}</span>{" "}
      <button type="submit">Sign out</button>
    </form>
  );
}
