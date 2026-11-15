/**
 * The TV board's link token: a random nonce plus an HMAC of it (Web Crypto,
 * so edge middleware can check it without the database). Middleware only lets
 * a signed token through; the page then checks the nonce is the one saved in
 * Kegs → Setup, so "New link" retires every old URL.
 */

import { DISPLAY_TOKEN_RE } from "@/domain/taps";

const enc = new TextEncoder();
const PURPOSE = "taps-board:";

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** 16 random bytes, base64url (22 characters). */
export function newDisplayNonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function signDisplayToken(nonce: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(PURPOSE + nonce));
  return `${nonce}.${b64url(sig)}`;
}

/** The nonce when the token is signed with this secret, else null. Constant-time (crypto.subtle.verify). */
export async function verifyDisplayToken(token: string | null | undefined, secret: string): Promise<string | null> {
  if (!token || !secret || !DISPLAY_TOKEN_RE.test(token)) return null;
  const [nonce, sig] = token.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(PURPOSE + nonce));
    return ok ? nonce : null;
  } catch {
    return null;
  }
}

/** "/display/taps/<token>/…" → the token segment. */
export function tokenFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/display\/taps\/([^/]+)(?:\/|$)/);
  return m ? decodeURIComponent(m[1]) : null;
}
