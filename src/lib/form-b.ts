export interface FormBItemInput {
  aScore: number | null; // 1–5 or null
  bFlag: boolean; // red flag (1 point)
}

export interface FormBInput {
  rank: number;
  merchantName: string;
  ae: string;
  mid: string;
  inspectionDateIso: string;
  // ผู้ตรวจ = Preparer (same person for all 5 forms — pulled from page-1 selection)
  // ผู้ติดตาม = Reviewer (same person for all 5 forms — pulled from page-1 selection)
  items: FormBItemInput[]; // length 10

  // Section 3 — action checkboxes, INDEPENDENT per row.
  // Medium (30-39) and High (<30) share the same option labels but are tracked
  // separately so ticking one doesn't tick the other. The B-row's
  // "ปิดบัญชีร้านค้า" is NOT stored here — it auto-ticks when sumB(items) >= 1.

  // Low (40+)
  actLowNormal: boolean;

  // Medium (30-39)
  actMediumNotify: boolean;
  actMediumNotifyDays: string;
  actMediumNotifyHours: string;
  actMediumEDD: boolean;

  // High (<30)
  actHighEDD: boolean;
  actHighNotify: boolean;
  actHighNotifyDays: string;
  actHighNotifyHours: string;
  actHighSuspend: boolean;
  actHighClose: boolean;

  // Section 4 — follow-up
  followDateIso: string;
  followerComment: string;
  followSuspend: boolean;
  followClose: boolean;
  followRestore: boolean;
}

export const MONITORING_ITEMS: {
  label: string;
  generalCheck: string;
  redFlag: string;
}[] = [
  { label: "1. เว็บเข้าใช้งานได้", generalCheck: "เปิดเว็บ", redFlag: "ปิด/404" },
  { label: "2. เปลี่ยนสินค้า/บริการ", generalCheck: "Check เทียบเดือนก่อน", redFlag: "เพิ่มสินค้าเสี่ยง" },
  { label: "3. ช่องทางติดต่อยังใช้งานได้", generalCheck: "โทร/ข้อความ", redFlag: "ติดต่อไม่ได้" },
  { label: "4. เปลี่ยนโดเมนโดยไม่แจ้ง", generalCheck: "ตรวจ WHOIS", redFlag: "โดเมนใหม่ไม่ตรง" },
  { label: "5. Payment Page ถูกต้อง", generalCheck: "ทดสอบ Checkout", redFlag: "QR/บัญชีผิดปกติ" },
  { label: "6. มีร้องเรียนจากลูกค้า", generalCheck: "ตรวจ Ticket", redFlag: "ไม่ได้รับสินค้า" },
  { label: "7. พบเนื้อหาผิดกฎหมาย", generalCheck: "ตรวจเว็บ", redFlag: "การพนัน/ยาเสพติด" },
  { label: "8. Social Media ผิดปกติ", generalCheck: "ตรวจเพจร้านค้า", redFlag: "ปิดเพจ/เนื้อหาหลอกลวง" },
  { label: "9. ธุรกรรมไม่สอดคล้องกับสินค้า", generalCheck: "เทียบ Transaction", redFlag: "ไม่สัมพันธ์" },
  { label: "10. URL Redirect ผิดปกติ", generalCheck: "Redirect Checker", redFlag: "เด้งเว็บต้องสงสัย" },
];

export function emptyFormBInput(
  merchant: { rank: number; merchantName: string; ae: string; mid: string },
  inspectionDateIso: string
): FormBInput {
  return {
    rank: merchant.rank,
    merchantName: merchant.merchantName,
    ae: merchant.ae,
    mid: merchant.mid,
    inspectionDateIso,
    items: Array.from({ length: 10 }, () => ({ aScore: null, bFlag: false })),
    actLowNormal: false,
    actMediumNotify: false,
    actMediumNotifyDays: "",
    actMediumNotifyHours: "",
    actMediumEDD: false,
    actHighEDD: false,
    actHighNotify: false,
    actHighNotifyDays: "",
    actHighNotifyHours: "",
    actHighSuspend: false,
    actHighClose: false,
    followDateIso: inspectionDateIso,
    followerComment: "",
    followSuspend: false,
    followClose: false,
    followRestore: false,
  };
}

export function sumA(items: FormBItemInput[]): number {
  return items.reduce((s, it) => s + (it.aScore ?? 0), 0);
}

export function sumB(items: FormBItemInput[]): number {
  return items.reduce((s, it) => s + (it.bFlag ? 1 : 0), 0);
}
