import { describe, expect, it } from "vitest";
import {
  friendlyGoogleError,
  gbpKeywordsQuery,
  gbpMetricsQuery,
  gbpWindow,
  googleAuthorizeUrl,
  googleTokensFrom,
  grantFromScope,
  gscQueryUrl,
  gscWindow,
  isBrandQuery,
  parseAccounts,
  parseDailyMetrics,
  parseGscRows,
  parseKeywords,
  parseLocations,
  parseSites,
  pickSite,
  SCOPE_BUSINESS,
  SCOPE_SEARCH_CONSOLE,
  sumGsc,
} from "../googleData";
import { validateSecret } from "../secretFormats";

// Built from parts so secret scanners don't mistake test values for real credentials.
const FAKE_ID = ["123456789012-", "x".repeat(32), ".apps.", "googleusercontent", ".com"].join("");
const FAKE_SECRET = "GOC" + "SPX-" + "x".repeat(28);

describe("Google OAuth", () => {
  it("asks for offline, read-only Search Console and (optionally) Business Profile", () => {
    const u = new URL(googleAuthorizeUrl({ clientId: "client-id", redirectUri: "https://ops.example.com/api/google/oauth/callback", state: "s1", business: true }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe(`${SCOPE_SEARCH_CONSOLE} ${SCOPE_BUSINESS}`);
    const no = new URL(googleAuthorizeUrl({ clientId: "x", redirectUri: "y", state: "z", business: false }));
    expect(no.searchParams.get("scope")).toBe(SCOPE_SEARCH_CONSOLE);
  });
  it("keeps the refresh token when a renewal doesn't send one", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const t = googleTokensFrom({ access_token: "a", expires_in: 3599, scope: SCOPE_SEARCH_CONSOLE }, now, "r-old");
    expect(t.refreshToken).toBe("r-old");
    expect(t.accessExpiresAt).toBe("2026-11-15T12:59:59.000Z");
    expect(() => googleTokensFrom({}, now)).toThrow();
  });
  it("knows which parts were allowed", () => {
    expect(grantFromScope(`${SCOPE_SEARCH_CONSOLE} openid`)).toEqual({ search: true, business: false });
    expect(grantFromScope(`${SCOPE_BUSINESS} ${SCOPE_SEARCH_CONSOLE}`)).toEqual({ search: true, business: true });
  });
  it("explains errors in plain English", () => {
    expect(friendlyGoogleError(400, JSON.stringify({ error: "invalid_grant" }))).toMatch(/Testing/);
    expect(friendlyGoogleError(403, JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "Business Profile Performance API has not been used in project 1 before or it is disabled." } }))).toMatch(/isn't turned on/);
    expect(friendlyGoogleError(429, "")).toMatch(/slow down/);
  });
  it("checks pasted credentials", () => {
    expect(validateSecret("GOOGLE_OAUTH_CLIENT_ID", `  ${FAKE_ID} `)).toEqual({ ok: true, value: FAKE_ID });
    expect(validateSecret("GOOGLE_OAUTH_CLIENT_ID", FAKE_SECRET).ok).toBe(false);
    expect(validateSecret("GOOGLE_OAUTH_CLIENT_SECRET", FAKE_SECRET)).toEqual({ ok: true, value: FAKE_SECRET });
    const wrong = validateSecret("GOOGLE_OAUTH_CLIENT_SECRET", FAKE_ID);
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.error).toMatch(/Client ID/);
  });
});

describe("Search Console", () => {
  it("encodes the property in the query URL", () => {
    expect(gscQueryUrl("sc-domain:drinksubversive.com")).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Adrinksubversive.com/searchAnalytics/query");
    expect(gscQueryUrl("https://drinksubversive.com/")).toBe("https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fdrinksubversive.com%2F/searchAnalytics/query");
  });
  it("picks the website's property, preferring a Domain property", () => {
    const sites = parseSites({ siteEntry: [{ siteUrl: "https://www.drinksubversive.com/", permissionLevel: "siteOwner" }, { siteUrl: "sc-domain:drinksubversive.com", permissionLevel: "siteOwner" }, { siteUrl: "https://other.com/", permissionLevel: "siteUnverifiedUser" }] });
    expect(sites).toHaveLength(2);
    expect(pickSite(sites, "https://drinksubversive.com")).toBe("sc-domain:drinksubversive.com");
    expect(pickSite([sites[0]], "https://drinksubversive.com")).toBe("https://www.drinksubversive.com/");
    expect(pickSite(sites, "https://nope.com")).toBeNull();
    expect(pickSite([sites[0]], null)).toBe("https://www.drinksubversive.com/");
  });
  it("parses rows by date and dimension", () => {
    const rows = parseGscRows({ rows: [{ keys: ["2026-11-10", "subversive brewing"], clicks: 12, impressions: 40, ctr: 0.3, position: 1.234 }, { keys: ["bad"], clicks: 1 }] });
    expect(rows).toEqual([{ day: "2026-11-10", key: "subversive brewing", clicks: 12, impressions: 40, position: 1.23 }]);
    expect(parseGscRows({})).toEqual([]);
  });
  it("sums with weighted position and CTR", () => {
    const s = sumGsc([{ clicks: 10, impressions: 100, position: 2 }, { clicks: 0, impressions: 300, position: 10 }]);
    expect(s).toEqual({ clicks: 10, impressions: 400, ctr: 0.025, position: 8 });
    expect(sumGsc([]).position).toBeNull();
  });
  it("re-reads recent days for late data; first sync goes back ~16 months", () => {
    expect(gscWindow("2026-11-15", "2026-11-12")).toEqual({ from: "2026-11-02", to: "2026-11-14" });
    expect(gscWindow("2026-11-15", null).from).toBe("2025-07-23");
  });
  it("spots searches for the business by name", () => {
    expect(isBrandQuery("Subversive Brewing Catskill")).toBe(true);
    expect(isBrandQuery("brewery near catskill")).toBe(false);
  });
});

describe("Business Profile", () => {
  it("builds the daily-metrics query exactly as documented", () => {
    const q = new URLSearchParams(gbpMetricsQuery("2026-01-01", "2026-03-31", ["WEBSITE_CLICKS", "CALL_CLICKS"]));
    expect(q.getAll("dailyMetrics")).toEqual(["WEBSITE_CLICKS", "CALL_CLICKS"]);
    expect(q.get("dailyRange.start_date.year")).toBe("2026");
    expect(q.get("dailyRange.start_date.month")).toBe("1");
    expect(q.get("dailyRange.end_date.day")).toBe("31");
  });
  it("parses time series; a missing value means zero", () => {
    const rows = parseDailyMetrics({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            { dailyMetric: "BUSINESS_DIRECTION_REQUESTS", timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: "14" }, { date: { year: 2026, month: 11, day: 2 } }] } },
            { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: "3" }] } },
          ],
        },
      ],
    });
    expect(rows).toEqual([
      { day: "2026-11-01", metric: "BUSINESS_DIRECTION_REQUESTS", value: 14 },
      { day: "2026-11-02", metric: "BUSINESS_DIRECTION_REQUESTS", value: 0 },
      { day: "2026-11-01", metric: "CALL_CLICKS", value: 3 },
    ]);
  });
  it("parses keywords with values or thresholds, and pages", () => {
    const r = parseKeywords({ searchKeywordsCounts: [{ searchKeyword: "brewery", insightsValue: { value: "120" } }, { searchKeyword: "burgers catskill", insightsValue: { threshold: "15" } }], nextPageToken: "abc" });
    expect(r.keywords).toEqual([{ keyword: "brewery", value: 120, threshold: null }, { keyword: "burgers catskill", value: null, threshold: 15 }]);
    expect(r.next).toBe("abc");
    const q = new URLSearchParams(gbpKeywordsQuery("2026-10", "2026-10", "abc"));
    expect(q.get("monthlyRange.start_month.month")).toBe("10");
    expect(q.get("pageToken")).toBe("abc");
  });
  it("parses accounts and locations", () => {
    expect(parseAccounts({ accounts: [{ name: "accounts/1", accountName: "Max" }, { name: "x" }] })).toEqual([{ name: "accounts/1", accountName: "Max" }]);
    expect(parseLocations({ locations: [{ name: "locations/9", title: "Subversive", storefrontAddress: { addressLines: ["96 West Bridge St"], locality: "Catskill" } }] })).toEqual([{ name: "locations/9", title: "Subversive", address: "96 West Bridge St, Catskill", websiteUri: null }]);
  });
  it("syncs 18 months the first time, then the last 10 days", () => {
    expect(gbpWindow("2026-11-15", "2026-11-14")).toEqual({ from: "2026-11-04", to: "2026-11-14" });
    expect(gbpWindow("2026-11-15", null).from).toBe("2025-05-24");
  });
});
