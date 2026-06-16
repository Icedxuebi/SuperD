import "./globals.css";
import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Super D — Anypay Internal Tools",
  description: "Internal tools for Application Support, Operation, Risk Management and CFR.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas">
        <Shell header={<Header />}>{children}</Shell>
      </body>
    </html>
  );
}
