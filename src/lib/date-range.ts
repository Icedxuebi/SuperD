import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from "date-fns";

/**
 * Format a "YYYY-MM-DD" string as "19 May 2026" without timezone shifts.
 * Parsing manually keeps it date-only (avoids UTC-vs-local-day drift).
 */
export function formatReportDate(s: string): string {
  if (!s) return "—";
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return s;
  return format(new Date(y, m - 1, d), "d MMMM yyyy");
}

/** Same but short month abbreviation: "19 May 2026" / "17 Sep 2026" */
export function formatReportDateShort(s: string): string {
  if (!s) return "—";
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return s;
  return format(new Date(y, m - 1, d), "d MMM yyyy");
}

/** Parse YYYY-MM-DD into a local-tz Date (no timezone drift). */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toISO(d: Date): string {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Returns YYYY-MM-DD of the Monday on or before the given date. */
export function weekStartOf(dateISO: string): string {
  const date = parseLocalDate(dateISO);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  return toISO(date);
}

/** Returns YYYY-MM-01 of the given date's month. */
export function monthStartOf(dateISO: string): string {
  const [y, m] = dateISO.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** "13 May – 19 May 2026" — compact when same month/year, expands when crossing boundaries. */
export function formatWeekRange(weekStartISO: string): string {
  const start = parseLocalDate(weekStartISO);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${format(start, "d")} – ${format(end, "d MMMM yyyy")}`;
  }
  if (sameYear) {
    return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
  }
  return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
}

/** "May 2026" */
export function formatMonth(monthStartISO: string): string {
  return format(parseLocalDate(monthStartISO), "MMMM yyyy");
}

export type FilterMode = "date" | "week" | "month";

export interface DateRange {
  from: Date;
  to: Date;
}

export function rangeForToday(mode: FilterMode, anchor: Date = new Date()): DateRange {
  switch (mode) {
    case "week":
      return {
        from: startOfWeek(anchor, { weekStartsOn: 1 }),
        to: endOfWeek(anchor, { weekStartsOn: 1 }),
      };
    case "month":
      return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
    case "date":
    default:
      return { from: anchor, to: anchor };
  }
}

export function fmt(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function parseDateOrNull(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
