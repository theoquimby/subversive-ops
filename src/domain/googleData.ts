import { addDays, type ISODate } from "./dates";

/**
 * Google Search Console and Google Business Profile: endpoints, the OAuth
 * sign-in URL and parsing what comes back. Pure (no network) so every shape
 * is unit-tested. Each endpoint is the one in Google's reference docs:
 *
 * - OAuth 2.0 for web server apps — developers.google.com/identity/protocols/oauth2/web-server
 * - Search Console: sites.list, searchAnalytics.query — developers.google.com/webmaster-tools/v1/…
 * - Business Profile: accounts.list (Account Management API), accounts.locations.list
 *   (Business Information API), locations.fetchMultiDailyMetricsTimeSeries and
 *   locations.searchkeywords.impressions.monthly.list (Performance API) — developers.google.com/my-business/reference/…
 */

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const SCOPE_SEARCH_CONSOLE = "https://www.googleapis.com/auth/webmasters.readonly";
export const SCOPE_BUSINESS = "https://www.googleapis.com/auth/business.manage";

export const GSC_SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";
export const gscQueryUrl = (siteUrl: string) => `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

export const GBP_ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
export const gbpLocationsUrl = (account: string) => `https://mybusinessbusinessinformation.googleapis.com/v1/${account}/locations`;
export const gbpMetricsUrl = (location: string) => `https://businessprofileperformance.googleapis.com/v1/${location}:fetchMultiDailyMetricsTimeSeries`;
export const gbpKeywordsUrl = (location: string) => `https://businessprofileperformance.googleapis.com/v1/${location}/searchkeywords/impressions/monthly`;

/** Which parts the owner allowed (Google lets them untick one on the consent screen). */
export interface GoogleGrant {
  search: boolean;
  business: boolean;
}

export const grantFromScope = (scope: string | null | undefined): GoogleGrant => {
  const s = new Set((scope ?? "").split(/\s+/));
  return { search: s.has(SCOPE_SEARCH_CONSOLE) || s.has("https://www.googleapis.com/auth/webmasters"), business: s.has(SCOPE_BUSINESS) };
};

/**
 * The consent URL. `access_type=offline` gets a refresh token for the nightly
 * sync; `prompt=consent` makes Google send it again on a reconnect (it's only
 * returned on the first authorization otherwise).
 */
export function googleAuthorizeUrl(a: { clientId: string; redirectUri: string; state: string; business: boolean }): string {
  const scope = [SCOPE_SEARCH_CONSOLE, ...(a.business ? [SCOPE_BUSINESS] : [])].join(" ");
  const q = new URLSearchParams({
    client_id: a.clientId,
    redirect_uri: a.redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: a.state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${q}`;
}

export interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: string;
  refreshExpiresAt: string | null;
  scope: string;
}

export function googleTokensFrom(r: GoogleTokenResponse, now: Date, previousRefresh: string | null = null): GoogleTokens {
  if (!r?.access_token) throw new Error("Google didn't send back a sign-in. Press Connect Google again.");
  const access = Number.isFinite(r.expires_in) && r.expires_in! > 0 ? r.expires_in! : 3600;
  const refreshIn = Number.isFinite(r.refresh_token_expires_in) && r.refresh_token_expires_in! > 0 ? r.refresh_token_expires_in! : null;
  return {
    accessToken: r.access_token,
    // A refresh response usually has no refresh_token: keep the one we have.
    refreshToken: r.refresh_token ?? previousRefresh,
    accessExpiresAt: new Date(now.getTime() + access * 1000).toISOString(),
    refreshExpiresAt: refreshIn ? new Date(now.getTime() + refreshIn * 1000).toISOString() : null,
    scope: r.scope ?? "",
  };
}

/** Plain English for Google's OAuth and API errors. */
export function friendlyGoogleError(status: number, body: string): string {
  let reason = "";
  let message = "";
  try {
    const j = JSON.parse(body) as { error?: string | { status?: string; message?: string; details?: { reason?: string }[] }; error_description?: string };
    if (typeof j.error === "string") {
      reason = j.error;
      message = j.error_description ?? "";
    } else if (j.error) {
      reason = j.error.status ?? j.error.details?.find((d) => d.reason)?.reason ?? "";
      message = j.error.message ?? "";
    }
  } catch {
    /* not JSON */
  }
  if (reason === "invalid_grant") return "Google says the sign-in has expired or was removed. Press Connect Google again. (If the app's consent screen is still in Testing, Google ends sign-ins after 7 days: publish it.)";
  if (reason === "invalid_client") return "Google didn't accept the Client ID or secret. Paste them again from the Credentials page.";
  if (reason === "redirect_uri_mismatch") return "The redirect address isn't on the Google client yet. Copy it from step 3 into Authorized redirect URIs, save, and try again.";
  if (status === 401) return "Google asked to sign in again. Press Connect Google.";
  if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(message + reason)) return `An API isn't turned on in the Google Cloud project yet: ${message.slice(0, 160)}`;
  if (status === 403 && /quota|0 QPM|RATE_LIMIT|RESOURCE_EXHAUSTED/i.test(message + reason)) return "Google hasn't approved Business Profile API access for this project yet (its quota is 0). Search Console still works. See step 6 of the guide.";
  if (status === 403) return `Google refused: ${message.slice(0, 160) || "the signed-in account can't see this property or listing."}`;
  if (status === 429) return "Google asked us to slow down. The next nightly sync tries again.";
  if (status >= 500) return "Google's service had a problem. The next nightly sync tries again.";
  return message ? `Google said: ${message.slice(0, 200)}` : `Google answered ${status}.`;
}

// ---- Search Console ----------------------------------------------------------------------

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export function parseSites(j: unknown): GscSite[] {
  const list = (j as { siteEntry?: { siteUrl?: string; permissionLevel?: string }[] })?.siteEntry ?? [];
  return list.filter((s) => typeof s.siteUrl === "string" && s.permissionLevel !== "siteUnverifiedUser").map((s) => ({ siteUrl: s.siteUrl!, permissionLevel: s.permissionLevel ?? "" }));
}

/** The Search Console property for the website: a Domain property beats a URL-prefix one; www or not both match. */
export function pickSite(sites: GscSite[], websiteOrigin: string | null): string | null {
  if (!sites.length) return null;
  if (!websiteOrigin) return sites.length === 1 ? sites[0].siteUrl : null;
  let host = "";
  try {
    host = new URL(websiteOrigin).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  const domain = sites.find((s) => s.siteUrl === `sc-domain:${host}`);
  if (domain) return domain.siteUrl;
  const prefix = sites.find((s) => {
    try {
      return new URL(s.siteUrl).hostname.replace(/^www\./, "") === host;
    } catch {
      return false;
    }
  });
  return prefix?.siteUrl ?? null;
}

export interface GscRow {
  day: ISODate;
  key: string;
  clicks: number;
  impressions: number;
  position: number;
}

/** rows[].keys follow the requested dimensions: ["date"] or ["date", "query" | "page" | "device"]. */
export function parseGscRows(j: unknown): GscRow[] {
  const rows = (j as { rows?: { keys?: string[]; clicks?: number; impressions?: number; position?: number }[] })?.rows ?? [];
  return rows
    .filter((r) => Array.isArray(r.keys) && /^\d{4}-\d{2}-\d{2}$/.test(r.keys[0] ?? ""))
    .map((r) => ({ day: r.keys![0], key: (r.keys![1] ?? "all").slice(0, 300), clicks: Math.round(r.clicks ?? 0), impressions: Math.round(r.impressions ?? 0), position: Math.round((r.position ?? 0) * 100) / 100 }));
}

/**
 * Search Console data is final after about 2–3 days, and the API keeps 16
 * months. The nightly sync re-reads the last `back` days (so late data lands);
 * the first sync goes back as far as Google keeps.
 */
export function gscWindow(today: ISODate, lastSynced: ISODate | null, back = 10): { from: ISODate; to: ISODate } {
  const to = addDays(today, -1);
  const first = addDays(today, -480);
  const from = lastSynced ? addDays(lastSynced, -back) : first;
  return { from: from < first ? first : from, to };
}

/** Click-weighted CTR and impression-weighted position over many rows. */
export function sumGsc(rows: { clicks: number; impressions: number; position: number }[]) {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const position = impressions > 0 ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : null;
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null, position };
}

/** Searches for the business by name ("subversive", "subversive brewing catskill") vs everything else. */
export const isBrandQuery = (q: string, brand: string[] = ["subversive"]) => brand.some((b) => q.toLowerCase().includes(b.toLowerCase()));

// ---- Business Profile ----------------------------------------------------------------------

export const GBP_METRICS = [
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_DIRECTION_REQUESTS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_FOOD_MENU_CLICKS",
  "BUSINESS_BOOKINGS",
] as const;
export type GbpMetric = (typeof GBP_METRICS)[number];

export const GBP_LABEL: Record<GbpMetric, string> = {
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "Seen on Maps (phone)",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "Seen on Maps (computer)",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "Seen in Search (phone)",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "Seen in Search (computer)",
  BUSINESS_DIRECTION_REQUESTS: "Direction requests",
  CALL_CLICKS: "Calls",
  WEBSITE_CLICKS: "Website clicks",
  BUSINESS_FOOD_MENU_CLICKS: "Menu clicks",
  BUSINESS_BOOKINGS: "Bookings",
};

export interface GbpAccount {
  name: string;
  accountName: string;
}
export interface GbpLocation {
  name: string;
  title: string;
  address: string | null;
  websiteUri: string | null;
}

export function parseAccounts(j: unknown): GbpAccount[] {
  const list = (j as { accounts?: { name?: string; accountName?: string }[] })?.accounts ?? [];
  return list.filter((a) => typeof a.name === "string" && a.name.startsWith("accounts/")).map((a) => ({ name: a.name!, accountName: a.accountName ?? a.name! }));
}

export function parseLocations(j: unknown): GbpLocation[] {
  const list = (j as { locations?: { name?: string; title?: string; websiteUri?: string; storefrontAddress?: { addressLines?: string[]; locality?: string } }[] })?.locations ?? [];
  return list
    .filter((l) => typeof l.name === "string" && l.name.startsWith("locations/"))
    .map((l) => ({
      name: l.name!,
      title: l.title ?? l.name!,
      address: l.storefrontAddress ? [...(l.storefrontAddress.addressLines ?? []), l.storefrontAddress.locality].filter(Boolean).join(", ") || null : null,
      websiteUri: l.websiteUri ?? null,
    }));
}

/** Query string for fetchMultiDailyMetricsTimeSeries: repeated dailyMetrics and dailyRange.start_date.year etc. */
export function gbpMetricsQuery(from: ISODate, to: ISODate, metrics: readonly string[] = GBP_METRICS): string {
  const q = new URLSearchParams();
  for (const m of metrics) q.append("dailyMetrics", m);
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  q.set("dailyRange.start_date.year", String(fy));
  q.set("dailyRange.start_date.month", String(fm));
  q.set("dailyRange.start_date.day", String(fd));
  q.set("dailyRange.end_date.year", String(ty));
  q.set("dailyRange.end_date.month", String(tm));
  q.set("dailyRange.end_date.day", String(td));
  return q.toString();
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * multiDailyMetricTimeSeries[].dailyMetricTimeSeries[] → one row per day and
 * metric. Google leaves `value` out when it is zero, so a missing value is 0.
 */
export function parseDailyMetrics(j: unknown): { day: ISODate; metric: string; value: number }[] {
  type DV = { date?: { year?: number; month?: number; day?: number }; value?: string };
  type S = { dailyMetric?: string; timeSeries?: { datedValues?: DV[] } };
  const out: { day: ISODate; metric: string; value: number }[] = [];
  const multi = (j as { multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: S[] }[] })?.multiDailyMetricTimeSeries ?? [];
  for (const m of multi)
    for (const s of m.dailyMetricTimeSeries ?? []) {
      if (!s.dailyMetric) continue;
      for (const dv of s.timeSeries?.datedValues ?? []) {
        const d = dv.date;
        if (!d?.year || !d.month || !d.day) continue;
        const value = dv.value != null ? Number(dv.value) : 0;
        out.push({ day: `${d.year}-${pad(d.month)}-${pad(d.day)}`, metric: s.dailyMetric, value: Number.isFinite(value) ? value : 0 });
      }
    }
  return out;
}

export function gbpKeywordsQuery(fromMonth: string, toMonth: string, pageToken?: string): string {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  const q = new URLSearchParams({
    "monthlyRange.start_month.year": String(fy),
    "monthlyRange.start_month.month": String(fm),
    "monthlyRange.end_month.year": String(ty),
    "monthlyRange.end_month.month": String(tm),
    pageSize: "100",
  });
  if (pageToken) q.set("pageToken", pageToken);
  return q.toString();
}

/** searchKeywordsCounts[]: insightsValue is either a value or a threshold ("fewer than 15"). */
export function parseKeywords(j: unknown): { keywords: { keyword: string; value: number | null; threshold: number | null }[]; next: string | null } {
  const r = j as { searchKeywordsCounts?: { searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }[]; nextPageToken?: string };
  const keywords = (r?.searchKeywordsCounts ?? [])
    .filter((k) => typeof k.searchKeyword === "string" && k.searchKeyword)
    .map((k) => ({
      keyword: k.searchKeyword!.slice(0, 200),
      value: k.insightsValue?.value != null ? Number(k.insightsValue.value) : null,
      threshold: k.insightsValue?.threshold != null ? Number(k.insightsValue.threshold) : null,
    }));
  return { keywords, next: r?.nextPageToken ?? null };
}

/** Business Profile data arrives a few days late; re-read the last 10 days each night, 18 months the first time. */
export function gbpWindow(today: ISODate, lastSynced: ISODate | null): { from: ISODate; to: ISODate } {
  const to = addDays(today, -1);
  const first = addDays(today, -540);
  const from = lastSynced ? addDays(lastSynced, -10) : first;
  return { from: from < first ? first : from, to };
}
