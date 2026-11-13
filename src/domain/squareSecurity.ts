import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secrets at rest and webhook signatures for the Square integration.
 * Pure helpers: every function takes its key explicitly, so they are
 * unit-testable without the environment.
 */

/** 32-byte AES key derived from an app secret with HKDF-SHA256, scoped by `info`. */
export function deriveKey(secret: string, info = "square.connection"): Buffer {
  if (!secret) throw new Error("A secret is required to derive an encryption key.");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("subversive-ops", "utf8"), Buffer.from(info, "utf8"), 32));
}

const b64url = (b: Buffer) => b.toString("base64url");

/** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptJSON(key: Buffer, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", b64url(iv), b64url(cipher.getAuthTag()), b64url(ct)].join(".");
}

/** Inverse of encryptJSON. Throws if the key is wrong or the data was altered. */
export function decryptJSON<T>(key: Buffer, sealed: string): T {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || ct == null) throw new Error("Unrecognized encrypted value.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

/** Square webhook signature: base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)). */
export function squareSignature(signatureKey: string, notificationUrl: string, rawBody: string): string {
  return createHmac("sha256", signatureKey).update(notificationUrl + rawBody, "utf8").digest("base64");
}

/** Constant-time check of the `x-square-hmacsha256-signature` header. */
export function verifySquareSignature(signatureKey: string, notificationUrl: string, rawBody: string, header: string | null | undefined): boolean {
  if (!signatureKey || !header) return false;
  const expected = Buffer.from(squareSignature(signatureKey, notificationUrl, rawBody), "utf8");
  const given = Buffer.from(header.trim(), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
