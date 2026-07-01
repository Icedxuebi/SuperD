# Super D — Internal Operations & Risk Dashboard

> Full-stack internal web platform for a Thai payment-gateway / fintech company (Anypay),
> built on top of a **~250 GB production PostgreSQL database** with **160+ tables** and
> several individual transaction tables exceeding **50 million rows**.

---

## One-line summary (resume header)

**Designed and built a 20+ tool internal dashboard (Next.js 15 / React 19 / TypeScript) that reads directly from a ~250 GB production Postgres replica, serving Application Support, Operations, Risk Management, Finance, and financial-crime (CFR) reporting teams.**

---

## What the project is

Super D is an internal, authentication-gated web application that gives Anypay's
back-office teams self-service access to live production payment data without writing SQL.
It replaces a scatter of manual spreadsheet pulls and one-off scripts with a single,
consistently-styled dashboard covering five functional areas:

- **Application Support** — merchant lookup, merchant status by account executive (AE),
  locked-account auditing, bulk payment / transfer status lookups, and automated
  generation of the daily "Top 5" Word report.
- **Operations** — duplicate Tax-ID and duplicate phone-number detection across the
  merchant base, and an onboarding-funnel / aging view.
- **Risk Management** — police-case transaction exports, top-merchant and top-spender
  analytics, "no transaction in 90/120 days" monitoring, payer spend-history tracing,
  a fraud-monitoring feed, blacklist-hit reporting, KYC/CDD period-review tracking, and
  partner/merchant risk distribution.
- **Finance** — a daily settlement report that reconciles payment and transfer
  transactions into KPIs (count, gross, net, fee %), a bank-cost / agency-commission /
  gross-profit breakdown, and by-agency rollups that mirror the finance Power BI model.
- **CFR (financial-crime reporting)** — a "Money Trace" tool that converts an uploaded
  bank-case workbook into ready-to-submit regulatory forms (one per sheet, zipped),
  porting a legacy Python desktop converter to a server-side TypeScript/ExcelJS pipeline.

---

## Scale of the data

The application queries the **production read replica** directly, so every feature is
built around large-table performance and correctness:

| Table | Approx. rows | Size |
| --- | ---: | ---: |
| `webhook` | 61.6M | 22 GB |
| `transaction_commission` | 58.7M | 16 GB |
| `payment_transaction_balance` | 58.6M | 40 GB |
| `payment_transaction` | 53.9M | 57 GB |
| `payment_information` (1:1 split of payment_transaction) | 51.9M | 7.1 GB |
| `payment_transaction_response` | 48.2M | 12 GB |
| `transfer_transaction` | 12.8M | 29 GB |
| `action_log` | 66.9M | 8.5 GB |

- **~250 GB total database**, dominated by transaction and reconciliation data.
- **160+ tables** in a single Postgres schema.
- **No database-level foreign-key or primary-key constraints** — all referential
  integrity is enforced at the application layer, so every join had to be reverse-engineered
  and documented from production data rather than read off a schema diagram.
- ~1,500 merchants linked to AE partners, each with multi-period KYC / KYM / CDD
  compliance cycles.

---

## What I can do / skills demonstrated

**Full-stack web development**
- Built a Next.js 15 (App Router) + React 19 + TypeScript (strict mode) application from
  the ground up, with a Tailwind-only design system (no UI or icon libraries) enforced for
  visual consistency across 20+ tools.
- Implemented a clean request architecture: server/client pages never touch the database
  directly — they call typed `/api/*` route handlers, which use a cached connection pool.

**Database & SQL engineering at scale**
- Wrote performant, parameterized SQL against 50M+ row tables on a live production replica.
- Reverse-engineered a constraint-free schema (160+ tables, no FKs/PKs) into a documented
  set of inferred relationships and join patterns, including 1:1 vertical table splits and
  `master_data` lookup conventions.
- Solved a real-world timezone-correctness bug by overriding the Postgres driver's `date`
  and `timestamp` type parsers so Bangkok wall-clock values are not silently shifted in the
  UI or in Excel exports.
- Hardened dynamic sorting/ordering with allowlists so no user input ever reaches the query
  string (SQL-injection safe by construction).

**Security & authentication**
- Built a custom, dependency-free auth layer: edge-runtime middleware gating every route,
  HMAC-SHA256-signed session cookies using the Web Crypto API (so identical code runs in
  both Edge middleware and Node API routes), and scrypt-hashed credentials with
  timing-safe, case-insensitive username lookups.

**Document & file generation**
- Generated regulatory and operational artifacts programmatically: `.docx` reports (docx
  library, with graceful handling of missing signature assets), Excel exports (xlsx /
  ExcelJS), and a cell-by-cell ExcelJS template-fill pipeline that preserves styles, merged
  cells, and formulas while producing zipped multi-file output.
- Ported a legacy Python (openpyxl) desktop tool to a maintainable server-side TypeScript
  module.

**Data analysis & reporting**
- Translated finance Power BI model formulas (net transaction value, bank cost, agency
  commission, gross profit) into application logic, and built interactive charts (recharts)
  for top-merchant, top-spender, and ticket-dashboard views.

**Engineering practices**
- Maintained authoritative internal documentation (schema reference, design system,
  architecture rules) and a conventions-driven codebase so new tools can be added by
  following a documented pattern.

---

## Tech stack

**Frontend:** Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind CSS 3, recharts
**Backend:** Next.js API route handlers (Node runtime), `pg` (node-postgres) with a pooled singleton
**Data / files:** PostgreSQL (read replica), ExcelJS, SheetJS (xlsx), docx, jszip, date-fns
**Auth / security:** Custom middleware, Web Crypto (HMAC), scrypt password hashing

---

## Resume bullet points (ready to paste)

- Built and maintained a full-stack internal dashboard (Next.js 15, React 19, TypeScript,
  Tailwind) of 20+ self-service tools serving Support, Operations, Risk, Finance, and
  financial-crime teams at a Thai payment-gateway company.
- Engineered performant, injection-safe SQL against a **~250 GB production PostgreSQL
  database** with **160+ tables** and several **50M+ row** transaction tables, on a live
  read replica.
- Reverse-engineered a constraint-free production schema into documented join patterns, and
  fixed a driver-level timezone bug that had been corrupting dates across the UI and Excel
  exports.
- Implemented a custom, library-free authentication system (edge middleware, Web Crypto
  HMAC-signed sessions, scrypt credential hashing with timing-safe lookups).
- Automated regulatory and operational reporting by generating `.docx`, Excel, and zipped
  multi-sheet form outputs, including porting a legacy Python converter to TypeScript.
