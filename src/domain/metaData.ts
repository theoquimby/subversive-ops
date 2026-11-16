import { addDays, todayIn, zonedMidnightUTC, type ISODate } from "./dates";

/**
 * Instagram and the Facebook Page, read through Meta's Graph API: the sign-in
 * URL, which token to use and when to renew it, the requests for daily numbers
 * and posts, parsing what comes back, and Meta's errors in plain English.
 * Pure (no network), so every shape is unit-tested.
 *
 * Checked against Meta's developer docs on 2026-11-15 (see docs/online-channels.md):
 *
 * - "Instagram API with Facebook Login" (graph.facebook.com), because one
 *   sign-in then reads both the Instagram professional account and the
 *   Facebook Page it is linked to — developers.facebook.com/docs/instagram-platform/overview
 * - Account insights: reach, views, accounts_engaged, total_interactions,
 *   likes, comments, saves, shares, profile_links_taps, follows_and_unfollows.
 *   impressions, profile_views, website_clicks and the other contact-click
 *   metrics were removed in 2025 and are never asked for —
 *   developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights
 * - Media insights — developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/
 * - Page insights (page_media_view and page_follows replaced page_impressions
 *   and page_fans) — developers.facebook.com/docs/graph-api/reference/page/insights/
 */

export const META_API_VERSION = "v27.0";
export const META_GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}`;
export const META_DIALOG_URL = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth`;
export const META_TOKEN_URL = `${META_GRAPH_URL}/oauth/access_token`;

// ---- Sign-in ------------------------------------------------------------------------------------

/** Read-only: nothing here can post, reply, message or run ads. */
export const META_SCOPES = ["pages_show_list", "pages_read_engagement", "read_insights", "instagram_basic", "instagram_manage_insights"] as const;
export type MetaScope = (typeof META_SCOPES)[number];

/** What each permission lets the app read, in the words the guide uses. */
export const SCOPE_LABEL: Record<MetaScope, string> = {
  pages_show_list: "the list of your Pages",
  pages_read_engagement: "the Page's posts and followers",
  read_insights: "the Facebook Page's numbers",
  instagram_basic: "the Instagram account and its posts",
  instagram_manage_insights: "the Instagram account's numbers",
};

/**
 * Facebook's sign-in dialog. `rerequest` makes Facebook ask again for boxes
 * that were unticked last time (it otherwise remembers the refusal).
 */
export function metaAuthorizeUrl(a: { appId: string; redirectUri: string; state: string; rerequest?: boolean }): string {
  const q = new URLSearchParams({ client_id: a.appId, redirect_uri: a.redirectUri, state: a.state, response_type: "code", scope: META_SCOPES.join(",") });
  if (a.rerequest) q.set("auth_type", "rerequest");
  return `${META_DIALOG_URL}?${q}`;
}

export interface MetaTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export interface MetaUserToken {
  token: string;
  /** Null when Meta gives no end date. */
  expiresAt: string | null;
}

export function metaTokenFrom(r: MetaTokenResponse | null | undefined, now: Date): MetaUserToken {
  if (!r?.access_token) throw new Error("Facebook didn't send back a sign-in. Press Connect again.");
  const secs = Number.isFinite(r.expires_in) && r.expires_in! > 0 ? r.expires_in! : null;
  return { token: r.access_token, expiresAt: secs ? new Date(now.getTime() + secs * 1000).toISOString() : null };
}

/** GET /me/permissions → the permissions that were granted. */
export function parseGrantedScopes(j: unknown): string[] {
  const list = (j as { data?: { permission?: string; status?: string }[] })?.data ?? [];
  return list.filter((p) => typeof p?.permission === "string" && p.status === "granted").map((p) => p.permission!);
}

export const missingScopes = (granted: readonly string[]): MetaScope[] => META_SCOPES.filter((s) => !granted.includes(s));

export function missingScopesMessage(missing: readonly string[]): string | null {
  const names = missing.map((s) => SCOPE_LABEL[s as MetaScope] ?? s);
  if (!names.length) return null;
  return `Not allowed at sign-in: ${names.join(", ")}. Press Connect again and leave every box ticked (Facebook may show "Edit access" first).`;
}

/** The sign-in came back without a code: the person pressed Cancel, or Facebook refused. */
export function friendlyMetaDenial(a: { error: string | null; reason: string | null; description: string | null }): string {
  if (a.error === "access_denied" || a.reason === "user_denied") return "Nothing was connected because the Facebook sign-in was cancelled. Press Connect to try again.";
  return `Facebook said: ${(a.description || a.error || "the sign-in didn't finish").slice(0, 160)}. Press Connect to try again.`;
}

// ---- Which token, and when to renew it ----------------------------------------------------------

/** Renew the owner's sign-in once it is this close to running out (it lasts about 60 days). */
export const USER_TOKEN_RENEW_DAYS = 15;

export interface TokenPlan {
  /** The token the sync should use; null when there is none that works. */
  use: "page" | "user" | null;
  /** Swap the owner's sign-in for a fresh one before it runs out. */
  refreshUser: boolean;
  /** Set when nothing works any more: what to tell the owner. */
  reconnect: string | null;
  /** The day the owner's sign-in runs out (null when it has no end date). */
  userExpiresOn: ISODate | null;
}

/**
 * A Page's own token, made from a long-lived sign-in, has no end date, so the
 * nightly sync uses it and keeps working after the owner's 60-day sign-in runs
 * out. The owner's sign-in is only needed to look for Pages again; it is
 * renewed while it still can be.
 */
export function tokenPlan(c: { pageToken: string | null; userToken: string | null; userExpiresAt: string | null }, now: Date, renewDays = USER_TOKEN_RENEW_DAYS): TokenPlan {
  const expires = c.userExpiresAt ? Date.parse(c.userExpiresAt) : null;
  const userAlive = !!c.userToken && (expires == null || !Number.isFinite(expires) || expires > now.getTime());
  const userExpiresOn = c.userExpiresAt && Number.isFinite(expires) ? c.userExpiresAt.slice(0, 10) : null;
  const refreshUser = userAlive && expires != null && Number.isFinite(expires) && expires - now.getTime() < renewDays * 86_400_000;
  if (c.pageToken) return { use: "page", refreshUser, reconnect: null, userExpiresOn };
  if (userAlive) return { use: "user", refreshUser, reconnect: null, userExpiresOn };
  return { use: null, refreshUser: false, reconnect: c.userToken ? "The Facebook sign-in ran out (it lasts about 60 days). Press Connect again and the numbers pick up where they left off." : "Press Connect to sign in with Facebook.", userExpiresOn };
}

// ---- Errors -------------------------------------------------------------------------------------

export interface MetaErrorInfo {
  /** HTTP status; 0 when the request never got an answer. */
  status: number;
  code: number | null;
  subcode: number | null;
  type: string;
  message: string;
}

export function parseMetaError(status: number, body: string): MetaErrorInfo {
  const out: MetaErrorInfo = { status, code: null, subcode: null, type: "", message: "" };
  try {
    const j = JSON.parse(body) as { error?: string | { message?: string; type?: string; code?: number; error_subcode?: number }; error_description?: string; error_message?: string };
    if (typeof j.error === "string") out.message = j.error_description ?? j.error_message ?? j.error;
    else if (j.error) {
      out.message = String(j.error.message ?? "");
      out.type = String(j.error.type ?? "");
      out.code = Number.isFinite(j.error.code) ? Number(j.error.code) : null;
      out.subcode = Number.isFinite(j.error.error_subcode) ? Number(j.error.error_subcode) : null;
    }
  } catch {
    /* not JSON */
  }
  return out;
}

export type MetaErrorKind =
  | "auth" // the sign-in expired or was removed
  | "role" // the person who connected lost their place on the Page
  | "permission" // a box wasn't ticked at sign-in
  | "not-tester" // the Meta app is in development mode and this person isn't on it
  | "not-professional" // the Instagram account is a personal one
  | "invalid-metric" // Meta no longer has that number
  | "range" // older than Meta keeps
  | "no-insights" // a post with no numbers (yet)
  | "gone" // a post that was deleted
  | "rate" // asked to slow down
  | "app" // wrong App ID or secret
  | "redirect" // the redirect address isn't on the Meta app
  | "code" // the sign-in code expired or was used twice
  | "transient" // an outage, or no answer
  | "other";

const AUTH_SUBCODES = new Set([458, 459, 460, 463, 464, 467]);
const RATE_CODES = new Set([4, 17, 32, 341, 368, 613, 80001, 80002]);

export function classifyMetaError(e: MetaErrorInfo): MetaErrorKind {
  const m = e.message;
  if (e.subcode === 492) return "role";
  if (e.subcode === 2108006 || /not enough viewers|before business account conversion|insights (data )?(is|are) not available|does not support insights/i.test(m)) return "no-insights";
  if (e.code === 190 || e.code === 102 || e.status === 401 || (e.subcode != null && AUTH_SUBCODES.has(e.subcode))) return "auth";
  if ((e.code != null && RATE_CODES.has(e.code)) || e.status === 429) return "rate";
  if (e.code === 191 || /redirect_uri|redirect URI|can't load URL|URL blocked/i.test(m)) return "redirect";
  if (e.code === 101 || /client secret|validating application|invalid (client|app(lication)?) ?id|application has been deleted/i.test(m)) return "app";
  if (e.subcode === 36007 || e.subcode === 36009 || /authorization code|code has (expired|been used)|verification code/i.test(m)) return "code";
  if (/development mode|role on (the|this) app|app (is )?not (active|live|accessible)|app isn't available/i.test(m)) return "not-tester";
  if (/instagram business account|creator account|professional account|not an? (instagram )?business/i.test(m)) return "not-professional";
  if (e.subcode === 33 || /does not exist|cannot be loaded due to missing permissions/i.test(m)) return "gone";
  if (e.code === 100 && /\bsince\b|\buntil\b|time range|days .*between|last \d+ (days|years)|only available for the last/i.test(m)) return "range";
  if (e.code === 100 && /metric|breakdown|must be one of|not (a )?valid/i.test(m)) return "invalid-metric";
  if (e.code === 10 || e.code === 3 || (e.code != null && e.code >= 200 && e.code <= 299) || e.status === 403) return "permission";
  if (e.code === 1 || e.code === 2 || e.status >= 500 || e.status === 0) return "transient";
  return "other";
}

/** Kinds that end a sync run: carrying on would fail the same way, or make a throttle worse. */
export const isFatalKind = (k: MetaErrorKind): boolean => k === "auth" || k === "role" || k === "rate" || k === "app" || k === "not-tester";

/** Kinds that mean the sign-in itself has to be done again. */
export const needsReconnectKind = (k: MetaErrorKind): boolean => k === "auth" || k === "role";

const FRIENDLY: Record<Exclude<MetaErrorKind, "other">, string> = {
  auth: "Facebook says the sign-in has expired or was removed (changing the Facebook password does this too). Press Connect again and the numbers pick up where they left off.",
  role: "The person who connected no longer has access to the Facebook Page. Someone with full control of the Page should press Connect again.",
  permission: "Facebook didn't allow that, because a permission wasn't ticked at sign-in. Press Connect again and leave every box ticked.",
  "not-tester": "The Meta app is in development mode, so only people added to it can connect. In the Meta app, open App roles → Roles, add this person as an Administrator or Tester, have them accept the invitation, then press Connect again.",
  "not-professional": "This Instagram account is a personal one, and Instagram only shares numbers for professional accounts. In the Instagram app: Settings → Account type and tools → Switch to professional account (it's free). Then press Find again.",
  "invalid-metric": "Instagram no longer gives one of the numbers the app asked for. Everything else was brought in.",
  range: "That is further back than Facebook keeps numbers.",
  "no-insights": "No numbers for that post yet.",
  gone: "That post isn't there any more.",
  rate: "Facebook asked us to slow down. The next nightly sync tries again.",
  app: "Meta didn't accept the App ID or App secret. Copy them again from App settings → Basic.",
  redirect: "The redirect address isn't on the Meta app yet. Copy it from the guide into Valid OAuth Redirect URIs, save, and try again.",
  code: "That sign-in took too long or was already used. Press Connect again.",
  transient: "Facebook's service had a problem. The next nightly sync tries again.",
};

export function friendlyMetaError(e: MetaErrorInfo): string {
  const kind = classifyMetaError(e);
  if (kind !== "other") return FRIENDLY[kind];
  return e.message ? `Facebook said: ${e.message.slice(0, 200)}` : `Facebook answered ${e.status}.`;
}

/** No Instagram account on the Page: said by the app, not by Meta. */
export const NOT_LINKED_MESSAGE = "No Instagram account is linked to this Facebook Page. On Facebook, open the Page → Settings → Linked accounts → Instagram and connect it (the Instagram account has to be a professional one). Then press Find again.";
export const NO_PAGES_MESSAGE = "Facebook didn't list any Pages for this sign-in. Press Connect again and, when Facebook asks which Pages to share, tick the business's Page. The person signing in needs full control of the Page.";

// ---- Pages and the Instagram account -------------------------------------------------------------

export const PAGES_FIELDS = "id,name,tasks,access_token,instagram_business_account{id,username}";

export interface MetaPage {
  id: string;
  name: string;
  /** The Page's own access token. Never leaves the server. */
  token: string;
  /** The person who connected may read the Page's numbers. */
  canAnalyze: boolean;
  instagram: { id: string; username: string | null } | null;
}

export function parsePages(j: unknown): { pages: MetaPage[]; after: string | null } {
  type Raw = { id?: string; name?: string; access_token?: string; tasks?: string[]; instagram_business_account?: { id?: string; username?: string } };
  const r = j as { data?: Raw[]; paging?: { cursors?: { after?: string }; next?: string } } | null;
  const pages = (r?.data ?? [])
    .filter((p) => typeof p?.id === "string" && typeof p.access_token === "string")
    .map((p) => ({
      id: p.id!,
      name: p.name ?? p.id!,
      token: p.access_token!,
      canAnalyze: Array.isArray(p.tasks) ? p.tasks.includes("ANALYZE") : true,
      instagram: typeof p.instagram_business_account?.id === "string" ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null } : null,
    }));
  return { pages, after: r?.paging?.next ? r.paging.cursors?.after ?? null : null };
}

/** The Page picked before if it is still there; else the only Page; else the only Page with Instagram. */
export function pickPage(pages: MetaPage[], previousId: string | null): MetaPage | null {
  const before = previousId ? pages.find((p) => p.id === previousId) : null;
  if (before) return before;
  if (pages.length === 1) return pages[0];
  const withIg = pages.filter((p) => p.instagram);
  return withIg.length === 1 ? withIg[0] : null;
}

export const IG_ACCOUNT_FIELDS = "id,username,followers_count,media_count";

export function parseIgAccount(j: unknown): { id: string; username: string | null; followers: number | null; mediaCount: number | null } | null {
  const r = j as { id?: string; username?: string; followers_count?: number; media_count?: number } | null;
  if (typeof r?.id !== "string") return null;
  return { id: r.id, username: r.username ?? null, followers: num(r.followers_count), mediaCount: num(r.media_count) };
}

// ---- Instagram: one day's numbers ------------------------------------------------------------------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Asked for together, as totals for one day. */
export const IG_DAY_METRICS = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "saves", "shares"] as const;
/** Asked for on their own, because each has its own breakdown. */
export const IG_TAPS_METRIC = "profile_links_taps";
export const IG_TAPS_BREAKDOWN = "contact_button_type";
export const IG_FOLLOWS_METRIC = "follows_and_unfollows";
export const IG_FOLLOWS_BREAKDOWN = "follow_type";

/** Meta's name → the short name stored in OnlineChannelDaily.metric. */
const IG_NAME: Record<string, string> = {
  reach: "reach",
  views: "views",
  accounts_engaged: "engaged",
  total_interactions: "interactions",
  likes: "likes",
  comments: "comments",
  saves: "saves",
  shares: "shares",
};

const TAP_NAME: Record<string, string> = { CALL: "tap_call", DIRECTION: "tap_directions", EMAIL: "tap_email", TEXT: "tap_text", BOOK_NOW: "tap_book" };
export const IG_TAP_KEYS = ["tap_call", "tap_directions", "tap_email", "tap_text", "tap_book", "tap_other"] as const;

/** The stored names one request can produce, so a re-read replaces exactly those. */
export const igStoredNames = (metrics: readonly string[]): string[] =>
  metrics.flatMap((m) => (m === IG_TAPS_METRIC ? ["profile_taps", ...IG_TAP_KEYS] : m === IG_FOLLOWS_METRIC ? ["follows", "unfollows"] : IG_NAME[m] ? [IG_NAME[m]] : []));

/** `metric_type=total_value` over one business day: local midnight to a second before the next. */
export function igDayQuery(day: ISODate, timeZone: string, metrics: readonly string[], breakdown?: string): string {
  const since = Math.floor(zonedMidnightUTC(day, timeZone).getTime() / 1000);
  const until = Math.floor(zonedMidnightUTC(addDays(day, 1), timeZone).getTime() / 1000) - 1;
  const q = new URLSearchParams({ metric: metrics.join(","), period: "day", metric_type: "total_value", since: String(since), until: String(until) });
  if (breakdown) q.set("breakdown", breakdown);
  return q.toString();
}

export interface MetricValue {
  metric: string;
  value: number;
}

/**
 * data[].total_value → rows under the stored names. Instagram leaves a metric
 * out (rather than sending 0) when it has nothing, and may stop sending one
 * altogether: `seen` lists what did come back so the caller can tell.
 */
export function parseIgTotals(j: unknown): { rows: MetricValue[]; seen: string[] } {
  type Result = { dimension_values?: string[]; value?: unknown };
  type Item = { name?: string; total_value?: { value?: unknown; breakdowns?: { results?: Result[] }[] }; values?: { value?: unknown }[] } | null;
  const rows: MetricValue[] = [];
  const seen: string[] = [];
  for (const d of (j as { data?: Item[] } | null)?.data ?? []) {
    if (typeof d?.name !== "string") continue;
    if (!seen.includes(d.name)) seen.push(d.name);
    // The older shape: one value per day.
    const series = Array.isArray(d.values) ? d.values.map((v) => num(v?.value)).filter((v): v is number => v != null) : [];
    const total = num(d.total_value?.value) ?? (series.length ? series.reduce((s, v) => s + v, 0) : null);
    const results = d.total_value?.breakdowns?.flatMap((b) => b.results ?? []) ?? [];
    if (d.name === IG_TAPS_METRIC) {
      if (total != null) rows.push({ metric: "profile_taps", value: total });
      const by = new Map<string, number>();
      for (const r of results) {
        const v = num(r.value);
        if (v == null) continue;
        const key = TAP_NAME[r.dimension_values?.[0] ?? ""] ?? "tap_other";
        by.set(key, (by.get(key) ?? 0) + v);
      }
      for (const [metric, value] of by) rows.push({ metric, value });
    } else if (d.name === IG_FOLLOWS_METRIC) {
      for (const r of results) {
        const v = num(r.value);
        const which = r.dimension_values?.[0];
        if (v == null) continue;
        if (which === "FOLLOWER") rows.push({ metric: "follows", value: v });
        else if (which === "NON_FOLLOWER") rows.push({ metric: "unfollows", value: v });
      }
    } else if (IG_NAME[d.name] && total != null) rows.push({ metric: IG_NAME[d.name], value: total });
  }
  return { rows, seen };
}

/** Metrics that were asked for and didn't come back. */
export const missingMetrics = (asked: readonly string[], seen: readonly string[]): string[] => asked.filter((m) => !seen.includes(m));

// ---- The Facebook Page: numbers by day ----------------------------------------------------------

/** Meta's name → the stored name. page_impressions and page_fans were removed in November 2025. */
export const PAGE_DAY_METRICS: Record<string, string> = {
  page_media_view: "views",
  page_total_media_view_unique: "reach",
  page_views_total: "profile_visits",
  page_follows: "followers",
  page_daily_follows_unique: "follows",
  page_daily_unfollows_unique: "unfollows",
  page_post_engagements: "interactions",
  page_total_actions: "profile_taps",
};

/** Page insights take at most 90 days a request. */
export const PAGE_CHUNK_DAYS = 85;

/** A day wider at each end: the day a value belongs to is worked out from its end_time. */
export function pageInsightsQuery(from: ISODate, to: ISODate, metrics: readonly string[]): string {
  return new URLSearchParams({ metric: metrics.join(","), period: "day", since: addDays(from, -1), until: addDays(to, 2) }).toString();
}

const isoInstant = (s: string) => Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

/** A daily value covers the day that ended at `end_time`; Facebook's days run on Pacific time. */
export function pageInsightDay(endTime: string): ISODate | null {
  const t = isoInstant(String(endTime));
  return Number.isFinite(t) ? todayIn("America/Los_Angeles", new Date(t - 1000)) : null;
}

export interface DayMetricValue extends MetricValue {
  day: ISODate;
}

export function parsePageInsights(j: unknown, names: Record<string, string> = PAGE_DAY_METRICS): { rows: DayMetricValue[]; seen: string[] } {
  type Item = { name?: string; period?: string; values?: { value?: unknown; end_time?: string }[] } | null;
  const rows: DayMetricValue[] = [];
  const seen: string[] = [];
  for (const d of (j as { data?: Item[] } | null)?.data ?? []) {
    if (typeof d?.name !== "string" || (d.period && d.period !== "day")) continue;
    if (!seen.includes(d.name)) seen.push(d.name);
    const metric = names[d.name];
    if (!metric) continue;
    for (const v of d.values ?? []) {
      const day = v?.end_time ? pageInsightDay(v.end_time) : null;
      const value = sumValue(v?.value);
      if (day && value != null) rows.push({ day, metric, value });
    }
  }
  return { rows, seen };
}

/** A number, or an object of numbers (a metric split by type) added up. */
function sumValue(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object") {
    const parts = Object.values(v as Record<string, unknown>).map(num).filter((x): x is number => x != null);
    return parts.length ? parts.reduce((s, x) => s + x, 0) : null;
  }
  return null;
}

// ---- Posts and reels ------------------------------------------------------------------------------

export type PostKind = "post" | "reel" | "video" | "carousel" | "link" | "text";

/** A post as the channel lists it, before its insights are read. */
export interface ChannelPost {
  externalId: string;
  /** ISO instant. */
  postedAt: string;
  kind: PostKind;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

export interface PostNumbers {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  interactions: number | null;
  profileVisits: number | null;
  follows: number | null;
  /** Numbers only one channel has. */
  extra: Record<string, number> | null;
  /** At least one number came back. */
  any: boolean;
}

export const CAPTION_MAX = 220;

/** The first couple of hundred characters, on one line, cut at a word. */
export function excerpt(text: string | null | undefined, max = CAPTION_MAX): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

const instant = (s: unknown): string | null => {
  const t = typeof s === "string" ? isoInstant(s) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export const IG_MEDIA_FIELDS = "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count";
export const IG_MEDIA_LIMIT = 50;

export function parseIgMedia(j: unknown): ChannelPost[] {
  type Raw = { id?: string; caption?: string; media_type?: string; media_product_type?: string; permalink?: string; thumbnail_url?: string; media_url?: string; timestamp?: string; like_count?: number; comments_count?: number } | null;
  const out: ChannelPost[] = [];
  for (const m of (j as { data?: Raw[] } | null)?.data ?? []) {
    const postedAt = instant(m?.timestamp);
    if (typeof m?.id !== "string" || !postedAt) continue;
    const kind: PostKind = m.media_product_type === "REELS" ? "reel" : m.media_type === "CAROUSEL_ALBUM" ? "carousel" : m.media_type === "VIDEO" ? "video" : "post";
    out.push({
      externalId: m.id,
      postedAt,
      kind,
      caption: excerpt(m.caption),
      permalink: m.permalink ?? null,
      // A video's own address is the film, not a picture.
      thumbnailUrl: m.thumbnail_url ?? (m.media_type === "VIDEO" ? null : m.media_url ?? null),
      likes: num(m.like_count),
      comments: num(m.comments_count),
      shares: null,
    });
  }
  return out;
}

const IG_MEDIA_COMMON = ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"];

/** A reel has watch time; a feed post has the profile visits and follows it led to. */
export const igMediaMetrics = (kind: PostKind): string[] => (kind === "reel" ? [...IG_MEDIA_COMMON, "ig_reels_avg_watch_time"] : [...IG_MEDIA_COMMON, "profile_visits", "follows"]);

const NO_NUMBERS: PostNumbers = { views: null, reach: null, likes: null, comments: null, saves: null, shares: null, interactions: null, profileVisits: null, follows: null, extra: null, any: false };

/** name → value, from either shape Meta uses (values[0].value or total_value.value). */
function insightValues(j: unknown): Map<string, unknown> {
  type Item = { name?: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } } | null;
  const m = new Map<string, unknown>();
  for (const d of (j as { data?: Item[] } | null)?.data ?? []) {
    if (typeof d?.name !== "string") continue;
    m.set(d.name, d.values?.[0]?.value ?? d.total_value?.value);
  }
  return m;
}

/** An Instagram post's insights. A post with none yet comes back empty: every number is null, not zero. */
export function parseMediaInsights(j: unknown): PostNumbers {
  const v = insightValues(j);
  const get = (k: string) => num(v.get(k));
  const watch = get("ig_reels_avg_watch_time");
  const n: PostNumbers = {
    ...NO_NUMBERS,
    views: get("views"),
    reach: get("reach"),
    likes: get("likes"),
    comments: get("comments"),
    saves: get("saved"),
    shares: get("shares"),
    interactions: get("total_interactions"),
    profileVisits: get("profile_visits"),
    follows: get("follows"),
    extra: watch != null ? { avgWatchSeconds: Math.round(watch / 100) / 10 } : null,
  };
  return { ...n, any: [n.views, n.reach, n.likes, n.comments, n.saves, n.shares, n.interactions, n.profileVisits, n.follows, watch].some((x) => x != null) };
}

export const PAGE_POST_FIELDS = "id,created_time,message,permalink_url,full_picture,status_type,shares,reactions.limit(0).summary(total_count),comments.limit(0).summary(total_count)";
/** Without the counts of reactions and comments, for a sign-in that isn't allowed them. */
export const PAGE_POST_FIELDS_BASIC = "id,created_time,message,permalink_url,full_picture,status_type,shares";
export const PAGE_POST_LIMIT = 50;
export const PAGE_POST_METRICS = ["post_media_view", "post_total_media_view_unique", "post_clicks", "post_reactions_by_type_total"];

/** The Page's own posts. Reactions and comments are asked for as counts only (limit 0): never who. */
export function parsePagePosts(j: unknown): ChannelPost[] {
  type Raw = { id?: string; created_time?: string; message?: string; permalink_url?: string; full_picture?: string; status_type?: string; shares?: { count?: number }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } } | null;
  const KIND: Record<string, PostKind> = { added_video: "video", added_photos: "post", shared_story: "link", mobile_status_update: "text" };
  const out: ChannelPost[] = [];
  for (const p of (j as { data?: Raw[] } | null)?.data ?? []) {
    const postedAt = instant(p?.created_time);
    if (typeof p?.id !== "string" || !postedAt) continue;
    out.push({
      externalId: p.id,
      postedAt,
      kind: KIND[p.status_type ?? ""] ?? "post",
      caption: excerpt(p.message),
      permalink: p.permalink_url ?? null,
      thumbnailUrl: p.full_picture ?? null,
      likes: num(p.reactions?.summary?.total_count),
      comments: num(p.comments?.summary?.total_count),
      shares: num(p.shares?.count),
    });
  }
  return out;
}

export function parsePostInsights(j: unknown): PostNumbers {
  const v = insightValues(j);
  const views = num(v.get("post_media_view"));
  const reach = num(v.get("post_total_media_view_unique"));
  const clicks = num(v.get("post_clicks"));
  const likes = sumValue(v.get("post_reactions_by_type_total"));
  return { ...NO_NUMBERS, views, reach, likes, extra: clicks != null ? { clicks } : null, any: [views, reach, clicks, likes].some((x) => x != null) };
}

/** A post's numbers: its insights where there are some, else the counts that came with the post. */
export function mergePostNumbers(post: ChannelPost, n: PostNumbers): Omit<PostNumbers, "any"> & { hasInsights: boolean } {
  const { any, ...rest } = n;
  return { ...rest, likes: n.likes ?? post.likes, comments: n.comments ?? post.comments, shares: n.shares ?? post.shares, hasInsights: any };
}

/** Reactions, comments and shares together, for a channel that doesn't add them up itself. Null when it gave none of them. */
export const countInteractions = (likes: number | null, comments: number | null, shares: number | null): number | null => ([likes, comments, shares].some((x) => x != null) ? (likes ?? 0) + (comments ?? 0) + (shares ?? 0) : null);

// ---- Which days a sync reads -----------------------------------------------------------------------

/** Meta's numbers can run two days late, so the last few days are read again each night. */
export const META_REREAD_DAYS = 4;
/** Instagram is read a day at a time, so the first sync takes a month and the rest follows nightly. */
export const IG_FIRST_DAYS = 30;
export const IG_BACKFILL_DAYS_PER_RUN = 60;
/** Meta keeps two years. */
export const META_MAX_HISTORY_DAYS = 730;
/** This many empty days in a row while working backwards means the history has run out. */
export const BACKFILL_EMPTY_STREAK = 14;

/** Yesterday back to a few days before the last day read (or `first` days, the first time). */
export function recentWindow(today: ISODate, lastDay: ISODate | null, back = META_REREAD_DAYS, first = IG_FIRST_DAYS): { from: ISODate; to: ISODate } {
  const to = addDays(today, -1);
  const floor = addDays(today, -Math.max(first, 1));
  const from = lastDay ? addDays(lastDay, -back) : floor;
  return { from: lastDay && from < addDays(today, -META_MAX_HISTORY_DAYS) ? addDays(today, -META_MAX_HISTORY_DAYS) : from, to };
}

/** The next slice of older days to read, just before the earliest day already read; null when there is no more. */
export function backfillWindow(today: ISODate, earliest: ISODate | null, perRun = IG_BACKFILL_DAYS_PER_RUN, maxHistory = META_MAX_HISTORY_DAYS): { from: ISODate; to: ISODate } | null {
  const floor = addDays(today, -maxHistory);
  if (!earliest || earliest <= floor) return null;
  const from = addDays(earliest, -perRun);
  return { from: from < floor ? floor : from, to: addDays(earliest, -1) };
}

export function chunkDays(from: ISODate, to: ISODate, size: number): { from: ISODate; to: ISODate }[] {
  const out: { from: ISODate; to: ISODate }[] = [];
  for (let a = from; a <= to; a = addDays(a, size)) {
    const b = addDays(a, size - 1);
    out.push({ from: a, to: b < to ? b : to });
  }
  return out;
}

// ---- A run, step by step -----------------------------------------------------------------------------

export type StepOutcome = { name: string; status: "ok" } | { name: string; status: "failed"; kind: MetaErrorKind; error: string } | { name: string; status: "skipped" };

export interface RunResult {
  outcomes: StepOutcome[];
  /** The step that ended the run early, when one did. */
  stopped: { step: string; kind: MetaErrorKind; message: string } | null;
}

/**
 * Run the parts of a sync in order. A part that fails is noted and the next
 * one still runs, unless the failure is one that every later part would hit
 * too (the sign-in died mid-run, or Meta asked us to slow down): then the run
 * stops there, what was already saved stays, and the rest is marked skipped.
 */
export async function runSteps(steps: { name: string; run: () => Promise<void> }[], kindOf: (e: unknown) => MetaErrorKind, say: (e: unknown) => string): Promise<RunResult> {
  const outcomes: StepOutcome[] = [];
  let stopped: RunResult["stopped"] = null;
  for (const s of steps) {
    if (stopped) {
      outcomes.push({ name: s.name, status: "skipped" });
      continue;
    }
    try {
      await s.run();
      outcomes.push({ name: s.name, status: "ok" });
    } catch (e) {
      const kind = kindOf(e);
      const error = say(e);
      outcomes.push({ name: s.name, status: "failed", kind, error });
      if (isFatalKind(kind)) stopped = { step: s.name, kind, message: error };
    }
  }
  return { outcomes, stopped };
}
