"use client";

import { useCallback, useRef, useState } from "react";
import JSZip from "jszip";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface ConvertedFile {
  name: string;
  sheet: string;
  rows: number;
  base64: string;
}

interface SkippedSheet {
  sheet: string;
  reason: string;
}

interface ConvertResponse {
  caseId: string;
  files: ConvertedFile[];
  skipped: SkippedSheet[];
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function MoneyTracePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResponse | null>(null);

  const pickFile = useCallback((f: File | null) => {
    setError(null);
    setResult(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".xlsx")) {
      setError("Please choose a .xlsx file (the Bank Case ID workbook).");
      return;
    }
    setFile(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      pickFile(e.dataTransfer.files?.[0] ?? null);
    },
    [pickFile],
  );

  const convert = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/cfr/convert", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `Conversion failed (HTTP ${res.status})`);
      }
      setResult(data as ConvertResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setLoading(false);
    }
  }, [file]);

  const downloadOne = useCallback((f: ConvertedFile) => {
    triggerDownload(base64ToBlob(f.base64, XLSX_MIME), f.name);
  }, []);

  const downloadAll = useCallback(async () => {
    if (!result) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const f of result.files) zip.file(f.name, f.base64, { base64: true });
      const blob = await zip.generateAsync({ type: "blob" });
      triggerDownload(blob, `readytoupload_${result.caseId}.zip`);
    } finally {
      setZipping(false);
    }
  }, [result]);

  const reset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const totalRows = result?.files.reduce((s, f) => s + f.rows, 0) ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Money Trace</h1>
        <p className="text-slate-600">
          Upload a <span className="font-medium">Bank Case ID</span> Excel file —
          each sheet is turned into a ready-to-upload CFR form. Download them one
          at a time or all together as a ZIP.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      <section className="bg-white border border-slate-200/80 rounded-xl p-6 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
          <h2 className="text-lg font-semibold text-slate-800">
            Upload Bank Case ID file
          </h2>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-brand-600 bg-brand-50"
              : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/40"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="sr-only"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 rounded-full bg-brand-50 text-brand-600">
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M17 8l-5-5-5 5" />
                <path d="M12 3v12" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-slate-800">
                {file ? file.name : "Drop the .xlsx here, or click to browse"}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {file
                  ? "Click again to choose a different file"
                  : "One Bank Case ID workbook — every sheet becomes its own output file"}
              </div>
            </div>
          </div>
        </label>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={convert}
            disabled={!file || loading}
            className="px-6 py-2.5 rounded-md font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {loading ? "Converting…" : "Convert"}
          </button>
          {(file || result) && (
            <button
              onClick={reset}
              disabled={loading}
              className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {result && (
        <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-5 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
              <h3 className="text-lg font-semibold text-slate-800">
                Ready to upload
                <span className="text-sm font-normal text-slate-500 ml-2">
                  Case{" "}
                  <span className="font-mono text-slate-700">
                    {result.caseId}
                  </span>{" "}
                  · {result.files.length}{" "}
                  {result.files.length === 1 ? "file" : "files"} · {totalRows}{" "}
                  {totalRows === 1 ? "row" : "rows"}
                </span>
              </h3>
            </div>
            <button
              onClick={downloadAll}
              disabled={zipping}
              className="px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm whitespace-nowrap"
            >
              {zipping ? "Zipping…" : "Download all (.zip)"}
            </button>
          </div>

          <ul className="divide-y divide-slate-100">
            {result.files.map((f) => (
              <li
                key={f.name}
                className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {f.name}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Sheet <span className="text-slate-600">{f.sheet}</span> ·{" "}
                    {f.rows} {f.rows === 1 ? "transaction" : "transactions"}
                  </div>
                </div>
                <button
                  onClick={() => downloadOne(f)}
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 transition-colors whitespace-nowrap"
                >
                  Download
                </button>
              </li>
            ))}
          </ul>

          {result.skipped.length > 0 && (
            <div className="px-5 py-3 bg-amber-50 border-t border-amber-200 text-sm text-amber-800">
              <span className="font-medium">
                Skipped {result.skipped.length}{" "}
                {result.skipped.length === 1 ? "sheet" : "sheets"}:
              </span>{" "}
              {result.skipped.map((s) => `${s.sheet} (${s.reason})`).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
