# Database Info

## System Overview

**Platform:** Anypay — Thai payment gateway / fintech platform  
**DB:** PostgreSQL, single `public` schema  
**Constraint model:** No FK or PK constraints defined at the DB level (queries 3 & 4 returned empty). All referential integrity is enforced at the application layer. Only a handful of tables have sequence-backed `DEFAULT` on their `id`.

---

## Key Observations

- **Primary merchant search key:** `merchant_info.merchant_no` — this is the MID (e.g. `M250701022505`) used to identify merchants in reports, police case exports, and all external-facing queries. Always join via `merchant_info` and filter on `merchant_no`; do not use the internal `merchant_info.id` as the input parameter.
- **AE / partner link:** Every merchant is linked to an AE/partner via `merchant_info.partner_id → partner_info.id`. Use `partner_info.partner_no` as the AE identifier in reports and exports. `registration_channel_partner_details` on `merchant_info` is a free-text field that is often blank — do not use it.
- **Scale:** ~250 GB total, dominated by transaction + recon data
- **Thai platform:** Address tables use Thai admin divisions (province/district/sub_district); Thai name fields throughout
- **Company name:** "Anypay" — visible in profit-split columns like `qr_cash_profit_any_pay` in `partner_rate`
- **No DB-level FK/PK constraints** — application enforces all integrity
- **payment_information** is a 1:1 vertical split of `payment_transaction` (same PK `ptx_id`) — wide-column separation
- **merchant_rate / partner_rate / transfer_due** all use the entity's own ID as PK (1:1 with merchant/partner)
- **users** is a unified auth table — one row can be a merchant user, partner user, or internal staff (mutually exclusive via `merchant_id`, `staff_id`, `partner_id`)
- **Webhook table** tracks full outbound delivery lifecycle — `start_send_date`, `end_send_date`, response payloads, result codes
- **transfer_transaction** stores raw bank request/response payloads (`bank_authen_request/response`, `bank_inquire_*`, `bank_confirm_*`) — full audit trail
- **running_no:** Key/type/date-based sequence generator (65 MB for 285 rows — likely stores historical entries per date)
- **payment_transaction_balance_backup:** Ad-hoc backup in public schema, identical schema to `payment_transaction_balance`
- **Sandbox:** Full parallel tables for payment and transfer testing (`_sandbox` suffix)
- **KYC/KYM/CDD pattern:** Multi-period compliance review cycle for both merchants and their individual persons — operation, risk, and manager sign-off columns per period
- **MFA:** `users` has `mfa_otp_failed_attempts`, `mfa_otp_locked_until`, `login_lock_tier`, `login_permanently_locked`

---

## Inferred Relationships (application-level, no DB constraints)

```
merchant_info.id        ← payment_transaction.merchant_id
merchant_info.id        ← transfer_transaction.merchant_id
merchant_info.id        ← merchant_rate.merchant_id          (1:1)
merchant_info.id        ← transfer_due.merchant_id           (1:1)
merchant_info.id        ← users.merchant_id
merchant_info.id        ← invoice.merchant_id
merchant_info.partner_id → partner_info.id

partner_info.id         ← partner_rate.partner_id            (1:1)
partner_info.id         ← users.partner_id
partner_info.id         ← transaction_commission.partner_id

staff_info.id           ← users.staff_id

payment_transaction.id  → payment_information.ptx_id          (1:1, vertical split)
payment_transaction.id  → payment_transaction_response.ptx_id (1:1)
payment_transaction.id  → payment_transaction_balance.ptx_id  (1:many)
payment_transaction.id  → transaction_commission.ptx_id
payment_transaction.id  → reconcile_all.ptx_id
payment_transaction.id  → transaction_fraud_monitoring.ptx_id
payment_transaction.id  → webhook.t_id  (when webhook.type = payment)

transfer_transaction.id → payment_transaction_balance.transfer_id
transfer_transaction.id → transaction_commission.transfer_id
transfer_transaction.id → transfer_transaction_reference_no.transfer_transaction_id
transfer_transaction.id → reconcile_all.transfer_id
transfer_transaction.id → transaction_fraud_monitoring.transfer_transaction_id
transfer_transaction.id → webhook.t_id  (when webhook.type = transfer)
transfer_transaction.transfer_due_of_day_id → transfer_due_of_day.id

gateway_info.id         ← gateway_channel.gwif_id
gateway_channel.id      ← gateway_channel_key.gwc_id
gateway_channel.id      ← payment_transaction.gwc_id
gateway_channel.id      ← transfer_transaction.gwc_id
gateway_channel.id      ← invoice_detail.gwc_id

invoice.id              ← invoice_detail.invoice_id

reconcile_payment_transaction.id       ← reconcile_payment_transaction_details.rct_id
reconcile_statement_transaction.id     ← reconcile_statement_transaction_details.rst_id
reconcile_transfer_transaction.id      ← reconcile_transfer_transaction_details.rct_id

transfer_commission_summary.id         ← transfer_commission_transaction.transfer_commission_summary_id
transfer_commission_summary.id         ← transaction_commission.transfer_commission_summary_id

transfer_due_of_day.id  ← payment_transaction_balance.transfer_due_of_day_id
```

---

## Column Details — Key Tables

### payment_transaction
Core payment record. One row per payment initiated.

| Column | Type | Notes |
|---|---|---|
| id | bigint | PK (convention) |
| merchant_id | bigint | → merchant_info.id |
| gwc_id | bigint | → gateway_channel.id (payment channel used) |
| gwc_id_invoice | bigint | Invoice channel |
| gwc_id_transfer | bigint | Transfer/payout channel |
| amount | numeric | |
| fee | numeric | Platform fee charged |
| fee_type | varchar | Fee calculation method |
| cal_rate | double | Calculated rate |
| pay_type | varchar | e.g. QR, card |
| payment_type | varchar | Finer classification |
| currency / currency_code | varchar | |
| status | varchar | Transaction status |
| ref_no | varchar | Internal reference |
| merchant_reference_no | varchar | Merchant's own ref |
| merchant_invoice | varchar | Merchant invoice no |
| invoice_number | varchar | |
| acq_transaction_id | varchar | Acquirer's transaction ID |
| payment_date | timestamp | When payment occurred |
| settle_due | date | Expected settlement date |
| expire_date | timestamp | QR/link expiry |
| customer_email / name | varchar | |
| customer_bank_account_no / name / code | varchar | Payer's bank info |
| payment_card_no | varchar | Card number (masked) |
| card_level / type / scheme / location | varchar | Card metadata |
| webhook_url | varchar | Merchant's callback URL |
| check_bank_account_name/no | boolean | Name-matching flags |

### payment_information
1:1 extension of `payment_transaction` (same PK `ptx_id`). Holds wider customer/merchant data split out to keep `payment_transaction` narrower.

| Column | Notes |
|---|---|
| ptx_id | PK = payment_transaction.id |
| customer_address / email / name / telephone | |
| detail | Payment description |
| merchant_defined1–5 | Merchant free-form fields |
| merchant_name | |
| bank_account_no | |

### payment_transaction_balance
Ledger entries per payment — one payment can have multiple balance movements (e.g. initial, refund, settlement).

| Column | Notes |
|---|---|
| id | bigint, sequence-backed |
| ptx_id | → payment_transaction.id |
| transfer_id | → transfer_transaction.id (for settlement payouts) |
| transfer_due_of_day_id | → transfer_due_of_day.id |
| merchant_id, gwc_id | |
| amount, fee, net_amount | |
| payment_type | |
| description | |
| settle_date | |

### payment_transaction_response
Raw gateway response per transaction (1:1 with payment_transaction by ptx_id).

| Column | Notes |
|---|---|
| ptx_id | PK |
| acq_transaction_id | Acquirer ref |
| bank_result_code / message | Bank's raw result |
| result_code / result_message | Normalized result |
| from_account / from_bank / from_name | Payer's bank info |
| reference1 / 2 / 3 | Bank references |
| channel_code | PromptPay / card channel |
| payee_account_number / proxy_type | Payee info |
| transaction_type | |
| authorize_code | Card authorization code |
| consumerpan / merchantpan | Card PANs |
| invoice, merchant_id, terminal_id | Card-specific fields |
| trace_no | Card trace number |

### transfer_transaction
Outbound payout/settlement to merchant's bank account.

| Column | Notes |
|---|---|
| id | PK |
| merchant_id, gwc_id | |
| account_no, account_holder_name, bank_code | Destination bank account |
| amount, fee, fee_type, cal_rate | |
| payment_type, destination_type, type | Classification |
| status, result, result_description | |
| transfer_date | |
| transfer_reference_no | |
| transfer_due_of_day_id | → transfer_due_of_day.id |
| transfer_transaction_reference_id | → transfer_transaction_reference_no.id |
| bank_authen/inquire/confirm _request/response | Full raw bank payloads (text) |
| bank_result, bank_result_description | |
| merchant_defined1–5, merchant_reference_no | Passthrough fields |
| webhook_url | |
| condition, email | |

### transaction_commission
Fee split per transaction — records what Anypay earns and what goes to the partner.

| Column | Notes |
|---|---|
| id | |
| ptx_id | → payment_transaction.id |
| transfer_id | → transfer_transaction.id |
| partner_id, merchant_id | |
| gwc_id, gwc_id_transfer, gwc_id_invoice | |
| transaction_fee | Total fee |
| commission_fee | Net commission |
| commission_fee_anypay | Anypay's share |
| commission_fee_partner | Partner's share |
| commission_fee_type | |
| transfer_commission_summary_id | |

### webhook
Outbound webhook delivery log. One row per delivery attempt.

| Column | Notes |
|---|---|
| id | |
| t_id | → payment_transaction.id or transfer_transaction.id |
| merchant_id | |
| type | payment / transfer |
| payment_type | |
| status | Delivery status |
| result / result_description | Transaction result echoed |
| transaction_result / transaction_id | |
| webhook_url | Target URL |
| webhook_response | Raw HTTP response |
| webhook_response_result / _result_description | Parsed result from response |
| start_send_date / end_send_date | Retry window tracking |
| reference_no / transfer_reference_no | |
| amount, fee, vat | |
| payment_date / transfer_date | |
| merchant_defined1–5, customer_* | Passthrough payload fields |

### merchant_info
Core merchant record. Very wide — 100+ columns. Key groups:

| Group | Columns |
|---|---|
| Identity | id, merchant_no, merchant_contract_no, person_type (corporate/individual) |
| Company | company_name_en/th, company_tax_id, company_type_id, company_register_date/capital |
| Contact | company_telephone, website, ip_host |
| Partner | partner_id (which partner referred/onboarded them) |
| Channels | qr_gwc_id, credit_card_offline/online_gwc_id, qr_credit_gwc_id |
| Webhooks | webhook_qr_cash, webhook_transfer, webhook_qr_credit (+ sandbox variants) |
| State | state (onboarding FSM), enabled, enabled_sandbox |
| Limits | max_amount_per_month, max_count_per_month |
| Risk | risk, black_list, black_list_after_approve, auto_reject |
| Compliance | consent_pdpa, consent_policy, check_ip |
| Bank | bank_id, bank_account_no, bank_account_name, bank_account_type_id, bank_account_branch |
| Review (multi-role) | remark_operation/risk/operation_manager/risk_manager _kyc/kym + _date + _staff_id for each |
| Approval dates | operation/risk/operation_manager/risk_manager/manager/supervisor _approve_date |
| Registration | registration_channel_*, used_online_payment_service |

### merchant_rate
Fee schedule for a merchant. PK = `merchant_id` (1:1 with merchant_info).

| Group | Columns |
|---|---|
| QR Cash | rate_qr_cash_percent, rate_qr_cash_time, rate_qr_cash_type |
| Transfer | rate_transfer_percent/time/type |
| Withdraw to own bank | rate_withdraw_to_merchant_percent/time/type |
| Withdraw to other | rate_withdraw_to_other_percent/time/type |
| Transaction limits | transaction_min/max_amount, transaction_max_amount/count_per_month |
| Withdrawal limits | withdraw_min/max_amount, settlement_min/max_amount |
| Feature flags | enabledqr, enabled_withdraw, enabled_credit_card_offline/online, enabled_qr_credit |

### partner_rate
Cost & profit structure for a partner. PK = `partner_id`.

| Group | Columns |
|---|---|
| Cost (what partner pays Anypay) | cost_qr_cash_percent/time, cost_transfer_percent/time, cost_withdraw_* |
| Default rates (what partner sets for their merchants) | default_rate_qr_cash_percent/time, etc. |
| Profit split | qr_cash_profit_any_pay, qr_cash_profit_partner, transfer_profit_*, withdraw_* |
| Default types | default_type_qr_cash/transfer/withdraw_to_merchant/other |

### transfer_due
Settlement schedule per merchant. PK = `merchant_id`.

| Column | Notes |
|---|---|
| merchant_id | PK |
| monday–sunday | boolean — settle on this day? |
| half_month | boolean |
| month | boolean |
| transfer_hour | integer — hour of day to run settlement |

### users
Unified auth table for all user types.

| Column | Notes |
|---|---|
| username | PK (varchar) |
| merchant_id / staff_id / partner_id | One will be set; others NULL |
| register_partner_id | Partner that registered this user |
| enabled | |
| password | Hashed |
| failed_login_attempts, last_failed_login_time, locked_until | Brute-force lockout |
| mfa_otp_failed_attempts, mfa_otp_locked_until | MFA lockout |
| login_lock_tier | Tiered lockout escalation |
| login_permanently_locked | |

### reconcile_all
Cross-type reconciliation summary. Links internal records to bank statement rows.

| Column | Notes |
|---|---|
| id | |
| ptx_id | → payment_transaction |
| transfer_id | → transfer_transaction |
| reconcile_payment_detail_id | → reconcile_payment_transaction_details.id |
| reconcile_statement_detail_id | → reconcile_statement_transaction_details.id |
| reconcile_transfer_detail_id | → reconcile_transfer_transaction_details.id |
| type | payment / transfer / etc |
| anp_status | Anypay's recon status |
| bank_status | Bank's recon status |
| acq_transaction_id, amount, ref1/2 | Matching keys |
| report_date | |

### gateway_channel
Payment channel config (PromptPay, card, etc.). One row per configured channel.

| Column | Notes |
|---|---|
| id | |
| gwif_id | → gateway_info.id (which acquirer) |
| pay_type | Payment type this channel handles |
| merchant_id / merchant_name | Gateway-side merchant identifier |
| terminal_id | |
| min_amount, min_amount_check | |
| url1/2/3 | Gateway endpoint URLs |
| public_key / private_key / pass_key | Credentials |
| pgp_key_path, pgp_passphrase | PGP encryption for file-based recon |
| sftp_host/port/user/pass/dir | SFTP for statement download |
| transfer_sftp_* / transfer_pgp_* | Separate SFTP/PGP for transfer recon |
| bank_account_no/name/code | Settlement bank account |
| invoice_bank_account_id | |
| company_id | |
| is_show | Visible to merchants? |
| enabled | |

---

## Table Inventory

> Source: Query 1 — `pg_class` size snapshot

### Core Transaction Tables

| Table | Approx Rows | Total Size | Notes |
|---|---|---|---|
| `payment_transaction` | 53.9M | 57 GB | |
| `payment_transaction_balance` | 58.6M | 40 GB | |
| `transfer_transaction` | 12.8M | 29 GB | |
| `webhook` | 61.6M | 22 GB | |
| `transaction_commission` | 58.7M | 16 GB | |
| `reconcile_statement_transaction_details` | 59.2M | 15 GB | |
| `reconcile_payment_transaction_details` | 47.8M | 13 GB | |
| `payment_transaction_response` | 48.2M | 12 GB | |
| `action_log` | 66.9M | 8.5 GB | |
| `payment_information` | 51.9M | 7.1 GB | 1:1 with payment_transaction |
| `transfer_transaction_reference_no` | 12.7M | 3.7 GB | |
| `reconcile_transfer_transaction_details` | 12.3M | 2.6 GB | |
| `reconcile_all` | 2.2M | 501 MB | |

### Merchant & Partner Config

| Table | Approx Rows | Total Size | Notes |
|---|---|---|---|
| `merchant_info` | 1,491 | 2.9 MB | 100+ cols |
| `merchant_kym` | 5,448 | 1.5 MB | |
| `merchant_address` | 4,789 | 1.2 MB | |
| `merchant_process_history` | 3,659 | 1.2 MB | |
| `merchant_rate` | 1,369 | 928 kB | PK = merchant_id |
| `merchant_setting_rate` | 1,443 | 616 kB | Time-bound rate overrides |
| `merchant_kym_period` | 1,366 | 536 kB | |
| `merchant_personal_kyc_period` | 1,282 | 528 kB | |
| `merchant_personal_cdd_period` | 1,342 | 448 kB | |
| `merchant_personal_info` | 1,493 | 440 kB | Individual persons |
| `merchant_partner_meet_detail` | 1,067 | 440 kB | |
| `merchant_review` | 2,035 | 424 kB | |
| `merchant_personal_kyc` | 1,661 | 336 kB | |
| `merchant_key` | 357 | 248 kB | API client_id/secret |
| `merchant_file` | 79,736 | 38 MB | Document uploads |
| `partner_info` | 123 | 208 kB | |
| `partner_file` | 3,044 | 1.1 MB | |
| *(other partner_* tables)* | 47–473 | <200 kB each | Mirror of merchant_* structure |

### Financial Settlement

| Table | Approx Rows | Total Size | Notes |
|---|---|---|---|
| `transfer_due` | 1,439 | 328 kB | Settlement schedule, PK = merchant_id |
| `transfer_due_of_day` | 1,015 | 280 kB | Daily settlement run records |
| `transfer_commission_summary` | 90 | 80 kB | Partner commission batch |
| `transfer_commission_transaction` | 90 | 96 kB | Individual commission transfers |
| `reconcile_*_transaction` (3 tables) | 979–1,182 | ~400–580 kB | Recon batch headers |

### Gateway / Channels

| Table | Approx Rows | Total Size |
|---|---|---|
| `gateway_info` | 4 | 64 kB |
| `gateway_channel` | 11 | 72 kB |
| `gateway_channel_key` | 99 | 80 kB |

### Users & Auth

| Table | Approx Rows | Notes |
|---|---|---|
| `users` | 1,744 | PK = username (varchar) |
| `role` | 1,729 | Roles per username |
| `staff_info` | 66 | Internal staff |
| `password_history` | 1,324 | |
| `verification_email` | 718 | Email verification tokens |

### Reference / Lookup

| Table | Approx Rows | Notes |
|---|---|---|
| `province` | 77 | Thai provinces |
| `district` | 937 | |
| `sub_district` | 7,470 | Has `risk` and `score` columns — geographic risk scoring |
| `master_data` | 1,134 | Generic enum/config store — has `key1`, `key2`, `mcc`, `score` |
| `running_no` | 285 | Sequence generator by key/type/date |
| `blacklist` | 199 | General blacklist (type + value) |
| `blacklist_id_card` | 136,022 | Blocked Thai ID card numbers |
| `cash_connect` | 158 | |

### Misc / Other

| Table | Notes |
|---|---|
| `invoice` / `invoice_detail` | Merchant invoices for fees |
| `report` | Stored/generated report jobs |
| `transaction_fraud_monitoring` | Fraud alerts per transaction |
| `action_log` | 66.9M rows — API-level audit log (api_path, merchant_id, staff_id, detail) |
| `payment_transaction_balance_backup` | Ad-hoc point-in-time backup, same schema as balance table |
| `*_sandbox` tables | Full parallel test environment |
| `transfer_transaction_internal` | Internal transfers between gateway channels |
| `merchant_static_qr` | Static QR code config (empty) |
| `card_no_zone` | BIN/card range lookup for risk scoring (empty) |

---

## merchant_info — Onboarding State Machine

States in `merchant_info.state` and their counts (as of snapshot):

| State | Count | Meaning |
|---|---|---|
| `APPROVE` | 1,193 | Fully approved — live merchant |
| `BUSINESS_APPROVE` | 103 | Business-level approval done, pending final |
| `REJECT` | 80 | Rejected at some stage |
| `PRE_APPROVE_OPERATION` | 50 | Pending operations team review |
| NULL | 25 | No state (incomplete registrations) |
| `PRE_APPROVE_SUPERVISOR` | 20 | Pending supervisor sign-off |
| `PRE_APPROVE_DOCUMENT` | 15 | Pending document review |
| `REGISTER` | 3 | Just registered, not yet in review |
| `PRE_BUSINESS_APPROVE` | 2 | Pending final business approval step |

**FSM flow (inferred):**
```
REGISTER → PRE_APPROVE_DOCUMENT → PRE_APPROVE_OPERATION → PRE_APPROVE_SUPERVISOR
         → PRE_BUSINESS_APPROVE → BUSINESS_APPROVE → APPROVE
                                                    ↘ REJECT (from any stage)
```

---

## running_no — Sequence Generator Patterns

One row per (key, type, date). Resets daily. Used to build reference numbers.

| Type | Key format | Example | Purpose |
|---|---|---|---|
| `paymentQ` | `YYMMDD` | `260522` | Daily QR payment sequence counter |
| `transfer` | `YYMMDD` | `260522` | Daily transfer sequence counter |
| `paymentQC` | `YYMMDD` | `260226` | Daily QR Credit sequence (appeared Feb 2026) |
| `partnerContractNo` | `YYMM-` | `2605-` | Monthly partner contract number |
| `merchantContractNo` | `P/C + YYMM-` | `P2601-`, `C2603-` | Monthly merchant contract number (P=individual, C=company) |
| `partnerNo` | prefix string | `AE` | Partner number by prefix |

Active since at least Dec 2025. The `no` column holds the last used sequence value for that key/date — the large 65 MB table size comes from the integer values representing thousands of daily transactions.

---

## master_data — Enum/Config Store

Full list of `key1` categories (102 distinct keys):

### Reference Data
| key1 | Description |
|---|---|
| `BANK` | All Thai banks with numeric codes (002–079) — name_en, name_th |
| `BANK_ACCOUNT_TYPE` | Current Account / Saving Account |
| `COUNTRY` | Full country list (en + th) |
| `TITLE_NAME` | Thai name titles (Mr/Mrs/etc.) |
| `STATUS` | Generic status values |

### Business Classification (used in merchant/partner onboarding)
| key1 | Description |
|---|---|
| `BUSINESS_CATEGORY` | Top-level business category (Automotive, Food & Beverage, etc.) |
| `BUSINESS_GROUP` | MCC-linked sub-categories under BUSINESS_CATEGORY (key2 = category ID, mcc = MCC code) |
| `BUSINESS_TYPE` | Operational type: agent, manufacturer, wholesaler, service, other |
| `COMPANY_TYPE` | Legal structure: Company Limited, Public Company, Partnership, Other |
| `COMPANY_INCOME_RANGE` | Revenue brackets (e.g., <10M, 10–50M, ..., >5,000M THB) |
| `COMPANY_INCOME_TYPE` | Business income / employment / investment / property sale |
| `COMPANY_RELATIONSHIP` | Roles: Authorize Director, Shareholder >25%, Director, Proxy |
| `INDIVIDUAL_INCOME_RANGE` | Income brackets for individual merchants |
| `INDIVIDUAL_INCOME_TYPE` | Income type for individuals |
| `JOB` | Job categories for personal KYC |
| `PROPERTY` | Property types (for individual KYC) |
| `PROPERTY_VALUE` | Property value ranges |
| `MERCHANT_OBJECTIVE` | Merchant's stated business objective |
| `PARTNER_OBJECTIVE` | Partner's stated objective |
| `PRODUCT_RISK` | Product risk classifications |

### KYC / KYM Checklists
The `master_data` table stores all compliance checklist question definitions. Naming convention: `{entity}_{form}_{person_type}_{reviewer_role}[_{group}]`

- Entity: `MERCHANT` / `PARTNER`  
- Form: `KYC` (Know Your Customer) / `KYM` (Know Your Merchant) / `CDD` (Customer Due Diligence)  
- Channel: `OFFLINE` variant exists for offline-registered merchants  
- Person type: `C` = Company, `I` = Individual  
- Reviewer role: `O` = Operation, `R` = Risk  
- Group suffix `_1`–`_7`: Sub-groups of questions within a form

| key1 group | Forms covered |
|---|---|
| `KYC_C`, `KYC_I` | Base KYC templates |
| `KYM_C`, `KYM_I`, `KYM_C_1`–`KYM_C_6`, `KYM_I_1` | KYM question groups |
| `MERCHANT_KYC_C_O/R`, `MERCHANT_KYC_I_O/R` | Merchant KYC (online) by reviewer |
| `MERCHANT_KYM_C_O/R`, `MERCHANT_KYM_I_O/R` + `_1`–`_7` | Merchant KYM by reviewer and group |
| `MERCHANT_CDD_C_R`, `MERCHANT_CDD_I_R` | Merchant CDD (risk reviewer) |
| `MERCHANT_OFFLINE_KYC_*`, `MERCHANT_OFFLINE_KYM_*`, `MERCHANT_OFFLINE_CDD_*` | Offline channel equivalents |
| `PARTNER_KYC_C_O/R`, `PARTNER_KYC_I_O/R` | Partner KYC |
| `PARTNER_CDD_C_R`, `PARTNER_CDD_I_R` | Partner CDD |
| `PARTNER_MEET_MERCHANT_C/I` | Partner–merchant meeting checklist |

### Rate Configs
| key1 | Description |
|---|---|
| `EDC_RATE_CONFIG` / `EDC_RATE_CONFIG_DETAIL` | EDC (card terminal) rate configuration templates |
| `QC_RATE_CONFIG` / `QC_RATE_CONFIG_DETAIL` | QR Credit rate configuration templates |

---

## Still To Learn

- [ ] gateway_info rows (only 4 — which acquirers/banks?)
- [ ] Distinct values of `payment_transaction.status`, `pay_type`, `payment_type`
- [ ] Distinct values of `transfer_transaction.status`, `type`, `payment_type`
- [ ] Webhook `type` + `status` distribution
