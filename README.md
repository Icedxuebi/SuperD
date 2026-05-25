# Super D

Internal Anypay tooling — Next.js 15 + Tailwind dashboard that reads directly from the production PostgreSQL replica. Styled per `docs/template.md`.

## Setup

```powershell
npm install
copy .env.example .env.local
# then edit .env.local and fill in DATABASE_URL
npm run dev
```

App runs at http://localhost:3000.

## Environment

| Var            | Required | Notes                                                                                |
| -------------- | -------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL` | yes      | Postgres connection string. AWS RDS requires `?sslmode=no-verify` on the connection. |

Without `DATABASE_URL`, pages still render but any DB-backed API route returns 500 with a clear message.

## One-time local setup: signature PNGs

The "Generate TOP 5 Daily Report" feature embeds employee signatures in the Word doc. The 4 PNGs are **not** in source control (PII). Ask a teammate for the files and drop them into `signaturesup/`:

```
signaturesup/
├── thanawat.png    
├── burin.png       
├── mongkon.png     
└── chawanat.png    
```

If a file is missing, the DOCX still generates — just without that person's signature.

## Features

| Area | Route | What |
| --- | --- | --- |
| Risk Management | `/risk-management/police-case` | MID + date range → payments + withdrawals table → Excel export |
| Risk Management | `/risk-management/top-100-merchants` | Top Merchant Transaction dashboard (by date / week / month / multi-day stats) |
| Application Support | `/application-support/merchant-lookup` | Searchable, paginated `merchant_info` browser + per-merchant detail page (mirrors staff.anypay.asia backoffice) |
| Application Support | `/application-support/merchant-status-by-ae` | Active vs inactive merchants per AE partner |
| Application Support | `/application-support/generate-top5-report` | Generates the TOP 5 Daily Report `.docx` |
| Operation | `/operation/duplicate-tax-id` | Merchants sharing a Tax / Citizen ID with another merchant (search + Excel export) |
| Operation | `/operation/duplicate-phone` | Merchants sharing a phone number with another merchant (search + Excel export) |

## Where to look

- **Schema reference** — `docs/dbinfo.md` (no FK / PK constraints exist in the DB; trust the inferred-relationships section and the **master_data Foreign Key Patterns** subsection — joins are `id`-based or `key2`-based depending on the source column).
- **Design system** — `docs/template.md` (Tailwind only, no UI libraries, no icon libraries — see §20 for the full anti-pattern list).
- **Architecture rules** — `CLAUDE.md` at the repo root.
- **Shared client component** — `src/components/DuplicateFinder.tsx` powers both `/operation/duplicate-*` pages (search, sort, group dividers, Excel export).

## Adding a new tool

1. Create the route under `src/app/<area>/<tool>/page.tsx`.
2. Add it to the correct dropdown's `items` array in `src/components/Header.tsx`.
3. Follow `docs/template.md` for every UI primitive (the vertical brand-red pill on titled cards is non-negotiable).
