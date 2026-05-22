import {
  AlignmentType,
  BorderStyle,
  HeightRule,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  mimeToDocxType,
  stripDataUrl,
  type InlineImage,
  type LastPageInput,
} from "../last-page";

const FONT = "Browallia New";
const BRAND_RED = "C00000";
const WHITE = "FFFFFF";

const SZ_TITLE = 32; // 16pt — matches page-1 section heading
const SZ_HEADER = 22; // 11pt — table header
const SZ_BODY = 22; // 11pt — table body

const BORDER_THIN = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: "000000",
};

// Image sizes — slightly tightened so the 3 tables + title fit one page.
const LANDSCAPE_W = 260;
const LANDSCAPE_H = 150;
const QR_W = 260;
const QR_H = 150;
const SLIP_W = 150;
const SLIP_H = 200;

function run(
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

function headerCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    shading: { fill: BRAND_RED, color: "auto", type: "clear" },
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        children: [run(text, { bold: true, color: WHITE, size: SZ_HEADER })],
      }),
    ],
  });
}

function imageCell(
  img: InlineImage | null,
  widthPct: number,
  imgW: number,
  imgH: number,
  placeholder: string
): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        children: img
          ? [
              new ImageRun({
                type: mimeToDocxType(img.mime),
                data: Buffer.from(stripDataUrl(img.dataUrl), "base64"),
                transformation: { width: imgW, height: imgH },
              }),
            ]
          : [run(placeholder, { color: "888888" })],
      }),
    ],
  });
}

function textCell(
  text: string,
  widthPct: number,
  opts: {
    bold?: boolean;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  } = {}
): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        spacing: { after: 0, line: 280, lineRule: "auto" },
        children: [run(text || "—", { bold: opts.bold ?? true, size: SZ_BODY })],
      }),
    ],
  });
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

function spacer(after = 80): Paragraph {
  return new Paragraph({
    spacing: { after, before: 0, line: 200, lineRule: "auto" },
    children: [run("", { size: 10 })],
  });
}

export function buildLastPageChildren(data: LastPageInput): (Paragraph | Table)[] {
  const title = new Paragraph({
    pageBreakBefore: true,
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120, line: 240, lineRule: "auto" },
    children: [run("สรุปผลการดำเนินการสั่งซื้อสินค้า", { bold: true, size: SZ_TITLE })],
  });

  // Table 1 — Product page | Cart
  const table1 = bordered([
    new TableRow({
      tableHeader: true,
      height: { value: 420, rule: HeightRule.ATLEAST },
      children: [headerCell("สินค้าที่สั่งซื้อ", 50), headerCell("ตะกร้าสินค้า", 50)],
    }),
    new TableRow({
      children: [
        imageCell(data.productPageImage, 50, LANDSCAPE_W, LANDSCAPE_H, "(no product page image)"),
        imageCell(data.cartImage, 50, LANDSCAPE_W, LANDSCAPE_H, "(no cart image)"),
      ],
    }),
  ]);

  // Table 2 — QR Cash | ชื่อสินค้า
  const table2 = bordered([
    new TableRow({
      tableHeader: true,
      height: { value: 420, rule: HeightRule.ATLEAST },
      children: [headerCell("QR Cash", 50), headerCell("ชื่อสินค้า", 50)],
    }),
    new TableRow({
      children: [
        imageCell(data.qrCashImage, 50, QR_W, QR_H, "(no QR image)"),
        textCell(data.productName, 50, { align: AlignmentType.CENTER }),
      ],
    }),
  ]);

  // Table 3 — Slip | สถานะสั่งซื้อสินค้า
  const table3 = bordered([
    new TableRow({
      tableHeader: true,
      height: { value: 420, rule: HeightRule.ATLEAST },
      children: [
        headerCell("Slip ยืนยันการโอนสั่งซื้อ", 50),
        headerCell("สถานะสั่งซื้อสินค้า", 50),
      ],
    }),
    new TableRow({
      children: [
        imageCell(data.slipImage, 50, SLIP_W, SLIP_H, "(no slip image)"),
        textCell(data.orderStatus, 50, { align: AlignmentType.CENTER }),
      ],
    }),
  ]);

  // Tail paragraph: tiny, zero-spacing so the trailing implicit paragraph that
  // Word adds at the end of the section doesn't push onto a new blank page.
  const tail = new Paragraph({
    spacing: { before: 0, after: 0, line: 200, lineRule: "auto" },
    children: [run("", { size: 2 })],
  });

  return [title, table1, spacer(80), table2, spacer(80), table3, tail];
}
