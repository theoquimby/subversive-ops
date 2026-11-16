import "server-only";
import type { ISODate } from "@/domain/dates";
import {
  classifyMetaError,
  friendlyMetaError,
  IG_ACCOUNT_FIELDS,
  IG_MEDIA_FIELDS,
  IG_MEDIA_LIMIT,
  igDayQuery,
  META_GRAPH_URL,
  PAGE_POST_FIELDS,
  PAGE_POST_FIELDS_BASIC,
  PAGE_POST_LIMIT,
  pageInsightsQuery,
  PAGES_FIELDS,
  parseGrantedScopes,
  parseIgAccount,
  parseIgMedia,
  parseIgTotals,
  parseMediaInsights,
  parseMetaError,
  parsePageInsights,
  parsePagePosts,
  parsePages,
  parsePostInsights,
  type ChannelPost,
  type MetaErrorInfo,
  type MetaErrorKind,
  type MetaPage,
  type MetaTokenResponse,
  type PostNumbers,
} from "@/domain/metaData";

/**
 * Every call to Meta's Graph API goes through here: plain fetch (no SDK), the
 * pinned API version, a 30-second timeout, and the access token in a header so
 * it never sits in an address or a log. Nothing runs when this is imported.
 * Reading only: the sign-in, the Pages a person manages, the Instagram
 * account, daily numbers and the business's own posts.
 */

export class MetaError extends Error {
  constructor(message: string, public info: MetaErrorInfo, public kind: MetaErrorKind) {
    super(message);
  }
}

/** What went wrong, for anything thrown (not only a MetaError). */
export const kindOfError = (e: unknown): MetaErrorKind => (e instanceof MetaError ? e.kind : "other");

export interface MetaApp {
  appId: string;
  appSecret: string;
}

const TIMEOUT_MS = 30_000;

function fail(info: MetaErrorInfo): never {
  throw new MetaError(friendlyMetaError(info), info, classifyMetaError(info));
}

async function call(path: string, query: string | Record<string, string>, opts: { token?: string; method?: "GET" | "DELETE" } = {}): Promise<unknown> {
  const qs = typeof query === "string" ? query : new URLSearchParams(query).toString();
  const url = `${META_GRAPH_URL}/${path}${qs ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { Accept: "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const info: MetaErrorInfo = { status: 0, code: null, subcode: null, type: "", message: e instanceof Error ? e.name : "no answer" };
    throw new MetaError("Couldn't reach Facebook. The next nightly sync tries again.", info, "transient");
  }
  const text = await res.text();
  if (!res.ok) fail(parseMetaError(res.status, text));
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new MetaError("Facebook sent something that wasn't readable. The next nightly sync tries again.", { status: res.status, code: null, subcode: null, type: "", message: "" }, "transient");
  }
  // Now and then an error comes back with a 200.
  if (json && typeof json === "object" && "error" in json && (json as { error?: unknown }).error && typeof (json as { error?: unknown }).error === "object") fail(parseMetaError(400, text));
  return json;
}

// ---- Sign-in --------------------------------------------------------------------------------------

/** The code from Facebook's dialog → a short-lived token for the person who signed in. */
export const exchangeCode = (app: MetaApp, code: string, redirectUri: string) =>
  call("oauth/access_token", { client_id: app.appId, client_secret: app.appSecret, redirect_uri: redirectUri, code }) as Promise<MetaTokenResponse>;

/** A short-lived token (or a long-lived one that hasn't run out) → a long-lived one, good for about 60 days. */
export const exchangeLongLived = (app: MetaApp, userToken: string) =>
  call("oauth/access_token", { grant_type: "fb_exchange_token", client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: userToken }) as Promise<MetaTokenResponse>;

export async function grantedScopes(userToken: string): Promise<string[]> {
  return parseGrantedScopes(await call("me/permissions", {}, { token: userToken }));
}

/** Disconnect: Facebook forgets the permission it gave this app. */
export async function revokeApp(userToken: string): Promise<void> {
  await call("me/permissions", {}, { token: userToken, method: "DELETE" });
}

// ---- Pages and the Instagram account ---------------------------------------------------------------

/** The Pages the person manages, each with its own token and the Instagram account linked to it. */
export async function listPages(userToken: string): Promise<MetaPage[]> {
  const out: MetaPage[] = [];
  let after: string | null = null;
  for (let i = 0; i < 5; i++) {
    const q: Record<string, string> = { fields: PAGES_FIELDS, limit: "100" };
    if (after) q.after = after;
    const r = parsePages(await call("me/accounts", q, { token: userToken }));
    out.push(...r.pages);
    if (!r.after) break;
    after = r.after;
  }
  return out.filter((p, i) => out.findIndex((x) => x.id === p.id) === i);
}

export async function igAccount(token: string, igId: string) {
  return parseIgAccount(await call(igId, { fields: IG_ACCOUNT_FIELDS }, { token }));
}

// ---- Daily numbers ---------------------------------------------------------------------------------

/** One business day's totals for the Instagram account. */
export async function igDayTotals(token: string, igId: string, day: ISODate, timeZone: string, metrics: readonly string[], breakdown?: string) {
  return parseIgTotals(await call(`${igId}/insights`, igDayQuery(day, timeZone, metrics, breakdown), { token }));
}

/** The Facebook Page's numbers by day, for up to 90 days. Needs the Page's own token. */
export async function pageDayInsights(pageToken: string, pageId: string, from: ISODate, to: ISODate, metrics: readonly string[]) {
  const r = parsePageInsights(await call(`${pageId}/insights`, pageInsightsQuery(from, to, metrics), { token: pageToken }));
  return { rows: r.rows.filter((x) => x.day >= from && x.day <= to), seen: r.seen };
}

// ---- Posts -------------------------------------------------------------------------------------------

/** The account's latest posts and reels (stories aren't listed here; their numbers only last a day). */
export async function igMedia(token: string, igId: string): Promise<ChannelPost[]> {
  return parseIgMedia(await call(`${igId}/media`, { fields: IG_MEDIA_FIELDS, limit: String(IG_MEDIA_LIMIT) }, { token }));
}

export async function igMediaInsights(token: string, mediaId: string, metrics: readonly string[]): Promise<PostNumbers> {
  return parseMediaInsights(await call(`${mediaId}/insights`, { metric: metrics.join(",") }, { token }));
}

/** The Page's latest posts. `basic` leaves out the reaction and comment counts, for a sign-in not allowed them. */
export async function pagePosts(pageToken: string, pageId: string, basic = false): Promise<ChannelPost[]> {
  return parsePagePosts(await call(`${pageId}/posts`, { fields: basic ? PAGE_POST_FIELDS_BASIC : PAGE_POST_FIELDS, limit: String(PAGE_POST_LIMIT) }, { token: pageToken }));
}

export async function pagePostInsights(pageToken: string, postId: string, metrics: readonly string[]): Promise<PostNumbers> {
  return parsePostInsights(await call(`${postId}/insights`, { metric: metrics.join(",") }, { token: pageToken }));
}
