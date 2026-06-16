import { NextResponse } from "next/server";
import { convertWorkbook } from "@/lib/cfr/convert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — bank case files are tiny in practice

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

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'No file uploaded. Attach the Bank Case ID .xlsx as "file".' },
      { status: 400 },
    );
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json(
      { error: "Please upload a .xlsx file (the Bank Case ID workbook)." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File is too large (max 25 MB)." },
      { status: 413 },
    );
  }

  let result;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    result = await convertWorkbook(buffer, file.name);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Conversion failed unexpectedly.";
    console.error("[/api/cfr/convert]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (result.files.length === 0) {
    return NextResponse.json(
      {
        error:
          "No output files were created — the workbook had no usable data rows.",
        skipped: result.skipped,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(
    {
      caseId: result.caseId,
      files: result.files.map((f) => ({
        name: f.name,
        sheet: f.sheet,
        rows: f.rows,
        base64: f.buffer.toString("base64"),
      })),
      skipped: result.skipped,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
