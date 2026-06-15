// User store + password verification. Node-only — do not import from middleware.
//
// Users live in `auth/users.json` (gitignored). Each entry:
//   { "username": "alice", "passwordHash": "scrypt$<saltHex>$<hashHex>" }
//
// Generate hashes with `node scripts/hash-password.mjs <password>`.

import fs from "node:fs";
import path from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

type User = { username: string; passwordHash: string };

let cache: { mtimeMs: number; users: User[] } | null = null;

function usersFilePath(): string {
  return path.join(process.cwd(), "auth", "users.json");
}

function loadUsers(): User[] {
  const filePath = usersFilePath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return [];
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.users;

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("auth/users.json must be a JSON array");
  }
  const users: User[] = parsed.map((u, i) => {
    if (typeof u !== "object" || u === null) {
      throw new Error(`auth/users.json[${i}] is not an object`);
    }
    const o = u as Record<string, unknown>;
    if (typeof o.username !== "string" || typeof o.passwordHash !== "string") {
      throw new Error(`auth/users.json[${i}] needs string username and passwordHash`);
    }
    return { username: o.username, passwordHash: o.passwordHash };
  });
  cache = { mtimeMs: stat.mtimeMs, users };
  return users;
}

// Dummy hash used to keep timing consistent when the username doesn't exist.
const DUMMY_SALT = Buffer.from("0".repeat(32), "hex");

export async function verifyPassword(username: string, password: string): Promise<boolean> {
  const users = loadUsers();
  const target = username.toLowerCase();
  const user = users.find((u) => u.username.toLowerCase() === target);

  if (!user) {
    // Burn the same scrypt cost so attackers can't enumerate usernames by timing.
    await scryptAsync(password, DUMMY_SALT, 64);
    return false;
  }

  const parts = user.passwordHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    await scryptAsync(password, DUMMY_SALT, 64);
    return false;
  }

  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (salt.length === 0 || expected.length === 0) {
    await scryptAsync(password, DUMMY_SALT, 64);
    return false;
  }

  const actual = await scryptAsync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

const SCRYPT_KEY_LEN = 64;
const SCRYPT_SALT_LEN = 16;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const derived = await scryptAsync(password, salt, SCRYPT_KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "wrong-password" | "user-not-found" };

// Rewrite auth/users.json with the user's new password hash. Writes go through
// a sibling `.tmp` file + atomic rename so a crash mid-write can't truncate the
// store. The mtime-based cache invalidates automatically on the next read.
export async function changePassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  // Re-read from disk (bypass cache) to avoid clobbering a concurrent edit.
  cache = null;
  const users = loadUsers();
  const target = username.toLowerCase();
  const idx = users.findIndex((u) => u.username.toLowerCase() === target);
  if (idx === -1) return { ok: false, reason: "user-not-found" };

  const ok = await verifyPassword(username, currentPassword);
  if (!ok) return { ok: false, reason: "wrong-password" };

  const newHash = await hashPassword(newPassword);
  const updated: User[] = users.map((u, i) =>
    i === idx ? { ...u, passwordHash: newHash } : u,
  );

  const filePath = usersFilePath();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(updated, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.promises.rename(tmpPath, filePath);
  cache = null;
  return { ok: true };
}
