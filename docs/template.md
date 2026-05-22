# Anypay Top Merchant — Design System Template

Hand this file to another Claude session and it will be able to rebuild a new
Next.js app with the same visual style, layout conventions, and UI primitives
as this dashboard. It captures **styling only** — not business logic.

---

## 1. Stack & setup

- **Framework:** Next.js 15 (App Router, `src/app/...`)
- **React:** 19
- **Styling:** Tailwind CSS 3.4 (no UI library — plain Tailwind utilities + small inline SVGs)
- **Charts:** `recharts` 2.x (only when charts are needed)
- **Spreadsheets:** `xlsx` (only for the export-Excel button pattern)
- **Fonts:** system / Next.js default (no custom font import)
- **Icons:** **inline SVG only**, 24×24 viewBox, `stroke="currentColor"`, `strokeWidth="2"`, `strokeLinecap="round" strokeLinejoin="round"`. No icon library.

`package.json` dependencies (trim to what the new app needs):

```json
{
  "dependencies": {
    "next": "^15.0.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "recharts": "^2.13.3",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.15",
    "typescript": "^5.6.3"
  }
}
```

---

## 2. Color palette (the heart of the style)

Brand red + restrained gold accent, on a cool slate-gray neutral canvas.
The brand-red is used for primary CTAs, headers, focus rings, and the leading
chart series; gold is used **sparingly** as a secondary highlight only.

Drop this **as-is** into `tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#fdf3f4",
          100: "#fbe1e3",
          200: "#f5bdc1",
          300: "#ed8d93",
          400: "#dc5f66",
          500: "#c03d44",
          600: "#A4262C", // primary
          700: "#8a1f24",
          800: "#6f1a1f",
          900: "#4d1216",
        },
        accent: {
          50:  "#fdf8ec",
          100: "#fbeec6",
          400: "#e6b430",
          500: "#d4a017", // primary gold
          600: "#b88712",
        },
        canvas: "#F8FAFC",
      },
      boxShadow: {
        card:      "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)",
        cardHover: "0 4px 12px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};
export default config;
```

### Neutral usage (built-in Tailwind slate)

| Role                     | Class                                  |
| ------------------------ | -------------------------------------- |
| Page background          | `bg-canvas` (#F8FAFC)                  |
| Card / panel background  | `bg-white`                             |
| Card border              | `border border-slate-200/80`           |
| Subtle divider           | `border-slate-100` or `border-slate-200` |
| Heading text             | `text-slate-900` (or `text-slate-800`) |
| Body text                | `text-slate-700`                       |
| Muted / secondary text   | `text-slate-500` (`text-slate-600` for slightly stronger) |
| Disabled                 | `bg-slate-300 text-slate-500`          |

### Chart palette (recharts `Cell` / `Line` stroke)

Use this exact ordering — brand red leads, gold supports, then cool tones:

```ts
const COLORS = [
  "#A4262C", "#d4a017", "#475569", "#2563eb", "#0891b2",
  "#059669", "#7c3aed", "#db2777", "#ea580c", "#1e293b",
];
// For pie charts we extend with two more: "#94a3b8", "#c03d44"
```

### Status colors (built-in Tailwind palettes)

| State    | Bg                  | Text                |
| -------- | ------------------- | ------------------- |
| Success  | `bg-emerald-50` / `bg-emerald-100` | `text-emerald-600` / `text-emerald-700` |
| Warning  | `bg-amber-50` / `bg-amber-100`     | `text-amber-600` / `text-amber-700`     |
| Error    | `bg-red-50` / `bg-red-100`         | `text-red-600` / `text-red-700`         |
| Info / progress | `bg-brand-50` / `bg-brand-100` | `text-brand-600` / `text-brand-700`     |

---

## 3. Global CSS

`src/app/globals.css` — verbatim:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body {
  background: #F8FAFC;
  color: #0f172a;
}

/* Subtle scrollbar styling to match the cool, restrained palette */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 999px;
}
::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

/* Focus ring uses the brand red */
*:focus-visible {
  outline: 2px solid #A4262C;
  outline-offset: 2px;
}
```

---

## 4. Layout shell (header + page container)

Sticky top header, max-w-7xl content column, generous vertical padding.

```tsx
// src/app/layout.tsx
import "./globals.css";
import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "<App Name>",
  description: "<one-line>",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas">
        <header className="bg-white border-b border-slate-200/80 shadow-card sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3 group">
              <Image src="/logo.png" alt="Logo" width={140} height={42} priority className="h-9 w-auto" />
              <span className="hidden sm:inline-block h-7 w-px bg-slate-200" />
              <span className="hidden sm:inline-block text-sm font-semibold text-slate-700 tracking-tight">
                <App Name>
              </span>
            </Link>

            <nav className="flex items-center gap-1">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/reports">Reports</NavLink>
              <Link
                href="/primary-action"
                className="px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-sm"
              >
                Primary Action
              </Link>
            </nav>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
    >
      {children}
    </Link>
  );
}
```

**Rules:**
- Header is always white, sticky, with `shadow-card` + `border-b border-slate-200/80`.
- Logo on the left, vertical divider (`h-7 w-px bg-slate-200`), app name in `text-sm font-semibold text-slate-700`.
- Right-side nav: secondary links are ghost buttons (`hover:bg-slate-100`); the **single** primary CTA in the header is solid brand-red.
- Main content always wrapped in `<main className="max-w-7xl mx-auto px-6 py-8">`.

---

## 5. Page-header convention

Every page opens with:

```tsx
<div className="space-y-6">
  <div>
    <h1 className="text-3xl font-bold text-slate-900 mb-1">Page Title</h1>
    <p className="text-slate-600">Short one-line subtitle describing the current view.</p>
  </div>
  {/* filters / content below */}
</div>
```

`space-y-6` between major sections is the standard rhythm.

---

## 6. Card primitive (the universal container)

Every panel — summary cards, charts, tables, form sections — uses the same
card recipe:

```tsx
<div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
  <div className="flex items-center gap-2 mb-4">
    <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
    <h3 className="text-lg font-semibold text-slate-800">Section title</h3>
  </div>
  {/* body */}
</div>
```

**Recipe:**
- `bg-white`, `border border-slate-200/80`, `rounded-xl`, `shadow-card`
- Padding: `p-5` for chart/data cards, `p-6` for form sections
- Hoverable variant adds `hover:shadow-cardHover transition-shadow`
- **Section header signature:** a tiny vertical pill (`w-1 h-5 rounded-full`) in `bg-brand-600` (primary), `bg-accent-500` (secondary), or `bg-slate-700` (neutral), followed by `text-lg font-semibold text-slate-800`. This is the most distinctive visual motif — use it on every titled card.

### Summary / KPI card (with left accent bar + icon)

```tsx
<div className="relative bg-white border border-slate-200/80 rounded-xl p-5 shadow-card hover:shadow-cardHover transition-shadow overflow-hidden">
  <span className="absolute left-0 top-0 bottom-0 w-1 bg-brand-600" aria-hidden />
  <div className="flex items-start justify-between">
    <div className="text-sm font-medium text-slate-500">{label}</div>
    <div className="p-2 rounded-lg bg-brand-50 text-brand-600">{icon}</div>
  </div>
  <div className="mt-3 text-2xl font-bold text-slate-900 truncate">{value}</div>
  {sub && <div className="text-sm text-slate-500 mt-1">{sub}</div>}
</div>
```

Layout: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4` for a row of 4 KPIs.

Accent-bar colors rotate through `bg-brand-600`, `bg-accent-500`, `bg-slate-700`, `bg-brand-400` (or repeat brand-600 if all metrics are the same family). Icon bubble matches: `bg-brand-50 text-brand-600`, `bg-accent-50 text-accent-600`, `bg-slate-100 text-slate-700`.

---

## 7. Buttons

| Variant     | Classes |
| ----------- | ------- |
| **Primary** | `px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm` |
| **Primary, large CTA** | same but `px-6 py-3` and `font-medium` |
| **Ghost / nav** | `px-4 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors` |
| **Subtle link** | `text-brand-600 hover:text-brand-700 hover:underline` |
| **Tertiary icon-button** | `text-slate-400 hover:text-red-600 p-1` (e.g. remove-row "×") |

Buttons always include `shadow-sm` when solid, `transition-colors`, and a `disabled:` state.

---

## 8. Form controls

All inputs share the same skeleton — borders are `slate-300`, focus is brand red.

```tsx
// text / number / date inputs and selects
<input
  type="text"
  className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white
             focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none
             hover:border-slate-400 transition-colors"
/>
```

Compact variants in toolbars use `px-3 py-1.5`.

### Labeled field wrapper

```tsx
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
```

Field grids: `grid grid-cols-1 md:grid-cols-2 gap-4` (or `md:grid-cols-3`).

### Section wrapper (numbered form sections)

```tsx
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200/80 rounded-xl p-6 shadow-card">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
```

Typical usage: `<Section title="1. Section name" subtitle="What this is for">`.

### Segmented tab control (used on filter bars)

```tsx
<div className="inline-flex gap-1 bg-slate-100 rounded-lg p-1">
  {options.map((m) => (
    <button
      key={m}
      onClick={() => setMode(m)}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
        mode === m
          ? "bg-white shadow-sm text-brand-700"
          : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {label(m)}
    </button>
  ))}
</div>
```

The active tab is a "lifted" white pill (`bg-white shadow-sm`) with brand-red text on a slate-100 track.

### Filter bar container

```tsx
<div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-center gap-4">
  {/* segmented control */}
  {/* selectors */}
  <div className="ml-auto text-sm text-slate-500 flex items-center gap-1.5">
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
    Live status text
  </div>
</div>
```

Right-aligned status dot uses `bg-brand-500 animate-pulse`.

---

## 9. Drag-and-drop upload zone

```tsx
<label
  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
  onDragLeave={() => setIsDragging(false)}
  onDrop={handleDrop}
  className={`block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
    isDragging
      ? "border-brand-600 bg-brand-50"
      : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/40"
  }`}
>
  <input type="file" className="sr-only" />
  <div className="flex flex-col items-center gap-3">
    <div className="p-3 rounded-full bg-brand-50 text-brand-600">{/* inline SVG upload icon */}</div>
    <div>
      <div className="font-semibold text-slate-800">Drop files here, or click to browse</div>
      <div className="text-xs text-slate-500 mt-1">Helper text</div>
    </div>
  </div>
</label>
```

Queue list directly below:

```tsx
<div className="border border-slate-200 rounded-lg overflow-hidden">
  <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
    <div className="text-sm font-medium text-slate-700">
      {n} file{n === 1 ? "" : "s"} queued
      <span className="ml-2 text-emerald-600">• {ok} done</span>
      <span className="ml-2 text-red-600">• {fail} failed</span>
      <span className="ml-2 text-amber-600">• {bad} invalid</span>
    </div>
    <button className="text-xs text-slate-500 hover:text-slate-700">Clear all</button>
  </div>
  <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">{/* rows */}</ul>
</div>
```

---

## 10. Data table

```tsx
<div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
  <div className="flex items-center justify-between p-5 border-b border-slate-200">
    <div className="flex items-center gap-2">
      <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
      <h3 className="text-lg font-semibold text-slate-800">Table title</h3>
    </div>
    <input
      type="search"
      placeholder="Search..."
      className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-64
                 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
    />
  </div>
  <div className="overflow-x-auto max-h-[600px]">
    <table className="w-full text-sm">
      <thead className="bg-slate-50 sticky top-0">
        <tr className="text-left text-slate-600 border-b border-slate-200">
          <th className="px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900">
            Column ↑
          </th>
          {/* numeric columns: add `text-right` */}
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-slate-100 hover:bg-slate-50">
          <td className="px-4 py-2 font-medium text-slate-800">…</td>
          <td className="px-4 py-2 font-mono text-xs">…</td>          {/* IDs */}
          <td className="px-4 py-2 text-right font-mono font-medium">…</td>  {/* numbers */}
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

**Conventions:**
- Header row: `bg-slate-50 sticky top-0`, `text-slate-600`, headers `font-semibold px-4 py-2.5`.
- Body rows: `border-b border-slate-100 hover:bg-slate-50`, `px-4 py-2`.
- IDs / codes use `font-mono text-xs`.
- Numeric columns are right-aligned, `font-mono font-medium`, sometimes `tabular-nums`.
- Sortable headers add ` ↑` / ` ↓` arrows via a small helper:
  ```ts
  arrow(k) => sortKey !== k ? "" : sortDir === "asc" ? " ↑" : " ↓"
  ```
- Scroll container: `max-h-[600px] overflow-x-auto`.

### Tier / count pill (inline cell badge)

```tsx
<span
  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-mono font-medium"
  style={{ backgroundColor: `${color}15`, color }}   // 15 = ~8% alpha
>
  {count}
  <span className="text-[10px] opacity-70">({pct}%)</span>
</span>
```

The trick is the tinted background `${color}15` (hex alpha) — it keeps the
badge color-coordinated without needing extra Tailwind classes.

---

## 11. Charts (recharts)

Always wrap in the standard card. Common props:

```tsx
<div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
  <div className="flex items-center gap-2 mb-4">
    <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
    <h3 className="text-lg font-semibold text-slate-800">Chart title</h3>
  </div>
  <div style={{ width: "100%", height: 400 }}>
    <ResponsiveContainer>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" stroke="#64748b" fontSize={12} tickFormatter={formatNum} />
        <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} width={140}
               tick={{ textAnchor: "end" }} />
        <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
          {data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
</div>
```

**Chart styling constants:**
- Grid: `stroke="#e2e8f0"`, `strokeDasharray="3 3"`
- Axes: `stroke="#64748b"`, `fontSize={11 | 12}`
- Tooltip: `contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}`
- Bar radius: `[0, 4, 4, 0]` (horizontal) or `[4, 4, 0, 0]` (vertical)
- Line: `strokeWidth={2}`, `dot={{ r: 4 }}`, `type="monotone"`
- Pie: `innerRadius={60} outerRadius={120} paddingAngle={2}` for donut style
- Legend: `wrapperStyle={{ fontSize: 12 }}`

Compact number formatter for axes:

```ts
function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
```

---

## 12. Status icons / status pills

Small circular icon badges, 5×5 (`w-5 h-5 rounded-full`), with a tinted bg and matching text color. The container itself stays neutral.

```tsx
const base = "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5";

// in-progress: <div className={`${base} bg-brand-100 text-brand-600`}>  spinner svg  </div>
// success:     <div className={`${base} bg-emerald-100 text-emerald-700`}> check svg </div>
// error:       <div className={`${base} bg-red-100 text-red-700`}>       ×   svg    </div>
// warning:     <div className={`${base} bg-amber-100 text-amber-700`}>   !   svg    </div>
// idle:        <div className={`${base} bg-slate-200`}><span className="w-1.5 h-1.5 rounded-full bg-slate-400" /></div>
```

Loading spinner (inline SVG, no library):

```tsx
<svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="3">
  <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
  <path strokeLinecap="round" d="M21 12a9 9 0 00-9-9" />
</svg>
```

---

## 13. Banners / inline alerts

```tsx
// Error
<div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">…</div>

// Success
<div className="p-4 rounded-md border border-emerald-200 bg-emerald-50 text-sm text-emerald-800">…</div>

// Empty state card
<div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">
  No data for this date range.
</div>
```

Loading text: `<div className="text-center py-12 text-slate-500">Loading…</div>`

---

## 14. Empty / first-run page

```tsx
<div className="max-w-2xl mx-auto text-center py-16">
  <h1 className="text-3xl font-bold mb-3">No data yet</h1>
  <p className="text-slate-600 mb-6">Upload your first report to get started.</p>
  <Link
    href="/upload"
    className="inline-block px-6 py-3 bg-brand-600 text-white rounded-md font-medium hover:bg-brand-700"
  >
    Go to Upload
  </Link>
</div>
```

---

## 15. Auth / login page (centered card)

```tsx
<div className="min-h-screen flex items-center justify-center bg-canvas px-6">
  <div className="w-full max-w-md">
    <div className="bg-white border border-slate-200/80 rounded-2xl shadow-card p-8">
      <div className="flex flex-col items-center mb-7">
        <Image src="/logo.png" alt="Logo" width={180} height={54} priority className="h-12 w-auto mb-5" />
        <h1 className="text-2xl font-bold text-slate-900">App Name</h1>
        <p className="text-sm text-slate-500 mt-1">Sign in with your account</p>
      </div>

      {/* error banner pattern from §13 */}

      <button className="w-full inline-flex items-center justify-center gap-3 px-4 py-2.5
                         bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-md
                         transition-colors shadow-sm">
        {/* provider icon svg */}
        Sign in
      </button>

      <p className="mt-6 text-xs text-center text-slate-400">Helper line</p>
    </div>
  </div>
</div>
```

Note the login uses `rounded-2xl` (one step rounder than normal `rounded-xl` cards) and the SSO button is `bg-slate-900` rather than brand-red — keeps brand-red reserved for app-internal primary actions.

---

## 16. Typography scale

| Use                | Class                                |
| ------------------ | ------------------------------------ |
| Page H1            | `text-3xl font-bold text-slate-900`  |
| Section H2         | `text-lg font-semibold text-slate-900` |
| Card title H3      | `text-lg font-semibold text-slate-800` |
| Card label / KPI label | `text-sm font-medium text-slate-500` (or `text-xs font-medium uppercase tracking-wide text-slate-500` for "eyebrow" labels) |
| KPI value          | `text-2xl font-bold text-slate-900`  |
| Body               | `text-slate-600` / `text-slate-700`  |
| Table body / form  | `text-sm`                            |
| Helper / caption   | `text-xs text-slate-500`             |
| Code / IDs         | `font-mono text-xs`                  |
| Inline code snippet | `bg-slate-100 px-1.5 py-0.5 rounded text-sm border border-slate-200` |

---

## 17. Spacing & shape conventions

- **Border radius:** `rounded-md` for buttons/inputs, `rounded-lg` for inner sub-panels and the segmented track, `rounded-xl` for top-level cards, `rounded-2xl` only for the auth shell, `rounded-full` for status dots / pills.
- **Shadows:** only two, both defined in the Tailwind config — `shadow-card` (default) and `shadow-cardHover` (on hover for interactive cards). The native `shadow-sm` is used on solid buttons.
- **Borders:** `border-slate-200/80` is the canonical card border (note the `/80` opacity — it softens the line on the cool background). Inner dividers use `border-slate-100` or `border-slate-200` (no opacity).
- **Spacing rhythm:** `space-y-6` between page sections, `gap-4` between KPI cards, `gap-6` between chart cards on a row.
- **Container:** `max-w-7xl mx-auto px-6 py-8` for normal pages; `max-w-4xl` for form-heavy pages; `max-w-3xl` for upload-style pages; `max-w-2xl` for empty-states / messages; `max-w-md` for auth.

---

## 18. Inline SVG library

Always 24×24, `fill="none"`, `stroke="currentColor"`, `strokeWidth="2"`,
`strokeLinecap="round" strokeLinejoin="round"`, and an explicit size class
(`h-5 w-5`, `h-4 w-4`, `h-7 w-7`). Reusable shapes used in this app:

```tsx
// Storefront (merchants/shops)
<path d="M3 7h18l-1.5 12.5a2 2 0 01-2 1.5h-11a2 2 0 01-2-1.5L3 7z" />
<path d="M8 7V5a4 4 0 018 0v2" />

// Currency
<path d="M12 2v20M17 7H9.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H7" />

// Trophy
<path d="M8 21h8m-4-4v4M6 4h12v4a6 6 0 01-12 0V4z" />
<path d="M18 6h2a2 2 0 010 4h-2M6 6H4a2 2 0 000 4h2" />

// People / partners
<path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M9 11a4 4 0 100-8 4 4 0 000 8zm6 0a4 4 0 100-8 4 4 0 000 8z" />

// Upload arrow
<path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12V4m0 0l-4 4m4-4l4 4" />

// Close ×
<path d="M6 18L18 6M6 6l12 12" />

// Check ✓
<path d="M5 13l4 4L19 7" />

// Warning triangle
<path d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.74-3l-7-12a2 2 0 00-3.48 0l-7 12A2 2 0 005 19z" />
```

---

## 19. Voice & micro-copy

- Subtitles are one short sentence describing what's on screen ("Showing data for Mon, May 19, 2026").
- Status counts in toolbars use bullet separators: `• 3 done` / `• 1 failed` / `• 2 invalid`.
- Em-dash `—` is the placeholder for missing values (not `-` or `N/A`).
- File-format / filename examples are wrapped in the inline-code style from §16.
- Primary buttons label themselves with the active count: `Upload 3 files`, `Generating…`, `All files processed`.

---

## 20. Anti-patterns (do NOT do these)

- ❌ Don't introduce a UI library (no shadcn, MUI, Chakra, etc.) — Tailwind utilities only.
- ❌ Don't use icon libraries (lucide, heroicons npm, react-icons). Inline SVG per §18.
- ❌ Don't use pure black (`#000`) or pure gray; everything is on the slate ramp.
- ❌ Don't put gold (`accent-*`) on a primary CTA — it's a secondary highlight only.
- ❌ Don't drop shadows other than `shadow-card`, `shadow-cardHover`, and the built-in `shadow-sm` on solid buttons.
- ❌ Don't skip the colored vertical pill (`w-1 h-5 rounded-full bg-…`) on titled cards — it's the signature of this design system.
- ❌ Don't render numeric data in proportional fonts — always `font-mono` (and right-aligned).

---

## 21. Quick-start checklist for a new project

1. `npx create-next-app@latest` with App Router + TypeScript + Tailwind.
2. Replace `tailwind.config.ts` with the block in §2.
3. Replace `src/app/globals.css` with §3.
4. Build `src/app/layout.tsx` from §4 (drop your own logo at `public/logo.png`).
5. Build each new page as: page-header (§5) → optional filter bar (§8) → cards/charts/tables (§6, §10, §11) using the standard recipes.
6. Use `space-y-6` between sections, never custom margins.
7. When in doubt about color: brand-red is the answer; if it would be too much red, use slate-700.
