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

/** One uploaded workbook's outcome — mirrors the API's SourceResult. */
interface SourceResult {
  sourceName: string;
  caseId?: string;
  files?: ConvertedFile[];
  skipped?: SkippedSheet[];
  error?: string;
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

/** Same file dropped twice (or across two drops) should only be queued once. */
function fileKey(f: File): string {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

export default function MoneyTracePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  /** Which zip is currently building: a caseId, "__all__", or null. */
  const [zipping, setZipping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SourceResult[] | null>(null);

  const addFiles = useCallback((picked: FileList | null) => {
    setError(null);
    setResults(null);
    if (!picked || picked.length === 0) return;

    const incoming = Array.from(picked);
    const rejected = incoming.filter(
      (f) => !f.name.toLowerCase().endsWith(".xlsx"),
    );
    const accepted = incoming.filter((f) =>
      f.name.toLowerCase().endsWith(".xlsx"),
    );
    if (rejected.length) {
      setError(
        `Skipped ${rejected.length} non-.xlsx ${
          rejected.length === 1 ? "file" : "files"
        }: ${rejected.map((f) => f.name).join(", ")}`,
      );
    }
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      return [...prev, ...accepted.filter((f) => !seen.has(fileKey(f)))];
    });
    // Let the same file be re-picked after a Clear.
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const removeFile = useCallback((key: string) => {
    setResults(null);
    setFiles((prev) => prev.filter((f) => fileKey(f) !== key));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const convert = useCallback(async () => {
    if (!files.length) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const body = new FormData();
      for (const f of files) body.append("file", f);
      const res = await fetch("/api/cfr/convert", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `Conversion failed (HTTP ${res.status})`);
      }
      setResults(data.results as SourceResult[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setLoading(false);
    }
  }, [files]);

  const downloadOne = useCallback((f: ConvertedFile) => {
    triggerDownload(base64ToBlob(f.base64, XLSX_MIME), f.name);
  }, []);

  /** Zip one case's outputs — byte-identical to converting that file alone. */
  const downloadCase = useCallback(async (r: SourceResult, index: number) => {
    if (!r.files?.length) return;
    setZipping(String(index));
    try {
      const zip = new JSZip();
      for (const f of r.files) zip.file(f.name, f.base64, { base64: true });
      const blob = await zip.generateAsync({ type: "blob" });
      triggerDownload(blob, `readytoupload_${r.caseId}.zip`);
    } finally {
      setZipping(null);
    }
  }, []);

  /** Every case in one zip, one folder per case. */
  const downloadEverything = useCallback(async () => {
    if (!results) return;
    setZipping("__all__");
    try {
      const zip = new JSZip();
      const usedFolders = new Set<string>();
      for (const r of results) {
        if (!r.files?.length) continue;
        let folder = `readytoupload_${r.caseId}`;
        // Two source workbooks can resolve to the same case ID; keep them apart.
        if (usedFolders.has(folder)) {
          let n = 2;
          while (usedFolders.has(`${folder}_${n}`)) n++;
          folder = `${folder}_${n}`;
        }
        usedFolders.add(folder);
        for (const f of r.files) {
          zip.file(`${folder}/${f.name}`, f.base64, { base64: true });
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      triggerDownload(blob, `readytoupload_${usedFolders.size}cases.zip`);
    } finally {
      setZipping(null);
    }
  }, [results]);

  const reset = useCallback(() => {
    setFiles([]);
    setResults(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  // Keep each result's position in the batch — two uploads can share a filename,
  // so the index is the only stable identity for keys and the zipping state.
  const indexed = results?.map((r, i) => ({ r, i })) ?? [];
  const succeeded = indexed.filter(({ r }) => r.files?.length);
  const failed = indexed.filter(({ r }) => r.error);
  const totalOut = succeeded.reduce((s, { r }) => s + (r.files?.length ?? 0), 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Money Trace</h1>
        <p className="text-slate-600">
          Upload one or more <span className="font-medium">Bank Case ID</span>{" "}
          Excel files — each workbook is processed on its own, and every sheet
          becomes a ready-to-upload CFR form. Download per case, or grab the
          whole batch as one ZIP.
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
            Upload Bank Case ID files
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
            multiple
            className="sr-only"
            onChange={(e) => addFiles(e.target.files)}
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
                {files.length
                  ? `${files.length} ${files.length === 1 ? "file" : "files"} ready — drop more to add`
                  : "Drop .xlsx files here, or click to browse"}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Up to 20 Bank Case ID workbooks per run — each one is converted
                exactly as if uploaded alone
              </div>
            </div>
          </div>
        </label>

        {files.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {files.map((f) => (
              <li
                key={fileKey(f)}
                className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white"
              >
                <span className="text-sm text-slate-700 truncate">{f.name}</span>
                <button
                  onClick={() => removeFile(fileKey(f))}
                  disabled={loading}
                  className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-50 shrink-0"
                  aria-label={`Remove ${f.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={convert}
            disabled={!files.length || loading}
            className="px-6 py-2.5 rounded-md font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {loading
              ? "Converting…"
              : files.length > 1
                ? `Convert ${files.length} files`
                : "Convert"}
          </button>
          {(files.length > 0 || results) && (
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

      {succeeded.length > 1 && (
        <div className="flex items-center justify-between gap-3 bg-white border border-slate-200/80 rounded-xl px-5 py-4 shadow-card">
          <div className="text-sm text-slate-600">
            <span className="font-semibold text-slate-800">
              {succeeded.length} cases
            </span>{" "}
            · {totalOut} {totalOut === 1 ? "file" : "files"} converted
          </div>
          <button
            onClick={downloadEverything}
            disabled={zipping !== null}
            className="px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm whitespace-nowrap"
          >
            {zipping === "__all__" ? "Zipping…" : "Download everything (.zip)"}
          </button>
        </div>
      )}

      {failed.map(({ r, i }) => (
        <div
          key={i}
          className="p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-700"
        >
          <span className="font-medium">{r.sourceName}</span> — {r.error}
          {r.skipped && r.skipped.length > 0 && (
            <div className="mt-1 text-red-600/90">
              Skipped: {r.skipped.map((s) => `${s.sheet} (${s.reason})`).join(", ")}
            </div>
          )}
        </div>
      ))}

      {succeeded.map(({ r, i }) => {
        const rows = r.files!.reduce((s, f) => s + f.rows, 0);
        return (
          <div
            key={i}
            className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 p-5 border-b border-slate-200">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                  <h3 className="text-lg font-semibold text-slate-800">
                    Ready to upload
                    <span className="text-sm font-normal text-slate-500 ml-2">
                      Case{" "}
                      <span className="font-mono text-slate-700">
                        {r.caseId}
                      </span>{" "}
                      · {r.files!.length}{" "}
                      {r.files!.length === 1 ? "file" : "files"} · {rows}{" "}
                      {rows === 1 ? "row" : "rows"}
                    </span>
                  </h3>
                </div>
                <div className="text-xs text-slate-400 mt-1 ml-3 truncate">
                  from {r.sourceName}
                </div>
              </div>
              <button
                onClick={() => downloadCase(r, i)}
                disabled={zipping !== null}
                className="px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm whitespace-nowrap"
              >
                {zipping === String(i) ? "Zipping…" : "Download all (.zip)"}
              </button>
            </div>

            <ul className="divide-y divide-slate-100">
              {r.files!.map((f) => (
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

            {r.skipped && r.skipped.length > 0 && (
              <div className="px-5 py-3 bg-amber-50 border-t border-amber-200 text-sm text-amber-800">
                <span className="font-medium">
                  Skipped {r.skipped.length}{" "}
                  {r.skipped.length === 1 ? "sheet" : "sheets"}:
                </span>{" "}
                {r.skipped.map((s) => `${s.sheet} (${s.reason})`).join(", ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
