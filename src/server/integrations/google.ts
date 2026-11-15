import "server-only";
import {
  friendlyGoogleError,
  GBP_ACCOUNTS_URL,
  gbpKeywordsQuery,
  gbpKeywordsUrl,
  gbpLocationsUrl,
  gbpMetricsQuery,
  gbpMetricsUrl,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  GSC_SITES_URL,
  gscQueryUrl,
  parseAccounts,
  parseDailyMetrics,
  parseGscRows,
  parseKeywords,
  parseLocations,
  parseSites,
  type GbpAccount,
  type GbpLocation,
  type GoogleTokenResponse,
  type GscRow,
  type GscSite,
} from "@/domain/googleData";
import type { ISODate } from "@/domain/dates";

/**
 * Google REST calls with plain fetch (no SDK): OAuth token exchange, refresh
 * and revoke; Search Console sites + Search Analytics; Business Profile
 * accounts, locations, daily metrics and monthly search keywords.
 */

export class GoogleError extends Error {
  constructor(message: string, public status: number, public oauthError?: string) {
    super(message);
  }
}

export interface GoogleApp {
  clientId: string;
  clientSecret: string;
}

async function call(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  } catch (e) {
    throw new GoogleError(`Couldn't reach Google (${(e as Error).message}). The next nightly sync tries again.`, 0);
  }
  const text = await res.text();
  if (!res.ok) {
    let oauth: string | undefined;
    try {
      const j = JSON.parse(text) as { error?: unknown };
      if (typeof j.error === "string") oauth = j.error;
    } catch {
      /* not JSON */
    }
    throw new GoogleError(friendlyGoogleError(res.status, text), res.status, oauth);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new GoogleError("Google sent something that wasn't JSON.", res.status);
  }
}

const form = (o: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
const bearer = (token: string, extra: Record<string, string> = {}) => ({ headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...extra } });

// ---- OAuth -----------------------------------------------------------------------------------

export const exchangeCode = (app: GoogleApp, code: string, redirectUri: string) =>
  call(GOOGLE_TOKEN_URL, form({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })) as Promise<GoogleTokenResponse>;

export const refreshAccess = (app: GoogleApp, refreshToken: string) =>
  call(GOOGLE_TOKEN_URL, form({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })) as Promise<GoogleTokenResponse>;

export const revoke = (token: string) => call(GOOGLE_REVOKE_URL, form({ token }));

// ---- Search Console ---------------------------------------------------------------------------

export async function listSites(token: string): Promise<GscSite[]> {
  return parseSites(await call(GSC_SITES_URL, bearer(token)));
}

/** One Search Analytics query, paging with startRow until fewer than rowLimit rows come back (capped). */
export async function searchAnalytics(token: string, siteUrl: string, a: { from: ISODate; to: ISODate; dimension: "query" | "page" | "device" | null; maxRows?: number }): Promise<GscRow[]> {
  const out: GscRow[] = [];
  const rowLimit = 25_000;
  const max = a.maxRows ?? 100_000;
  for (let startRow = 0; startRow < max; startRow += rowLimit) {
    const body = { startDate: a.from, endDate: a.to, dimensions: a.dimension ? ["date", a.dimension] : ["date"], type: "web", rowLimit, startRow, dataState: "final" };
    const j = await call(gscQueryUrl(siteUrl), { method: "POST", ...bearer(token, { "Content-Type": "application/json" }), body: JSON.stringify(body) });
    const rows = parseGscRows(j);
    out.push(...rows);
    if (rows.length < rowLimit) break;
  }
  return out;
}

// ---- Business Profile ----------------------------------------------------------------------

export async function listAccounts(token: string): Promise<GbpAccount[]> {
  const out: GbpAccount[] = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const j = (await call(`${GBP_ACCOUNTS_URL}?pageSize=20${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, bearer(token))) as { nextPageToken?: string };
    out.push(...parseAccounts(j));
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

export async function listLocations(token: string, account: string): Promise<GbpLocation[]> {
  const out: GbpLocation[] = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ readMask: "name,title,storefrontAddress,websiteUri", pageSize: "100" });
    if (pageToken) q.set("pageToken", pageToken);
    const j = (await call(`${gbpLocationsUrl(account)}?${q}`, bearer(token))) as { nextPageToken?: string };
    out.push(...parseLocations(j));
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

export async function dailyMetrics(token: string, location: string, from: ISODate, to: ISODate) {
  return parseDailyMetrics(await call(`${gbpMetricsUrl(location)}?${gbpMetricsQuery(from, to)}`, bearer(token)));
}

export async function monthlyKeywords(token: string, location: string, fromMonth: string, toMonth: string) {
  const out: ReturnType<typeof parseKeywords>["keywords"] = [];
  let next: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = parseKeywords(await call(`${gbpKeywordsUrl(location)}?${gbpKeywordsQuery(fromMonth, toMonth, next)}`, bearer(token)));
    out.push(...r.keywords);
    if (!r.next) break;
    next = r.next;
  }
  return out;
}
