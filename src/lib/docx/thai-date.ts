const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const THAI_MONTH_ABBR = [
  "ม.ค",
  "ก.พ",
  "มี.ค",
  "เม.ย",
  "พ.ค",
  "มิ.ย",
  "ก.ค",
  "ส.ค",
  "ก.ย",
  "ต.ค",
  "พ.ย",
  "ธ.ค",
];

function parts(iso: string): [number, number, number] | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return [y, m, d];
}

/** "20 พฤษภาคม 2569" — long Thai with Buddhist year */
export function toThaiLong(iso: string): string {
  const p = parts(iso);
  if (!p) return iso;
  const [y, m, d] = p;
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`;
}

/** "20 พ.ค 2569" — short Thai with Buddhist year */
export function toThaiShort(iso: string): string {
  const p = parts(iso);
  if (!p) return iso;
  const [y, m, d] = p;
  return `${d} ${THAI_MONTH_ABBR[m - 1]} ${y + 543}`;
}

/** "20/05/2026" — dd/mm/yyyy CE */
export function toIsoSlash(iso: string): string {
  const p = parts(iso);
  if (!p) return iso;
  const [y, m, d] = p;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** Filename "TOP 5 Daily Report DD-MM-YY.docx" using Buddhist year last 2 digits */
export function reportFilename(iso: string): string {
  const p = parts(iso);
  if (!p) return "TOP 5 Daily Report.docx";
  const [y, m, d] = p;
  const bYear2 = String((y + 543) % 100).padStart(2, "0");
  return `TOP 5 Daily Report ${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${bYear2}.docx`;
}
