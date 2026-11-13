import { describe, expect, it } from "vitest";
import { cleanPasted, createSecretStore, hintFor, maskSecret, parseSender, secretKey, validateSecret, type SecretBackend } from "../secrets";
import { deriveKey } from "../squareSecurity";

function memoryBackend() {
  const rows: Record<string, string> = {};
  let reads = 0;
  const backend: SecretBackend = {
    async readAll() {
      reads++;
      return { ...rows };
    },
    async write(k, v) {
      rows[k] = v;
    },
    async remove(k) {
      delete rows[k];
    },
  };
  return { backend, rows, reads: () => reads };
}

const KEY = deriveKey("x".repeat(40), "app.secrets");

describe("secret store", () => {
  it("round-trips a value, encrypted at rest", async () => {
    const m = memoryBackend();
    const s = createSecretStore({ backend: m.backend, key: KEY, env: {} });
    await s.set("RESEND_API_KEY", "re_abcdefghijklmnop1234");
    expect(await s.get("RESEND_API_KEY")).toBe("re_abcdefghijklmnop1234");
    const raw = m.rows[secretKey("RESEND_API_KEY")];
    expect(raw.startsWith("v1.")).toBe(true);
    expect(raw).not.toContain("abcdefghijklmnop");
  });

  it("prefers the app value, falls back to the environment, then null", async () => {
    const m = memoryBackend();
    const s = createSecretStore({ backend: m.backend, key: KEY, env: { ANTHROPIC_API_KEY: " sk-ant-from-env " } });
    expect(await s.get("ANTHROPIC_API_KEY")).toBe("sk-ant-from-env");
    expect(await s.get("GOOGLE_PLACES_API_KEY")).toBeNull();
    await s.set("ANTHROPIC_API_KEY", "sk-ant-from-app");
    expect(await s.get("ANTHROPIC_API_KEY")).toBe("sk-ant-from-app");
    const [st] = await s.status(["ANTHROPIC_API_KEY"]);
    expect(st).toMatchObject({ set: true, source: "app", hint: "…-app" });
    await s.remove("ANTHROPIC_API_KEY");
    expect(await s.get("ANTHROPIC_API_KEY")).toBe("sk-ant-from-env");
    expect((await s.status(["ANTHROPIC_API_KEY"]))[0].source).toBe("env");
  });

  it("ignores values sealed with another key or copied onto another name", async () => {
    const m = memoryBackend();
    const a = createSecretStore({ backend: m.backend, key: KEY, env: { RESEND_API_KEY: "re_env" } });
    await a.set("ANTHROPIC_API_KEY", "sk-ant-secret");
    // Copy the sealed row onto a different name.
    m.rows[secretKey("RESEND_API_KEY")] = m.rows[secretKey("ANTHROPIC_API_KEY")];
    a.invalidate();
    expect(await a.get("RESEND_API_KEY")).toBe("re_env");
    const other = createSecretStore({ backend: m.backend, key: deriveKey("y".repeat(40), "app.secrets"), env: {} });
    expect(await other.get("ANTHROPIC_API_KEY")).toBeNull();
    expect((await other.status(["ANTHROPIC_API_KEY"]))[0]).toMatchObject({ set: false, unreadable: true });
  });

  it("caches reads for the ttl and clears the cache on write", async () => {
    let t = 0;
    const m = memoryBackend();
    const s = createSecretStore({ backend: m.backend, key: KEY, env: {}, ttlMs: 1000, now: () => t });
    await s.get("EMAIL_FROM");
    await s.get("RESEND_API_KEY");
    expect(m.reads()).toBe(1);
    t = 1500;
    await s.get("EMAIL_FROM");
    expect(m.reads()).toBe(2);
    await s.set("EMAIL_FROM", "a@b.com");
    expect(await s.get("EMAIL_FROM")).toBe("a@b.com");
    expect(m.reads()).toBe(3);
  });

  it("never reports the secret itself in status", async () => {
    const s = createSecretStore({ backend: memoryBackend().backend, key: KEY, env: { SQUARE_APPLICATION_SECRET: "sq0csp-verysecretvalue9xQ2" } });
    const json = JSON.stringify(await s.status());
    expect(json).not.toContain("verysecret");
    expect(json).toContain("…xQ2".replace("…", "…9"));
  });
});

describe("masking", () => {
  it("shows only the last four characters", () => {
    expect(maskSecret("re_1234567890abcd")).toBe("…abcd");
    expect(maskSecret("short")).toBe("…••••");
    expect(maskSecret("")).toBeNull();
    expect(maskSecret(null)).toBeNull();
  });
  it("shows non-secret settings in full", () => {
    expect(hintFor("EMAIL_FROM", "Subversive <orders@sub.com>")).toBe("Subversive <orders@sub.com>");
    expect(hintFor("RESEND_API_KEY", "re_1234567890abcd")).toBe("…abcd");
  });
});

describe("validation", () => {
  const ok = (n: Parameters<typeof validateSecret>[0], v: string) => {
    const r = validateSecret(n, v);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    return r.ok ? r.value : "";
  };
  const err = (n: Parameters<typeof validateSecret>[0], v: string) => {
    const r = validateSecret(n, v);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.error;
  };

  it("cleans copy-paste accidents", () => {
    expect(cleanPasted('  "re_abc123"\n')).toBe("re_abc123");
    expect(cleanPasted("Bearer sk-ant-xyz")).toBe("sk-ant-xyz");
    expect(cleanPasted("RESEND_API_KEY=re_abc")).toBe("re_abc");
    expect(cleanPasted("​re_abc")).toBe("re_abc");
  });

  it("checks Square app credentials and spots the wrong box", () => {
    expect(ok("SQUARE_APPLICATION_ID", " sq0idp-AbCdEfGhIjKlMnOp ")).toBe("sq0idp-AbCdEfGhIjKlMnOp");
    ok("SQUARE_APPLICATION_ID", "sandbox-sq0idb-AbCdEfGhIjKlMnOp");
    expect(err("SQUARE_APPLICATION_ID", "sq0csp-AbCdEfGhIjKlMnOpQrSt")).toMatch(/Application secret/);
    expect(err("SQUARE_APPLICATION_ID", "EAAAl0ng-token")).toMatch(/access token/);
    ok("SQUARE_APPLICATION_SECRET", "sq0csp-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ab");
    expect(err("SQUARE_APPLICATION_SECRET", "hello")).toMatch(/sq0csp-/);
    ok("SQUARE_WEBHOOK_SIGNATURE_KEY", "a1B2c3D4e5F6g7H8i9J0kL");
    expect(err("SQUARE_WEBHOOK_SIGNATURE_KEY", "https://example.com/api/webhooks/square")).toMatch(/web address/);
  });

  it("checks email settings", () => {
    ok("RESEND_API_KEY", "re_123456789_abcdefghij");
    expect(err("RESEND_API_KEY", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toMatch(/Claude key/);
    expect(ok("EMAIL_FROM", "Subversive  <orders@subversive.com>")).toBe("Subversive <orders@subversive.com>");
    expect(ok("EMAIL_FROM", "orders@subversive.com")).toBe("orders@subversive.com");
    expect(err("EMAIL_FROM", "max@gmail.com")).toMatch(/Gmail/);
    expect(err("EMAIL_FROM", "not an email")).toMatch(/orders@/);
  });

  it("checks Claude and Google keys", () => {
    ok("ANTHROPIC_API_KEY", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
    expect(err("ANTHROPIC_API_KEY", "sk-ant-admin01-abcdefghijklmnopqrstuvwxyz")).toMatch(/admin/);
    expect(err("ANTHROPIC_API_KEY", "abc def")).toMatch(/spaces/);
    ok("GOOGLE_PLACES_API_KEY", "AIza" + "a".repeat(35));
    expect(err("GOOGLE_PLACES_API_KEY", "AIza123")).toMatch(/39 characters/);
  });

  it("parses senders", () => {
    expect(parseSender("Ops <ops@x.com>")).toEqual({ name: "Ops", address: "ops@x.com" });
    expect(parseSender("ops@x.com")).toEqual({ name: null, address: "ops@x.com" });
    expect(parseSender("Ops <nope>")).toBeNull();
  });
});
