import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const username = (body as { username?: unknown })?.username;
  const password = (body as { password?: unknown })?.password;
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server is not configured" }, { status: 500 });
  }

  const ok = await verifyPassword(username, password);
  if (!ok) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await signSession({ username, exp }, secret);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
