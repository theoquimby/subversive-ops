import { hintFor, secretKey, SECRET_NAMES, type SecretName } from "./secretFormats";
import { decryptJSON, encryptJSON } from "./squareSecurity";

export * from "./secretFormats";

/**
 * Keys and settings for outside services (Square, email, Claude, Google, phone
 * notifications) that a manager can paste into Settings → Connections instead
 * of asking whoever hosts the app to set environment variables.
 *
 * Pure: the store takes its storage, encryption key and environment as
 * arguments, so it's unit-testable without a database.
 *
 * Precedence: a value saved in the app wins; the environment variable of the
 * same name is the fallback (so existing deployments keep working).
 */

// ---- Store ---------------------------------------------------------------------------

export interface SecretBackend {
  /** Every stored row whose key starts with `secret.`, sealed values as stored. */
  readAll(): Promise<Record<string, string>>;
  write(key: string, sealed: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type SecretSource = "app" | "env";

export interface SecretStatus {
  name: SecretName;
  set: boolean;
  source: SecretSource | null;
  /** "…ab12" (or the full value for non-secret settings). Never the secret itself. */
  hint: string | null;
  /** A value is saved in the app but couldn't be read (e.g. the app's master key changed). */
  unreadable?: boolean;
}

interface Sealed {
  v: 1;
  name: SecretName;
  value: string;
  savedAt: string;
}

export function createSecretStore(opts: {
  backend: SecretBackend;
  key: Buffer;
  env: Record<string, string | undefined>;
  /** Cache stored values this long (ms); 0 = always read. */
  ttlMs?: number;
  now?: () => number;
}) {
  const { backend, key, env } = opts;
  const ttl = opts.ttlMs ?? 0;
  const now = opts.now ?? Date.now;
  let cache: { at: number; values: Map<SecretName, string>; unreadable: Set<SecretName> } | null = null;

  async function load() {
    if (cache && ttl > 0 && now() - cache.at < ttl) return cache;
    const rows = await backend.readAll();
    const values = new Map<SecretName, string>();
    const unreadable = new Set<SecretName>();
    for (const n of SECRET_NAMES) {
      const sealed = rows[secretKey(n)];
      if (!sealed) continue;
      try {
        const s = decryptJSON<Sealed>(key, sealed);
        // The name is sealed too, so a row copied onto another key isn't accepted.
        if (s.name === n && typeof s.value === "string" && s.value) values.set(n, s.value);
        else unreadable.add(n);
      } catch {
        unreadable.add(n);
      }
    }
    cache = { at: now(), values, unreadable };
    return cache;
  }

  const fromEnv = (n: SecretName) => env[n]?.trim() || null;

  return {
    /** The value to use: saved in the app, else the environment variable, else null. */
    async get(name: SecretName): Promise<string | null> {
      return (await load()).values.get(name) ?? fromEnv(name);
    },
    async getMany<N extends SecretName>(names: readonly N[]): Promise<Record<N, string | null>> {
      const c = await load();
      return Object.fromEntries(names.map((n) => [n, c.values.get(n) ?? fromEnv(n)])) as Record<N, string | null>;
    },
    async set(name: SecretName, value: string) {
      const v = value.trim();
      if (!v) throw new Error("Nothing to save.");
      const sealed = encryptJSON(key, { v: 1, name, value: v, savedAt: new Date(now()).toISOString() } satisfies Sealed);
      await backend.write(secretKey(name), sealed);
      cache = null;
    },
    async remove(name: SecretName) {
      await backend.remove(secretKey(name));
      cache = null;
    },
    async status(names: readonly SecretName[] = SECRET_NAMES): Promise<SecretStatus[]> {
      const c = await load();
      return names.map((name) => {
        const app = c.values.get(name);
        const e = fromEnv(name);
        const value = app ?? e;
        return {
          name,
          set: !!value,
          source: app ? "app" : e ? "env" : null,
          hint: hintFor(name, value),
          ...(c.unreadable.has(name) ? { unreadable: true } : {}),
        };
      });
    },
    /** Forget the cache (another instance may have saved something). */
    invalidate() {
      cache = null;
    },
  };
}

export type SecretStore = ReturnType<typeof createSecretStore>;
