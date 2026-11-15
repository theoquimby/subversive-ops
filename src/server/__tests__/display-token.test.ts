import { describe, expect, it } from "vitest";
import { DISPLAY_TOKEN_RE } from "@/domain/taps";
import { newDisplayNonce, signDisplayToken, tokenFromPath, verifyDisplayToken } from "../display-token";

describe("TV board token", () => {
  it("is long and random", () => {
    const a = newDisplayNonce(), b = newDisplayNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
  });
  it("verifies only with the same secret and an untouched token", async () => {
    const nonce = newDisplayNonce();
    const t = await signDisplayToken(nonce, "secret-one");
    expect(t).toMatch(DISPLAY_TOKEN_RE);
    expect(t.length).toBeGreaterThanOrEqual(60);
    expect(await verifyDisplayToken(t, "secret-one")).toBe(nonce);
    expect(await verifyDisplayToken(t, "secret-two")).toBeNull();
    const tampered = (t[0] === "A" ? "B" : "A") + t.slice(1);
    expect(await verifyDisplayToken(tampered, "secret-one")).toBeNull();
    expect(await verifyDisplayToken("", "secret-one")).toBeNull();
    expect(await verifyDisplayToken("abc.def", "secret-one")).toBeNull();
    expect(await verifyDisplayToken(t, "")).toBeNull();
  });
  it("reads the token from the board's paths", () => {
    expect(tokenFromPath("/display/taps/abc.def")).toBe("abc.def");
    expect(tokenFromPath("/display/taps/abc.def/data")).toBe("abc.def");
    expect(tokenFromPath("/display/other")).toBeNull();
  });
});
