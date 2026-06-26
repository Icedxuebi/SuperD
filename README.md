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

| Area | Nav label | Route | What |
| --- | --- | --- | --- |
| Application Support | Merchant Lookup | `/application-support/merchant-lookup` | Searchable, paginated `merchant_info` browser + per-merchant detail page (mirrors staff.anypay.asia backoffice) |
| Application Support | Merchant Status by AE | `/application-support/merchant-status-by-ae` | Active vs inactive merchants per AE partner |
| Application Support | Locked Accounts | `/application-support/locked-accounts` | Currently-locked `users` rows with owner labelling (merchant / partner / staff) |
| Application Support | Payment Status | `/application-support/payment-status` | Bulk-paste Ref1 (`merchant_invoice`) / Ref2 (`merchant_reference_no`) → payment status + amounts, with success/failed summary and Excel export |
| Application Support | Transfer Status | `/application-support/transfer-status` | Same bulk-ref lookup as Payment Status, for withdrawal / payout transfer status |
| Application Support | Generate Top 5 Report | `/application-support/generate-top5-report` | Generates the TOP 5 Daily Report `.docx` |
| Application Support | Ticket Dashboard | `/application-support/ticket-dashboard` | Upload a support-ticket CSV → charts for issue mix, created-vs-closed by team member, resolution time, and tickets per partner (client-side only, no DB) |
| Operation | Check Duplicate Tax ID | `/operation/duplicate-tax-id` | Merchants sharing a Tax / Citizen ID with another merchant (search + Excel export) |
| Operation | Check Duplicate Phone Number | `/operation/duplicate-phone` | Merchants sharing a phone number with another merchant (search + Excel export) |
| Operation | Onboarding Funnel | `/operation/onboarding-funnel` | Merchants by onboarding state with aging from `register_date`; flags merchants stuck ≥ N days. Pre-approval rows with no MID fall back to `#<merchant_id>` + brand name. |
| Risk Management | Police Case Query | `/risk-management/police-case` | MID + date range → payments + withdrawals table → Excel export |
| Risk Management | Top Merchant Transaction | `/risk-management/top-100-merchants` | Top Merchant Transaction dashboard (by date / week / month / multi-day stats) |
| Risk Management | No Transaction 90 / 120 | `/risk-management/no-transaction` | Live merchants (`close_date` unset) with no successful payment in a 75 / 90 / 120-day window; flags "never transacted"; Excel export |
| Risk Management | Spender History | `/risk-management/spender-history` | Look up a payer's bank account → every Anypay merchant it has paid (successful only), aggregated per merchant with totals and Excel export |
| Risk Management | Top Spender | `/risk-management/top-spender` | Top spenders (by bank account) for a selected month with totals, top-10 chart, concentration share, and Excel export |
| Risk Management | Fraud Monitoring Feed | `/risk-management/fraud-monitoring` | Alerts from `transaction_fraud_monitoring` joined to the underlying payment / transfer / merchant; schema is introspected at request time |
| Risk Management | Blacklist Hit Report | `/risk-management/blacklist-hits` | Merchants / partners flagged on the blacklist |
| Risk Management | KYC / CDD Period Review | `/risk-management/kyc-cdd-review` | Per-period KYM / KYC / CDD sign-off tracker. Closed merchants always excluded; fully-approved (`state='APPROVE'`) merchants excluded from KYM / KYC (one-time checks) but kept for CDD (recurring obligation). Pre-approval rows fall back to `#<merchant_id>` + brand name + onboarding state pill. |
| Risk Management | Partner & Merchant Risk | `/risk-management/partner-merchant-risk` | Risk + status distribution across partners (AEs) and their merchants, with per-AE rollup and side-by-side compare. Data is live from `partner_info` + `merchant_info` (no CSV upload). |
| CFR | Money Trace | `/cfr/money-trace` | Upload a `Bank Case ID *.xlsx` → one ready-to-upload CFR form per sheet. Server-side port of the `cfrauto` desktop converter (ExcelJS over `cfr-template/TemplateAddSubCase_V17.2_Non-bank.xlsx`); download each file or all as a ZIP. No DB. |
| Finance | Finance Report | `/finance/report` | Daily settlement report for a chosen day — combines payment (`payment_transaction.settle_due`) and transfer (`transfer_transaction.transfer_date`). Shows transaction-summary KPIs (count, gross, net, fee, fee %), a cost/profit breakdown (bank cost = per-transaction acquirer fee by gateway channel; agency commission from `transaction_commission.commission_fee_partner`; gross profit = revenue − cost), and By-Agency-Code / By-Agency-Group tables (partner→group mapping in `src/lib/finance/groups.ts`). Formulas mirror the finance Power BI model exactly. Live from the DB, cached per date; Excel export. |

## Where to look

- **Schema reference** — `docs/dbinfo.md` (no FK / PK constraints exist in the DB; trust the inferred-relationships section and the **master_data Foreign Key Patterns** subsection — joins are `id`-based or `key2`-based depending on the source column).
- **Design system** — `docs/template.md` (Tailwind only, no UI libraries, no icon libraries — see §20 for the full anti-pattern list).
- **Architecture rules** — `CLAUDE.md` at the repo root.
- **Shared client component** — `src/components/DuplicateFinder.tsx` powers both `/operation/duplicate-*` pages (search, sort, group dividers, Excel export).

## Adding a new tool

1. Create the route under `src/app/<area>/<tool>/page.tsx`.
2. Add it to the correct dropdown's `items` array in `src/components/Header.tsx`.
3. Follow `docs/template.md` for every UI primitive (the vertical brand-red pill on titled cards is non-negotiable).
