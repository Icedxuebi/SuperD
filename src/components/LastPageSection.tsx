"use client";

import { useRef } from "react";
import type { InlineImage, LastPageInput } from "@/lib/last-page";

type ImageSlotKey =
  | "productPageImage"
  | "cartImage"
  | "qrCashImage"
  | "slipImage";

export default function LastPageSection({
  value,
  onChange,
}: {
  value: LastPageInput;
  onChange: (next: LastPageInput) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ImageSlot
          label="สินค้าที่สั่งซื้อ (Product page screenshot)"
          value={value.productPageImage}
          onChange={(img) => onChange({ ...value, productPageImage: img })}
        />
        <ImageSlot
          label="ตะกร้าสินค้า (Cart screenshot)"
          value={value.cartImage}
          onChange={(img) => onChange({ ...value, cartImage: img })}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ImageSlot
          label="QR Cash"
          value={value.qrCashImage}
          onChange={(img) => onChange({ ...value, qrCashImage: img })}
        />
        <Field label="ชื่อสินค้า (Product name + price)">
          <textarea
            value={value.productName}
            onChange={(e) => onChange({ ...value, productName: e.target.value })}
            rows={3}
            placeholder="e.g. หูฟังไร้สาย TOZO Agile Solo True Wireless Nova Purple : ฿499.00 บาท"
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white w-full"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ImageSlot
          label="Slip ยืนยันการโอนสั่งซื้อ"
          value={value.slipImage}
          onChange={(img) => onChange({ ...value, slipImage: img })}
        />
        <Field label="สถานะสั่งซื้อสินค้า (Order status)">
          <textarea
            value={value.orderStatus}
            onChange={(e) => onChange({ ...value, orderStatus: e.target.value })}
            rows={3}
            placeholder="e.g. อยู่ระหว่างจัดส่ง ยังไม่ได้รับ Mail จากร้านค้า"
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white w-full"
          />
        </Field>
      </div>
    </div>
  );
}

function ImageSlot({
  label,
  value,
  onChange,
}: {
  label: string;
  value: InlineImage | null;
  onChange: (img: InlineImage | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please pick an image file (PNG, JPG, GIF, or BMP).");
      return;
    }
    try {
      const compressed = await compressImage(file);
      onChange(compressed);
    } catch (e) {
      console.error(e);
      alert("Couldn't process that image — try a different file.");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="border border-slate-300 border-dashed rounded-md p-3 bg-white flex flex-col items-center justify-center min-h-[180px] gap-2">
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value.dataUrl}
              alt={label}
              className="max-h-40 max-w-full object-contain rounded"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-sm text-slate-600 hover:text-brand-600"
          >
            + Click to upload image
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/bmp"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="hidden"
        />
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

// Vercel serverless functions cap request bodies at ~4.5 MB. Four raw
// screenshots base64-encoded into JSON blow past that limit instantly, so we
// downscale to ≤ MAX_DIM px on the long edge and re-encode as JPEG before
// sending. A 2 MB PNG screenshot typically drops to ~150–300 KB.
const MAX_DIM = 1400;
const JPEG_QUALITY = 0.85;

async function compressImage(file: File): Promise<{ dataUrl: string; mime: string }> {
  const img = await loadImage(file);
  let { naturalWidth: width, naturalHeight: height } = img;
  if (width > MAX_DIM || height > MAX_DIM) {
    const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  // White background so JPEGs from transparent PNGs (e.g. QR codes) don't go black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { dataUrl, mime: "image/jpeg" };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}
