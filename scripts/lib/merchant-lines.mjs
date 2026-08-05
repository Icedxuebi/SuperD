// Shared SQL behind the merchant "line" scripts:
//   gen-bank-lines.mjs    — bank details as one delimited line
//   gen-address-lines.mjs — address as one space-joined line
//   fill-data-xlsx.mjs    — writes both into data.xlsx
//
// It lives here so the spreadsheet columns cannot drift from what the CLIs
// print: data.xlsx's own headers say "use gen-address-lines.mjs" / "use
// gen_bank)lines.mjs", so the two must stay defined in exactly one place.
//
// Both queries take the same two bind params:
//   $1 :: text[]  MIDs to filter to, or NULL for every merchant
//   $2 :: text    separator placed between the parts of the line
//
// Both return one row per merchant_info row (LEFT JOINed), so merchants with no
// data still come back with an empty line rather than vanishing.

// -- BANK ---------------------------------------------------------------------
// Two fields:  $<3-digit bank code>,<account number>       e.g.  $006,2363277538
// The bank code is prefixed with a literal '$'. Bank name, account holder name
// and account type are deliberately NOT included.
//
// The bank code is the Bank of Thailand 3-digit code, held as master_data.key2
// (verified: all 33 BANK rows have one, all match ^[0-9]{3}$, range 002-089, no
// duplicates). It is NOT merchant_info.bank_id — that column holds the
// master_data ROW ID (e.g. Krung Thai is bank_id 3, but BOT code '006').
//
// So this join is a deliberate hybrid of the two patterns in docs/dbinfo.md
// ("master_data Foreign Key Patterns"): join by id because that is what
// merchant_info.bank_id stores (Pattern 1), then read key2 off the matched row to
// get the code (the value Pattern 2 columns like transfer_transaction.bank_code
// store directly). Do not "simplify" this into a key2 = bank_id join — it would
// match nothing, silently, since the DB has no FK constraints.
//
// The key1 = 'BANK' guard is load-bearing, not redundant: merchant_info holds
// bare master_data ids, so without it an id can match another category's row.
// (Real example: one merchant's bank_account_type_id points at a PRODUCT_RISK
// row. That column is gone from this query now, but it is why the guard exists.)
//
// Fields are COALESCEd, so a missing one leaves an EMPTY SLOT and the line always
// has 2 fields. (Bare concat_ws would drop the slot and shift the rest left.)
// The '$' belongs to the bank field, so a blank bank field is blank — no lone '$'.
//
// bank_account_no is btrim'd: two merchants store it with a leading space
// (' 8032031564'), which would otherwise land in the output verbatim.
export const BANK_LINE_SQL = `
SELECT
    mi.merchant_no,
    mi.id::text AS id,
    concat_ws($2::text,
        CASE
            WHEN NULLIF(btrim(md_bank.key2), '') IS NULL THEN ''
            ELSE '$' || btrim(md_bank.key2)
        END,
        COALESCE(btrim(mi.bank_account_no), '')
    ) AS bank_line
FROM merchant_info mi
LEFT JOIN master_data md_bank
  ON md_bank.id::text = mi.bank_id::text
 AND md_bank.key1 = 'BANK'
WHERE ($1::text[] IS NULL OR mi.merchant_no = ANY($1::text[]))
ORDER BY mi.merchant_no
`;

// -- ADDRESS ------------------------------------------------------------------
// merchant_address is reachable two ways: only ~850 of ~5,300 rows carry
// merchant_id, the other ~4,500 hang off merchant_personal_id ->
// merchant_personal_info.merchant_id. Most merchants have NO address on the
// direct path, so both must be unioned. A row carries one FK or the other, never
// both, so the union cannot double-count.
//
// A merchant typically has 3-4 addresses discriminated by `type`; we take the
// first that exists by priority SHOP_ADDRESS -> WORKING -> CURRENT -> PERSONAL ->
// (anything else). SHOP_ADDRESS is the true store location but only ~236
// merchants have one, so without the fallback 85% of lines would be empty. The
// trailing tier catches COMPANY_REGISTRATION / blank-type rows as a last resort.
// `isactive` is NULL on every row, so it is not a usable filter.
//
// district_id / sub_district_id / province_id are real integer FKs into the
// dedicated district / sub_district / province tables — NOT master_data, so no
// key1 guard or ::text cast applies. Names use name_th: the free-text parts
// (road, soi, ...) are stored in Thai, so name_en would give a mixed-script line.
//
// Unlike the bank line, missing fields COLLAPSE rather than leave a slot — the
// separator is a space, so an empty slot would just be a double space.
//
// postal_code comes from the SAME picked address row as the line, so the two
// always describe one place.
export const ADDRESS_LINE_SQL = `
WITH reach AS (
    -- direct link
    SELECT mi.id AS merchant_id, ma.id AS addr_id, ma.type,
           ma.no, ma.moo, ma.building, ma.floor, ma.soi, ma.road,
           ma.sub_district_id, ma.district_id, ma.province_id, ma.postal_code
    FROM merchant_address ma
    JOIN merchant_info mi ON mi.id = ma.merchant_id
    UNION ALL
    -- via the personal-info record
    SELECT mi.id, ma.id, ma.type,
           ma.no, ma.moo, ma.building, ma.floor, ma.soi, ma.road,
           ma.sub_district_id, ma.district_id, ma.province_id, ma.postal_code
    FROM merchant_address ma
    JOIN merchant_personal_info mpi ON mpi.id = ma.merchant_personal_id
    JOIN merchant_info mi ON mi.id = mpi.merchant_id
),
picked AS (
    SELECT DISTINCT ON (merchant_id) *
    FROM reach
    ORDER BY merchant_id,
             CASE type
                 WHEN 'SHOP_ADDRESS' THEN 1
                 WHEN 'WORKING'      THEN 2
                 WHEN 'CURRENT'      THEN 3
                 WHEN 'PERSONAL'     THEN 4
                 ELSE 5
             END,
             addr_id
)
SELECT
    mi.merchant_no,
    mi.id::text                       AS id,
    COALESCE(p.type, '')              AS addr_type,
    COALESCE(p.postal_code, '')       AS postal_code,
    COALESCE(concat_ws($2::text,
        NULLIF(btrim(p.no), ''),
        NULLIF(btrim(p.moo), ''),
        NULLIF(btrim(p.building), ''),
        NULLIF(btrim(p.floor), ''),
        NULLIF(btrim(p.soi), ''),
        NULLIF(btrim(p.road), ''),
        NULLIF(btrim(sd.name_th), ''),
        NULLIF(btrim(d.name_th), ''),
        NULLIF(btrim(pv.name_th), '')
    ), '')                            AS address_line
FROM merchant_info mi
LEFT JOIN picked p        ON p.merchant_id = mi.id
LEFT JOIN sub_district sd ON sd.id = p.sub_district_id
LEFT JOIN district d      ON d.id  = p.district_id
LEFT JOIN province pv     ON pv.id = p.province_id
WHERE ($1::text[] IS NULL OR mi.merchant_no = ANY($1::text[]))
ORDER BY mi.merchant_no
`;

// -- TAX ID / REGISTERED CAPITAL ----------------------------------------------
// person_type 'I' = individual (บุคคลธรรมดา), 'C' = company (นิติบุคคล).
// Individuals have company_tax_id = '' and carry their 13-digit citizen_id on
// merchant_personal_info instead; companies have both, and their citizen_id copy
// sometimes drops the leading zero — so company_tax_id wins when present.
// company_register_capital is only ever set for companies.
// merchant_personal_info is 1:1 with merchant_info, so this join can't fan out.
export const TAX_CAPITAL_SQL = `
SELECT
    mi.merchant_no,
    mi.person_type,
    COALESCE(
        NULLIF(btrim(mi.company_tax_id), ''),
        NULLIF(btrim(mpi.citizen_id), ''),
        ''
    )                                    AS tax_id,
    mi.company_register_capital::text    AS company_register_capital
FROM merchant_info mi
LEFT JOIN merchant_personal_info mpi ON mpi.merchant_id = mi.id
WHERE ($1::text[] IS NULL OR mi.merchant_no = ANY($1::text[]))
ORDER BY mi.merchant_no
`;
