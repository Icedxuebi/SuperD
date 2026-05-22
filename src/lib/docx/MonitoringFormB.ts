import fs from "fs";
import {
  AlignmentType,
  BorderStyle,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  TextWrappingType,
  VerticalAlign,
  VerticalPositionRelativeFrom,
  WidthType,
  PageBreak,
} from "docx";
import {
  MONITORING_ITEMS,
  sumA,
  sumB,
  type FormBInput,
  type FormBItemInput,
} from "../form-b";
export { emptyFormBInput, MONITORING_ITEMS, type FormBInput } from "../form-b";

const FONT = "Browallia New";
const BRAND_RED = "C00000";
const WHITE = "FFFFFF";
// Standard "Office blue" for checked marks.
const CHECK_BLUE = "0070C0";

// Tighter sizes than v1 so one form fits one page.
const SZ_FORM_TITLE = 28; // 14pt
const SZ_SECTION = 24; // 12pt
const SZ_BODY = 20; // 10pt
const SZ_SMALL = 22; // 11pt — table cells

const CHECKED = "☑"; // ☑
const UNCHECKED = "☐"; // ☐

const BORDER_THIN = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: "000000",
};

// Signature image size for inline placement in Section 1 / Section 4
const SIG_WIDTH = 70;
const SIG_HEIGHT = 24;

export interface FormBSigner {
  name: string;
  signaturePath?: string;
}

function run(
  text: string,
  opts: { bold?: boolean; size?: number; color?: string; underline?: boolean } = {}
): TextRun {
  return new TextRun({
    text,
    bold: opts.bold,
    size: opts.size ?? SZ_BODY,
    color: opts.color,
    underline: opts.underline ? { type: "single", color: "000000" } : undefined,
    font: { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT },
  });
}

function para(
  children: (TextRun | ImageRun)[],
  opts: {
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spacingBefore?: number;
    spacingAfter?: number;
    pageBreakBefore?: boolean;
    indentLeft?: number; // twips
  } = {}
): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    pageBreakBefore: opts.pageBreakBefore,
    indent: opts.indentLeft ? { left: opts.indentLeft } : undefined,
    spacing: {
      before: opts.spacingBefore,
      after: opts.spacingAfter ?? 0,
      line: 240,
      lineRule: "auto",
    },
    children,
  });
}

function check(on: boolean): string {
  return on ? CHECKED : UNCHECKED;
}

// Checkbox glyph as its own run so the checked state can be colored blue
// without affecting the surrounding label text.
function checkRun(on: boolean, opts: { size?: number } = {}): TextRun {
  return run(on ? CHECKED : UNCHECKED, {
    size: opts.size,
    bold: on,
    color: on ? CHECK_BLUE : undefined,
  });
}

function headerCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    shading: { fill: BRAND_RED, color: "auto", type: "clear" },
    margins: { top: 30, bottom: 30, left: 50, right: 50 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        children: [run(text, { bold: true, color: WHITE, size: SZ_SMALL })],
      }),
    ],
  });
}

function bodyCell(
  children: Paragraph[],
  opts: { widthPct: number }
): TableCell {
  return new TableCell({
    width: { size: opts.widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 25, bottom: 25, left: 50, right: 50 },
    children,
  });
}

function textCell(
  text: string,
  opts: {
    widthPct: number;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    bold?: boolean;
    size?: number;
  }
): TableCell {
  return bodyCell(
    [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        children: [run(text, { bold: opts.bold, size: opts.size ?? SZ_SMALL })],
      }),
    ],
    { widthPct: opts.widthPct }
  );
}

function bordered(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER_THIN,
      bottom: BORDER_THIN,
      left: BORDER_THIN,
      right: BORDER_THIN,
      insideHorizontal: BORDER_THIN,
      insideVertical: BORDER_THIN,
    },
    rows,
  });
}

function buildMonitoringTable(items: FormBItemInput[]): Table {
  const w = [30, 22, 11, 26, 11];
  const header = new TableRow({
    tableHeader: true,
    height: { value: 400, rule: HeightRule.ATLEAST },
    children: [
      headerCell("รายการ", w[0]),
      headerCell("ตรวจสอบทั่วไป", w[1]),
      headerCell("A คะแนน (1-5)", w[2]),
      headerCell("ตรวจสอบ Red Flags", w[3]),
      headerCell("B คะแนน (1)", w[4]),
    ],
  });
  // All data rows (row 2 onward) are center-aligned per spec.
  const rows = MONITORING_ITEMS.map((item, idx) => {
    const it = items[idx] ?? { aScore: null, bFlag: false };
    return new TableRow({
      children: [
        textCell(item.label, { widthPct: w[0], align: AlignmentType.LEFT }),
        textCell(item.generalCheck, { widthPct: w[1], align: AlignmentType.CENTER }),
        textCell(it.aScore == null ? "" : String(it.aScore), {
          widthPct: w[2],
          align: AlignmentType.CENTER,
          bold: true,
        }),
        textCell(item.redFlag, { widthPct: w[3], align: AlignmentType.CENTER }),
        textCell(it.bFlag ? "1" : "", {
          widthPct: w[4],
          align: AlignmentType.CENTER,
          bold: true,
        }),
      ],
    });
  });
  return bordered([header, ...rows]);
}

function buildCriteriaTable(form: FormBInput): Table {
  const w = [22, 28, 50];
  const header = new TableRow({
    tableHeader: true,
    height: { value: 400, rule: HeightRule.ATLEAST },
    children: [
      headerCell("คะแนนเฉลี่ย A", w[0]),
      headerCell("ระดับความเสี่ยง", w[1]),
      headerCell("การดำเนินการ", w[2]),
    ],
  });

  const checkLabelPara = (on: boolean, label: string) =>
    new Paragraph({
      spacing: { after: 0, line: 240, lineRule: "auto" },
      children: [
        checkRun(on, { size: SZ_SMALL }),
        run(` ${label}`, { size: SZ_SMALL }),
      ],
    });

  const mediumNotifyLabel = `แจ้งร้านค้าแก้ไขภายใน ${form.actMediumNotifyDays || "........"} วัน ${form.actMediumNotifyHours || "......."} ชั่วโมง`;
  const highNotifyLabel = `แจ้งร้านค้าแก้ไขภายใน ${form.actHighNotifyDays || "........"} วัน ${form.actHighNotifyHours || "......."} ชั่วโมง`;

  // Row 1 — Low (40+): only ปกติ option
  const lowActions = [checkLabelPara(form.actLowNormal, "ปกติ")];

  // Row 2 — Medium (30-39): own copies of notify + EDD
  const mediumActions = [
    checkLabelPara(form.actMediumNotify, mediumNotifyLabel),
    checkLabelPara(form.actMediumEDD, "ส่ง EDD"),
  ];

  // Row 3 — High (<30): own copies of all four
  const highActions = [
    checkLabelPara(form.actHighEDD, "ส่ง EDD"),
    checkLabelPara(form.actHighNotify, highNotifyLabel),
    checkLabelPara(form.actHighSuspend, "ระงับธุรกรรมร้านค้าชั่วคราว"),
    checkLabelPara(form.actHighClose, "ปิดบัญชีร้านค้า"),
  ];

  const rowLow = new TableRow({
    children: [
      textCell("40 ขึ้นไป", { widthPct: w[0], align: AlignmentType.CENTER }),
      textCell("ความเสี่ยงต่ำ (Low)", { widthPct: w[1], align: AlignmentType.CENTER }),
      bodyCell(lowActions, { widthPct: w[2] }),
    ],
  });
  const rowMedium = new TableRow({
    children: [
      textCell("เท่ากับ 30-39", { widthPct: w[0], align: AlignmentType.CENTER }),
      textCell("ความเสี่ยงปานกลาง (Medium)", { widthPct: w[1], align: AlignmentType.CENTER }),
      bodyCell(mediumActions, { widthPct: w[2] }),
    ],
  });
  const rowHigh = new TableRow({
    children: [
      textCell("น้อยกว่า 30", { widthPct: w[0], align: AlignmentType.CENTER }),
      textCell("ความเสี่ยงสูง (High)", { widthPct: w[1], align: AlignmentType.CENTER }),
      bodyCell(highActions, { widthPct: w[2] }),
    ],
  });

  // B-score section
  const headerB = new TableRow({
    tableHeader: true,
    height: { value: 400, rule: HeightRule.ATLEAST },
    children: [
      headerCell("คะแนนเฉลี่ย B", w[0]),
      headerCell("ระดับความเสี่ยง", w[1]),
      headerCell("การดำเนินการ", w[2]),
    ],
  });
  // B-row "ปิดบัญชีร้านค้า" is auto-ticked whenever ANY B flag is set
  // (i.e., the total B score is 1 or more).
  const bAutoClose = sumB(form.items) >= 1;
  const rowB = new TableRow({
    children: [
      textCell("1 คะแนนขึ้นไป", { widthPct: w[0], align: AlignmentType.CENTER }),
      textCell("ความเสี่ยงสูง (High)", { widthPct: w[1], align: AlignmentType.CENTER }),
      bodyCell(
        [
          new Paragraph({
            spacing: { after: 0, line: 240, lineRule: "auto" },
            children: [
              checkRun(bAutoClose, { size: SZ_SMALL }),
              run(" ปิดบัญชีร้านค้า", { size: SZ_SMALL }),
            ],
          }),
        ],
        { widthPct: w[2] }
      ),
    ],
  });

  return bordered([header, rowLow, rowMedium, rowHigh, headerB, rowB]);
}

function formatDateOrBlank(iso: string): string {
  // DD/MM/YYYY (Gregorian) — matches the correct template format.
  if (!iso || iso.length < 10) return "________________";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Word collapses trailing regular spaces in a run — use non-breaking spaces
// (U+00A0) so the underline actually renders its full padded length.
const NB = " ";

// Underlined fill-in run. Pads the value with non-breaking spaces so the line
// renders the full padded length. Pass padLeft/padRight separately for
// left-aligned fields (e.g. comments — long line on the right only).
function fill(
  value: string,
  opts: { padLeft?: number; padRight?: number; pad?: number } = {}
): TextRun {
  const padLeft = opts.padLeft ?? opts.pad ?? 4;
  const padRight = opts.padRight ?? opts.pad ?? 4;
  return run(
    `${NB.repeat(padLeft)}${value}${NB.repeat(padRight)}`,
    { underline: true }
  );
}

// Signature painted ON TOP OF a continuous underlined run. The image is
// floated (no inline width consumed) so the underlined spaces extend the full
// length of the field with the signature drawn over the leftmost portion.
//
// Anchored to the PARAGRAPH (not LINE) so a small vertical raise can't push
// the image up onto the previous bullet's line.
function signatureRuns(
  signaturePath: string | undefined,
  fallback: string,
  opts: { underlinePad?: number; nudgeRight?: number; nudgeUp?: number } = {}
): (TextRun | ImageRun)[] {
  const padCount = opts.underlinePad ?? 60;
  // ~63500 EMU per character at 10pt; nudgeRight is in characters.
  const xOffset = (opts.nudgeRight ?? 0) * 63500;
  // nudgeUp ticks (~63500 EMU each) raise the image above the baseline raise.
  const yOffset = -40000 - (opts.nudgeUp ?? 0) * 63500;
  const fillRun = fill("", { padLeft: 0, padRight: padCount });
  if (signaturePath && fs.existsSync(signaturePath)) {
    const sig = new ImageRun({
      type: "png",
      data: fs.readFileSync(signaturePath),
      transformation: { width: SIG_WIDTH, height: SIG_HEIGHT },
      floating: {
        horizontalPosition: {
          relative: HorizontalPositionRelativeFrom.CHARACTER,
          offset: xOffset,
        },
        verticalPosition: {
          relative: VerticalPositionRelativeFrom.PARAGRAPH,
          offset: yOffset,
        },
        wrap: { type: TextWrappingType.NONE },
        behindDocument: false,
      },
    });
    return [sig, fillRun];
  }
  return [fill(fallback, { padLeft: 2, padRight: padCount })];
}

export function buildFormBChildren(
  form: FormBInput,
  signers: { inspector: FormBSigner; follower: FormBSigner }
): (Paragraph | Table)[] {
  const totalA = sumA(form.items);
  const totalB = sumB(form.items);

  const titleLine1 = para(
    [run("ฟอร์ม B: Website Monitoring Form", { bold: true, size: SZ_FORM_TITLE })],
    {
      align: AlignmentType.CENTER,
      pageBreakBefore: true,
      spacingAfter: 0,
    }
  );
  const titleLine2 = para(
    [run("(ทำหลังอนุมัติไปแล้ว – Monthly/Quarterly)", { bold: true, size: SZ_BODY })],
    { align: AlignmentType.CENTER, spacingAfter: 40 }
  );
  const subtitle = para(
    [run("ใช้สำหรับตรวจต่อเนื่องเพื่อติดตามความเสี่ยง", { size: SZ_BODY })],
    { align: AlignmentType.CENTER, spacingAfter: 100 }
  );

  // Section 1 — ข้อมูลร้านค้า
  const sec1Title = para(
    [run("1. ข้อมูลร้านค้า", { bold: true, size: SZ_SECTION })],
    { spacingAfter: 40 }
  );
  const sec1Body = [
    para(
      [
        run("• ร้านค้า: ", { bold: true }),
        fill(`${form.merchantName} / ${form.ae || "—"}`, { pad: 12 }),
      ],
      { spacingAfter: 20, indentLeft: 540 }
    ),
    para(
      [
        run("• วันที่ตรวจ: ", { bold: true }),
        fill(formatDateOrBlank(form.inspectionDateIso), { pad: 20 }),
      ],
      { spacingAfter: 20, indentLeft: 540 }
    ),
    para(
      [
        run("• ผู้ตรวจ: ", { bold: true }),
        ...signatureRuns(
          signers.inspector.signaturePath,
          signers.inspector.name || "_______",
          { underlinePad: 65, nudgeRight: 4, nudgeUp: 0 }
        ),
      ],
      { spacingAfter: 80, indentLeft: 540 }
    ),
  ];

  // Section 2 — Monitoring
  const sec2Title = para(
    [run("2. รายการ Monitoring + Red Flags", { bold: true, size: SZ_SECTION })],
    { spacingAfter: 40 }
  );
  const monitoringTable = buildMonitoringTable(form.items);
  const totals = para(
    [
      run("คะแนนรวม A: ", { bold: true }),
      run(`${totalA}`, { bold: true, underline: true }),
      run(" / 50", { bold: true }),
      run("    คะแนนรวม B: ", { bold: true }),
      run(`${totalB}`, { bold: true, underline: true }),
      run(" / 10", { bold: true }),
    ],
    { spacingBefore: 60, spacingAfter: 80 }
  );

  // Section 3 — Criteria
  const sec3Title = para(
    [run("3. เกณฑ์สรุปความเสี่ยง / การดำเนินการ", { bold: true, size: SZ_SECTION })],
    { spacingAfter: 40 }
  );
  const criteriaTable = buildCriteriaTable(form);

  // Section 4 — ผลการติดตาม
  const sec4Title = para(
    [run("4. ผลการติดตาม", { bold: true, size: SZ_SECTION })],
    { spacingBefore: 100, spacingAfter: 40 }
  );
  const sec4Follower = para(
    [
      run("ผู้ติดตาม: ", { bold: true }),
      ...signatureRuns(
        signers.follower.signaturePath,
        signers.follower.name || "____________",
        { underlinePad: 50, nudgeRight: 4, nudgeUp: 0.5 }
      ),
      run("    วันที่ติดตาม: ", { bold: true }),
      fill(formatDateOrBlank(form.followDateIso), { padLeft: 4, padRight: 30 }),
    ],
    { spacingAfter: 40 }
  );
  const sec4Comment = para(
    [
      run("ความเห็นผู้ติดตาม: ", { bold: true }),
      fill(form.followerComment || "-", { padLeft: 1, padRight: 110 }),
    ],
    { spacingAfter: 60 }
  );
  const sec4Actions = para(
    [
      checkRun(form.followSuspend),
      run(" ระงับธุรกรรมร้านค้าชั่วคราว    "),
      checkRun(form.followClose),
      run(" ปิดบัญชีร้านค้า    "),
      checkRun(form.followRestore),
      run(" คืนสถานะร้านค้าให้เปิดปกติ"),
    ],
    { spacingAfter: 0 }
  );

  return [
    titleLine1,
    titleLine2,
    subtitle,
    sec1Title,
    ...sec1Body,
    sec2Title,
    monitoringTable,
    totals,
    sec3Title,
    criteriaTable,
    sec4Title,
    sec4Follower,
    sec4Comment,
    sec4Actions,
  ];
}

export function buildAllFormBChildren(
  forms: FormBInput[],
  signers: { inspector: FormBSigner; follower: FormBSigner }
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  forms.forEach((f) => {
    out.push(...buildFormBChildren(f, signers));
  });
  return out;
}

// Re-export PageBreak for callers that want explicit breaks.
export { PageBreak };
