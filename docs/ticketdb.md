# Ticket DB Info

## System Overview

**Platform:** Anypay support-ticketing system (separate instance from the main Anypay DB — see [`docs/dbinfo.md`](./dbinfo.md))
**Host:** `43.208.86.43:5432` — a plain (non-SSL) Postgres instance, distinct from the RDS instance `DATABASE_URL` points at
**Database:** `anypay_ticket` (the instance also has a default, empty `postgres` database — the 5 app tables are NOT there)
**Env var:** `TICKETDB_URL` in `.env.local`
**Constraint model:** No FK constraints (same pattern as the main Anypay DB) — only PKs (`id` on every table) are enforced at the DB level
**Scale:** Tiny — ~5,000 total rows across all 5 tables, largest table (`case_info`) is under 5 MB

Merchant tickets ("cases") are created by merchants (`case_info.create_by` is a merchant login email in 9,507/9,526 rows) and worked by Anypay staff (`@anypay.co.th` emails, 19 rows) organized by role (SUPPORT / SUPPORT_MANAGER / FINANCE / OPERATION). `merchant_id` / `partner_id` on `case_info` link back to `merchant_info.id` / `partner_info.id` in the main Anypay DB (cross-database — no join possible in SQL, only in application code).

---

## Table Inventory

| Table | Rows | Size | Purpose |
|---|---|---|---|
| `case_info` | 9,526 | 4.8 MB | One row per support ticket |
| `case_info_detail` | 9,692 | 1.4 MB | Key/value extra fields attached to a ticket |
| `case_info_file` | 8,191 | 2.2 MB | File attachments on a ticket |
| `master_data` | 15 | 32 kB | Category/reason lookup (ticket taxonomy) |
| `role_config` | 20 | 32 kB | Which staff role owns which ticket category |

---

## case_info — the ticket itself

| Column | Type | Notes |
|---|---|---|
| `id` | bigint | PK |
| `create_by` | varchar | Email of the person who opened the ticket — merchant login email in ~99.8% of rows, `@anypay.co.th` staff email in the rest |
| `create_date` | timestamp | |
| `detail` | text | **The ticket body** — free text, usually Thai, written by the merchant. Populated on 8,985/9,526 rows (375 empty string, 166 NULL). Typically 50–300 chars, often multi-line (transaction ref, amount, bank account, requested change). This is the single most useful field for a lookup UI. The 166 NULLs are all "Edit Webhook" tickets, which carry their payload in `case_info_detail` instead |
| `merchant_id` | bigint | Never NULL (9,526/9,526) — → `merchant_info.id` in the main Anypay DB |
| `partner_id` | bigint | Always NULL in current data (0/9,526 set) — no merchant+partner ticket seen yet |
| `role` | varchar | Always NULL on `case_info` itself — role ownership is resolved via `sub_id` → `master_data.id` → `role_config`, not stored directly here |
| `status` | varchar | `CREATE` (2,767) → `APPROVE` (6,202) or `REJECT` (557) — simple 3-state ticket lifecycle |
| `main_id` | bigint | → `master_data.id` where `key1='MAIN_SECTION'` — top-level category (Go-live / Payment / Transfer / Report / Merchant) |
| `sub_id` | bigint | → `master_data.id` directly (any `key1`) — the specific ticket reason/type |
| `success_date` | timestamp | When the ticket was resolved (set alongside `APPROVE`/`REJECT`) |
| `update_by` / `update_date` | | Last staff member to touch the ticket, and when |
| `master_data_id` | bigint | Always NULL in current data — unused/legacy column |
| `contract_no` | varchar | The merchant's MID (e.g. `M251024034453`) — same format as `merchant_info.merchant_no` in the main DB; use this instead of `merchant_id` for human-facing lookups |

### main_id / sub_id → master_data mapping (observed distribution)

| main_id | Main section | sub_id | Sub section (ticket type) | Count |
|---|---|---|---|---|
| 2 | Payment | 8 | Success Payment But Transaction Status do not update | 6,947 |
| 5 | Merchant | 12 | Edit Merchant Detail | 1,094 |
| 3 | Transfer | 10 | Destination Account do not receive money | 817 |
| 1 | Go-live | 6 | Edit Webhook | 247 |
| 5 | Merchant | 14 | Close Merchant | 160 |
| 4 | Report | 11 | Other report | 123 |
| 1 | Go-live | 7 | Edit Whitelist IP | 101 |
| 5 | Merchant | 15 | Edit Personal Info | 19 |
| 2 | Payment | 9 | Duplicate Payment | 17 |
| 5 | Merchant | 13 | Edit Merchant Rate | 1 |

The single most common ticket by far is "Success Payment But Transaction Status do not update" (73% of all tickets) — a payment-status-sync complaint.

---

## case_info_detail — extra fields per ticket

1:N with `case_info` via `case_info_id`. A generic key/value sidecar so different ticket types can attach different structured data without schema changes.

| Column | Notes |
|---|---|
| `id` | PK |
| `case_info_id` | → `case_info.id` |
| `key` | Only 3 distinct values seen: `priority` (9,360 rows), `webhookTransfer` (166), `webhookQrCash` (166). The three are mutually exclusive per ticket — the 166 "Edit Webhook" tickets carry the two webhook keys and *no* `priority` row, so a ticket's priority can legitimately be absent |
| `value1` | Used only for `priority` — always `'medium'` in current data (no ticket has ever used a different priority) |
| `value2` | `text` — used for the webhook URL keys (holds the callback URL string, e.g. `https://gizmohub4u.com/qr_callbacks/`, or literal `Test_PROD` for sandbox-only merchants); empty string for `priority` rows |
| `create_by` / `create_date` / `update_by` / `update_date` | |

The `webhookTransfer` / `webhookQrCash` keys only appear on tickets under sub_id 6 ("Edit Webhook") — they carry the merchant's requested new webhook URL for transfer and QR-cash callbacks respectively.

---

## case_info_file — attachments

1:N with `case_info` via `case_info_id` (note: there is also an unused `case_info` bigint column — always NULL, 0/8,191 — `case_info_id` is the real FK, don't use the other one).

| Column | Notes |
|---|---|
| `id` | PK |
| `case_info_id` | → `case_info.id` |
| `case_info` | **Dead column** — always NULL, do not use |
| `file_name` | Stored filename: `{uuid}{file_type}.{ext}` |
| `file_name_original` | Original upload filename — frequently Thai-language (e.g. `แบบฟอร์มการขอแก้ไขข้อมูลBSO.pdf`) |
| `file_path` | e.g. `/webdata/upload/ticket/312` — server-side storage path |
| `file_type` | Only one value observed: `TICKET_ATTACHMENT` (8,191/8,191) |
| `status` | Always NULL in sample data |
| `enabled` | boolean — `true` in sample rows |
| `create_by` / `create_date` / `update_by` / `update_date` | |

Only merchant-relevant categories carry attachments in practice — `master_data.attach_file = true` for: "Success Payment But Transaction Status do not update", "Duplicate Payment", "Edit Merchant Detail", "Edit Personal Info" (matches the 4 categories where evidence/proof is meaningfully required).

---

## master_data — ticket taxonomy (all 15 rows)

Two-level category tree: `MAIN_SECTION` (5 top-level areas) → `SUB_SECTION_1..5` (specific ticket reasons within each area). `key2` is the display order within a `key1` group; `id` is the actual FK target used by `case_info.main_id`/`sub_id` and `role_config.master_data_id`.

| id | key1 | key2 | name_en | name_th | role | attach_file | email_to |
|---|---|---|---|---|---|---|---|
| 1 | MAIN_SECTION | 1 | Go-live | การเริ่มใช้งาน Production | — | false | — |
| 2 | MAIN_SECTION | 2 | Payment | การรับชำระเงิน | — | false | — |
| 3 | MAIN_SECTION | 3 | Transfer | การโอนเงิน | — | false | — |
| 4 | MAIN_SECTION | 4 | Report | รายงาน | — | false | — |
| 5 | MAIN_SECTION | 5 | Merchant | ร้านค้า | — | false | — |
| 6 | SUB_SECTION_1 | 1 | Edit Webhook | แก้ไข Webhook | SUPPORT | false | support@anypay.co.th |
| 7 | SUB_SECTION_1 | 2 | Edit Whitelist IP | แก้ไข Whitelist IP | SUPPORT | false | support@anypay.co.th |
| 8 | SUB_SECTION_2 | 1 | Success Payment But Transaction Status do not update | รายการชำระเงินแล้วไม่เปลี่ยนสถานะเป็นสำเร็จ | SUPPORT | true | support@anypay.co.th |
| 9 | SUB_SECTION_2 | 2 | Duplicate Payment | รายการชำระเงินซ้ำ | FINANCE | true | finance@anypay.co.th |
| 10 | SUB_SECTION_3 | 1 | Destination Account do not receive money | บัญชีปลายทางไม่ได้รับเงิน | SUPPORT | false | support@anypay.co.th |
| 11 | SUB_SECTION_4 | 1 | Other report | ขอรายงาน (อื่น ๆ) | SUPPORT | false | support@anypay.co.th |
| 12 | SUB_SECTION_5 | 1 | Edit Merchant Detail | แก้ไขข้อมูลร้านค้า | OPERATION | true | operation@anypay.co.th |
| 13 | SUB_SECTION_5 | 2 | Edit Merchant Rate | แก้ไขข้อมูลค่าธรรมเนียม | OPERATION | false | operation@anypay.co.th |
| 14 | SUB_SECTION_5 | 3 | Close Merchant | แจ้งความประสงค์ปิดร้านค้า | OPERATION | false | operation@anypay.co.th |
| 15 | SUB_SECTION_5 | 4 | Edit Personal Info | แก้ไขข้อมูลบุคคล | OPERATION | true | operation@anypay.co.th |

All 15 rows have `enabled = true`. `role` and `email_to` here are the *default* owner/notification target for the sub-section; `role_config` below is the fuller (and sometimes overlapping) role-assignment table.

---

## role_config — which staff role can act on which ticket type

Maps `role` → `master_data_id` (a `SUB_SECTION_*` row). One sub-section can map to multiple roles (e.g. both `SUPPORT` and `SUPPORT_MANAGER` can act on "Edit Webhook") — this is a many-to-many join table, not 1:1.

| role | Sub-sections it can handle |
|---|---|
| `SUPPORT` | Edit Webhook, Edit Whitelist IP, Success Payment status issue, Destination Account no money, Duplicate Payment, Close Merchant, Other report |
| `SUPPORT_MANAGER` | Edit Webhook, Edit Whitelist IP, Success Payment status issue, Destination Account no money, Duplicate Payment, Close Merchant |
| `FINANCE` | Duplicate Payment, Success Payment status issue |
| `OPERATION` | Edit Merchant Detail, Edit Merchant Rate, Close Merchant, Edit Personal Info |

Note this is broader than the single `role` column stored per-row on `master_data` — e.g. `master_data` says "Success Payment..." defaults to `SUPPORT`, but `role_config` shows `SUPPORT`, `SUPPORT_MANAGER`, *and* `FINANCE` can all handle it.

---

## Relationships (application-level, no DB constraints)

```
case_info.id            ← case_info_detail.case_info_id   (1:N)
case_info.id            ← case_info_file.case_info_id      (1:N — NOT case_info_file.case_info, which is dead)
case_info.main_id       → master_data.id  (key1='MAIN_SECTION')
case_info.sub_id        → master_data.id  (any key1, typically SUB_SECTION_*)
role_config.master_data_id → master_data.id

# Cross-database (main Anypay DB — see docs/dbinfo.md), app-layer only:
case_info.merchant_id   → merchant_info.id
case_info.partner_id    → partner_info.id
case_info.contract_no   ≈ merchant_info.merchant_no  (same MID format, human-facing key)
```

---

## In the app

`/application-support/tickets` (**Application Support → Tickets**) is the lookup UI over this
database — `src/app/application-support/tickets/page.tsx` + `src/app/api/tickets/route.ts`,
connecting via `getTicketPool()` in `src/lib/db.ts`.

**Query-shape warning:** neither `case_info_file.case_info_id` nor `role_config.master_data_id`
is indexed. Joining them with a per-row `LEFT JOIN LATERAL` makes Postgres run the aggregate
for every candidate row *before* `ORDER BY … LIMIT` can discard them — 9.5k sequential scans of
an 8k-row table, measured at **6.6 s per request**. Pre-aggregating each into a derived table
and hash-joining once brings the same query to **38 ms**. Do this:

```sql
LEFT JOIN (
    SELECT case_info_id, COUNT(*)::int AS n
      FROM case_info_file WHERE COALESCE(enabled, TRUE) GROUP BY case_info_id
) af ON af.case_info_id = ci.id
```

---

## Gotchas

- **Two databases, one instance:** the host `43.208.86.43` also has an unrelated empty `postgres` database — always connect with `TICKETDB_URL`, which points at `anypay_ticket`, not the bare host default.
- **`SUB_SECTION_<n>` hangs off `MAIN_SECTION` id `<n>`** — e.g. every `key1='SUB_SECTION_5'` row is a sub-type of main section 5 (Merchant). That is the only link between the two levels; there is no parent-id column.
- **`success_date` is exactly the resolved-set marker** — set on all 6,202 `APPROVE` and all 557 `REJECT` rows, never on `CREATE`. Turnaround = `success_date - create_date`; median ≈ 20 days, mean ≈ 31 days (long right tail, max ~155 days), so prefer the median.
- **Not every section has open tickets** — all 1,274 Merchant-section tickets are closed, so a Section=Merchant + Status=Open filter correctly returns zero rows.
- **No SSL on this host** — unlike the main `DATABASE_URL` (AWS RDS, requires `sslmode=no-verify`), this instance rejects SSL connections outright. Don't copy the `?sslmode=...` suffix onto `TICKETDB_URL`.
- **`case_info_file.case_info` is a dead column** — always NULL. The real FK to the ticket is `case_info_file.case_info_id`.
- **`case_info.role` and `case_info.master_data_id` are always NULL** — don't rely on them; derive role ownership via `sub_id → master_data.id → role_config.role`.
- **Cross-database joins aren't possible in SQL** — `case_info.merchant_id`/`contract_no` reference the separate main Anypay DB (`DATABASE_URL`), so any merchant-detail enrichment has to be a second query against that connection, joined in application code.
