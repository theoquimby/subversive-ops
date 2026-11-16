import { describe, expect, it } from "vitest";
import { deriveKey } from "../squareSecurity";
import { signOAuthState, verifyOAuthState } from "../oauthState";
import { hintFor, isPublicSetting, isSecretName, validateSecret } from "../secretFormats";

// Built from parts so secret scanners don't mistake test values for real credentials.
const FAKE_APP_ID = "1234" + "5678".repeat(3);
const FAKE_APP_SECRET = ["0a1b", "2c3d", "4e5f", "6a7b"].join("").repeat(2);

describe("the Meta app's keys", () => {
  it("are names the secret store knows, with the App ID shown in full and the secret masked", () => {
    expect(isSecretName("META_APP_ID")).toBe(true);
    expect(isSecretName("META_APP_SECRET")).toBe(true);
    expect(isPublicSetting("META_APP_ID")).toBe(true);
    expect(isPublicSetting("META_APP_SECRET")).toBe(false);
    expect(hintFor("META_APP_ID", FAKE_APP_ID)).toBe(FAKE_APP_ID);
    expect(hintFor("META_APP_SECRET", FAKE_APP_SECRET)).toBe(`…${FAKE_APP_SECRET.slice(-4)}`);
  });
  it("accepts an App ID (digits) and an App secret (32 letters a–f and digits), tidying the paste", () => {
    expect(validateSecret("META_APP_ID", ` ${FAKE_APP_ID}\n`)).toEqual({ ok: true, value: FAKE_APP_ID });
    expect(validateSecret("META_APP_SECRET", `"${FAKE_APP_SECRET}"`)).toEqual({ ok: true, value: FAKE_APP_SECRET });
    expect(validateSecret("META_APP_SECRET", FAKE_APP_SECRET.toUpperCase())).toEqual({ ok: true, value: FAKE_APP_SECRET });
  });
  it("says so when the two are swapped", () => {
    const a = validateSecret("META_APP_ID", FAKE_APP_SECRET);
    expect(a.ok).toBe(false);
    expect(!a.ok && a.error).toMatch(/That's the App secret, not the App ID/);
    const b = validateSecret("META_APP_SECRET", FAKE_APP_ID);
    expect(!b.ok && b.error).toMatch(/That's the App ID, not the App secret/);
  });
  it("says when one was cut short", () => {
    const a = validateSecret("META_APP_ID", FAKE_APP_ID.slice(0, 9));
    expect(!a.ok && a.error).toMatch(/cut short/);
    const b = validateSecret("META_APP_SECRET", FAKE_APP_SECRET.slice(0, 20));
    expect(!b.ok && b.error).toMatch(/cut short/);
  });
  it("recognises something else pasted in, and says where each one is found", () => {
    const token = validateSecret("META_APP_SECRET", "EAAG" + "x".repeat(180));
    expect(!token.ok && token.error).toMatch(/access token, not the App secret/);
    const google = validateSecret("META_APP_ID", "AIza" + "x".repeat(35));
    expect(!google.ok && google.error).toMatch(/That's a Google key, not the App ID/);
    const junk = validateSecret("META_APP_ID", "hello");
    expect(!junk.ok && junk.error).toMatch(/App settings → Basic/);
    const junk2 = validateSecret("META_APP_SECRET", "hello-there");
    expect(!junk2.ok && junk2.error).toMatch(/Show/);
  });
  it("names a Meta App secret pasted into another service's box", () => {
    const r = validateSecret("GOOGLE_OAUTH_CLIENT_SECRET", FAKE_APP_SECRET);
    expect(!r.ok && r.error).toMatch(/That's a Meta App secret, not the Client secret/);
  });
});

describe("the signed state for a sign-in", () => {
  const key = deriveKey("a-session-secret-that-is-long-enough-000", "meta.oauth.state");
  const now = Date.parse("2026-11-16T12:00:00Z");
  it("round-trips, and is different every time", () => {
    const a = signOAuthState(key, now);
    const b = signOAuthState(key, now);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[\w-]+\.[0-9a-z]+\.[\w-]+$/);
    expect(verifyOAuthState(key, a, now + 60_000)).toBe(true);
  });
  it("is refused when altered, signed with another key, too old, or from the future", () => {
    const s = signOAuthState(key, now);
    const [nonce, at, sig] = s.split(".");
    expect(verifyOAuthState(key, `${nonce}x.${at}.${sig}`, now)).toBe(false);
    expect(verifyOAuthState(key, `${nonce}.${at}.${sig.slice(0, -2)}${sig.endsWith("aa") ? "bb" : "aa"}`, now)).toBe(false);
    expect(verifyOAuthState(deriveKey("another-session-secret-that-is-long-0000", "meta.oauth.state"), s, now)).toBe(false);
    expect(verifyOAuthState(key, s, now + 16 * 60_000)).toBe(false);
    expect(verifyOAuthState(key, s, now - 5 * 60_000)).toBe(false);
  });
  it("is refused when it isn't a state at all", () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "..", "a.zz!.c"]) expect(verifyOAuthState(key, bad, now)).toBe(false);
  });
});
