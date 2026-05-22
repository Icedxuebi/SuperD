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
  business_type: string | null;
  business_detail: string | null;

  company_telephone: string | null;
  website: string | null;
  ip_host: string | null;
  ip_host_country: string | null;
  email: string | null;

  bank_account_name: string | null;
  bank_account_no: string | null;
  bank_account_branch: string | null;
  bank_id: number | null;
  bank_account_type_id: number | null;

  enabled: boolean | null;
  enabled_sandbox: boolean | null;
  is_online_shop: boolean | null;
  is_offline_shop: boolean | null;
  qr_cash: string | null;
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
};

const SQL = `
SELECT
    mi.id::text AS id,
    mi.merchant_no,
    mi.merchant_contract_no,
    mi.person_type,
    pi.partner_no,
    pi.company_name_en  AS partner_company_name,
    mi.state,

    mi.merchant_name_en,
    mi.merchant_name_th,
    mi.company_name_en,
    mi.company_name_th,
    mi.company_tax_id,
    mi.company_register_date,
    mi.company_register_capital,
    mi.business_type,
    mi.business_detail,

    mi.company_telephone,
    mi.website,
    mi.ip_host,
    mi.ip_host_country,
    (
        SELECT u.username FROM users u
        WHERE u.merchant_id = mi.id
        ORDER BY u.username LIMIT 1
    ) AS email,

    mi.bank_account_name,
    mi.bank_account_no,
    mi.bank_account_branch,
    mi.bank_id,
    mi.bank_account_type_id,

    mi.enabled,
    mi.enabled_sandbox,
    mi.is_online_shop,
    mi.is_offline_shop,
    mi.qr_cash,
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
    mi.close_remark
FROM merchant_info mi
LEFT JOIN partner_info pi ON pi.id = mi.partner_id
WHERE mi.merchant_no = $1
LIMIT 1;
`;

async function fetchMerchant(merchant_no: string): Promise<Merchant | null> {
  const pool = getPool();
  const result = await pool.query<Merchant>(SQL, [merchant_no]);
  return result.rows[0] ?? null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  return String(v).replace("T", " ").replace("Z", "").slice(0, 19);
}

function fmtDateOnly(v: string | null): string {
  if (!v) return "—";
  return String(v).replace("T", " ").replace("Z", "").slice(0, 10);
}

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

export default async function MerchantDetailPage({
  params,
}: {
  params: Promise<{ merchant_no: string }>;
}) {
  const { merchant_no } = await params;

  if (!MID_RE.test(merchant_no)) {
    notFound();
  }

  const m = await fetchMerchant(merchant_no);
  if (!m) notFound();

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
            {m.merchant_name_en ?? "—"}
          </h1>
          <p className="text-slate-600 flex items-center gap-3 flex-wrap">
            <span className="font-mono text-sm">{m.merchant_no}</span>
            <span className="text-slate-300">·</span>
            <StateBadge state={m.state} />
            <span className="text-slate-300">·</span>
            <span className="text-sm">
              {m.person_type === "C"
                ? "Company"
                : m.person_type === "I"
                  ? "Individual"
                  : m.person_type ?? "—"}
            </span>
          </p>
        </div>
      </div>

      <Card title="Identity">
        <FieldGrid>
          <Field label="Merchant No" value={fmt(m.merchant_no)} mono />
          <Field label="Contract No" value={fmt(m.merchant_contract_no)} mono />
          <Field
            label="Partner"
            value={
              m.partner_no
                ? `${m.partner_no}${m.partner_company_name ? ` — ${m.partner_company_name}` : ""}`
                : "—"
            }
          />
          <Field label="Person Type" value={fmt(m.person_type)} />
          <Field label="State" value={<StateBadge state={m.state} />} />
          <Field label="Registered" value={fmtDate(m.register_date)} mono />
        </FieldGrid>
      </Card>

      <Card title="Company">
        <FieldGrid>
          <Field label="Merchant Name (EN)" value={fmt(m.merchant_name_en)} />
          <Field label="Merchant Name (TH)" value={fmt(m.merchant_name_th)} />
          <Field label="Company Name (EN)" value={fmt(m.company_name_en)} />
          <Field label="Company Name (TH)" value={fmt(m.company_name_th)} />
          <Field label="Tax ID" value={fmt(m.company_tax_id)} mono />
          <Field label="Registered" value={fmtDateOnly(m.company_register_date)} mono />
          <Field label="Register Capital" value={fmt(m.company_register_capital)} mono />
          <Field label="Business Type" value={fmt(m.business_type)} />
          <Field label="Business Detail" value={fmt(m.business_detail)} wide />
        </FieldGrid>
      </Card>

      <Card title="Contact" accent="bg-accent-500">
        <FieldGrid>
          <Field label="Email" value={fmt(m.email)} />
          <Field label="Telephone" value={fmt(m.company_telephone)} />
          <Field label="Website" value={fmt(m.website)} />
          <Field label="IP Host" value={fmt(m.ip_host)} mono />
          <Field label="IP Host Country" value={fmt(m.ip_host_country)} />
          <Field label="Channel" value={`Online: ${fmt(m.is_online_shop)} · Offline: ${fmt(m.is_offline_shop)}`} />
        </FieldGrid>
      </Card>

      <Card title="Bank Account" accent="bg-accent-500">
        <FieldGrid>
          <Field label="Account Name" value={fmt(m.bank_account_name)} />
          <Field label="Account No" value={fmt(m.bank_account_no)} mono />
          <Field label="Branch" value={fmt(m.bank_account_branch)} />
          <Field label="Bank ID" value={fmt(m.bank_id)} mono />
          <Field label="Account Type ID" value={fmt(m.bank_account_type_id)} mono />
        </FieldGrid>
      </Card>

      <Card title="Channels & Webhooks" accent="bg-slate-700">
        <FieldGrid>
          <Field label="QR Cash" value={fmt(m.qr_cash)} />
          <Field label="QR Credit" value={fmt(m.qr_credit)} />
          <Field label="Credit Card Online" value={fmt(m.credit_card_online)} />
          <Field label="Credit Card Offline" value={fmt(m.credit_card_offline)} />
          <Field label="Webhook QR Cash" value={fmt(m.webhook_qr_cash)} mono wide />
          <Field label="Webhook Transfer" value={fmt(m.webhook_transfer)} mono wide />
          <Field label="Webhook QR Credit" value={fmt(m.webhook_qr_credit)} mono wide />
          <Field label="Webhook (Sandbox) QR Cash" value={fmt(m.webhook_sandbox_qr_cash)} mono wide />
          <Field label="Webhook (Sandbox) Transfer" value={fmt(m.webhook_sandbox_transfer)} mono wide />
          <Field label="Webhook (Sandbox) QR Credit" value={fmt(m.webhook_sandbox_qr_credit)} mono wide />
        </FieldGrid>
      </Card>

      <Card title="Risk & Compliance" accent="bg-brand-600">
        <FieldGrid>
          <Field label="Risk" value={fmt(m.risk)} />
          <Field label="Black List" value={fmt(m.black_list)} />
          <Field label="Black List After Approve" value={fmt(m.black_list_after_approve)} />
          <Field label="Auto Reject" value={fmt(m.auto_reject)} />
          <Field label="Check IP" value={fmt(m.check_ip)} />
          <Field label="Consent PDPA" value={fmt(m.consent_pdpa)} />
          <Field label="Consent Policy" value={fmt(m.consent_policy)} />
          <Field label="Max Amount / Month" value={fmt(m.max_amount_per_month)} mono />
          <Field label="Max Count / Month" value={fmt(m.max_count_per_month)} mono />
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
          <Field label="Operation Manager Approved" value={fmtDate(m.operation_manager_approve_date)} mono />
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
