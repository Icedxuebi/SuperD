import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The funnel's "Stuck Merchants" rows are keyed by the internal merchant_info.id,
// not merchant_no — pre-approval and rejected merchants usually have no MID yet.
// So this detail page is keyed by the internal id.
const ID_RE = /^\d+$/;

type Detail = {
  id: string;
  merchant_no: string | null;
  company_name_en: string | null;
  company_name_th: string | null;
  merchant_name_en: string | null;
  merchant_name_th: string | null;
  person_type: string | null;
  state: string | null;
  risk: string | null;
  partner_no: string | null;
  owner_name: string | null;
  owner_surname: string | null;
  create_date: string | null;
  register_date: string | null;
  close_date: string | null;
  age_days: number | null;
  days_at_stage: number | null;

  // Remark matrix — text + date (Bangkok wall-clock, as stored) + reviewer name/surname for each.
  remark_operation_kyc: string | null;
  remark_operation_kyc_date: string | null;
  op_kyc_name: string | null;
  op_kyc_surname: string | null;
  remark_operation_kym: string | null;
  remark_operation_kym_date: string | null;
  op_kym_name: string | null;
  op_kym_surname: string | null;

  remark_operation_manager_kyc: string | null;
  remark_operation_manager_kyc_date: string | null;
  opm_kyc_name: string | null;
  opm_kyc_surname: string | null;
  remark_operation_manager_kym: string | null;
  remark_operation_manager_kym_date: string | null;
  opm_kym_name: string | null;
  opm_kym_surname: string | null;

  remark_risk_kyc: string | null;
  remark_risk_kyc_date: string | null;
  rk_kyc_name: string | null;
  rk_kyc_surname: string | null;
  remark_risk_kym: string | null;
  remark_risk_kym_date: string | null;
  rk_kym_name: string | null;
  rk_kym_surname: string | null;

  remark_risk_manager_kyc: string | null;
  remark_risk_manager_kyc_date: string | null;
  rkm_kyc_name: string | null;
  rkm_kyc_surname: string | null;
  remark_risk_manager_kym: string | null;
  remark_risk_manager_kym_date: string | null;
  rkm_kym_name: string | null;
  rkm_kym_surname: string | null;

  remark: string | null;
  close_remark: string | null;
};

// Remark *_date columns are stored in Bangkok wall-clock (verified against the
// prod backoffice) and shown as-is — no shift. Same for create_date /
// register_date / close_date.
//
// state_changed_at + days_at_stage deliberately keep the funnel STUCK_SQL's +7h
// on the *_approve_date columns so this page's "Days at Stage" matches the funnel
// row the user clicked through from. That number is a whole-day count, so the 7h
// doesn't change it in practice. It also replicates the PRE_APPROVE_DOCUMENT
// override and the WAITING_SANDBOX promotion from merchant_process_history.
const SQL = `
WITH mph_waiting AS (
  SELECT mph.merchant_id, MIN(mph.create_date) AS ws_create_date
  FROM merchant_process_history mph
  WHERE mph.state = 'WAITING_SANDBOX' AND mph.create_date IS NOT NULL
  GROUP BY mph.merchant_id
)
SELECT
  mi.id::text                                                       AS id,
  mi.merchant_no,
  mi.company_name_en,
  mi.company_name_th,
  mi.merchant_name_en,
  mi.merchant_name_th,
  mi.person_type,
  CASE WHEN w.merchant_id IS NOT NULL THEN 'WAITING_SANDBOX' ELSE mi.state END AS state,
  mi.risk,
  pi.partner_no,
  owner.name                                                        AS owner_name,
  owner.surname                                                     AS owner_surname,
  mi.create_date::text                                              AS create_date,
  mi.register_date::text                                            AS register_date,
  mi.close_date::text                                               AS close_date,
  CASE WHEN mi.create_date IS NULL THEN NULL
       ELSE ((now() AT TIME ZONE 'Asia/Bangkok')::date - mi.create_date::date)::int END AS age_days,
  ((now() AT TIME ZONE 'Asia/Bangkok')::date - sc.state_changed_at::date)::int          AS days_at_stage,

  mi.remark_operation_kyc,
  mi.remark_operation_kyc_date::text                                AS remark_operation_kyc_date,
  s_op_kyc.name    AS op_kyc_name,    s_op_kyc.surname    AS op_kyc_surname,
  mi.remark_operation_kym,
  mi.remark_operation_kym_date::text                                AS remark_operation_kym_date,
  s_op_kym.name    AS op_kym_name,    s_op_kym.surname    AS op_kym_surname,

  mi.remark_operation_manager_kyc,
  mi.remark_operation_manager_kyc_date::text                        AS remark_operation_manager_kyc_date,
  s_opm_kyc.name   AS opm_kyc_name,   s_opm_kyc.surname   AS opm_kyc_surname,
  mi.remark_operation_manager_kym,
  mi.remark_operation_manager_kym_date::text                        AS remark_operation_manager_kym_date,
  s_opm_kym.name   AS opm_kym_name,   s_opm_kym.surname   AS opm_kym_surname,

  mi.remark_risk_kyc,
  mi.remark_risk_kyc_date::text                                     AS remark_risk_kyc_date,
  s_rk_kyc.name    AS rk_kyc_name,    s_rk_kyc.surname    AS rk_kyc_surname,
  mi.remark_risk_kym,
  mi.remark_risk_kym_date::text                                     AS remark_risk_kym_date,
  s_rk_kym.name    AS rk_kym_name,    s_rk_kym.surname    AS rk_kym_surname,

  mi.remark_risk_manager_kyc,
  mi.remark_risk_manager_kyc_date::text                             AS remark_risk_manager_kyc_date,
  s_rkm_kyc.name   AS rkm_kyc_name,   s_rkm_kyc.surname   AS rkm_kyc_surname,
  mi.remark_risk_manager_kym,
  mi.remark_risk_manager_kym_date::text                             AS remark_risk_manager_kym_date,
  s_rkm_kym.name   AS rkm_kym_name,   s_rkm_kym.surname   AS rkm_kym_surname,

  mi.remark,
  mi.close_remark
FROM merchant_info mi
LEFT JOIN partner_info pi ON pi.id = mi.partner_id
LEFT JOIN staff_info owner ON owner.id = mi.staff_owner_id
LEFT JOIN mph_waiting w ON w.merchant_id = mi.id
  AND mi.state NOT IN ('APPROVE', 'COMPLETE_SANDBOX')
LEFT JOIN staff_info s_op_kyc  ON s_op_kyc.id  = mi.remark_operation_kyc_staff_id
LEFT JOIN staff_info s_op_kym  ON s_op_kym.id  = mi.remark_operation_kym_staff_id
LEFT JOIN staff_info s_opm_kyc ON s_opm_kyc.id = mi.remark_operation_manager_kyc_staff_id
LEFT JOIN staff_info s_opm_kym ON s_opm_kym.id = mi.remark_operation_manager_kym_staff_id
LEFT JOIN staff_info s_rk_kyc  ON s_rk_kyc.id  = mi.remark_risk_kyc_staff_id
LEFT JOIN staff_info s_rk_kym  ON s_rk_kym.id  = mi.remark_risk_kym_staff_id
LEFT JOIN staff_info s_rkm_kyc ON s_rkm_kyc.id = mi.remark_risk_manager_kyc_staff_id
LEFT JOIN staff_info s_rkm_kym ON s_rkm_kym.id = mi.remark_risk_manager_kym_staff_id
LEFT JOIN LATERAL (
  SELECT CASE
    WHEN w.merchant_id IS NOT NULL THEN
      w.ws_create_date
    WHEN mi.state = 'PRE_APPROVE_DOCUMENT' AND mi.risk = 'H' THEN
      GREATEST(
        mi.supervisor_approve_date + INTERVAL '7 hours',
        mi.manager_approve_date    + INTERVAL '7 hours'
      )
    WHEN mi.state = 'PRE_APPROVE_DOCUMENT' THEN
      mi.supervisor_approve_date + INTERVAL '7 hours'
    ELSE
      GREATEST(
        mi.create_date,
        mi.register_date,
        mi.operation_approve_date         + INTERVAL '7 hours',
        mi.operation_manager_approve_date + INTERVAL '7 hours',
        mi.risk_approve_date              + INTERVAL '7 hours',
        mi.risk_manager_approve_date      + INTERVAL '7 hours',
        mi.supervisor_approve_date        + INTERVAL '7 hours',
        mi.manager_approve_date           + INTERVAL '7 hours'
      )
  END AS state_changed_at
) sc ON true
WHERE mi.id = $1
LIMIT 1;
`;

const STATE_DESCRIPTION: Record<string, string> = {
  REGISTER: "Applicant entered info — create_date is set.",
  PRE_BUSINESS_APPROVE: "Waiting for ops to action.",
  BUSINESS_APPROVE: "Waiting for merchant to send more document info.",
  PRE_APPROVE_OPERATION: "KYC / KYM review by ops.",
  PRE_APPROVE_OPERATION_MANAGER: "Ops manager sign-off.",
  PRE_APPROVE_RISK: "Risk team determines risk level.",
  PRE_APPROVE_RISK_MANAGER: "Risk manager sign-off.",
  PRE_APPROVE_SUPERVISOR: "COO sign-off.",
  PRE_APPROVE_MANAGER: "CEO sign-off — only required when risk = H.",
  PRE_APPROVE_DOCUMENT: "Waiting for contract.",
  WAITING_SANDBOX: "Waiting for merchant sandbox testing.",
  COMPLETE_SANDBOX: "Sandbox done, ready to go live.",
  APPROVE: "Approved — live merchant.",
  REJECT: "Rejected — terminal.",
};

function staffName(name: string | null, surname: string | null): string | null {
  const full = `${name ?? ""} ${surname ?? ""}`.trim();
  return full === "" ? null : full;
}

function riskLabel(risk: string | null): string {
  switch (risk) {
    case "H":
      return "High";
    case "M":
      return "Medium";
    case "L":
      return "Low";
    default:
      return "Unrated";
  }
}

function personTypeLabel(pt: string | null): string {
  if (pt === "C") return "นิติบุคคล";
  if (pt === "I") return "บุคคลธรรมดา";
  return pt ?? "—";
}

// dd/mm/yyyy HH:mm from "YYYY-MM-DD HH:MM:SS..." (already shifted to Bangkok in SQL).
function fmtDateTime(s: string | null): string {
  if (!s) return "—";
  const v = s.replace("T", " ");
  const [date, time] = v.split(" ");
  const [y, m, d] = (date ?? "").split("-");
  if (!y || !m || !d) return "—";
  const hm = (time ?? "").slice(0, 5);
  return hm ? `${d}/${m}/${y} ${hm}` : `${d}/${m}/${y}`;
}

function fmtDateOnly(s: string | null): string {
  if (!s) return "—";
  const ymd = s.slice(0, 10);
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
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
      title={STATE_DESCRIPTION[state] ?? ""}
    >
      {state}
    </span>
  );
}

function Card({
  title,
  sub,
  accent = "bg-brand-600",
  children,
}: {
  title: string;
  sub?: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200/80 rounded-xl p-6 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <span className={`inline-block w-1 h-5 rounded-full ${accent}`} />
        <h2 className="text-lg font-semibold text-slate-800">
          {title}
          {sub && <span className="text-sm font-normal text-slate-500 ml-2">{sub}</span>}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-sm text-slate-800 break-words ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}

// One remark line: KYC/KYM chip, the (multi-line) text, and a date · reviewer meta line.
function RemarkRow({
  kind,
  text,
  date,
  staff,
}: {
  kind: "KYC" | "KYM";
  text: string | null;
  date: string | null;
  staff: string | null;
}) {
  const has = text != null && text.trim() !== "";
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold font-mono bg-slate-100 text-slate-600">
          {kind}
        </span>
        {has ? (
          <span className="text-xs text-slate-500 font-mono">
            {fmtDateTime(date)}
            {staff && (
              <>
                <span className="text-slate-300 mx-1.5">·</span>
                <span className="text-slate-700 font-sans">{staff}</span>
              </>
            )}
          </span>
        ) : (
          <span className="text-xs text-slate-400 italic">— no remark yet —</span>
        )}
      </div>
      {has && (
        <p className="mt-1.5 text-sm text-slate-800 whitespace-pre-line break-words leading-relaxed">
          {text}
        </p>
      )}
    </div>
  );
}

// A self-contained block for one team's remarks (or a standalone remark).
// Bordered with a colored left-accent stripe + header bar so each team reads
// as its own distinct panel rather than blending into the next.
function RemarkBlock({
  title,
  accent,
  headerExtra,
  children,
}: {
  title: string;
  accent: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="border border-l-4 border-slate-200 rounded-lg overflow-hidden"
      style={{ borderLeftColor: accent }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-slate-50/70 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {headerExtra}
      </div>
      <div className="px-4">{children}</div>
    </div>
  );
}

export default async function StuckMerchantRemarksPage({
  params,
}: {
  params: Promise<{ merchant_id: string }>;
}) {
  const { merchant_id } = await params;
  if (!ID_RE.test(merchant_id)) notFound();

  const pool = getPool();
  const res = await pool.query<Detail>(SQL, [merchant_id]);
  const m = res.rows[0];
  if (!m) notFound();

  const displayName =
    m.company_name_en ||
    m.company_name_th ||
    m.merchant_name_en ||
    m.merchant_name_th ||
    "—";

  const teams = [
    {
      title: "Operation (ops reviewer)",
      accent: "#f59e0b",
      rows: [
        { kind: "KYC" as const, text: m.remark_operation_kyc, date: m.remark_operation_kyc_date, staff: staffName(m.op_kyc_name, m.op_kyc_surname) },
        { kind: "KYM" as const, text: m.remark_operation_kym, date: m.remark_operation_kym_date, staff: staffName(m.op_kym_name, m.op_kym_surname) },
      ],
    },
    {
      title: "Operation Manager",
      accent: "#ea580c",
      rows: [
        { kind: "KYC" as const, text: m.remark_operation_manager_kyc, date: m.remark_operation_manager_kyc_date, staff: staffName(m.opm_kyc_name, m.opm_kyc_surname) },
        { kind: "KYM" as const, text: m.remark_operation_manager_kym, date: m.remark_operation_manager_kym_date, staff: staffName(m.opm_kym_name, m.opm_kym_surname) },
      ],
    },
    {
      title: "Risk (risk reviewer)",
      accent: "#d946ef",
      rows: [
        { kind: "KYC" as const, text: m.remark_risk_kyc, date: m.remark_risk_kyc_date, staff: staffName(m.rk_kyc_name, m.rk_kyc_surname) },
        { kind: "KYM" as const, text: m.remark_risk_kym, date: m.remark_risk_kym_date, staff: staffName(m.rk_kym_name, m.rk_kym_surname) },
      ],
    },
    {
      title: "Risk Manager",
      accent: "#a21caf",
      rows: [
        { kind: "KYC" as const, text: m.remark_risk_manager_kyc, date: m.remark_risk_manager_kyc_date, staff: staffName(m.rkm_kyc_name, m.rkm_kyc_surname) },
        { kind: "KYM" as const, text: m.remark_risk_manager_kym, date: m.remark_risk_manager_kym_date, staff: staffName(m.rkm_kym_name, m.rkm_kym_surname) },
      ],
    },
  ];

  const generalHas = m.remark != null && m.remark.trim() !== "";
  const closeHas = m.close_remark != null && m.close_remark.trim() !== "";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/operation/onboarding-funnel"
          className="text-sm text-brand-600 hover:text-brand-700 hover:underline inline-flex items-center gap-1 mb-2"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Onboarding Funnel
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mb-1 break-words">{displayName}</h1>
        <p className="text-slate-600 flex items-center gap-3 flex-wrap">
          {m.merchant_no ? (
            <span className="font-mono text-sm">{m.merchant_no}</span>
          ) : (
            <span className="font-mono text-sm text-slate-500" title="No MID assigned yet — still in onboarding">
              #{m.id}
            </span>
          )}
          <span className="text-slate-300">·</span>
          <StateBadge state={m.state} />
          <span className="text-slate-300">·</span>
          <span className="text-sm">{personTypeLabel(m.person_type)}</span>
        </p>
      </div>

      <Card title="Merchant">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          <Field label="Merchant No" value={m.merchant_no ?? `#${m.id} (no MID yet)`} mono />
          <Field label="Internal ID" value={m.id} mono />
          <Field label="State" value={<StateBadge state={m.state} />} />
          <Field label="Person Type" value={personTypeLabel(m.person_type)} />
          <Field label="Risk" value={riskLabel(m.risk)} />
          <Field label="Partner" value={m.partner_no ?? "—"} mono />
          <Field label="Owner" value={staffName(m.owner_name, m.owner_surname) ?? "—"} />
          <Field label="Created" value={fmtDateOnly(m.create_date)} mono />
          <Field label="Register Date" value={fmtDateOnly(m.register_date)} mono />
          <Field label="Age (days)" value={m.age_days ?? "—"} mono />
          <Field label="Days at Stage" value={m.days_at_stage ?? "—"} mono />
          {m.close_date && <Field label="Closed" value={fmtDateOnly(m.close_date)} mono />}
        </div>
      </Card>

      <Card title="Review Remarks" sub="By team, in onboarding order">
        <div className="space-y-4">
          {teams.map((t) => (
            <RemarkBlock key={t.title} title={t.title} accent={t.accent}>
              <div className="divide-y divide-slate-100">
                {t.rows.map((r) => (
                  <RemarkRow key={r.kind} kind={r.kind} text={r.text} date={r.date} staff={r.staff} />
                ))}
              </div>
            </RemarkBlock>
          ))}

          <RemarkBlock
            title="General remark | ดูในกรณี PRE_BUSINESS_APPROVE, BUSINESS_APPROVE (กรณี Oper เด้งกลับไปให้ร้านกรอกข้อมูลใหม่)"
            accent="#94a3b8"
          >
            <div className="py-3">
              {generalHas ? (
                <p className="text-sm text-slate-800 whitespace-pre-line break-words leading-relaxed">
                  {m.remark}
                </p>
              ) : (
                <p className="text-xs text-slate-400 italic">— none —</p>
              )}
            </div>
          </RemarkBlock>

          <RemarkBlock
            title="Close remark"
            accent="#475569"
            headerExtra={
              m.close_date ? (
                <span className="text-xs font-normal text-slate-500 font-mono">
                  {fmtDateOnly(m.close_date)}
                </span>
              ) : undefined
            }
          >
            <div className="py-3">
              {closeHas ? (
                <p className="text-sm text-slate-800 whitespace-pre-line break-words leading-relaxed">
                  {m.close_remark}
                </p>
              ) : (
                <p className="text-xs text-slate-400 italic">— none —</p>
              )}
            </div>
          </RemarkBlock>
        </div>
      </Card>
    </div>
  );
}
