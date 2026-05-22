// Inline image payload shipped from the client to the docx builder.
// dataUrl is what FileReader.readAsDataURL produces, e.g. "data:image/png;base64,iVBORw0KGgo..."
export interface InlineImage {
  dataUrl: string;
  mime: string; // "image/png" | "image/jpeg" | "image/gif" | "image/bmp"
}

export interface LastPageInput {
  productPageImage: InlineImage | null;
  cartImage: InlineImage | null;
  qrCashImage: InlineImage | null;
  slipImage: InlineImage | null;
  productName: string; // e.g. "หูฟังไร้สาย TOZO Agile ... : ฿499.00 บาท"
  orderStatus: string; // e.g. "อยู่ระหว่างจัดส่ง ยังไม่ได้รับ Mail จากร้านค้า"
}

export function emptyLastPageInput(): LastPageInput {
  return {
    productPageImage: null,
    cartImage: null,
    qrCashImage: null,
    slipImage: null,
    productName: "",
    orderStatus: "",
  };
}

// Strip the "data:image/png;base64," prefix so the result is raw base64.
export function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

// "image/png" → "png" — matches the literal expected by docx's ImageRun.type.
export function mimeToDocxType(mime: string): "png" | "jpg" | "gif" | "bmp" {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/bmp") return "bmp";
  return "png";
}
