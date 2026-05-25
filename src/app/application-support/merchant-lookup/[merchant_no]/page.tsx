import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MID_RE = /^[A-Z][A-Z0-9]{2,30}$/;

type Merchant = {
  id: string;
  merchant_no: string;
  merchant_contract_no: string | null;
  person_type: string | null;
  partner_no: string | null;
  partner_company_name: string | null;
  state: string | null;

  merchant_name_en: string | null;
  merchant_name_th: string | null;
  company_name_en: string | null;
  company_name_th: string | null;
  company_tax_id: string | null;
  company_register_date: string | null;
  company_register_capital: string | null;
  business_category_name: string | null;
  business_group_name: string | null;
  business_detail: string | null;

  company_telephone: string | null;
  website: string | null;
  ip_host: string | null;
  ip_host_country_name: string | null;
  username: string | null;
  is_other_payment_use: boolean | null;
  other_payment_use: string | null;

  bank_account_name: string | null;
  bank_account_no: string | null;
  bank_account_branch: string | null;
  bank_name: string | null;
  bank_account_type_name: string | null;

  qr_gwc_id: string | null;
  gateway_provider: string | null;

  product: string | null;
  product_detail: string | null;
  product_min_price: string | null;
  product_max_price: string | null;
  currency: string | null;
  currency_code: string | null;
  credit: string | null;
  qr_cash: string | null;

  enabled: boolean | null;
  enabled_sandbox: boolean | null;
  is_online_shop: boolean | null;
  is_offline_shop: boolean | null;
  credit_card_offline: string | null;
  credit_card_online: string | null;
  qr_credit: string | null;
  webhook_qr_cash: string | null;
  webhook_transfer: string | null;
  webhook_qr_credit: string | null;
  webhook_sandbox_qr_cash: string | null;
  webhook_sandbox_transfer: string | null;
  webhook_sandbox_qr_credit: string | null;

  risk: string | null;
  black_list: boolean | null;
  black_list_after_approve: boolean | null;
  auto_reject: boolean | null;
  auto_reject_detail: string | null;
  consent_pdpa: boolean | null;
  consent_policy: boolean | null;
  check_ip: boolean | null;
  max_amount_per_month: string | null;
  max_count_per_month: number | null;

  operation_approve_date: string | null;
  operation_manager_approve_date: string | null;
  risk_approve_date: string | null;
  risk_manager_approve_date: string | null;
  manager_approve_date: string | null;
  supervisor_approve_date: string | null;

  register_date: string | null;
  create_by: string | null;
  create_date: string | null;
  update_by: string | null;
  update_date: string | null;
  close_date: string | null;
  close_remark: string | null;

  rate_qr_cash_percent: number | null;
  rate_qr_cash_time: number | null;
  rate_transfer_percent: number | null;
  rate_transfer_time: number | null;
  rate_withdraw_to_merchant_percent: number | null;
  rate_withdraw_to_merchant_time: number | null;
  rate_withdraw_to_other_percent: number | null;
  rate_withdraw_to_other_time: number | null;
  transaction_min_amount: number | null;
  transaction_max_amount: number | null;
  transaction_max_amount_per_month: number | null;
  transaction_max_count_per_month: number | null;
  withdraw_min_amount: number | null;
  withdraw_max_amount: number | null;
};

type PersonalInfo = {
  full_name_th: string | null;
  full_name_en: string | null;
  citizen_id: string | null;
  national: string | null;
  dob: string | null;
  expire_id_card: string | null;
  title_name: string | null;
  job_name: string | null;
  income_type_id: string | null;
  income_range_id: string | null;
  percent_of_shareholder: string | null;
  position: string | null;
  is_political: boolean | null;
  is_contact_person: boolean | null;
  is_director: boolean | null;
  is_authorize: boolean | null;
  is_relation_ship: boolean | null;
  contact_address: string | null;
  telephone: string | null;
};

type SettingRate = {
  id: string;
  payment_type: string | null;
  start_date: string | null;
  end_date: string | null;
  create_date: string | null;
  rate_percent: number | null;
  rate_per_time: number | null;
  rate_transfer_percent: number | null;
  rate_transfer_per_time: number | null;
  rate_withdraw_to_merchant_percent: number | null;
  rate_withdraw_to_merchant_per_time: number | null;
  rate_withdraw_to_other_percent: number | null;
  rate_withdraw_to_other_per_time: number | null;
};

const SQL_MERCHANT = `
SELECT
    mi.id::text AS id,
    mi.merchant_no,
    mi.merchant_contract_no,
    mi.person_type,
    pi.partner_no,
    pi.company_name_en              AS partner_company_name,
    mi.state,

    mi.merchant_name_en,
    mi.merchant_name_th,
    mi.company_name_en,
    mi.company_name_th,
    mi.company_tax_id,
    mi.company_register_date,
    mi.company_register_capital,
    md_bcat.name_en                 AS business_category_name,
    md_bgrp.name_en                 AS business_group_name,
    mi.business_detail,

    mi.company_telephone,
    mi.website,
    mi.ip_host,
    md_country.name_en              AS ip_host_country_name,
    (
        SELECT u.username FROM users u
        WHERE u.merchant_id = mi.id
        ORDER BY u.username LIMIT 1
    )                               AS username,
    mi.is_other_payment_use,
    mi.other_payment_use,

    mi.bank_account_name,
    mi.bank_account_no,
    mi.bank_account_branch,
    md_bank.name_en                 AS bank_name,
    md_acct.name_en                 AS bank_account_type_name,

    mi.qr_gwc_id::text              AS qr_gwc_id,
    CASE
      WHEN gi.name_en IS NOT NULL AND gc.merchant_id IS NOT NULL
        THEN gi.name_en || '(' || gc.merchant_id || ')'
      WHEN gi.name_en IS NOT NULL THEN gi.name_en
      ELSE NULL
    END                             AS gateway_provider,

    mi.product,
    mi.product_detail,
    mi.product_min_price,
    mi.product_max_price,
    mi.currency,
    mi.currency_code,
    mi.credit,
    mi.qr_cash,

    mi.enabled,
    mi.enabled_sandbox,
    mi.is_online_shop,
    mi.is_offline_shop,
    mi.credit_card_offline,
    mi.credit_card_online,
    mi.qr_credit,
    mi.webhook_qr_cash,
    mi.webhook_transfer,
    mi.webhook_qr_credit,
    mi.webhook_sandbox_qr_cash,
    mi.webhook_sandbox_transfer,
    mi.webhook_sandbox_qr_credit,

    mi.risk,
    mi.black_list,
    mi.black_list_after_approve,
    mi.auto_reject,
    mi.auto_reject_detail,
    mi.consent_pdpa,
    mi.consent_policy,
    mi.check_ip,
    mi.max_amount_per_month,
    mi.max_count_per_month,

    mi.operation_approve_date,
    mi.operation_manager_approve_date,
    mi.risk_approve_date,
    mi.risk_manager_approve_date,
    mi.manager_approve_date,
    mi.supervisor_approve_date,

    mi.register_date,
    mi.create_by,
    mi.create_date,
    mi.update_by,
    mi.update_date,
    mi.close_date,
    mi.close_remark,

    mr.rate_qr_cash_percent,
    mr.rate_qr_cash_time,
    mr.rate_transfer_percent,
    mr.rate_transfer_time,
    mr.rate_withdraw_to_merchant_percent,
    mr.rate_withdraw_to_merchant_time,
    mr.rate_withdraw_to_other_percent,
    mr.rate_withdraw_to_other_time,
    mr.transaction_min_amount,
    mr.transaction_max_amount,
    mr.transaction_max_amount_per_month,
    mr.transaction_max_count_per_month,
    mr.withdraw_min_amount,
    mr.withdraw_max_amount
FROM merchant_info mi
LEFT JOIN partner_info pi          ON pi.id = mi.partner_id
LEFT JOIN master_data md_bank      ON md_bank.id::text    = mi.bank_id::text              AND md_bank.key1    = 'BANK'
LEFT JOIN master_data md_acct      ON md_acct.id::text    = mi.bank_account_type_id::text AND md_acct.key1    = 'BANK_ACCOUNT_TYPE'
LEFT JOIN master_data md_country   ON md_country.id::text = mi.ip_host_country::text      AND md_country.key1 = 'COUNTRY'
LEFT JOIN master_data md_bcat      ON md_bcat.id::text    = mi.business_category_id::text AND md_bcat.key1    = 'BUSINESS_CATEGORY'
LEFT JOIN master_data md_bgrp      ON md_bgrp.id::text    = mi.business_group_id::text    AND md_bgrp.key1    = 'BUSINESS_GROUP'
LEFT JOIN gateway_channel gc       ON gc.id = mi.qr_gwc_id
LEFT JOIN gateway_info gi          ON gi.id = gc.gwif_id
LEFT JOIN merchant_rate mr         ON mr.merchant_id = mi.id
WHERE mi.merchant_no = $1
LIMIT 1;
`;

const SQL_PERSONAL = `
SELECT
    mpi.full_name_th,
    mpi.full_name_en,
    mpi.citizen_id,
    mpi.national,
    mpi.dob,
    mpi.expire_id_card,
    md_title.name_en  AS title_name,
    md_job.name_en    AS job_name,
    mpi.income_type_id,
    mpi.income_range_id::text AS income_range_id,
    mpi.percent_of_shareholder,
    mpi.position,
    mpi.is_political,
    mpi.is_contact_person,
    mpi.is_director,
    mpi.is_authorize,
    mpi.is_relation_ship,
    mpi.contact_address,
    mpi.telephone
FROM merchant_personal_info mpi
LEFT JOIN master_data md_title ON md_title.id::text = mpi.title_name_id::text AND md_title.key1 = 'TITLE_NAME'
LEFT JOIN master_data md_job   ON md_job.id::text   = mpi.job_id::text         AND md_job.key1   = 'JOB'
WHERE mpi.merchant_id = $1
ORDER BY mpi.id
LIMIT 1;
`;

const SQL_SETTING_RATE = `
SELECT
    id::text AS id,
    payment_type,
    start_date,
    end_date,
    create_date,
    rate_percent,
    rate_per_time,
    rate_transfer_percent,
    rate_transfer_per_time,
    rate_withdraw_to_merchant_percent,
    rate_withdraw_to_merchant_per_time,
    rate_withdraw_to_other_percent,
    rate_withdraw_to_other_per_time
FROM merchant_setting_rate
WHERE merchant_id = $1
ORDER BY start_date DESC NULLS LAST, id DESC;
`;

async function fetchAll(merchant_no: string) {
  const pool = getPool();
  const m = await pool.query<Merchant>(SQL_MERCHANT, [merchant_no]);
  const merchant = m.rows[0];
  if (!merchant) return null;
  const [personal, rates] = await Promise.all([
    pool.query<PersonalInfo>(SQL_PERSONAL, [merchant.id]),
    pool.query<SettingRate>(SQL_SETTING_RATE, [merchant.id]),
  ]);
  return { merchant, personal: personal.rows[0] ?? null, rates: rates.rows };
}

const thbFmt = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numFmt = new Intl.NumberFormat("en-US");

const percentFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function fmtThaiBool(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v ? "ใช่" : "ไม่ใช่";
}

function fmtMoney(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return thbFmt.format(n);
}

function fmtNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return numFmt.format(n);
}

function fmtPercent(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `${percentFmt.format(n)}%`;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return String(v).replace("T", " ").replace("Z", "").slice(0, 19);
}

function fmtDateOnly(v: string | null | undefined): string {
  if (!v) return "—";
  return String(v).replace("T", " ").replace("Z", "").slice(0, 10);
}

const PAYMENT_TYPE_LABEL: Record<string, string> = {
  Q: "QR Cash",
  QC: "QR Credit",
  CO: "Credit Card Online",
  CF: "Credit Card Offline",
  T: "Transfer",
};

function StateBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-slate-400">—</span>;
  const color =
    state === "APPROVE"
      ? "bg-emerald-100 text-emerald-700"
      : state === "REJECT"
        ? "bg-red-100 text-red-700"
        : state.startsWith("PRE_") || state === "REGISTER"
          ? "bg-amber-100 text-amber-700"
          : state === "BUSINESS_APPROVE"
            ? "bg-brand-100 text-brand-700"
            : "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${color}`}
    >
      {state}
    </span>
  );
}

function Card({
  title,
  accent = "bg-brand-600",
  children,
}: {
  title: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200/80 rounded-xl p-6 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <span className={`inline-block w-1 h-5 rounded-full ${accent}`} />
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-slate-700 mt-2 mb-3">{children}</h3>
  );
}

function FieldGrid({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  const colsCls = cols === 2 ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3";
  return <div className={`grid grid-cols-1 ${colsCls} gap-x-6 gap-y-4`}>{children}</div>;
}

function Field({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${wide ? "md:col-span-2 lg:col-span-3" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`text-sm text-slate-800 break-words ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function personTypeLabel(pt: string | null): string {
  if (pt === "C") return "นิติบุคคล";
  if (pt === "I") return "บุคคลธรรมดา";
  return pt ?? "—";
}

export default async function MerchantDetailPage({
  params,
}: {
  params: Promise<{ merchant_no: string }>;
}) {
  const { merchant_no } = await params;

  if (!MID_RE.test(merchant_no)) {
    notFound();
  }

  const data = await fetchAll(merchant_no);
  if (!data) notFound();
  const { merchant: m, personal, rates } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/application-support/merchant-lookup"
            className="text-sm text-brand-600 hover:text-brand-700 hover:underline inline-flex items-center gap-1 mb-2"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to all merchants
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">
            {m.merchant_name_en ?? m.merchant_name_th ?? "—"}
          </h1>
          <p className="text-slate-600 flex items-center gap-3 flex-wrap">
            <span className="font-mono text-sm">{m.merchant_no}</span>
            <span className="text-slate-300">·</span>
            <StateBadge state={m.state} />
            <span className="text-slate-300">·</span>
            <span className="text-sm">{personTypeLabel(m.person_type)}</span>
          </p>
        </div>
      </div>

      <Card title="Basic Information">
        <FieldGrid>
          <Field label="Merchant ID" value={fmt(m.merchant_no)} mono />
          <Field
            label="Partner No"
            value={
              m.partner_no
                ? `${m.partner_no}${m.partner_company_name ? ` — ${m.partner_company_name}` : ""}`
                : "—"
            }
          />
          <Field label="Username" value={fmt(m.username)} />
          <Field label="Merchant Name (Thai)" value={fmt(m.merchant_name_th)} />
          <Field label="Merchant Name (English)" value={fmt(m.merchant_name_en)} />
          <Field label="Person Type" value={personTypeLabel(m.person_type)} />
          <Field label="Shop Type" value={
            m.is_online_shop || m.is_offline_shop
              ? [m.is_online_shop ? "Online" : null, m.is_offline_shop ? "Offline" : null]
                  .filter(Boolean)
                  .join(" / ")
              : "—"
          } />
          <Field label="State" value={<StateBadge state={m.state} />} />
          <Field label="Risk Level" value={fmt(m.risk)} />
          <Field label="Register Date" value={fmtDate(m.register_date)} mono />
          <Field label="Email" value="—" />
          <Field label="Telephone" value={fmt(m.company_telephone)} />
          <Field label="Business Type" value={fmt(m.business_category_name)} />
          <Field label="Business Group" value={fmt(m.business_group_name)} />
          <Field label="Max Amount Per Month" value={fmtMoney(m.max_amount_per_month)} mono />
          <Field label="Max Count Per Month" value={fmtNumber(m.max_count_per_month)} mono />
          <Field label="Contract No" value={fmt(m.merchant_contract_no)} mono />
        </FieldGrid>
      </Card>

      {m.person_type === "I" && (
        <Card title="Personal Information" accent="bg-accent-500">
          <FieldGrid>
            <Field label="Name" value={fmt(personal?.full_name_th ?? personal?.full_name_en ?? null)} />
            <Field label="Title" value={fmt(personal?.title_name)} />
            <Field label="Citizen ID" value={fmt(personal?.citizen_id)} mono />
            <Field label="Nationality" value={fmt(personal?.national)} />
            <Field label="Date of Birth" value={fmtDateOnly(personal?.dob)} mono />
            <Field label="ID Card Expiry" value={fmtDateOnly(personal?.expire_id_card)} mono />
            <Field label="Job" value={fmt(personal?.job_name)} />
            <Field label="Income Type" value={fmt(personal?.income_type_id)} />
            <Field label="Income Range" value={fmt(personal?.income_range_id)} />
            <Field label="Share Percentage" value={fmt(personal?.percent_of_shareholder)} />
            <Field label="Position" value={fmt(personal?.position)} />
            <Field label="Telephone" value={fmt(personal?.telephone)} />
            <Field label="Is Political Person" value={fmtThaiBool(personal?.is_political ?? null)} />
            <Field label="Is Contact Person" value={fmtThaiBool(personal?.is_contact_person ?? null)} />
            <Field label="Is Director" value={fmtThaiBool(personal?.is_director ?? null)} />
            <Field label="Is Authorized" value={fmtThaiBool(personal?.is_authorize ?? null)} />
            <Field label="Is Related" value={fmtThaiBool(personal?.is_relation_ship ?? null)} />
            <Field label="Address" value={fmt(personal?.contact_address)} wide />
          </FieldGrid>
        </Card>
      )}

      <Card title="Business Information" accent="bg-slate-700">
        <FieldGrid>
          <Field label="Business Type" value={fmt(m.business_category_name)} />
          <Field label="Business Detail" value={fmt(m.business_detail)} />
          <Field label="QR GWC ID" value={fmt(m.gateway_provider)} mono />
          <Field label="Credit" value={fmt(m.credit)} />
          <Field label="QR Cash" value={fmt(m.qr_cash)} />
          <Field
            label="Currency"
            value={
              m.currency
                ? `${m.currency}${m.currency_code ? ` (${m.currency_code})` : ""}`
                : "—"
            }
          />
          <Field label="Product" value={fmt(m.product)} />
          <Field label="Product Detail" value={fmt(m.product_detail)} />
          <Field label="Min Price" value={fmtMoney(m.product_min_price)} mono />
          <Field label="Max Price" value={fmtMoney(m.product_max_price)} mono />
        </FieldGrid>
      </Card>

      <Card title="Contact Information" accent="bg-accent-500">
        <FieldGrid>
          <Field label="Website" value={fmt(m.website)} />
          <Field label="IP Host" value={fmt(m.ip_host)} mono />
          <Field label="IP Host Country" value={fmt(m.ip_host_country_name)} />
          <Field
            label="Other Payment Use"
            value={
              m.is_other_payment_use
                ? `ใช่${m.other_payment_use ? ` — ${m.other_payment_use}` : ""}`
                : "ไม่"
            }
          />
        </FieldGrid>
      </Card>

      <Card title="Bank Information" accent="bg-brand-600">
        <FieldGrid>
          <Field label="Bank" value={fmt(m.bank_name)} />
          <Field label="Bank Account No" value={fmt(m.bank_account_no)} mono />
          <Field label="Bank Account Name" value={fmt(m.bank_account_name)} />
          <Field label="Bank Account Type" value={fmt(m.bank_account_type_name)} />
          <Field label="Bank Branch" value={fmt(m.bank_account_branch)} />
        </FieldGrid>
      </Card>

      <Card title="Gateway Information" accent="bg-slate-700">
        <FieldGrid>
          <Field
            label="Max Amount Per Month (Transaction)"
            value={fmtMoney(m.transaction_max_amount_per_month)}
            mono
          />
          <Field
            label="Max Count Per Month (Transaction)"
            value={fmtNumber(m.transaction_max_count_per_month)}
            mono
          />
          <Field label="MDR QR Cash Percent" value={fmtPercent(m.rate_qr_cash_percent)} mono />
          <Field label="MDR Minimum QR Cash" value={fmtMoney(m.rate_qr_cash_time)} mono />
          <Field label="Gateway Provider" value={fmt(m.gateway_provider)} mono />
        </FieldGrid>
      </Card>

      <Card title="Transfer Information" accent="bg-slate-700">
        <FieldGrid cols={2}>
          <Field label="Transfer Percent" value={fmtPercent(m.rate_transfer_percent)} mono />
          <Field label="Minimum Transfer Fee" value={fmtMoney(m.rate_transfer_time)} mono />
        </FieldGrid>
      </Card>

      <Card title="Withdraw Information" accent="bg-slate-700">
        <SubHeading>To Own Account</SubHeading>
        <FieldGrid>
          <Field
            label="Withdraw Percent (Own)"
            value={fmtPercent(m.rate_withdraw_to_merchant_percent)}
            mono
          />
          <Field
            label="Minimum Withdraw Fee (Own)"
            value={fmtMoney(m.rate_withdraw_to_merchant_time)}
            mono
          />
        </FieldGrid>
        <SubHeading>To Other Account</SubHeading>
        <FieldGrid>
          <Field
            label="Withdraw Percent (Other)"
            value={fmtPercent(m.rate_withdraw_to_other_percent)}
            mono
          />
          <Field
            label="Minimum Withdraw Fee (Other)"
            value={fmtMoney(m.rate_withdraw_to_other_time)}
            mono
          />
          <Field label="Withdraw Min Amount" value={fmtMoney(m.withdraw_min_amount)} mono />
          <Field label="Withdraw Max Amount" value={fmtMoney(m.withdraw_max_amount)} mono />
        </FieldGrid>
      </Card>

      <Card title="Transaction Information" accent="bg-slate-700">
        <FieldGrid>
          <Field label="Transaction Min Amount" value={fmtMoney(m.transaction_min_amount)} mono />
          <Field label="Transaction Max Amount" value={fmtMoney(m.transaction_max_amount)} mono />
          <Field label="Max Amount Per Month" value={fmtMoney(m.max_amount_per_month)} mono />
          <Field label="Max Count Per Month" value={fmtNumber(m.max_count_per_month)} mono />
        </FieldGrid>
      </Card>

      <Card title="Webhook Information" accent="bg-slate-700">
        <div className="space-y-5">
          <div>
            <SubHeading>Webhook QR Cash</SubHeading>
            <FieldGrid cols={2}>
              <Field label="Webhook QR Cash" value={fmt(m.webhook_qr_cash)} mono wide />
              <Field
                label="Webhook Sandbox QR Cash"
                value={fmt(m.webhook_sandbox_qr_cash)}
                mono
                wide
              />
            </FieldGrid>
          </div>
          <div>
            <SubHeading>Webhook QR Credit</SubHeading>
            <FieldGrid cols={2}>
              <Field label="Webhook QR Credit" value={fmt(m.webhook_qr_credit)} mono wide />
              <Field
                label="Webhook Sandbox QR Credit"
                value={fmt(m.webhook_sandbox_qr_credit)}
                mono
                wide
              />
            </FieldGrid>
          </div>
          <div>
            <SubHeading>Webhook Withdraw</SubHeading>
            <FieldGrid cols={2}>
              <Field label="Webhook Withdraw" value={fmt(m.webhook_transfer)} mono wide />
              <Field
                label="Webhook Sandbox Withdraw"
                value={fmt(m.webhook_sandbox_transfer)}
                mono
                wide
              />
            </FieldGrid>
          </div>
        </div>
      </Card>

      <Card title="Merchant Setting Rate" accent="bg-brand-600">
        {rates.length === 0 ? (
          <p className="text-sm text-slate-500">—</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="px-3 py-2 text-left">No.</th>
                  <th className="px-3 py-2 text-left">Payment Type</th>
                  <th className="px-3 py-2 text-left">Start Date</th>
                  <th className="px-3 py-2 text-left">End Date</th>
                  <th className="px-3 py-2 text-left">Created Date</th>
                  <th className="px-3 py-2 text-right font-mono">Rate (%)</th>
                  <th className="px-3 py-2 text-right font-mono">Minimum (THB)</th>
                  <th className="px-3 py-2 text-right font-mono">Transfer Rate (%)</th>
                  <th className="px-3 py-2 text-right font-mono">Transfer Minimum (THB)</th>
                  <th className="px-3 py-2 text-right font-mono">Withdraw Own (%)</th>
                  <th className="px-3 py-2 text-right font-mono">Withdraw Own Min</th>
                  <th className="px-3 py-2 text-right font-mono">Withdraw Other (%)</th>
                  <th className="px-3 py-2 text-right font-mono">Withdraw Other Min</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r, i) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">{i + 1}</td>
                    <td className="px-3 py-2">
                      {r.payment_type ? PAYMENT_TYPE_LABEL[r.payment_type] ?? r.payment_type : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{fmtDate(r.start_date)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{fmtDate(r.end_date)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{fmtDate(r.create_date)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtPercent(r.rate_percent)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtNumber(r.rate_per_time)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtPercent(r.rate_transfer_percent)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtNumber(r.rate_transfer_per_time)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtPercent(r.rate_withdraw_to_merchant_percent)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtNumber(r.rate_withdraw_to_merchant_per_time)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtPercent(r.rate_withdraw_to_other_percent)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtNumber(r.rate_withdraw_to_other_per_time)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Risk & Compliance" accent="bg-brand-600">
        <FieldGrid>
          <Field label="Black List" value={fmt(m.black_list)} />
          <Field label="Black List After Approve" value={fmt(m.black_list_after_approve)} />
          <Field label="Auto Reject" value={fmt(m.auto_reject)} />
          <Field label="Check IP" value={fmt(m.check_ip)} />
          <Field label="Consent PDPA" value={fmt(m.consent_pdpa)} />
          <Field label="Consent Policy" value={fmt(m.consent_policy)} />
          <Field label="Enabled" value={fmt(m.enabled)} />
          <Field label="Enabled (Sandbox)" value={fmt(m.enabled_sandbox)} />
          {m.auto_reject_detail && (
            <Field label="Auto Reject Detail" value={fmt(m.auto_reject_detail)} wide />
          )}
        </FieldGrid>
      </Card>

      <Card title="Approval Trail" accent="bg-slate-700">
        <FieldGrid>
          <Field label="Operation Approved" value={fmtDate(m.operation_approve_date)} mono />
          <Field
            label="Operation Manager Approved"
            value={fmtDate(m.operation_manager_approve_date)}
            mono
          />
          <Field label="Risk Approved" value={fmtDate(m.risk_approve_date)} mono />
          <Field label="Risk Manager Approved" value={fmtDate(m.risk_manager_approve_date)} mono />
          <Field label="Manager Approved" value={fmtDate(m.manager_approve_date)} mono />
          <Field label="Supervisor Approved" value={fmtDate(m.supervisor_approve_date)} mono />
        </FieldGrid>
      </Card>

      <Card title="Audit" accent="bg-slate-700">
        <FieldGrid>
          <Field label="Created" value={fmtDate(m.create_date)} mono />
          <Field label="Created By" value={fmt(m.create_by)} />
          <Field label="Updated" value={fmtDate(m.update_date)} mono />
          <Field label="Updated By" value={fmt(m.update_by)} />
          <Field label="Closed" value={fmtDate(m.close_date)} mono />
          <Field label="Close Remark" value={fmt(m.close_remark)} wide />
        </FieldGrid>
      </Card>
    </div>
  );
}
