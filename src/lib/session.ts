// Edge-compatible session cookie helpers. Uses Web Crypto so the same code
// runs in middleware (Edge) and in API routes (Node).
//
// Token format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256 sig)>`

export const SESSION_COOKIE = "secret_d_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

export type SessionPayload = {
  username: string;
  exp: number; // unix seconds
};

const enc = new TextEncoder();
const dec = new TextDecoder();

// TS 5.7's lib types let `TextEncoder.encode` return `Uint8Array<ArrayBufferLike>`,
// which is no longer assignable to Web Crypto's `BufferSource`. Wrap into a
// fresh `ArrayBuffer`-backed view so the types line up.
function utf8(s: string): Uint8Array<ArrayBuffer> {
  const tmp = enc.encode(s);
  const buf = new ArrayBuffer(tmp.byteLength);
  const out = new Uint8Array(buf);
  out.set(tmp);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64urlEncode(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(body)));
  return `${body}.${b64urlEncode(sig)}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = b64urlDecode(sig);
  } catch {
    return null;
  }

  const key = await importKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, utf8(body));
  if (!ok) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(b64urlDecode(body)));
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" || parsed === null ||
    typeof (parsed as SessionPayload).username !== "string" ||
    typeof (parsed as SessionPayload).exp !== "number"
  ) {
    return null;
  }

  const p = parsed as SessionPayload;
  if (p.exp < Math.floor(Date.now() / 1000)) return null;
  return p;
}
