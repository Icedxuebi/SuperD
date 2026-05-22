import fs from "fs";
import path from "path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
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
} from "docx";
import { toThaiLong, toThaiShort } from "./thai-date";
import { buildAllFormBChildren, type FormBInput } from "./MonitoringFormB";
import { buildLastPageChildren } from "./LastPage";
import type { LastPageInput } from "../last-page";

// Template uses Browallia New as the primary font for both Latin and Thai (complex script).
const FONT = "Browallia New";
// Anypay brand red — exact value pulled from template.docx table headers + footer line.
const BRAND_RED = "C00000";
const WHITE = "FFFFFF";

// Common half-point sizes pulled from template:
//   18pt title (sz 36), 16pt section heading (sz 32), 11pt body/cells (sz 22), 9pt footer (sz 18)
const SZ_TITLE = 36;
const SZ_SECTION = 32;
const SZ_BODY = 22;
const SZ_FOOTER = 18;

// Signature slot line height (twips). The image (110x50 px) is anchored at the text baseline,
// which sits well above the bottom of a tall paragraph — so a 750-twip slot leaves a visible gap
// between the signature and the dotted line that follows. 450 twips closes most of that gap
// while still keeping all 3 signer columns visually aligned (the acknowledger column uses the
// same slot height with an empty space char).
const SIGNATURE_SLOT_LINE_TWIPS = 900;

const HEADER_LOGO_FILENAME = "header.png";
const HEADER_LOGO_PATH = path.join(process.cwd(), HEADER_LOGO_FILENAME);

export interface Top5Row {
  rank: number;
  ae: string;
  mid: string;
  merchantName: string;
  amount: string;
}

export interface OrderTest {
  rank: number;
  orderDateIso: string;
  mid: string;
  merchantName: string;
  productName: string;
  productAmount: string;
}

export interface OrderStatus {
  rank: number;
  status: string;
  trackingNumber: string;
  carrierName: string;
  deliveredDate: string;
}

export interface Signer {
  name: string;
  title: string;
  signaturePath?: string;
}

export interface Top5DailyReportData {
  reportDateIso: string;
  signingDateIso: string;
  top5: Top5Row[];
  selectedRank: number;
  orderTest: OrderTest;
  orderStatus: OrderStatus;
  preparer: Signer;
  reviewer: Signer;
  acknowledger: Signer;
  forms: FormBInput[];
  lastPage: LastPageInput;
}

const BORDER_THIN = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: "000000",
};
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

function thaiRun(
  text: string,
  opts: { bold?: boolean; size?: number; color?: string } = {}
): TextRun {
  return new TextRun({
    text,
    bold: opts.bold,
    size: opts.size ?? SZ_BODY,
    color: opts.color,
    font: { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT },
  });
}

function p(
  text: string,
  opts: {
    bold?: boolean;
    size?: number;
    color?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spacingAfter?: number;
    spacingBefore?: number;
  } = {}
): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: {
      before: opts.spacingBefore,
      after: opts.spacingAfter ?? 0,
      line: 240,
      lineRule: "auto",
    },
    children: [
      thaiRun(text, { bold: opts.bold, size: opts.size, color: opts.color }),
    ],
  });
}

function headerCell({
  text,
  widthPct,
}: {
  text: string;
  widthPct: number;
}): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    shading: { fill: BRAND_RED, color: "auto", type: "clear" },
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        children: [thaiRun(text, { bold: true, color: WHITE })],
      }),
    ],
  });
}

function dataCell({
  text,
  align = AlignmentType.LEFT,
  widthPct,
  bold,
}: {
  text: string;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  widthPct: number;
  bold?: boolean;
}): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: align,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        children: [thaiRun(text, { bold })],
      }),
    ],
  });
}

function table(rows: TableRow[]): Table {
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

function buildTop5Table(top5: Top5Row[], selectedRank: number): Table {
  const w = [8, 17, 22, 33, 20];
  const header = new TableRow({
    tableHeader: true,
    height: { value: 610, rule: HeightRule.ATLEAST },
    children: [
      headerCell({ text: "NO.", widthPct: w[0] }),
      headerCell({ text: "AE", widthPct: w[1] }),
      headerCell({ text: "MID", widthPct: w[2] }),
      headerCell({ text: "Merchant Name", widthPct: w[3] }),
      headerCell({ text: "Amount (THB)", widthPct: w[4] }),
    ],
  });
  const rows = top5.map((r) => {
    const bold = r.rank === selectedRank;
    return new TableRow({
      children: [
        dataCell({ text: String(r.rank), align: AlignmentType.CENTER, widthPct: w[0], bold }),
        dataCell({ text: r.ae, align: AlignmentType.CENTER, widthPct: w[1], bold }),
        dataCell({ text: r.mid, align: AlignmentType.CENTER, widthPct: w[2], bold }),
        dataCell({ text: r.merchantName, align: AlignmentType.CENTER, widthPct: w[3], bold }),
        dataCell({ text: r.amount, align: AlignmentType.CENTER, widthPct: w[4], bold }),
      ],
    });
  });
  return table([header, ...rows]);
}

function buildOrderTestTable(o: OrderTest): Table {
  const w = [8, 18, 20, 20, 22, 12];
  const header = new TableRow({
    tableHeader: true,
    height: { value: 610, rule: HeightRule.ATLEAST },
    children: [
      headerCell({ text: "ลำดับ", widthPct: w[0] }),
      headerCell({ text: "วันที่สั่งซื้อสินค้า", widthPct: w[1] }),
      headerCell({ text: "MID", widthPct: w[2] }),
      headerCell({ text: "Merchant Name", widthPct: w[3] }),
      headerCell({ text: "ชื่อสินค้า", widthPct: w[4] }),
      headerCell({ text: "มูลค่าสินค้า", widthPct: w[5] }),
    ],
  });
  const row = new TableRow({
    children: [
      dataCell({ text: String(o.rank), align: AlignmentType.CENTER, widthPct: w[0], bold: true }),
      dataCell({ text: toThaiShort(o.orderDateIso), align: AlignmentType.CENTER, widthPct: w[1], bold: true }),
      dataCell({ text: o.mid, align: AlignmentType.CENTER, widthPct: w[2], bold: true }),
      dataCell({ text: o.merchantName, align: AlignmentType.CENTER, widthPct: w[3], bold: true }),
      dataCell({ text: o.productName, align: AlignmentType.CENTER, widthPct: w[4], bold: true }),
      dataCell({ text: o.productAmount, align: AlignmentType.CENTER, widthPct: w[5], bold: true }),
    ],
  });
  return table([header, row]);
}

function buildOrderStatusTable(o: OrderStatus): Table {
  const w = [8, 30, 20, 20, 22];
  const header = new TableRow({
    tableHeader: true,
    height: { value: 610, rule: HeightRule.ATLEAST },
    children: [
      headerCell({ text: "ลำดับ", widthPct: w[0] }),
      headerCell({ text: "Order Status", widthPct: w[1] }),
      headerCell({ text: "เลขพัสดุ", widthPct: w[2] }),
      headerCell({ text: "ชื่อขนส่ง", widthPct: w[3] }),
      headerCell({ text: "วันที่ได้รับสินค้า", widthPct: w[4] }),
    ],
  });
  const row = new TableRow({
    children: [
      dataCell({ text: String(o.rank), align: AlignmentType.CENTER, widthPct: w[0], bold: true }),
      dataCell({ text: o.status, align: AlignmentType.CENTER, widthPct: w[1], bold: true }),
      dataCell({ text: o.trackingNumber || "-", align: AlignmentType.CENTER, widthPct: w[2], bold: true }),
      dataCell({ text: o.carrierName || "-", align: AlignmentType.CENTER, widthPct: w[3], bold: true }),
      dataCell({ text: o.deliveredDate || "-", align: AlignmentType.CENTER, widthPct: w[4], bold: true }),
    ],
  });
  return table([header, row]);
}

// Nudge the floating signature image by this many "ticks" of ~63500 EMU each
// (~0.07in per tick). Down = lower on the page (toward the dotted line);
// Left = horizontally to the left of its centered anchor.
const SIGNATURE_NUDGE_DOWN = 4;
const SIGNATURE_NUDGE_LEFT = 8;

function signatureSlotParagraph(signer: Signer): Paragraph {
  // Fixed-height paragraph for the signature image — height matches whether the image is present or not,
  // so the dotted line + name + title + date align across all three signer columns.
  const hasSig = signer.signaturePath && fs.existsSync(signer.signaturePath);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0, line: SIGNATURE_SLOT_LINE_TWIPS, lineRule: "exact" },
    children: hasSig
      ? [
          new ImageRun({
            type: "png",
            data: fs.readFileSync(signer.signaturePath!),
            transformation: { width: 110, height: 50 },
            floating: {
              horizontalPosition: {
                relative: HorizontalPositionRelativeFrom.CHARACTER,
                offset: -SIGNATURE_NUDGE_LEFT * 63500,
              },
              verticalPosition: {
                relative: VerticalPositionRelativeFrom.PARAGRAPH,
                offset: SIGNATURE_NUDGE_DOWN * 63500,
              },
              wrap: { type: TextWrappingType.NONE },
              behindDocument: false,
              layoutInCell: true,
            },
          }),
        ]
      : [thaiRun(" ")],
  });
}

function signatureColumn(
  label: string,
  signer: Signer,
  signingDateIso: string
): TableCell {
  return new TableCell({
    width: { size: 33.33, type: WidthType.PERCENTAGE },
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
    },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80, line: 240, lineRule: "auto" },
        children: [thaiRun(label, { bold: true })],
      }),
      signatureSlotParagraph(signer),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        children: [thaiRun("…………………………………………")],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        children: [thaiRun(`( ${signer.name} )`)],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        children: [thaiRun(signer.title)],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 0, line: 240, lineRule: "auto" },
        children: [thaiRun(`วันที่ ${toThaiLong(signingDateIso)}`)],
      }),
    ],
  });
}

function buildSignatureBlock(data: Top5DailyReportData): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
    rows: [
      new TableRow({
        children: [
          signatureColumn("จัดทำโดย", data.preparer, data.signingDateIso),
          signatureColumn("ตรวจสอบโดย", data.reviewer, data.signingDateIso),
          signatureColumn("รับทราบโดย", data.acknowledger, data.signingDateIso),
        ],
      }),
    ],
  });
}

function buildHeader(): Header {
  const hasLogo = fs.existsSync(HEADER_LOGO_PATH);
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        children: hasLogo
          ? [
              new ImageRun({
                type: "png",
                data: fs.readFileSync(HEADER_LOGO_PATH),
                transformation: { width: 91, height: 37 },
              }),
            ]
          : [thaiRun("")],
      }),
    ],
  });
}

function buildFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: {
          top: {
            style: BorderStyle.SINGLE,
            size: 8,
            color: BRAND_RED,
            space: 4,
          },
        },
        spacing: { before: 80, line: 240, lineRule: "auto" },
        children: [
          thaiRun(
            "บริษัท เอนี่เพย์ จำกัด เลขที่ 1188 อาคารแกรนด์เซนเตอร์พอยต์ลุมพินี ชั้น 17 ห้อง 1717-1720 ถนนพระราม 4 แขวงทุ่งมหาเมฆ เขตสาทร กรุงเทพฯ 10120",
            { size: SZ_FOOTER }
          ),
        ],
      }),
    ],
  });
}

export function buildTop5DailyReport(data: Top5DailyReportData): Document {
  const title = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 80, line: 240, lineRule: "auto" },
    children: [
      thaiRun("รายงานร้านค้าที่มียอดสูงสุด 5 อันดับแรก", {
        bold: true,
        size: SZ_TITLE,
      }),
    ],
  });

  const reportDateLine = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 200, line: 240, lineRule: "auto" },
    children: [
      thaiRun(`ประจำวันที่ ${toThaiLong(data.reportDateIso)}`, {
        bold: true,
        size: SZ_TITLE,
      }),
    ],
  });

  return new Document({
    creator: "Anypay Top Merchant Dashboard",
    title: "TOP 5 Daily Report",
    styles: {
      default: {
        document: {
          run: {
            font: { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT },
            size: SZ_BODY,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              // 1.27cm header from top, 0.3cm footer from bottom (per user spec).
              // 1 cm ≈ 567 dxa, so 1.27 cm ≈ 720 dxa and 0.3 cm ≈ 170 dxa.
              top: 1700,
              right: 1440,
              bottom: 1440,
              left: 1440,
              header: 720,
              footer: 170,
            },
          },
        },
        headers: { default: buildHeader() },
        footers: { default: buildFooter() },
        children: [
          title,
          reportDateLine,
          p("1. รายละเอียด", { bold: true, size: SZ_SECTION, spacingAfter: 120 }),
          buildTop5Table(data.top5, data.selectedRank),
          p("2. รายการการทดสอบสั่งซื้อ", {
            bold: true,
            size: SZ_SECTION,
            spacingBefore: 240,
            spacingAfter: 120,
          }),
          buildOrderTestTable(data.orderTest),
          p("3. สรุปผลการสั่งซื้อ", {
            bold: true,
            size: SZ_SECTION,
            spacingBefore: 240,
            spacingAfter: 120,
          }),
          buildOrderStatusTable(data.orderStatus),
          new Paragraph({
            spacing: { before: 480 },
            children: [thaiRun("")],
          }),
          buildSignatureBlock(data),
          ...buildAllFormBChildren(data.forms, {
            inspector: {
              name: data.preparer.name,
              signaturePath: data.preparer.signaturePath,
            },
            follower: {
              name: data.reviewer.name,
              signaturePath: data.reviewer.signaturePath,
            },
          }),
          ...buildLastPageChildren(data.lastPage),
        ],
      },
    ],
  });
}
