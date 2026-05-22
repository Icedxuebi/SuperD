"use client";

import { useMemo, useState } from "react";
import {
  MONITORING_ITEMS,
  sumA,
  sumB,
  type FormBInput,
  type FormBItemInput,
} from "@/lib/form-b";

export default function FormBSection({
  value,
  onChange,
  inspectorName,
  followerName,
}: {
  value: FormBInput[];
  onChange: (next: FormBInput[]) => void;
  inspectorName: string;
  followerName: string;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  function updateForm(idx: number, patch: Partial<FormBInput>) {
    const next = value.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onChange(next);
  }

  function updateItem(formIdx: number, itemIdx: number, patch: Partial<FormBItemInput>) {
    const next = value.map((f, i) => {
      if (i !== formIdx) return f;
      const items = f.items.map((it, j) => (j === itemIdx ? { ...it, ...patch } : it));
      return { ...f, items };
    });
    onChange(next);
  }

  if (value.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Pick a report date above — the 5 monitoring forms will appear here once
        the top 5 merchants load.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
        <span className="font-medium">ผู้ตรวจ:</span> {inspectorName || "—"} ·{" "}
        <span className="font-medium">ผู้ติดตาม:</span> {followerName || "—"}{" "}
        <span className="text-slate-500">
          (taken from Preparer / Reviewer in Section 4 — their signature image
          is embedded automatically)
        </span>
      </div>
      {value.map((form, idx) => (
        <FormBCard
          key={form.mid}
          form={form}
          open={openIdx === idx}
          onToggle={() => setOpenIdx(openIdx === idx ? null : idx)}
          onChange={(patch) => updateForm(idx, patch)}
          onItemChange={(itemIdx, patch) => updateItem(idx, itemIdx, patch)}
        />
      ))}
    </div>
  );
}

function FormBCard({
  form,
  open,
  onToggle,
  onChange,
  onItemChange,
}: {
  form: FormBInput;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<FormBInput>) => void;
  onItemChange: (itemIdx: number, patch: Partial<FormBItemInput>) => void;
}) {
  const totalA = useMemo(() => sumA(form.items), [form.items]);
  const totalB = useMemo(() => sumB(form.items), [form.items]);

  const riskLevel = useMemo(() => {
    if (totalB >= 1) return { label: "High (B flagged)", color: "bg-red-100 text-red-700" };
    if (totalA >= 40) return { label: "Low", color: "bg-emerald-100 text-emerald-700" };
    if (totalA >= 30) return { label: "Medium", color: "bg-amber-100 text-amber-700" };
    return { label: "High", color: "bg-red-100 text-red-700" };
  }, [totalA, totalB]);

  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-brand-600 text-white text-sm font-bold flex-shrink-0">
            {form.rank}
          </span>
          <div className="min-w-0 text-left">
            <div className="font-semibold text-slate-800 truncate">
              {form.merchantName}
            </div>
            <div className="text-xs text-slate-500 font-mono">
              {form.mid} • {form.ae || "—"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-slate-500 font-mono">
            A: {totalA}/50 · B: {totalB}/10
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskLevel.color}`}>
            {riskLevel.label}
          </span>
          <span className="text-slate-400">{open ? "▾" : "▸"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-200 p-4 space-y-5 bg-slate-50/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="วันที่ตรวจ (Inspection date)">
              <input
                type="date"
                value={form.inspectionDateIso}
                onChange={(e) => onChange({ inspectionDateIso: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
              />
            </Field>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
              Monitoring + Red Flags
            </div>
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">รายการ</th>
                    <th className="px-2 py-1.5 text-center font-medium w-24">A (1–5)</th>
                    <th className="px-2 py-1.5 text-left font-medium">Red Flag</th>
                    <th className="px-2 py-1.5 text-center font-medium w-20">B</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {MONITORING_ITEMS.map((item, i) => {
                    const it = form.items[i];
                    return (
                      <tr key={item.label}>
                        <td className="px-2 py-1.5 align-top">
                          <div className="text-slate-800">{item.label}</div>
                          <div className="text-xs text-slate-500">
                            {item.generalCheck}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <select
                            value={it.aScore == null ? "" : String(it.aScore)}
                            onChange={(e) =>
                              onItemChange(i, {
                                aScore: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                            className="px-1.5 py-1 border border-slate-300 rounded text-sm bg-white"
                          >
                            <option value="">—</option>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-xs text-slate-600 align-top">
                          {item.redFlag}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={it.bFlag}
                            onChange={(e) => onItemChange(i, { bFlag: e.target.checked })}
                            className="w-4 h-4 accent-brand-600"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 text-slate-700 font-medium">
                  <tr>
                    <td className="px-2 py-1.5 text-right" colSpan={1}>
                      Totals
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono">
                      {totalA}/50
                    </td>
                    <td />
                    <td className="px-2 py-1.5 text-center font-mono">
                      {totalB}/10
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
              Section 3 — Actions (per row)
            </div>
            <div className="space-y-3 text-sm">
              <div className="border border-slate-200 rounded-md p-2">
                <div className="text-xs font-semibold text-slate-700 mb-1">
                  Low (A ≥ 40)
                </div>
                <Check
                  label="ปกติ"
                  checked={form.actLowNormal}
                  onChange={(v) => onChange({ actLowNormal: v })}
                />
              </div>

              <div className="border border-slate-200 rounded-md p-2">
                <div className="text-xs font-semibold text-slate-700 mb-1">
                  Medium (A 30–39)
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Check
                      label="แจ้งร้านค้าแก้ไขภายใน"
                      checked={form.actMediumNotify}
                      onChange={(v) => onChange({ actMediumNotify: v })}
                    />
                    <input
                      type="text"
                      value={form.actMediumNotifyDays}
                      onChange={(e) =>
                        onChange({ actMediumNotifyDays: e.target.value })
                      }
                      placeholder="วัน"
                      className="w-16 px-2 py-1 border border-slate-300 rounded text-sm bg-white"
                    />
                    <span className="text-slate-600">วัน</span>
                    <input
                      type="text"
                      value={form.actMediumNotifyHours}
                      onChange={(e) =>
                        onChange({ actMediumNotifyHours: e.target.value })
                      }
                      placeholder="ชม."
                      className="w-16 px-2 py-1 border border-slate-300 rounded text-sm bg-white"
                    />
                    <span className="text-slate-600">ชั่วโมง</span>
                  </div>
                  <Check
                    label="ส่ง EDD"
                    checked={form.actMediumEDD}
                    onChange={(v) => onChange({ actMediumEDD: v })}
                  />
                </div>
              </div>

              <div className="border border-slate-200 rounded-md p-2">
                <div className="text-xs font-semibold text-slate-700 mb-1">
                  High (A &lt; 30)
                </div>
                <div className="space-y-1">
                  <Check
                    label="ส่ง EDD"
                    checked={form.actHighEDD}
                    onChange={(v) => onChange({ actHighEDD: v })}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Check
                      label="แจ้งร้านค้าแก้ไขภายใน"
                      checked={form.actHighNotify}
                      onChange={(v) => onChange({ actHighNotify: v })}
                    />
                    <input
                      type="text"
                      value={form.actHighNotifyDays}
                      onChange={(e) =>
                        onChange({ actHighNotifyDays: e.target.value })
                      }
                      placeholder="วัน"
                      className="w-16 px-2 py-1 border border-slate-300 rounded text-sm bg-white"
                    />
                    <span className="text-slate-600">วัน</span>
                    <input
                      type="text"
                      value={form.actHighNotifyHours}
                      onChange={(e) =>
                        onChange({ actHighNotifyHours: e.target.value })
                      }
                      placeholder="ชม."
                      className="w-16 px-2 py-1 border border-slate-300 rounded text-sm bg-white"
                    />
                    <span className="text-slate-600">ชั่วโมง</span>
                  </div>
                  <Check
                    label="ระงับธุรกรรมร้านค้าชั่วคราว"
                    checked={form.actHighSuspend}
                    onChange={(v) => onChange({ actHighSuspend: v })}
                  />
                  <Check
                    label="ปิดบัญชีร้านค้า"
                    checked={form.actHighClose}
                    onChange={(v) => onChange({ actHighClose: v })}
                  />
                </div>
              </div>

              <p className="text-xs text-slate-500 italic">
                B-section <span className="font-medium">ปิดบัญชีร้านค้า</span>{" "}
                auto-ticks whenever the B total is ≥ 1
                {totalB >= 1 ? " (currently ✓)" : ""}.
              </p>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
              Section 4 — ผลการติดตาม
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="วันที่ติดตาม (Follow date)">
                <input
                  type="date"
                  value={form.followDateIso}
                  onChange={(e) => onChange({ followDateIso: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
                />
              </Field>
            </div>
            <Field label="ความเห็นผู้ติดตาม (Comments)">
              <textarea
                value={form.followerComment}
                onChange={(e) => onChange({ followerComment: e.target.value })}
                rows={2}
                className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white w-full"
              />
            </Field>
            <div className="flex flex-wrap gap-4 mt-2 text-sm">
              <Check
                label="ระงับธุรกรรมร้านค้าชั่วคราว"
                checked={form.followSuspend}
                onChange={(v) => onChange({ followSuspend: v })}
              />
              <Check
                label="ปิดบัญชีร้านค้า"
                checked={form.followClose}
                onChange={(v) => onChange({ followClose: v })}
              />
              <Check
                label="คืนสถานะร้านค้าให้เปิดปกติ"
                checked={form.followRestore}
                onChange={(v) => onChange({ followRestore: v })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-brand-600"
      />
      <span className="text-slate-700">{label}</span>
    </label>
  );
}
