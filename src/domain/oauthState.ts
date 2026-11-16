import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The `state` a sign-in carries to an outside service and back: a random
 * nonce, when it was made, and a signature over both, so a callback can tell
 * the app itself started this sign-in, and recently. (The callback also
 * checks it against a cookie, so it belongs to this browser.) Server-only:
 * uses node:crypto.
 */

const sign = (key: Buffer, body: string) => createHmac("sha256", key).update(body).digest("base64url");

export function signOAuthState(key: Buffer, now = Date.now()): string {
  const body = `${randomBytes(18).toString("base64url")}.${Math.floor(now / 1000).toString(36)}`;
  return `${body}.${sign(key, body)}`;
}

/** True when the state was signed with this key, hasn't been altered, and is at most `maxAgeMs` old. */
export function verifyOAuthState(key: Buffer, state: string, now = Date.now(), maxAgeMs = 15 * 60_000): boolean {
  const parts = String(state ?? "").split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return false;
  const [nonce, at, sig] = parts;
  if (!/^[0-9a-z]+$/.test(at)) return false;
  const expected = Buffer.from(sign(key, `${nonce}.${at}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  const made = parseInt(at, 36) * 1000;
  // A minute of slack for clocks that disagree.
  return Number.isFinite(made) && made <= now + 60_000 && now - made <= maxAgeMs;
}
