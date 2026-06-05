"use client";

import { useState } from "react";

const inputCls =
  "px-3 py-2 border border-slate-300 rounded-md text-sm bg-white " +
  "focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none " +
  "hover:border-slate-400 transition-colors";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setSuccess(null);

    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (next === current) {
      setError("New password must be different from the current one.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Could not update password");
        return;
      }
      setSuccess("Password updated.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  const disabled = pending || !current || !next || !confirm;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-800">
          {success}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Current password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">New password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={inputCls}
        />
        <span className="text-xs text-slate-500">At least 8 characters.</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Confirm new password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputCls}
        />
      </label>

      <div className="pt-2">
        <button
          type="submit"
          disabled={disabled}
          className="px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white
                     hover:bg-brand-700 active:bg-brand-800
                     disabled:bg-slate-300 disabled:cursor-not-allowed
                     transition-colors shadow-sm"
        >
          {pending ? "Updating…" : "Update password"}
        </button>
      </div>
    </form>
  );
}
