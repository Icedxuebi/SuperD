// Agency-group classification for the Finance settlement report.
//
// The "Group" dimension (K.CHAT, K.YOK, K.Oil …) does NOT exist anywhere in the
// database — it was a manual sales-agent lookup maintained inside the original
// Power BI report. Per the report owner this mapping is stable ("it won't
// change"), so it lives here as a constant. Each AE/partner (partner_info.
// partner_no) belongs to exactly one agent group. Verified against the report's
// "By Agency Group" rollup on 2026-06-24 (every group's TXN + net total
// reconciled exactly).
//
// To add a new AE: add a `"AExxxxxx": "K.Name"` line. Any partner_no not listed
// falls back to UNMAPPED_GROUP so it stays visible rather than silently dropped.

export const UNMAPPED_GROUP = "(unmapped)";

export const PARTNER_GROUP: Record<string, string> = {
  // K.CHAT
  AE000004: "K.CHAT",
  AE000086: "K.CHAT",
  // K.YOK
  AE000069: "K.YOK",
  AE000090: "K.YOK",
  AE000058: "K.YOK",
  AE000077: "K.YOK",
  AE000072: "K.YOK",
  AE000092: "K.YOK",
  // K.Oil
  AE000042: "K.Oil",
  AE000037: "K.Oil",
  AE000065: "K.Oil",
  AE000039: "K.Oil",
  AE000083: "K.Oil",
  AE000034: "K.Oil",
  AE000073: "K.Oil",
  AE000036: "K.Oil",
  AE000070: "K.Oil",
  AE000051: "K.Oil",
  AE000079: "K.Oil",
  AE000074: "K.Oil",
  AE000031: "K.Oil",
  AE000080: "K.Oil",
  AE000052: "K.Oil",
  AE000067: "K.Oil",
  // single-AE groups
  AE000085: "K.BANK (AE026)",
  AE000076: "K.BANK (AE076)",
  AE000075: "K.TUL",
  AE000006: "K.POP",
  AE000024: "K.MAX",
  AE000056: "K.AUN",
  AEx00001: "Anypay",
};

export function groupForPartner(partnerNo: string | null | undefined): string {
  if (!partnerNo) return UNMAPPED_GROUP;
  return PARTNER_GROUP[partnerNo] ?? UNMAPPED_GROUP;
}

// VAT charged on the platform fee (Thailand) — net paid to merchant is
// gross − fee − VAT. Confirmed against the report (0.96% fee/net ratio).
export const VAT_RATE = 0.07;

// "ต้นทุนเพื่อจ่ายธนาคาร" (cost to pay bank) is a preliminary estimate applied as
// a percentage of gross transaction value — it is NOT stored per transaction
// (the original report notes the figures are "ยังไม่ได้จัดสรรสู่ธนาคาร" / not yet
// allocated to banks). This default reproduces the reference day closely; the
// finance user can override the rate on the page.
export const DEFAULT_BANK_COST_RATE_PCT = 0.2745;
