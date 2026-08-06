import { NextResponse } from "next/server";
import { convertWorkbook } from "@/lib/cfr/convert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — bank case files are tiny in practice
const MAX_FILES = 20;

/** One source workbook's outcome — either its converted files, or why it failed. */
interface SourceResult {
  sourceName: string;
  caseId?: string;
  files?: { name: string; sheet: string; rows: number; base64: string }[];
  skipped?: { sheet: string; reason: string }[];
  error?: string;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form upload." },
      { status: 400 },
    );
  }

  // `File` became a global only in Node 20; an older prod runtime throws
  // "File is not defined" on `entry instanceof File`, crashing the handler before
  // it can return. Narrow without touching the global File constructor — a
  // FormData entry is either a string (non-file field) or a File (extends Blob).
  const uploads = form
    .getAll("file")
    .filter((entry): entry is File => entry !== null && typeof entry !== "string");

  if (uploads.length === 0) {
    return NextResponse.json(
      { error: 'No file uploaded. Attach the Bank Case ID .xlsx as "file".' },
      { status: 400 },
    );
  }
  if (uploads.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Too many files (max ${MAX_FILES} per upload).` },
      { status: 400 },
    );
  }

  // Each workbook is converted independently, exactly as if it had been uploaded
  // on its own — one bad file never takes the rest of the batch down with it.
  const results: SourceResult[] = [];
  for (const file of uploads) {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      results.push({
        sourceName: file.name,
        error: "Not a .xlsx file (expected a Bank Case ID workbook).",
      });
      continue;
    }
    if (file.size > MAX_BYTES) {
      results.push({ sourceName: file.name, error: "File is too large (max 25 MB)." });
      continue;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await convertWorkbook(buffer, file.name);
      if (result.files.length === 0) {
        results.push({
          sourceName: file.name,
          caseId: result.caseId,
          error:
            "No output files were created — the workbook had no usable data rows.",
          skipped: result.skipped,
        });
        continue;
      }
      results.push({
        sourceName: file.name,
        caseId: result.caseId,
        files: result.files.map((f) => ({
          name: f.name,
          sheet: f.sheet,
          rows: f.rows,
          base64: f.buffer.toString("base64"),
        })),
        skipped: result.skipped,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Conversion failed unexpectedly.";
      console.error("[/api/cfr/convert]", file.name, err);
      results.push({ sourceName: file.name, error: message });
    }
  }

  // Only fail the whole request when nothing at all converted; otherwise the
  // client renders the per-file errors alongside the successes.
  if (results.every((r) => r.error)) {
    return NextResponse.json(
      {
        error:
          results.length === 1
            ? results[0].error
            : "None of the uploaded workbooks could be converted.",
        results,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(
    { results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
