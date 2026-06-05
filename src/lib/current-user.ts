import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./session";

// Returns the username of the signed-in user, or null. Safe to call from
// server components and API routes — middleware has already gated access,
// so a null return on a protected route means the cookie was just invalidated
// (e.g. a stale tab after logout).
export async function getCurrentUsername(): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token, secret);
  return session?.username ?? null;
}
