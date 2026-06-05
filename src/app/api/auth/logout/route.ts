import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const wantsHtml = (req.headers.get("accept") ?? "").includes("text/html");

  const res = wantsHtml
    ? NextResponse.redirect(new URL("/login", url), { status: 303 })
    : NextResponse.json({ ok: true });

  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
