"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // even if the request fails, kick the user back to /login
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-700
                 hover:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed
                 transition-colors inline-flex items-center gap-1.5"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M15 17l5-5-5-5M20 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      </svg>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
