/**
 * CFR "Money Trace" converter.
 *
 * Port of cfrauto/convert.py. Turns a "Bank Case ID *.xlsx" workbook into one
 * ready-to-upload xlsx per sheet, using TemplateAddSubCase_V17.2_Non-bank.xlsx
 * as the skeleton. ExcelJS is used (not SheetJS) because it copies the template
 * cell-by-cell — preserving the form's styles, merged cells and the AL-column
 * formula — exactly the way the original openpyxl script does.
 */

import path from "path";
import fs from "fs/promises";
import ExcelJS from "exceljs";

export const TEMPLATE_PATH = path.join(
  process.cwd(),
  "cfr-template",
  "TemplateAddSubCase_V17.2_Non-bank.xlsx",
);

const TEMPLATE_SHEET = "AddSubCase";
const COMPANY_NAME = "บริษัท เอนี่เพย์ จำกัด";
const FI_CODE = 358;

const REQUIRED_HEADERS = [
  "MID",
  "TaxID",
  "BillerAccNo",
  "Name",
  "Surname",
  "WithdrawDate",
  "WithdrawTime",
  "AccountNumber",
  "Bank Name",
  "ToBankID",
  "Amount",
  "ผู้รับโอน",
  "ยอดเงินที่ควรระงับ",
] as const;

export interface ConvertedFile {
  /** Output filename, e.g. readytoupload_<caseId>_<sheet>.xlsx */
  name: string;
  /** Source sheet name from the input workbook */
  sheet: string;
  /** Number of transaction rows written */
  rows: number;
  /** The generated xlsx bytes */
  buffer: Buffer;
}

export interface SkippedSheet {
  sheet: string;
  reason: string;
}

export interface ConvertResult {
  caseId: string;
  files: ConvertedFile[];
  skipped: SkippedSheet[];
}

/** Pull e.g. "25690509BBL00005" out of "Bank Case ID 25690509BBL00005.xlsx". */
export function extractCaseId(filename: string): string {
  const base = path.basename(filename).replace(/\.[^.]+$/, "");
  const m = base.match(/Bank\s*Case\s*ID\s*[_\-\s]*(\S+)/i);
  return m ? m[1] : base;
}

/** Last whitespace token = surname; everything before = first name. */
export function splitName(full: string): [string, string] {
  const s = (full || "").trim();
  if (!s) return ["", ""];
  const parts = s.split(/\s+/);
  if (parts.length === 1) return [parts[0], ""];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}

/** Strip commas and coerce to a number; fall back to 0. */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const s = String(value).replace(/,/g, "").trim();
  const f = Number(s);
  return Number.isFinite(f) ? f : 0;
}

/** A cell may hold a string, number, Date, formula object or rich text. */
function cellRaw(cell: ExcelJS.Cell | undefined): unknown {
  if (!cell) return null;
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("result" in obj) return obj.result ?? null; // formula -> cached result
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return (obj.richText as { text: string }[]).map((t) => t.text).join("");
    }
    if ("text" in obj) return obj.text; // hyperlink
    if (v instanceof Date) return v;
  }
  return v;
}

/** Stringify a cell value, preserving leading zeros for account/bank codes. */
function cellStr(cell: ExcelJS.Cell | undefined): string {
  const v = cellRaw(cell);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return formatTime(v);
  return String(v).trim();
}

/** Format a withdraw time as HH:MM:SS, whether it arrives as text or a Date. */
export function formatTime(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Time-only cells come back as a Date anchored to the epoch; read in UTC so
    // the wall-clock time is not shifted by the server's timezone.
    const hh = String(value.getUTCHours()).padStart(2, "0");
    const mm = String(value.getUTCMinutes()).padStart(2, "0");
    const ss = String(value.getUTCSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return String(value).trim();
}

function safeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}

function buildHeaderIndex(headerRow: ExcelJS.Row): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = cellStr(cell);
    if (name && !map.has(name)) map.set(name, colNumber);
  });
  return map;
}

async function writeCaseFile(
  templateBuffer: Buffer,
  caseId: string,
  inputSheet: ExcelJS.Worksheet,
  col: Map<string, number>,
  dataRowNumbers: number[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(TEMPLATE_SHEET) ?? wb.worksheets[0];

  const at = (rowNumber: number, name: string): ExcelJS.Cell | undefined => {
    const c = col.get(name);
    return c ? inputSheet.getRow(rowNumber).getCell(c) : undefined;
  };

  const firstRow = dataRowNumbers[0];
  const taxId = cellStr(at(firstRow, "TaxID")).padStart(13, "0");
  const payorFirst = cellStr(at(firstRow, "Name"));
  const payorLast = cellStr(at(firstRow, "Surname"));
  const billerAcc = cellStr(at(firstRow, "BillerAccNo"));

  // Row 3: Bank Case ID
  ws.getCell("A3").value = caseId;

  // Row 7: payor info (one row, same payor for every transaction)
  ws.getCell("A7").value = taxId;
  ws.getCell("B7").value = "บุคคลธรรมดา";
  ws.getCell("C7").value = payorFirst;
  ws.getCell("D7").value = payorLast;
  ws.getCell("O7").value = 0;
  ws.getCell("W7").value = billerAcc;
  ws.getCell("X7").value = COMPANY_NAME;
  ws.getCell("Y7").value = FI_CODE;

  // Row 12+: one row per transaction
  dataRowNumbers.forEach((srcRow, i) => {
    const excelRow = 12 + i;
    const [sendFirst, sendLast] = splitName(cellStr(at(srcRow, "ผู้รับโอน")));
    const set = (c: number, value: ExcelJS.CellValue) => {
      ws.getRow(excelRow).getCell(c).value = value;
    };

    set(2, payorFirst); // B
    set(3, payorLast); // C
    set(4, billerAcc); // D
    set(5, COMPANY_NAME); // E
    set(6, FI_CODE); // F
    set(11, sendFirst); // K
    set(12, sendLast); // L
    set(13, "ไม่มี"); // M
    set(15, cellStr(at(srcRow, "AccountNumber"))); // O
    set(16, cellStr(at(srcRow, "Bank Name"))); // P
    set(17, cellStr(at(srcRow, "ToBankID"))); // Q
    set(18, cellStr(at(srcRow, "WithdrawDate"))); // R
    set(19, formatTime(cellRaw(at(srcRow, "WithdrawTime")))); // S
    set(21, toNumber(cellRaw(at(srcRow, "Amount")))); // U
    set(46, toNumber(cellRaw(at(srcRow, "ยอดเงินที่ควรระงับ")))); // AT
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * Convert every sheet of a Bank Case ID workbook into ready-to-upload files.
 *
 * @param inputBuffer the uploaded .xlsx bytes
 * @param filename    the original filename (used to derive the Bank Case ID)
 */
export async function convertWorkbook(
  inputBuffer: Buffer,
  filename: string,
): Promise<ConvertResult> {
  const caseId = extractCaseId(filename);
  const templateBuffer = await fs.readFile(TEMPLATE_PATH);

  const inWb = new ExcelJS.Workbook();
  await inWb.xlsx.load(inputBuffer as unknown as ArrayBuffer);

  const files: ConvertedFile[] = [];
  const skipped: SkippedSheet[] = [];
  const usedNames = new Set<string>();

  for (const ws of inWb.worksheets) {
    if (ws.rowCount < 2) {
      skipped.push({ sheet: ws.name, reason: "no data rows" });
      continue;
    }

    const col = buildHeaderIndex(ws.getRow(1));
    const missing = REQUIRED_HEADERS.filter((h) => !col.has(h));
    if (missing.length) {
      skipped.push({
        sheet: ws.name,
        reason: `missing column(s): ${missing.join(", ")}`,
      });
      continue;
    }

    const headerCols = Array.from(col.values());
    const dataRowNumbers: number[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const hasData = headerCols.some((c) => {
        const s = cellStr(row.getCell(c));
        return s !== "";
      });
      if (hasData) dataRowNumbers.push(r);
    }
    if (!dataRowNumbers.length) {
      skipped.push({ sheet: ws.name, reason: "empty data rows" });
      continue;
    }

    let name = `readytoupload_${caseId}_${safeFilename(ws.name)}.xlsx`;
    // Guard against duplicate sheet names producing a colliding filename.
    if (usedNames.has(name)) {
      let n = 2;
      const stem = name.replace(/\.xlsx$/, "");
      while (usedNames.has(`${stem}_${n}.xlsx`)) n++;
      name = `${stem}_${n}.xlsx`;
    }
    usedNames.add(name);

    const buffer = await writeCaseFile(
      templateBuffer,
      caseId,
      ws,
      col,
      dataRowNumbers,
    );
    files.push({ name, sheet: ws.name, rows: dataRowNumbers.length, buffer });
  }

  return { caseId, files, skipped };
}
