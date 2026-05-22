"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type NavItem = {
  label: string;
  href?: string;
  disabled?: boolean;
};

export function NavDropdown({ label, items }: { label: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors inline-flex items-center gap-1.5"
      >
        {label}
        <svg
          viewBox="0 0 24 24"
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 w-60 bg-white border border-slate-200/80 rounded-lg shadow-cardHover py-1 z-40"
        >
          {items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-400">No items yet</div>
          ) : (
            items.map((it) =>
              it.href && !it.disabled ? (
                <Link
                  key={it.label}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  role="menuitem"
                >
                  {it.label}
                </Link>
              ) : (
                <div
                  key={it.label}
                  className="px-3 py-2 text-sm text-slate-400 cursor-not-allowed flex items-center justify-between"
                  role="menuitem"
                  aria-disabled
                >
                  <span>{it.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">soon</span>
                </div>
              ),
            )
          )}
        </div>
      )}
    </div>
  );
}
