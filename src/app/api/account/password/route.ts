import { NextResponse } from "next/server";
import { changePassword } from "@/lib/auth";
import { getCurrentUsername } from "@/lib/current-user";

export const runtime = "nodejs";

const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 256;

export async function POST(req: Request) {
  const username = await getCurrentUsername();
  if (!username) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const currentPassword = (body as { currentPassword?: unknown })?.currentPassword;
  const newPassword = (body as { newPassword?: unknown })?.newPassword;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return NextResponse.json(
      { error: "Both currentPassword and newPassword are required" },
      { status: 400 },
    );
  }
  if (newPassword.length < MIN_PASSWORD_LEN || newPassword.length > MAX_PASSWORD_LEN) {
    return NextResponse.json(
      { error: `New password must be ${MIN_PASSWORD_LEN}–${MAX_PASSWORD_LEN} characters` },
      { status: 400 },
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "New password must be different from the current one" },
      { status: 400 },
    );
  }

  const result = await changePassword(username, currentPassword, newPassword);
  if (!result.ok) {
    if (result.reason === "wrong-password") {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
