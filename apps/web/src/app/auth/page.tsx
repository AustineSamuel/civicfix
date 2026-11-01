"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiRequest } from "@/lib/api";

type AuthResponse = {
  accessToken: string;
  user: { sub: string; email: string; roles: string[] };
};

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const formData = new FormData(event.currentTarget);
    const body = {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      ...(mode === "register" ? { displayName: String(formData.get("displayName") ?? "") } : {})
    };
    try {
      const result = await apiRequest<AuthResponse>(`/auth/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      window.sessionStorage.setItem("civicfix_token", result.accessToken);
      router.push("/reports/new");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="page-width max-w-2xl py-14">
      <p className="eyebrow">Resident account</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{mode === "register" ? "Create an account" : "Sign in"}</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">An account lets you submit reports and add evidence. Registration only creates a resident account; privileged roles are assigned by an administrator.</p>
      <form onSubmit={submit} className="mt-7 space-y-5 rounded-xl border border-[var(--line)] bg-white p-6 sm:p-8">
        {mode === "register" && (
          <label className="block text-sm font-medium">
            Display name
            <input name="displayName" required minLength={2} maxLength={80} autoComplete="name" className="focus-ring mt-2 h-11 w-full rounded-lg border border-[var(--line)] px-3" />
          </label>
        )}
        <label className="block text-sm font-medium">
          Email address
          <input name="email" type="email" required maxLength={254} autoComplete="email" className="focus-ring mt-2 h-11 w-full rounded-lg border border-[var(--line)] px-3" />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input name="password" type="password" required minLength={12} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} className="focus-ring mt-2 h-11 w-full rounded-lg border border-[var(--line)] px-3" />
          {mode === "register" && <span className="mt-1 block font-normal text-[var(--muted)]">Use at least 12 characters.</span>}
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <button disabled={pending} className="focus-ring w-full rounded-lg bg-[var(--green)] px-4 py-3 font-semibold text-white hover:bg-[var(--green-dark)] disabled:opacity-60">
          {pending ? "Please wait…" : mode === "register" ? "Create resident account" : "Sign in"}
        </button>
        <p className="text-center text-sm text-[var(--muted)]">
          {mode === "login" ? "New to CivicFix? " : "Already have an account? "}
          <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="focus-ring rounded font-semibold text-[var(--green)] underline underline-offset-2">
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </form>
      <p className="mt-4 text-center text-xs text-[var(--muted)]">Session token stays in this browser tab and expires after 15 minutes. Sign out by closing the tab.</p>
      <Link href="/" className="focus-ring mt-6 block rounded text-center text-sm text-[var(--muted)] underline underline-offset-2">Return to public reports</Link>
    </main>
  );
}
