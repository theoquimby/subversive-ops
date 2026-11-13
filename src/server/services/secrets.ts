import "server-only";
import { createSecretStore, SECRET_NAMES, type SecretName, type SecretStatus } from "@/domain/secrets";
import { deriveKey } from "@/domain/squareSecurity";
import { db } from "../db";
import { env } from "../env";

/**
 * Keys for outside services, pasted in Settings → Connections and stored in
 * the Setting table encrypted (AES-256-GCM, key derived from SESSION_SECRET —
 * the same helper the Square connection uses). Environment variables with the
 * same names still work as a fallback. Values never leave the server: the UI
 * only gets `secretStatus()` ("saved · ends in …ab12").
 */

const store = createSecretStore({
  key: deriveKey(env.SESSION_SECRET, "app.secrets"),
  env: process.env,
  // Short cache so a page that checks several services doesn't hit the database for each.
  ttlMs: 10_000,
  backend: {
    async readAll() {
      const rows = await db.setting.findMany({ where: { key: { startsWith: "secret." } } });
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
    async write(key, value) {
      await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    },
    async remove(key) {
      await db.setting.deleteMany({ where: { key } });
    },
  },
});

export const getSecret = (name: SecretName) => store.get(name);
export const getSecrets = <N extends SecretName>(names: readonly N[]) => store.getMany(names);
export const setSecret = (name: SecretName, value: string) => store.set(name, value);
export const removeSecret = (name: SecretName) => store.remove(name);
export const secretStatus = (names: readonly SecretName[] = SECRET_NAMES): Promise<SecretStatus[]> => store.status(names);
export const refreshSecrets = () => store.invalidate();
