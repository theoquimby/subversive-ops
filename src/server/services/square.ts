import "server-only";
import { decryptJSON, deriveKey, encryptJSON } from "@/domain/squareSecurity";
import { tokenNeedsRefresh } from "@/domain/squareSync";
import { db } from "../db";
import { env, squareOAuthConfigured } from "../env";
import { exchangeCode, fetchLocations, fetchMerchant, refreshAccessToken, revokeToken, SquareLocation } from "../integrations/square-auth";
import { friendlySquareError, SquareClient, SquareEnvironment } from "../integrations/square-http";

/**
 * The Square connection: stored encrypted in Setting `square.connection`
 * (AES-256-GCM, key derived from SESSION_SECRET), with env vars as a
 * fallback. Tokens never leave the server — the UI gets `SquareStatus`.
 */

export type SquareSource = "oauth" | "token" | "env";

export interface SquareConnection {
  accessToken: string;
  environment: SquareEnvironment;
  locationIds: string[];
  merchantId: string | null;
  merchantName: string | null;
  expiresAt: string | null;
  refreshToken: string | null;
  source: SquareSource;
  /** Every location on the account, for the picker (empty for env connections). */
  locations: SquareLocation[];
  connectedAt: string | null;
}

interface Stored extends Omit<SquareConnection, "source"> {
  v: 1;
  source: "oauth" | "token";
  refreshFailedAt?: string | null;
}

const CONNECTION_KEY = "square.connection";
const SYNC_LOG_KEY = "square.syncLog";
const STREAMS_KEY = "square.streams";

const cryptoKey = () => deriveKey(env.SESSION_SECRET, "square.connection");

// ---- Settings helpers ------------------------------------------------------------

export async function readSettingJSON<T>(key: string): Promise<T | null> {
  const s = await db.setting.findUnique({ where: { key } });
  if (!s) return null;
  try {
    return JSON.parse(s.value) as T;
  } catch {
    return null;
  }
}

export async function writeSettingJSON(key: string, value: unknown) {
  const v = JSON.stringify(value);
  await db.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

// ---- Connection -------------------------------------------------------------------

async function readStored(): Promise<Stored | null> {
  const s = await db.setting.findUnique({ where: { key: CONNECTION_KEY } });
  if (!s) return null;
  try {
    return decryptJSON<Stored>(cryptoKey(), s.value);
  } catch {
    // SESSION_SECRET changed or the row was tampered with: treat as disconnected.
    return null;
  }
}

async function writeStored(s: Stored) {
  const value = encryptJSON(cryptoKey(), s);
  await db.setting.upsert({ where: { key: CONNECTION_KEY }, create: { key: CONNECTION_KEY, value }, update: { value } });
}

function envConnection(): SquareConnection | null {
  if (!env.SQUARE_ACCESS_TOKEN) return null;
  return {
    accessToken: env.SQUARE_ACCESS_TOKEN,
    environment: env.SQUARE_ENVIRONMENT,
    locationIds: env.SQUARE_LOCATION_ID.split(",").map((s) => s.trim()).filter(Boolean),
    merchantId: null,
    merchantName: null,
    expiresAt: null,
    refreshToken: null,
    source: "env",
    locations: [],
    connectedAt: null,
  };
}

/** The live connection (refreshing an OAuth token that expires within 7 days), or null. */
export async function getSquareConnection(): Promise<SquareConnection | null> {
  let s = await readStored();
  if (!s) return envConnection();
  const now = new Date();
  const recentlyFailed = s.refreshFailedAt && now.getTime() - Date.parse(s.refreshFailedAt) < 3_600_000;
  if (s.source === "oauth" && s.refreshToken && squareOAuthConfigured() && !recentlyFailed && tokenNeedsRefresh(s.expiresAt, now)) {
    try {
      const t = await refreshAccessToken(s.environment, env.SQUARE_APPLICATION_ID, env.SQUARE_APPLICATION_SECRET, s.refreshToken);
      s = { ...s, accessToken: t.access_token, refreshToken: t.refresh_token ?? s.refreshToken, expiresAt: t.expires_at ?? null, refreshFailedAt: null };
      await writeStored(s);
    } catch (e) {
      s = { ...s, refreshFailedAt: now.toISOString() };
      await writeStored(s);
      await logSquareError("auth", `Couldn't renew the Square access token: ${friendlySquareError(e)}`);
    }
  }
  return {
    accessToken: s.accessToken,
    environment: s.environment,
    locationIds: s.locationIds,
    merchantId: s.merchantId,
    merchantName: s.merchantName,
    expiresAt: s.expiresAt,
    refreshToken: s.refreshToken,
    source: s.source,
    locations: s.locations,
    connectedAt: s.connectedAt,
  };
}

export async function isSquareConnected(): Promise<boolean> {
  const c = await getSquareConnection();
  return !!c && c.locationIds.length > 0;
}

export class SquareNotConnectedError extends Error {
  constructor() {
    super("Square isn't connected. Connect it under Settings → Square.");
  }
}

/** API client for the connected account; throws SquareNotConnectedError when there is none. */
export async function requireSquareClient(): Promise<SquareClient> {
  const c = await getSquareConnection();
  if (!c || !c.locationIds.length) throw new SquareNotConnectedError();
  return { accessToken: c.accessToken, environment: c.environment, locationIds: c.locationIds };
}

/** Everything the UI may know about the connection — no secrets. */
export interface SquareStatus {
  connected: boolean;
  source: SquareSource | null;
  environment: SquareEnvironment;
  merchantName: string | null;
  merchantId: string | null;
  locations: { id: string; name: string; active: boolean; selected: boolean }[];
  selectedCount: number;
  expiresAt: string | null;
  connectedAt: string | null;
  oauthAvailable: boolean;
  envFallback: boolean;
}

export async function squareStatus(): Promise<SquareStatus> {
  const c = await getSquareConnection();
  const locs = c?.locations.length ? c.locations : (c?.locationIds ?? []).map((id) => ({ id, name: id, active: true, timezone: null }));
  return {
    connected: !!c && c.locationIds.length > 0,
    source: c?.source ?? null,
    environment: c?.environment ?? env.SQUARE_ENVIRONMENT,
    merchantName: c?.merchantName ?? null,
    merchantId: c?.merchantId ?? null,
    locations: locs.map((l) => ({ id: l.id, name: l.name, active: l.active, selected: !!c?.locationIds.includes(l.id) })),
    selectedCount: c?.locationIds.length ?? 0,
    expiresAt: c?.expiresAt ?? null,
    connectedAt: c?.connectedAt ?? null,
    oauthAvailable: squareOAuthConfigured(),
    envFallback: !!env.SQUARE_ACCESS_TOKEN,
  };
}

async function saveNew(source: "oauth" | "token", environment: SquareEnvironment, accessToken: string, extra: { refreshToken?: string | null; expiresAt?: string | null }) {
  const c = { accessToken, environment };
  const [merchant, locations] = await Promise.all([fetchMerchant(c), fetchLocations(c)]);
  const active = locations.filter((l) => l.active);
  // Default to every active location (Square Online orders often use their own).
  const locationIds = (active.length ? active : locations).map((l) => l.id);
  await writeStored({
    v: 1,
    source,
    accessToken,
    environment,
    refreshToken: extra.refreshToken ?? null,
    expiresAt: extra.expiresAt ?? null,
    merchantId: merchant.id,
    merchantName: merchant.name,
    locations,
    locationIds,
    connectedAt: new Date().toISOString(),
  });
  return { merchantName: merchant.name, locations: locationIds.length };
}

export async function connectWithOAuthCode(code: string) {
  if (!squareOAuthConfigured()) throw new Error("Square OAuth isn't set up: add SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET.");
  const t = await exchangeCode(env.SQUARE_ENVIRONMENT, env.SQUARE_APPLICATION_ID, env.SQUARE_APPLICATION_SECRET, code);
  return saveNew("oauth", env.SQUARE_ENVIRONMENT, t.access_token, { refreshToken: t.refresh_token, expiresAt: t.expires_at });
}

/** Validates a pasted personal access token against /v2/merchants/me before saving it. */
export async function connectWithToken(token: string, environment: SquareEnvironment) {
  return saveNew("token", environment, token.trim(), {});
}

/** Revokes OAuth tokens (when we hold them) and forgets the stored connection. */
export async function disconnectSquare(): Promise<{ revokeError?: string }> {
  const s = await readStored();
  let revokeError: string | undefined;
  if (s?.source === "oauth" && squareOAuthConfigured()) {
    try {
      await revokeToken(s.environment, env.SQUARE_APPLICATION_ID, env.SQUARE_APPLICATION_SECRET, s.accessToken);
    } catch (e) {
      revokeError = friendlySquareError(e);
    }
  }
  await db.setting.deleteMany({ where: { key: CONNECTION_KEY } });
  return { revokeError };
}

/** Calls Square with the current token; refreshes the stored business name and locations. */
export async function testSquareConnection() {
  const c = await getSquareConnection();
  if (!c) throw new SquareNotConnectedError();
  const [merchant, locations] = await Promise.all([fetchMerchant(c), fetchLocations(c)]);
  const s = await readStored();
  if (s) await writeStored({ ...s, merchantName: merchant.name, merchantId: merchant.id, locations });
  return { merchantName: merchant.name, locations: locations.length };
}

export async function setSquareLocations(ids: string[]) {
  const s = await readStored();
  if (!s) throw new Error(env.SQUARE_ACCESS_TOKEN ? "Locations come from SQUARE_LOCATION_ID while connected through environment variables." : "Connect Square first.");
  const known = new Set(s.locations.map((l) => l.id));
  const picked = ids.filter((id) => known.has(id));
  if (!picked.length) throw new Error("Pick at least one location.");
  await writeStored({ ...s, locationIds: picked });
}

// ---- Sync bookkeeping ----------------------------------------------------------------

export type SquareStream = "catalog" | "sales" | "labor" | "live" | "webhook" | "auth";

export interface StreamRun {
  at: string;
  count: number;
  detail?: string;
}

export interface SyncLogEntry {
  at: string;
  stream: SquareStream;
  message: string;
}

export async function recordSquareSync(stream: "catalog" | "sales" | "labor" | "live", count: number, detail?: string) {
  const cur = (await readSettingJSON<Record<string, StreamRun>>(STREAMS_KEY)) ?? {};
  cur[stream] = { at: new Date().toISOString(), count, ...(detail ? { detail } : {}) };
  await writeSettingJSON(STREAMS_KEY, cur);
}

export async function squareStreams() {
  return (await readSettingJSON<Partial<Record<"catalog" | "sales" | "labor" | "live", StreamRun>>>(STREAMS_KEY)) ?? {};
}

/** Keep the last 20 sync errors with timestamps. */
export async function logSquareError(stream: SquareStream, message: string) {
  const cur = (await readSettingJSON<SyncLogEntry[]>(SYNC_LOG_KEY)) ?? [];
  cur.unshift({ at: new Date().toISOString(), stream, message: message.slice(0, 500) });
  await writeSettingJSON(SYNC_LOG_KEY, cur.slice(0, 20));
}

export async function squareSyncLog() {
  return (await readSettingJSON<SyncLogEntry[]>(SYNC_LOG_KEY)) ?? [];
}

export async function clearSquareSyncLog() {
  await db.setting.deleteMany({ where: { key: SYNC_LOG_KEY } });
}

// ---- Lock --------------------------------------------------------------------------

/**
 * Run `fn` only if no other sync holds the lock. The lock is a Setting row
 * holding a timestamp; it expires after `ttlMs` in case a run died.
 * Returns null when the lock was busy.
 */
export async function withSquareLock<T>(fn: () => Promise<T>, ttlMs = 120_000, name = "square.lock"): Promise<T | null> {
  const now = new Date().toISOString();
  const expired = new Date(Date.now() - ttlMs).toISOString();
  const rows = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "Setting" ("key", "value") VALUES (${name}, ${now})
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value" WHERE "Setting"."value" < ${expired}
    RETURNING "key"`;
  if (rows.length === 0) return null;
  try {
    return await fn();
  } finally {
    await db.setting.deleteMany({ where: { key: name, value: now } });
  }
}
