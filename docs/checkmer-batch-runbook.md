# Runbook — Merchant status tagging + transaction-detail batch (checkmer)

How to take a list of merchants (an Excel file of MIDs), tag each as **Active / Inactive /
Closed**, and generate the three transaction deliverables. Written from the run done
2026-07-13. Everything reads the **production read replica** — read-only, but be mindful of load.

---

## 0. Prerequisites

- `.env.local` present with `DATABASE_URL` (AWS RDS needs `?sslmode=no-verify`).
- Node 20+ (uses `--env-file`). Scripts import `pg`, `exceljs`, `xlsx` — so **run them from
  inside the repo** (`node` resolves `node_modules` from the script's folder; a script copied to
  a temp dir outside the repo fails with `ERR_MODULE_NOT_FOUND`).
- Standard invocation pattern (same as the other `scripts/*.mjs`):
  ```powershell
  node --env-file=.env.local scripts/<script>.mjs
  ```

---

## 1. Input file

A single-sheet `.xlsx` (here `checkmer.xlsx`) keyed by MID. Column layout used:

| Col | Header (Thai)                     | Meaning                    |
|-----|-----------------------------------|----------------------------|
| A   | ลำดับ                              | row number                 |
| B   | **รหัสร้านค้า**                     | **MID / `merchant_no`** (the join key, e.g. `M250507012836`) |
| C   | ชื่อร้านค้า                         | store name                 |
| D   | ประเภทร้านค้า                       | store type                 |
| E   | กรรมการผู้มีอำนาจ/เจ้าของร้านค้า     | owner                      |
| F   | **สถานะ (Status)**                | added in step 2            |
| G   | **วันที่ปิดร้าน (Close date)**       | added in step 3            |

`merchant_no` is the external MID — **never** identify a merchant by `merchant_info.id`. See
`docs/dbinfo.md`.

---

## 2. Add the Status column (F): Active / Inactive / Closed

**Rule (closed wins):** evaluate per merchant, in this order —

1. **Closed** — `merchant_info.close_date IS NOT NULL` (a stamped close date = perma-closed).
   This takes priority; if closed we don't care about active/inactive.
2. **Active** — otherwise, fully live: `state = 'APPROVE'` **AND** `merchant_info.enabled IS TRUE`
   **AND** at least one enabled `users` row (`users.merchant_id → merchant_info.id`).
3. **Inactive** — anything else that's open (still in the onboarding pipeline, or
   approved-but-disabled and not closed).

This mirrors the `merchant-status-by-ae` route (`src/app/api/merchant-status-by-ae/route.ts`),
**except** that route *excludes* closed merchants from its population; here Closed is a value.

Classification query (one row per MID; `bool_or` guards against >1 `users` row):

```sql
SELECT
    mi.merchant_no,
    bool_or(mi.close_date IS NOT NULL)                                    AS has_close,
    MAX(CASE WHEN mi.close_date IS NOT NULL THEN mi.close_date::text END) AS close_date,
    bool_or(mi.state = 'APPROVE' AND mi.enabled IS TRUE
            AND COALESCE(ue.any_enabled, FALSE))                          AS is_active
FROM merchant_info mi
LEFT JOIN (
    SELECT merchant_id, bool_or(enabled) AS any_enabled
    FROM users GROUP BY merchant_id
) ue ON ue.merchant_id = mi.id
WHERE mi.merchant_no = ANY($1::text[])   -- the MIDs from column B
GROUP BY mi.merchant_no;
```

Then write column F per row: `has_close → "Closed"`, else `is_active → "Active"`, else `"Inactive"`.
Use **ExcelJS** (`readFile` → set cells → `writeFile`) so existing formatting is preserved; dates
stay as **raw text** (`YYYY-MM-DD`) to avoid the pg UTC shift — the pool overrides type parsers for
OID 1082/1114 (see `src/lib/db.ts` / the `types.setTypeParser(1082/1114, v => v)` lines every
script repeats).

_2026-07-13 result: 1,187 MIDs → **137 Active, 1,050 Closed, 0 Inactive**, all found, no dupes._

## 3. Add the Close-date column (G)

For every **Closed** row, write `close_date` (from the query above) into column G; leave Active/
Inactive blank. Only closed stores carry a close date.

---

## 4. Generate the three deliverables

Script: **`scripts/gen-checkmer-batch.mjs`**. Reads Status (F) + Close date (G) straight from the
xlsx, so steps 2–3 must be done first.

```powershell
# full run — all merchants in the sheet -> ./hugefile
node --max-old-space-size=4096 --env-file=.env.local scripts/gen-checkmer-batch.mjs
```

### Per-merchant 3-month window
- **Active** → Apr, May, Jun 2026 (the 3 complete months before "now"; adjust in code if the
  reference month changes — constant `ACTIVE_MONTHS`).
- **Closed / Inactive** → the **close month + the 2 months before it** (full calendar months).
  e.g. close date in Nov 2024 → Sep, Oct, Nov 2024. (Helper `threeMonthsEnding(y, m)`.)

### Types in scope
Payment, Withdraw, Transfer (Settlement excluded). All statuses (`S` and `E`) are included with a
Status column so an analyst can filter. Schema facts used:
- **Payment** = `payment_transaction` (+ `payment_transaction_response` for the payer's
  `from_account` / `from_name` / `from_bank`).
- **Withdraw / Transfer** = `transfer_transaction` where `type IN ('Withdraw','Transfer')`;
  destination is `account_no` / `account_holder_name` / `bank_code`.
- Bank name via `master_data` (`key1='BANK' AND key2=<bank code>`).

### Outputs (`./hugefile`)
1. `1_transaction_details/<mid>_<name>.xlsx` — **one workbook per merchant, one sheet per window
   month** (sheet named `YYYY-MM`). Sheet-per-month keeps each sheet under Excel's ~1,048,576-row
   limit (whales hit ~300k/month). Columns: Order ID, MID, Merchant Name, BillerID, Transaction
   Date, Ref1, Ref2, Type, Status, Amount, Bank Account Number, Bank Account Name, Bank Code, Bank
   Name.
2. `2_monthly_summary.xlsx` — **By Merchant** (mid × month × type: count + amount, + totals) and
   **All by Month** (calendar rollup across all merchants + grand total).
3. `3_same_account_sample.xlsx` — **SAMPLE** of the money-in-then-out pattern (same bank account
   that **pays a merchant** *and* is **withdrawn to** by that merchant, same month). Sheets:
   - **Overlap Summary** — every merchant-month with any overlap: payer accts, withdraw accts,
     overlap accts, % of payers, in count/amount, out count/amount.
   - **Sample Accounts** — top-`N` matched accounts per merchant-month (default 5): both holder
     names, both banks, pay#/pay฿ in, wd#/wd฿ out, net.
   - **Sample Transactions** — a few real in/out txns per sampled account (default 3 per side).

   This is intentionally a **sample** (style of `scripts/inspect-transfer-vs-withdraw.mjs`) — the
   full match set is millions of rows; it is aggregated in SQL and streamed, never held in memory.

### Flags
| Flag              | Default        | Purpose                                             |
|-------------------|----------------|-----------------------------------------------------|
| `--out=DIR`       | `hugefile`     | output directory                                    |
| `--xlsx=FILE`     | `checkmer.xlsx`| input workbook                                      |
| `--limit=N`       | (all)          | first N merchants (sheet order) — for testing       |
| `--mids=M1,M2`    | (all)          | specific MIDs — for testing                         |
| `--sample-top=N`  | 5              | matched accounts per merchant-month in #3           |
| `--sample-tx=N`   | 3              | sample txns per account per side in #3              |
| `--no-details`    | off            | skip #1 workbooks (rebuild only #2/#3 fast)         |

### Recommended workflow
```powershell
# 1. smoke test on a handful first (fast, isolated dir)
node --env-file=.env.local scripts/gen-checkmer-batch.mjs --out=hugefile_test --mids=M260617144002

# 2. full run in the background, tee to a log, then watch the log
node --max-old-space-size=4096 --env-file=.env.local scripts/gen-checkmer-batch.mjs > hugefile_full.log 2>&1
```
Runtime is dominated by the high-volume ("whale") active merchants — expect on the order of an
hour for ~1,200 merchants; the old closed merchants with no activity fly by at ~14/s.

---

## 5. Gotchas / lessons learned

- **Don't hold match rows in memory.** The first #3 attempt accumulated every matched transaction
  in JS arrays → `JavaScript heap out of memory` (8 merchants alone = 2.9M txns, 218k account-month
  matches). Do the overlap/aggregation in **SQL** and stream results out.
- **ExcelJS streaming writer**: `worksheet.views` is **getter-only** — pass it in
  `wb.addWorksheet(name, { views: [{ state:'frozen', ySplit:1 }] })`, don't assign `ws.views = …`.
  Sequential sheets work: `addWorksheet → addRow().commit() → ws.commit()`, repeat, then
  `wb.commit()`.
- **Excel row limit** is 1,048,576/sheet → split detail by month (a 3-month whale can approach it).
- **Dates**: keep DB dates/timestamps as raw text (the type-parser overrides). The store clock is
  Bangkok wall-clock; parsing as UTC shifts everything −7h.
- **`from_account` vs `account_no` match**: exact string match on the account number is enough
  (validated — matched rows show the same person's name in EN on the pay side and TH on the
  withdraw side, same bank code). Nulls/empties are skipped.
- **Whales are real**: e.g. ChronoWrist June 2026 = 97k payments from 31k accounts, 26k withdrawals
  to 13k accounts, **10.5k accounts on both sides**. These are wallet/deposit-withdraw merchants;
  the in/out pattern is pervasive, not rare.

## 6. Verify after a run
- `2_monthly_summary.xlsx` → **All by Month** grand totals sanity-check against expectations.
- Open a couple of `1_transaction_details/*.xlsx` — one whale, one recently-onboarded (should have
  empty early-month sheets), one closed.
- `3_same_account_sample.xlsx` → **Sample Accounts**: payer name and withdraw-holder name should be
  the same person; net = pay-in − withdraw-out.
```
