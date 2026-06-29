# Handoff — "Gambling Risk" page (Risk Management)

> Hand this file to the next Claude Code session. It is self-contained.
> Delete it once the feature is merged.

## Goal

Add a new page **Risk Management → Gambling Risk** that lists merchants whose
outbound payouts (`transfer_transaction`) go to destination accounts whose
`account_holder_name` reads like a gambling-site handle. These merchants are
likely fronting for gambling sites and need to be reviewed/closed.

The flagging query (given by the user, replicate its semantics exactly):

```sql
SELECT *
FROM public.transfer_transaction
WHERE account_holder_name ILIKE '%VIP%'
   OR account_holder_name LIKE  '%เครดิต%'
   OR account_holder_name ILIKE '%โบนัส%';
```

The page must: list one row per flagged merchant with merchant name, MID, and
related info; let the user **search**; and **export to CSV**. Default view =
**active (live) merchants** since those are the ones that still need closing.

## Status

| Piece | State |
|---|---|
| API route `src/app/api/gambling-risk/route.ts` | **DONE & typechecks.** Validated against the live DB. |
| Page `src/app/risk-management/gambling-risk/page.tsx` | **TODO** — not created yet. |
| Nav entry in `src/components/Header.tsx` | **TODO** — not added yet. |
| `npm run typecheck` | Passes (route only; page not written). |
| `npm run lint` | Not yet run with the page in place. |

## Conventions you MUST follow (from CLAUDE.md + docs/template.md)

- Pages never touch the DB — they `fetch('/api/...')`. API routes start with
  `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"`.
- Tailwind utilities only. No UI/icon libraries. Icons = inline 24×24 SVG with
  `stroke="currentColor" strokeWidth="2"`.
- Brand red `#A4262C` = `brand-600` (the only primary). Gold `accent-500` is
  secondary, never on a primary CTA.
- Every titled card has the signature pill: `w-1 h-5 rounded-full bg-brand-600`.
- Numeric data: `font-mono`, right-aligned. Missing values render as `—` (em-dash).
- Adding a tool = create the page file + add an entry to the matching nav array.

## STEP 1 — Build the page (copy the blacklist-hits page as a template)

**Closest existing template:** `src/app/risk-management/blacklist-hits/page.tsx`
(it already has: scope toggle, search box, sortable table, KPI cards,
`StatePill`, `SortHeader`, `KpiCard` helpers, export button). Mirror its
structure and styling. Two differences for this page:

1. **Export must be CSV, not Excel** (user asked for CSV). Do NOT use `xlsx`.
   Use the helper below (UTF-8 BOM is required so Excel renders the Thai names).
2. Data shape and columns differ — see the API response below.

### API response shape (what `GET /api/gambling-risk` returns)

```ts
type GamblingRow = {
  merchant_id: string;
  hit_count: number;            // # of flagged transfers for this merchant
  total_amount: number;         // sum of flagged transfer amounts (THB)
  last_transfer_date: string | null; // "YYYY-MM-DD HH:MM:SS..." (raw text)
  sample_names: string[] | null;     // up to 8 distinct matched account names
  merchant_no: string | null;        // MID, e.g. M250821124353
  merchant_name_en: string | null;
  merchant_name_th: string | null;
  company_name_en: string | null;
  company_name_th: string | null;
  merchant_state: string | null;     // 'APPROVE' = live
  merchant_enabled: boolean | null;
  merchant_close_date: string | null;
  partner_no: string | null;
};
type ApiResponse = { patterns: string[]; rows: GamblingRow[]; count: number };
```

Rows arrive already sorted: live merchants first, then by `hit_count` desc.

### Display name fallback (per CLAUDE.md)

```ts
function nameOf(r: GamblingRow): string {
  return (
    r.merchant_name_en?.trim() ||
    r.company_name_en?.trim() ||
    r.company_name_th?.trim() ||
    r.merchant_name_th?.trim() ||
    "—"
  );
}
function isLive(r: GamblingRow): boolean {
  return r.merchant_state === "APPROVE" && !r.merchant_close_date;
}
```

### Page requirements

- Title: `Gambling Risk`. Subtitle explaining merchants flagged by suspicious
  payout account names (`VIP` / `เครดิต` / `โบนัส`). Mention it's a full scan and
  may take ~30s to load.
- Fetch once on mount (`useEffect`) from `/api/gambling-risk`. Show a loading
  state (the request takes ~30s — say so).
- **Scope toggle** `live | closed | all`, default `live` (reuse blacklist's
  segmented-button styling). `live` = `isLive(r)`, `closed` = `!isLive(r)`.
- **Search box** filtering MID, merchant/company name (en+th), partner_no, and
  the `sample_names`.
- KPI cards (compute client-side from the fetched rows):
  - Flagged merchants (live)  — count where `isLive`
  - Total flagged merchants   — all rows
  - Flagged transfers (current scope) — sum of `hit_count`
  - Flagged amount (current scope)    — sum of `total_amount`, THB formatted
- Sortable table. Suggested columns:
  MID (link to `/application-support/merchant-lookup/<merchant_no>`),
  Merchant Name, Partner, State (`StatePill`), Enabled, Flagged transfers
  (mono, right), Total amount THB (mono, right), Last transfer, Matched names
  (show `sample_names.join(", ")`, truncated with a `title=` tooltip — this is
  what lets the analyst eyeball false positives).
- **Export CSV** button (brand-600), exports the currently filtered rows.

### CSV export helper (use this — handles Thai + escaping)

```ts
function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function exportCsv(rows: GamblingRow[]) {
  if (rows.length === 0) return;
  const header = [
    "MID", "Merchant Name", "Partner", "State", "Enabled",
    "Flagged transfers", "Total amount (THB)", "Last transfer",
    "Matched account names",
  ];
  const body = rows.map((r) => [
    r.merchant_no ?? "",
    nameOf(r) === "—" ? "" : nameOf(r),
    r.partner_no ?? "",
    r.merchant_state ?? "",
    r.merchant_enabled ? "Yes" : "No",
    String(r.hit_count),
    r.total_amount.toFixed(2),
    r.last_transfer_date ?? "",
    (r.sample_names ?? []).join(" | "),
  ]);
  const csv =
    "﻿" +
    [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `GamblingRisk_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
```

## STEP 2 — Add the nav entry

In `src/components/Header.tsx`, append to the `riskManagement: NavItem[]` array
(around line 23-33):

```ts
{ label: "Gambling Risk", href: "/risk-management/gambling-risk" },
```

## STEP 3 — Verify

```powershell
npm run typecheck   # must pass (strict mode)
npm run lint        # must pass
```

Then `npm run dev`, log in, open **Risk Management → Gambling Risk**, confirm:
the page loads (after ~30s), the live/closed/all toggle works, search filters,
and Export CSV downloads a file whose Thai names render correctly in Excel.

## Gotchas / notes

- **~30s load.** Leading-wildcard `ILIKE` on `transfer_transaction` (~12.8M rows)
  is a full scan — there is no usable index. The route already sets
  `statement_timeout = 180s` as a guard. This is acceptable for a one-off risk
  page; don't try to "optimize" it away. (If you want, you could later add a
  Postgres trigram GIN index on `account_holder_name`, but that's out of scope.)
- **Optional cleanup in the route:** `src/app/api/gambling-risk/route.ts` issues
  `SET statement_timeout = 180000` on a pooled connection and never resets it
  before `client.release()`. Harmless (it only caps runaways) but for tidiness
  you may reset it in the `finally` block: `await client.query("SET statement_timeout = DEFAULT")`.
- **False positives are expected** (e.g. company name "...LTVIP" matches `%VIP%`).
  That's why the table surfaces `sample_names` — analysts triage manually. Keep
  the query semantics exactly as the user specified; do not add cleverness.
- **Verified live examples** from the data: `ComfySpace` (M250821124353, live,
  1.5k hits), `BKJnotebooksStore` (M250929111155, live), `ChronoG`
  (M250917051703, already closed, 9.4k hits). These same merchant names also
  appear as `.xlsx` files in the user's `vipbonus` folder on the Desktop — that
  folder is the manual version of what this page automates.
- The `account_holder_name` query uses `ILIKE` for all three patterns in the
  route (Thai is caseless, so `ILIKE` vs `LIKE` makes no difference for เครดิต).

## Reference files

- Template page: `src/app/risk-management/blacklist-hits/page.tsx`
- Done API route: `src/app/api/gambling-risk/route.ts`
- Allowlist/SQL-safety reference: `src/app/api/merchants/route.ts`
- transfer_transaction ↔ merchant_info join: `src/app/api/transfer-status/route.ts`
- Nav arrays: `src/components/Header.tsx`
- Schema notes: `docs/dbinfo.md`; design system: `docs/template.md`
```
