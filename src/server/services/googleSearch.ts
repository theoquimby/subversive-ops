import "server-only";
import { addDays, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import { gbpWindow, googleTokensFrom, grantFromScope, gscWindow, pickSite, type GbpLocation, type GoogleGrant, type GoogleTokens, type GscSite } from "@/domain/googleData";
import { decryptJSON, deriveKey, encryptJSON } from "@/domain/squareSecurity";
import { db } from "../db";
import { env } from "../env";
import { dailyMetrics, exchangeCode, GoogleError, listAccounts, listLocations, listSites, monthlyKeywords, refreshAccess, revoke, searchAnalytics, type GoogleApp } from "../integrations/google";
import { getSecrets } from "./secrets";
import { businessToday } from "./sales";
import { mainWebsiteOrigin } from "./webAnalytics";

/**
 * The Google connection for Search Console and Business Profile: one OAuth
 * sign-in by the owner (read-only Search Console scope, plus business.manage
 * for the listing), tokens encrypted in Setting `google.connection` like
 * Square's and QuickBooks', a nightly sync into GoogleSearchDaily /
 * GoogleProfileDaily / GoogleProfileKeyword, and graceful "not connected" states.
 */

const CONNECTION_KEY = "google.connection";
const STATE_KEY = "google.syncState";
export const GOOGLE_REDIRECT_PATH = "/api/google/oauth/callback";

const cryptoKey = () => deriveKey(env.SESSION_SECRET, "google.connection");

interface Stored extends GoogleTokens {
  v: 1;
  email?: string | null;
  connectedAt: string;
  connectedBy: string | null;
  siteUrl: string | null;
  location: string | null;
  locationTitle: string | null;
  needsReconnect?: string | null;
}

export interface SyncState {
  search: { lastDay: ISODate | null; at: string | null; error: string | null };
  profile: { lastDay: ISODate | null; at: string | null; error: string | null };
  keywords: { lastMonth: string | null; at: string | null; error: string | null };
}

const emptyState = (): SyncState => ({ search: { lastDay: null, at: null, error: null }, profile: { lastDay: null, at: null, error: null }, keywords: { lastMonth: null, at: null, error: null } });

export class GoogleNotConnectedError extends Error {
  constructor(message = "Google isn't connected yet. Connect it on Settings → Connections → Google.") {
    super(message);
  }
}

export async function googleApp(): Promise<GoogleApp | null> {
  const s = await getSecrets(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] as const);
  return s.GOOGLE_OAUTH_CLIENT_ID && s.GOOGLE_OAUTH_CLIENT_SECRET ? { clientId: s.GOOGLE_OAUTH_CLIENT_ID, clientSecret: s.GOOGLE_OAUTH_CLIENT_SECRET } : null;
}

async function readStored(): Promise<Stored | null> {
  const s = await db.setting.findUnique({ where: { key: CONNECTION_KEY } });
  if (!s) return null;
  try {
    const v = decryptJSON<Stored>(cryptoKey(), s.value);
    return v?.v === 1 ? v : null;
  } catch {
    return null;
  }
}

async function writeStored(s: Stored) {
  const value = encryptJSON(cryptoKey(), s);
  await db.setting.upsert({ where: { key: CONNECTION_KEY }, create: { key: CONNECTION_KEY, value }, update: { value } });
}

export async function syncState(): Promise<SyncState> {
  const s = await db.setting.findUnique({ where: { key: STATE_KEY } });
  try {
    return s ? { ...emptyState(), ...(JSON.parse(s.value) as SyncState) } : emptyState();
  } catch {
    return emptyState();
  }
}

async function saveState(st: SyncState) {
  const value = JSON.stringify(st);
  await db.setting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value }, update: { value } });
}

// ---- Status ---------------------------------------------------------------------------------

export interface GoogleStatus {
  appReady: boolean;
  connected: boolean;
  grant: GoogleGrant;
  siteUrl: string | null;
  location: string | null;
  locationTitle: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
  needsReconnect: string | null;
  state: SyncState;
  hasSearchData: boolean;
  hasProfileData: boolean;
}

export async function googleStatus(): Promise<GoogleStatus> {
  const [app, s, state, sCount, pCount] = await Promise.all([googleApp(), readStored(), syncState(), db.googleSearchDaily.count({ take: 1 }), db.googleProfileDaily.count({ take: 1 })]);
  return {
    appReady: !!app,
    connected: !!s && !s.needsReconnect,
    grant: grantFromScope(s?.scope),
    siteUrl: s?.siteUrl ?? null,
    location: s?.location ?? null,
    locationTitle: s?.locationTitle ?? null,
    connectedAt: s?.connectedAt ?? null,
    connectedBy: s?.connectedBy ?? null,
    needsReconnect: s?.needsReconnect ?? null,
    state,
    hasSearchData: sCount > 0,
    hasProfileData: pCount > 0,
  };
}

// ---- Connect -----------------------------------------------------------------------------

/** Finish "Connect Google": swap the code for tokens, then pick the website's property and the listing. */
export async function connectGoogle(args: { code: string; redirectUri: string; by: string }) {
  const app = await googleApp();
  if (!app) throw new GoogleNotConnectedError("Paste the Client ID and Client secret first, then connect.");
  const old = await readStored();
  const t = googleTokensFrom(await exchangeCode(app, args.code, args.redirectUri), new Date(), old?.refreshToken ?? null);
  if (!t.refreshToken) throw new GoogleError("Google didn't send a long-lived sign-in. Remove the app's access at myaccount.google.com/permissions, then press Connect Google again.", 400);
  const stored: Stored = { v: 1, ...t, connectedAt: new Date().toISOString(), connectedBy: args.by, siteUrl: old?.siteUrl ?? null, location: old?.location ?? null, locationTitle: old?.locationTitle ?? null, needsReconnect: null };
  await writeStored(stored);
  const found = await discover().catch((e) => ({ error: (e as Error).message }));
  return found;
}

/** Find the Search Console property for the website and the Business Profile listing. */
export async function discover(): Promise<{ sites: GscSite[]; siteUrl: string | null; locations: GbpLocation[]; location: string | null; notes: string[] }> {
  const s = await readStored();
  if (!s) throw new GoogleNotConnectedError();
  const grant = grantFromScope(s.scope);
  const notes: string[] = [];
  let sites: GscSite[] = [];
  let siteUrl = s.siteUrl;
  if (grant.search) {
    try {
      sites = await withToken((t) => listSites(t));
      siteUrl = siteUrl && sites.some((x) => x.siteUrl === siteUrl) ? siteUrl : pickSite(sites, await mainWebsiteOrigin());
      if (!siteUrl) notes.push(sites.length ? "Pick which Search Console property is the website." : "This Google account has no Search Console property yet. Add the website in Search Console: see How to set this up under Search Console.");
    } catch (e) {
      notes.push((e as Error).message);
    }
  }
  let locations: GbpLocation[] = [];
  let location = s.location;
  let locationTitle = s.locationTitle;
  if (grant.business) {
    try {
      const accounts = await withToken((t) => listAccounts(t));
      for (const a of accounts) locations.push(...(await withToken((t) => listLocations(t, a.name))));
      locations = locations.filter((l, i) => locations.findIndex((x) => x.name === l.name) === i);
      if (!location || !locations.some((l) => l.name === location)) {
        const pick = locations.length === 1 ? locations[0] : null;
        location = pick?.name ?? null;
        locationTitle = pick?.title ?? null;
      }
      if (!location) notes.push(locations.length ? "Pick which Business Profile listing is Subversive." : "No Business Profile listing found for this Google account.");
    } catch (e) {
      notes.push((e as Error).message);
    }
  }
  const cur = await readStored();
  if (cur) await writeStored({ ...cur, siteUrl, location, locationTitle });
  return { sites, siteUrl, locations, location, notes };
}

export async function chooseGoogleTargets(p: { siteUrl?: string | null; location?: string | null; locationTitle?: string | null }) {
  const s = await readStored();
  if (!s) throw new GoogleNotConnectedError();
  await writeStored({ ...s, ...(p.siteUrl !== undefined ? { siteUrl: p.siteUrl } : {}), ...(p.location !== undefined ? { location: p.location, locationTitle: p.locationTitle ?? null } : {}) });
}

let refreshing: Promise<string> | null = null;

/** A live access token, renewed when under 5 minutes from expiry (or forced after a 401). */
async function accessToken(force = false): Promise<string> {
  const s = await readStored();
  if (!s) throw new GoogleNotConnectedError();
  if (s.needsReconnect) throw new GoogleNotConnectedError(s.needsReconnect);
  if (!force && Date.parse(s.accessExpiresAt) - Date.now() > 5 * 60_000) return s.accessToken;
  // One renewal per instance at a time; Google's refresh tokens don't rotate, so a race is harmless.
  refreshing ??= (async () => {
    try {
      const app = await googleApp();
      if (!app) throw new GoogleNotConnectedError("The Google Client ID or secret was removed. Paste them again.");
      if (!s.refreshToken) throw new GoogleNotConnectedError("Press Connect Google again.");
      try {
        const t = googleTokensFrom(await refreshAccess(app, s.refreshToken), new Date(), s.refreshToken);
        await writeStored({ ...s, ...t, scope: t.scope || s.scope });
        return t.accessToken;
      } catch (e) {
        if (e instanceof GoogleError && (e.oauthError === "invalid_grant" || e.oauthError === "invalid_client")) {
          await writeStored({ ...s, needsReconnect: e.message });
          throw new GoogleNotConnectedError(e.message);
        }
        throw e;
      }
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await accessToken());
  } catch (e) {
    if (e instanceof GoogleError && e.status === 401) return fn(await accessToken(true));
    throw e;
  }
}

export async function disconnectGoogle() {
  const s = await readStored();
  if (s?.refreshToken) await revoke(s.refreshToken).catch(() => undefined);
  await db.setting.deleteMany({ where: { key: { in: [CONNECTION_KEY, STATE_KEY] } } });
}

// ---- Sync -----------------------------------------------------------------------------------

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Search Console: totals by day, then by query, page and device, for the sync window. */
async function syncSearch(s: Stored, st: SyncState, today: ISODate) {
  if (!s.siteUrl) return;
  const { from, to } = gscWindow(today, st.search.lastDay);
  if (from > to) return;
  // Query by month-sized chunks so a first sync of 16 months stays within limits.
  for (let a = from; a <= to; a = addDays(a, 31)) {
    const b = addDays(a, 30) < to ? addDays(a, 30) : to;
    const [total, query, page, device] = await Promise.all([
      withToken((t) => searchAnalytics(t, s.siteUrl!, { from: a, to: b, dimension: null })),
      withToken((t) => searchAnalytics(t, s.siteUrl!, { from: a, to: b, dimension: "query", maxRows: 50_000 })),
      withToken((t) => searchAnalytics(t, s.siteUrl!, { from: a, to: b, dimension: "page", maxRows: 25_000 })),
      withToken((t) => searchAnalytics(t, s.siteUrl!, { from: a, to: b, dimension: "device" })),
    ]);
    const rows = [...total.map((r) => ({ ...r, dim: "total" })), ...query.map((r) => ({ ...r, dim: "query" })), ...page.map((r) => ({ ...r, dim: "page" })), ...device.map((r) => ({ ...r, dim: "device" }))];
    await db.$transaction([
      db.googleSearchDaily.deleteMany({ where: { day: { gte: parseISODate(a), lte: parseISODate(b) } } }),
      db.googleSearchDaily.createMany({ data: rows.map((r) => ({ day: parseISODate(r.day), dim: r.dim, key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position })), skipDuplicates: true }),
    ]);
  }
  st.search = { lastDay: to, at: new Date().toISOString(), error: null };
}

async function syncProfile(s: Stored, st: SyncState, today: ISODate) {
  if (!s.location) return;
  const { from, to } = gbpWindow(today, st.profile.lastDay);
  const rows = await withToken((t) => dailyMetrics(t, s.location!, from, to));
  await db.$transaction([
    db.googleProfileDaily.deleteMany({ where: { day: { gte: parseISODate(from), lte: parseISODate(to) } } }),
    db.googleProfileDaily.createMany({ data: rows.map((r) => ({ day: parseISODate(r.day), metric: r.metric, value: r.value })), skipDuplicates: true }),
  ]);
  st.profile = { lastDay: to, at: new Date().toISOString(), error: null };
}

const monthOf = (d: ISODate) => d.slice(0, 7);
const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/** One month at a time (a multi-month range would come back summed). The current month is partial. */
async function syncKeywords(s: Stored, st: SyncState, today: ISODate) {
  if (!s.location) return;
  const months: string[] = [];
  let m = monthOf(today);
  const stop = st.keywords.lastMonth ? prevMonth(prevMonth(st.keywords.lastMonth)) : null;
  for (let i = 0; i < 13 && (!stop || m > stop); i++) {
    months.push(m);
    m = prevMonth(m);
  }
  for (const month of months) {
    const kws = await withToken((t) => monthlyKeywords(t, s.location!, month, month));
    await db.$transaction([
      db.googleProfileKeyword.deleteMany({ where: { month } }),
      db.googleProfileKeyword.createMany({ data: kws.map((k) => ({ month, keyword: k.keyword, value: k.value, threshold: k.threshold })), skipDuplicates: true }),
    ]);
  }
  st.keywords = { lastMonth: monthOf(today), at: new Date().toISOString(), error: null };
}

/** Nightly (and on "Sync now"): each part on its own, so one failing doesn't stop the others. */
export async function syncGoogle(): Promise<{ ok: boolean; skipped?: string; errors: string[] }> {
  const s = await readStored();
  if (!s) return { ok: false, skipped: "not connected", errors: [] };
  if (s.needsReconnect) return { ok: false, skipped: "needs reconnect", errors: [s.needsReconnect] };
  const st = await syncState();
  const today = businessToday();
  const errors: string[] = [];
  const grant = grantFromScope(s.scope);
  if (grant.search && s.siteUrl) {
    try {
      await syncSearch(s, st, today);
    } catch (e) {
      st.search = { ...st.search, at: new Date().toISOString(), error: msg(e) };
      errors.push(`Search Console: ${msg(e)}`);
    }
  }
  if (grant.business && s.location) {
    try {
      await syncProfile(s, st, today);
    } catch (e) {
      st.profile = { ...st.profile, at: new Date().toISOString(), error: msg(e) };
      errors.push(`Business Profile: ${msg(e)}`);
    }
    try {
      await syncKeywords(s, st, today);
    } catch (e) {
      st.keywords = { ...st.keywords, at: new Date().toISOString(), error: msg(e) };
      errors.push(`Search terms: ${msg(e)}`);
    }
  }
  await saveState(st);
  return { ok: errors.length === 0, errors };
}

// ---- Reading ---------------------------------------------------------------------------------

export async function searchRows(from: ISODate, to: ISODate, dims: string[]) {
  const rows = await db.googleSearchDaily.findMany({ where: { day: { gte: parseISODate(from), lte: parseISODate(to) }, dim: { in: dims } } });
  return rows.map((r) => ({ day: toISODate(r.day), dim: r.dim, key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position.toNumber() }));
}

export async function profileRows(from: ISODate, to: ISODate) {
  const rows = await db.googleProfileDaily.findMany({ where: { day: { gte: parseISODate(from), lte: parseISODate(to) } } });
  return rows.map((r) => ({ day: toISODate(r.day), metric: r.metric, value: r.value }));
}

export async function profileKeywords(months: string[]) {
  return db.googleProfileKeyword.findMany({ where: { month: { in: months } } });
}
