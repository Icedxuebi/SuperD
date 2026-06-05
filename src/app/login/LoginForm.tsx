"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Sign in failed");
        setPending(false);
        return;
      }
      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
      setPending(false);
    }
  }

  const disabled = pending || !username || !password;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Username</span>
        <input
          type="text"
          name="username"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none
                     hover:border-slate-400 transition-colors"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none
                     hover:border-slate-400 transition-colors"
        />
      </label>

      <button
        type="submit"
        disabled={disabled}
        className="w-full inline-flex items-center justify-center px-4 py-2.5
                   bg-brand-600 text-white text-sm font-medium rounded-md
                   hover:bg-brand-700 active:bg-brand-800
                   disabled:bg-slate-300 disabled:cursor-not-allowed
                   transition-colors shadow-sm"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
