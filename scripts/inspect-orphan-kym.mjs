import pg from "pg";

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

const url = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 2,
});

async function run(label, sql) {
  console.log(`\n=== ${label} ===`);
  try {
    const start = Date.now();
    const { rows } = await pool.query(sql);
    console.log(`(${((Date.now() - start) / 1000).toFixed(1)}s, ${rows.length} rows)`);
    console.table(rows);
  } catch (err) {
    console.log(`(error: ${err.message})`);
  }
}

// Coverage of alternate identifying fields on the 109 surviving KYM rows
// whose merchant has no merchant_no. The page currently shows blank cells for
// these; we want to find which fallback fields would actually carry data.
await run(
  "Fallback-field coverage for KYM rows with no merchant_no",
  `
    WITH src AS (
      SELECT
        kp.id AS kym_id,
        kp.merchant_id,
        kp.create_by,
        mi.state,
        mi.merchant_name_en,
        mi.merchant_name_th,
        mi.company_name_en,
        mi.company_name_th,
        mi.company_tax_id,
        mi.company_telephone,
        mi.bank_account_name,
        mi.partner_id
      FROM merchant_kym_period kp
      LEFT JOIN merchant_info mi ON mi.id = kp.merchant_id
      WHERE mi.close_date IS NULL
        AND mi.state IS DISTINCT FROM 'APPROVE'
        AND mi.merchant_no IS NULL
    )
    SELECT
      COUNT(*)::int                                                          AS total,
      COUNT(merchant_name_en) FILTER (WHERE merchant_name_en <> '')::int     AS has_merchant_name_en,
      COUNT(merchant_name_th) FILTER (WHERE merchant_name_th <> '')::int     AS has_merchant_name_th,
      COUNT(company_name_en)  FILTER (WHERE company_name_en  <> '')::int     AS has_company_name_en,
      COUNT(company_name_th)  FILTER (WHERE company_name_th  <> '')::int     AS has_company_name_th,
      COUNT(company_tax_id)   FILTER (WHERE company_tax_id   <> '')::int     AS has_tax_id,
      COUNT(company_telephone) FILTER (WHERE company_telephone <> '')::int   AS has_phone,
      COUNT(bank_account_name) FILTER (WHERE bank_account_name <> '')::int   AS has_bank_acct_name,
      COUNT(state)::int                                                      AS has_state,
      COUNT(create_by)::int                                                  AS has_create_by
    FROM src
  `,
);

// Show 10 sample orphan rows with all the candidate fallback fields so we
// can eyeball what would actually be useful to display.
await run(
  "Sample orphan KYM rows with all candidate fallback fields",
  `
    SELECT
      kp.id            AS kym_id,
      kp.merchant_id,
      mi.state,
      mi.merchant_name_en,
      mi.merchant_name_th,
      mi.company_name_en,
      mi.company_name_th,
      mi.company_tax_id,
      mi.company_telephone,
      mi.bank_account_name,
      kp.create_by
    FROM merchant_kym_period kp
    LEFT JOIN merchant_info mi ON mi.id = kp.merchant_id
    WHERE mi.close_date IS NULL
      AND mi.state IS DISTINCT FROM 'APPROVE'
      AND mi.merchant_no IS NULL
    ORDER BY kp.id DESC
    LIMIT 10
  `,
);

// Same check for the 35 rows that have merchant_no but no company name
await run(
  "Fallback-field coverage for KYM rows that HAVE merchant_no but no company name",
  `
    WITH src AS (
      SELECT
        mi.merchant_name_en,
        mi.merchant_name_th,
        mi.company_tax_id,
        mi.company_telephone
      FROM merchant_kym_period kp
      LEFT JOIN merchant_info mi ON mi.id = kp.merchant_id
      WHERE mi.close_date IS NULL
        AND mi.state IS DISTINCT FROM 'APPROVE'
        AND mi.merchant_no IS NOT NULL
        AND COALESCE(mi.company_name_en, mi.company_name_th) IS NULL
    )
    SELECT
      COUNT(*)::int                                                          AS total,
      COUNT(merchant_name_en) FILTER (WHERE merchant_name_en <> '')::int     AS has_merchant_name_en,
      COUNT(merchant_name_th) FILTER (WHERE merchant_name_th <> '')::int     AS has_merchant_name_th,
      COUNT(company_tax_id)   FILTER (WHERE company_tax_id   <> '')::int     AS has_tax_id,
      COUNT(company_telephone) FILTER (WHERE company_telephone <> '')::int   AS has_phone
    FROM src
  `,
);

await pool.end();
