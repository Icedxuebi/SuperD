import path from "path";
import fs from "fs";

export interface SupportSigner {
  id: string;
  name: string;
  signatureFilename: string;
}

export const SUPPORT_SIGNERS: SupportSigner[] = [
  { id: "thanawat", name: "ธนวัฒน์ โพธิลา", signatureFilename: "thanawat.png" },
  { id: "burin", name: "บุรินทร์ รัตนชัย", signatureFilename: "burin.png" },
  { id: "mongkon", name: "มงคล รุ่งจำรัส", signatureFilename: "mongkon.png" },
  { id: "chawanat", name: "ชวณัฐ แก้ววิจิตร", signatureFilename: "chawanat.png" },
];

export const SUPPORT_TITLE = "Application Support";

export const ACKNOWLEDGER_DEFAULT = {
  name: "ศศมน มันทะเล",
  title: "ประธานเจ้าหน้าที่ฝ่ายปฏิบัติการ",
};

export function findSigner(id: string): SupportSigner | undefined {
  return SUPPORT_SIGNERS.find((s) => s.id === id);
}

export function signaturePath(filename: string): string {
  const full = path.join(process.cwd(), "signaturesup", filename);
  if (!fs.existsSync(full)) {
    // Returning an empty string signals "no signature image available";
    // the docx generators can skip the ImageRun gracefully.
    console.warn(
      `[signers] signature image not found: ${full} — proceeding without image`,
    );
    return "";
  }
  return full;
}
