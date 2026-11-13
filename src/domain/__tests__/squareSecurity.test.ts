import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptJSON, deriveKey, encryptJSON, squareSignature, verifySquareSignature } from "../squareSecurity";

describe("encryption", () => {
  const key = deriveKey("a-session-secret-that-is-long-enough-123");

  it("round-trips JSON", () => {
    const v = { accessToken: "EAAA-secret", locationIds: ["L1", "L2"], n: 3 };
    const sealed = encryptJSON(key, v);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("EAAA-secret");
    expect(decryptJSON(key, sealed)).toEqual(v);
  });

  it("uses a fresh IV each time", () => {
    expect(encryptJSON(key, { a: 1 })).not.toBe(encryptJSON(key, { a: 1 }));
  });

  it("rejects the wrong key", () => {
    const sealed = encryptJSON(key, { a: 1 });
    expect(() => decryptJSON(deriveKey("another-secret-entirely-xxxxxxxxxxxx"), sealed)).toThrow();
  });

  it("rejects tampering", () => {
    const sealed = encryptJSON(key, { a: 1 });
    const parts = sealed.split(".");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 1;
    parts[3] = ct.toString("base64url");
    expect(() => decryptJSON(key, parts.join("."))).toThrow();
    expect(() => decryptJSON(key, "garbage")).toThrow();
  });

  it("derives different keys per purpose", () => {
    expect(deriveKey("s".repeat(32), "a").equals(deriveKey("s".repeat(32), "b"))).toBe(false);
    expect(deriveKey("s".repeat(32)).length).toBe(32);
  });
});

describe("webhook signature", () => {
  const sigKey = "sig-key-123";
  const url = "https://subversive-ops.vercel.app/api/webhooks/square";
  const body = '{"type":"order.updated","event_id":"e1"}';

  it("matches Square's algorithm", () => {
    const expected = createHmac("sha256", sigKey).update(url + body).digest("base64");
    expect(squareSignature(sigKey, url, body)).toBe(expected);
  });

  it("accepts a valid signature and rejects anything else", () => {
    const sig = squareSignature(sigKey, url, body);
    expect(verifySquareSignature(sigKey, url, body, sig)).toBe(true);
    expect(verifySquareSignature(sigKey, url, body + " ", sig)).toBe(false);
    expect(verifySquareSignature(sigKey, url + "/", body, sig)).toBe(false);
    expect(verifySquareSignature("other", url, body, sig)).toBe(false);
    expect(verifySquareSignature(sigKey, url, body, null)).toBe(false);
    expect(verifySquareSignature("", url, body, sig)).toBe(false);
    expect(verifySquareSignature(sigKey, url, body, "short")).toBe(false);
  });
});
