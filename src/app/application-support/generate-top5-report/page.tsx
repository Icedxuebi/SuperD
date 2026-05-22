"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatReportDate } from "@/lib/date-range";
import { emptyFormBInput, type FormBInput } from "@/lib/form-b";
import { emptyLastPageInput, type LastPageInput } from "@/lib/last-page";
import FormBSection from "@/components/FormBSection";
import LastPageSection from "@/components/LastPageSection";

interface Period {
  id: number;
  dateStart: string;
  dateEnd: string;
}

interface PreviewMerchant {
  mid: string;
  merchantName: string;
  partner: string | null;
  totalAmount: number;
}

const ORDER_STATUSES = [
  "อยู่ระหว่างจัดส่ง",
  "ได้รับสินค้าแล้ว",
  "ยกเลิก",
  "รอชำระเงิน",
];

interface SupportSignerOption {
  id: string;
  name: string;
}

const SUPPORT_SIGNERS: SupportSignerOption[] = [
  { id: "thanawat", name: "ธนวัฒน์ โพธิลา" },
  { id: "burin", name: "บุรินทร์ รัตนชัย" },
  { id: "mongkon", name: "มงคล รุ่งจำรัส" },
  { id: "chawanat", name: "ชวณัฐ แก้ววิจิตร" },
];

const DEFAULT_ACKNOWLEDGER = {
  name: "ศศมน มันทะเล",
  title: "ประธานเจ้าหน้าที่ฝ่ายปฏิบัติการ",
};

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function GenerateTop5ReportPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [reportDateIso, setReportDateIso] = useState<string>("");
  const [preview, setPreview] = useState<PreviewMerchant[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [signingDateIso, setSigningDateIso] = useState<string>("");

  const [testRank, setTestRank] = useState<number>(5);
  const [orderDateIso, setOrderDateIso] = useState<string>("");
  const [productName, setProductName] = useState<string>("");
  const [productAmount, setProductAmount] = useState<string>("");

  const [statusValue, setStatusValue] = useState<string>(ORDER_STATUSES[0]);
  const [trackingNumber, setTrackingNumber] = useState<string>("");
  const [carrierName, setCarrierName] = useState<string>("");
  const [deliveredDate, setDeliveredDate] = useState<string>("");

  const [preparerId, setPreparerId] = useState<string>("burin");
  const [reviewerId, setReviewerId] = useState<string>("thanawat");
  const [acknowledger, setAcknowledger] = useState(DEFAULT_ACKNOWLEDGER);

  const [forms, setForms] = useState<FormBInput[]>([]);
  const [lastPage, setLastPage] = useState<LastPageInput>(emptyLastPageInput());

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/top100/periods")
      .then((r) => r.json())
      .then((data: { periods: Period[] }) => {
        setPeriods(data.periods);
        if (data.periods.length && !reportDateIso) {
          setReportDateIso(data.periods[0].dateStart);
          setSigningDateIso(data.periods[0].dateStart);
          setOrderDateIso(data.periods[0].dateStart);
        }
      })
      .catch((err) => setError(err.message));
  }, [reportDateIso]);

  useEffect(() => {
    if (!reportDateIso) return;
    setPreviewLoading(true);
    setPreviewError(null);
    fetch(`/api/top100/merchants?from=${reportDateIso}&to=${reportDateIso}`)
      .then((r) => r.json())
      .then((data: { merchants: PreviewMerchant[] }) => {
        setPreview(data.merchants.slice(0, 5));
      })
      .catch((err) =>
        setPreviewError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setPreviewLoading(false));
  }, [reportDateIso]);

  const previewSig = useMemo(
    () => (preview ? preview.map((m) => m.mid).join(",") : ""),
    [preview],
  );

  useEffect(() => {
    if (!preview || preview.length === 0) {
      setForms([]);
      return;
    }
    setForms((prev) => {
      return preview.map((m, idx) => {
        const existing = prev.find((p) => p.mid === m.mid);
        const merchantBase = {
          rank: idx + 1,
          merchantName: m.merchantName,
          ae: m.partner ?? "",
          mid: m.mid,
        };
        if (existing) {
          return { ...existing, ...merchantBase };
        }
        return emptyFormBInput(merchantBase, reportDateIso);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSig]);

  const selectedTestMerchant = useMemo(() => {
    if (!preview || preview.length === 0) return null;
    const idx = Math.min(Math.max(testRank, 1), preview.length) - 1;
    return preview[idx];
  }, [preview, testRank]);

  const handleGenerate = useCallback(async () => {
    if (!reportDateIso) {
      setError("Pick a report date first");
      return;
    }
    if (!preview || preview.length === 0) {
      setError("No merchants found for that date");
      return;
    }
    if (preparerId === reviewerId) {
      setError("Preparer and reviewer must be different people");
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/top100/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportDateIso,
          signingDateIso,
          orderTest: { rank: testRank, orderDateIso, productName, productAmount },
          orderStatus: { status: statusValue, trackingNumber, carrierName, deliveredDate },
          preparer: { signerId: preparerId },
          reviewer: { signerId: reviewerId },
          acknowledger,
          forms,
          lastPage,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Generation failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "TOP 5 Daily Report.docx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [
    reportDateIso,
    signingDateIso,
    testRank,
    orderDateIso,
    productName,
    productAmount,
    statusValue,
    trackingNumber,
    carrierName,
    deliveredDate,
    preparerId,
    reviewerId,
    acknowledger,
    preview,
    forms,
    lastPage,
  ]);

  if (periods.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <h1 className="text-3xl font-bold mb-3">No recent payment data</h1>
        <p className="text-slate-600">
          The top 5 are computed from <code>payment_transaction</code> for the chosen day —
          there are no recent rows to draw from.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">
          Generate TOP 5 Daily Report
        </h1>
        <p className="text-slate-600">
          Pick a report date — the top 5 merchants for that day are computed from the live
          database. Fill in the order-test details and signers, then download the Word
          document.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      <Section title="1. Report data" subtitle="Pulled from the database">
        <Field label="Report date">
          <select
            value={reportDateIso}
            onChange={(e) => {
              const v = e.target.value;
              setReportDateIso(v);
              setSigningDateIso(v);
              setOrderDateIso(v);
            }}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white min-w-[220px]"
          >
            {periods.map((p) => (
              <option key={p.id} value={p.dateStart}>
                {formatReportDate(p.dateStart)}
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600 uppercase tracking-wide">
            Top 5 preview
          </div>
          {previewLoading && (
            <div className="px-4 py-6 text-sm text-slate-500">Loading…</div>
          )}
          {previewError && (
            <div className="px-4 py-3 text-sm text-red-600">{previewError}</div>
          )}
          {!previewLoading && preview && preview.length === 0 && (
            <div className="px-4 py-6 text-sm text-slate-500">
              No merchants for this date.
            </div>
          )}
          {!previewLoading && preview && preview.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left w-12">No.</th>
                  <th className="px-3 py-2 text-left">AE</th>
                  <th className="px-3 py-2 text-left">MID</th>
                  <th className="px-3 py-2 text-left">Merchant</th>
                  <th className="px-3 py-2 text-right">Amount (THB)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((m, idx) => (
                  <tr key={m.mid}>
                    <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                    <td className="px-3 py-2">{m.partner ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{m.mid}</td>
                    <td className="px-3 py-2">{m.merchantName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAmount(m.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>

      <Section title="2. Order test" subtitle="The test purchase recorded on the report">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Tested rank">
            <select
              value={testRank}
              onChange={(e) => setTestRank(Number(e.target.value))}
              className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  Rank {n}
                </option>
              ))}
            </select>
            {selectedTestMerchant && (
              <p className="text-xs text-slate-500 mt-1">
                {selectedTestMerchant.merchantName} ({selectedTestMerchant.mid})
              </p>
            )}
          </Field>
          <Field label="Order date">
            <input
              type="date"
              value={orderDateIso}
              onChange={(e) => setOrderDateIso(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
            />
          </Field>
          <Field label="Product name (ชื่อสินค้า)">
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. แผ่นรองเมาส์"
              className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
            />
          </Field>
          <Field label="Product amount (THB)">
            <input
              type="text"
              value={productAmount}
              onChange={(e) => setProductAmount(e.target.value)}
              placeholder="e.g. 20"
              className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
            />
          </Field>
        </div>
      </Section>

      <Section title="3. Order status" subtitle="Shipping / delivery info">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Status">
            <select
              value={statusValue}
              onChange={(e) => setStatusValue(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tracking number">
            <input
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="-"
              className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
            />
          </Field>
          <Field label="Carrier (ชื่อขนส่ง)">
            <input
              type="text"
              value={carrierName}
              onChange={(e) => setCarrierName(e.target.value)}
              placeholder="-"
              className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
            />
          </Field>
          <Field label="Delivered date">
            <input
              type="text"
              value={deliveredDate}
              onChange={(e) => setDeliveredDate(e.target.value)}
              placeholder="-"
              className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
            />
          </Field>
        </div>
      </Section>

      <Section
        title="4. Signatures"
        subtitle="Pick preparer & reviewer — their signature image is embedded automatically"
      >
        <Field label="Signing date">
          <input
            type="date"
            value={signingDateIso}
            onChange={(e) => setSigningDateIso(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <SignerDropdown
            label="จัดทำโดย (Preparer)"
            value={preparerId}
            onChange={setPreparerId}
            others={[reviewerId]}
          />
          <SignerDropdown
            label="ตรวจสอบโดย (Reviewer)"
            value={reviewerId}
            onChange={setReviewerId}
            others={[preparerId]}
          />
          <AcknowledgerCard value={acknowledger} onChange={setAcknowledger} />
        </div>
      </Section>

      <Section
        title="5. Monitoring forms (Form B)"
        subtitle="One website-monitoring form is appended for each of the top 5 merchants — open each card to score it"
      >
        <FormBSection
          value={forms}
          onChange={setForms}
          inspectorName={SUPPORT_SIGNERS.find((s) => s.id === preparerId)?.name ?? ""}
          followerName={SUPPORT_SIGNERS.find((s) => s.id === reviewerId)?.name ?? ""}
        />
      </Section>

      <Section
        title="6. Order completion summary (last page)"
        subtitle="Upload screenshots and fill in the product name + final order status — rendered as the last page of the .docx"
      >
        <LastPageSection value={lastPage} onChange={setLastPage} />
      </Section>

      <div className="flex items-center gap-3">
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !preview || preview.length === 0}
          className="px-6 py-2.5 rounded-md font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {isGenerating ? "Generating…" : "Generate DOCX"}
        </button>
        <span className="text-sm text-slate-500">
          The Word document will download to your computer.
        </span>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200/80 rounded-xl p-6 shadow-card">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function SignerDropdown({
  label,
  value,
  onChange,
  others,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  others: string[];
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/40">
      <div className="text-xs font-medium text-slate-600 mb-2">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
      >
        {SUPPORT_SIGNERS.map((s) => (
          <option key={s.id} value={s.id} disabled={others.includes(s.id)}>
            {s.name}
            {others.includes(s.id) ? "  — already selected" : ""}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-500 mt-2">Title: Application Support</p>
    </div>
  );
}

function AcknowledgerCard({
  value,
  onChange,
}: {
  value: { name: string; title: string };
  onChange: (v: { name: string; title: string }) => void;
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/40">
      <div className="text-xs font-medium text-slate-600 mb-2">รับทราบโดย (Acknowledged)</div>
      <div className="space-y-2">
        <input
          type="text"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="Name"
          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
        />
        <input
          type="text"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="Title"
          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
        />
      </div>
    </div>
  );
}
