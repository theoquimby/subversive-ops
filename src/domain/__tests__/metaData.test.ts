import { describe, expect, it } from "vitest";
import {
  backfillWindow,
  chunkDays,
  classifyMetaError,
  friendlyMetaDenial,
  friendlyMetaError,
  IG_DAY_METRICS,
  igDayQuery,
  igMediaMetrics,
  isFatalKind,
  mergePostNumbers,
  META_API_VERSION,
  META_SCOPES,
  metaAuthorizeUrl,
  metaTokenFrom,
  missingMetrics,
  missingScopes,
  missingScopesMessage,
  pageInsightDay,
  pageInsightsQuery,
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
  pickPage,
  recentWindow,
  runSteps,
  tokenPlan,
  type MetaErrorInfo,
} from "../metaData";

const err = (patch: Partial<MetaErrorInfo>): MetaErrorInfo => ({ status: 400, code: null, subcode: null, type: "", message: "", ...patch });
const body = (e: Record<string, unknown>) => JSON.stringify({ error: e });

describe("Meta sign-in", () => {
  it("pins one API version everywhere", () => {
    expect(META_API_VERSION).toMatch(/^v\d+\.0$/);
  });
  it("sends the owner to Facebook's dialog asking only to read", () => {
    const u = new URL(metaAuthorizeUrl({ appId: "1".repeat(16), redirectUri: "https://ops.example.com/api/meta/oauth/callback", state: "abc.def" }));
    expect(u.origin + u.pathname).toBe(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("abc.def");
    expect(u.searchParams.get("redirect_uri")).toBe("https://ops.example.com/api/meta/oauth/callback");
    const scope = u.searchParams.get("scope")!.split(",");
    expect(scope.sort()).toEqual([...META_SCOPES].sort());
    // Nothing that can post, message or manage.
    expect(scope.some((s) => /publish|manage_(comments|messages|posts)|messaging|ads_/.test(s))).toBe(false);
    expect(u.searchParams.get("auth_type")).toBeNull();
  });
  it("asks again for boxes that were unticked last time", () => {
    const u = new URL(metaAuthorizeUrl({ appId: "1", redirectUri: "https://x/cb", state: "s", rerequest: true }));
    expect(u.searchParams.get("auth_type")).toBe("rerequest");
  });
  it("reads a token and when it runs out", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(metaTokenFrom({ access_token: "tok", expires_in: 5_183_944 }, now)).toEqual({ token: "tok", expiresAt: "2027-01-15T11:59:04.000Z" });
    // Meta leaves expires_in out for a token with no end date.
    expect(metaTokenFrom({ access_token: "tok" }, now)).toEqual({ token: "tok", expiresAt: null });
    expect(() => metaTokenFrom({}, now)).toThrow(/Connect/);
  });
  it("knows which boxes were ticked and says which are missing in plain words", () => {
    const granted = parseGrantedScopes({ data: [{ permission: "pages_show_list", status: "granted" }, { permission: "read_insights", status: "declined" }, { permission: "instagram_basic", status: "granted" }] });
    expect(granted).toEqual(["pages_show_list", "instagram_basic"]);
    expect(missingScopes(granted)).toEqual(["pages_read_engagement", "read_insights", "instagram_manage_insights"]);
    expect(missingScopes([...META_SCOPES])).toEqual([]);
    const msg = missingScopesMessage(["read_insights", "instagram_manage_insights"]);
    expect(msg).toMatch(/Facebook Page's numbers/);
    expect(msg).toMatch(/Instagram account's numbers/);
    expect(msg).toMatch(/Connect again/);
    expect(missingScopesMessage([])).toBeNull();
  });
  it("puts a cancelled sign-in in plain words", () => {
    expect(friendlyMetaDenial({ error: "access_denied", reason: "user_denied", description: "Permissions error" })).toMatch(/cancelled/);
    expect(friendlyMetaDenial({ error: "server_error", reason: null, description: "Something broke" })).toMatch(/Something broke/);
  });
});

describe("token-expiry decisions", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
  it("syncs with the Page's own token, which has no end date", () => {
    expect(tokenPlan({ pageToken: "p", userToken: "u", userExpiresAt: inDays(40) }, now)).toEqual({ use: "page", refreshUser: false, reconnect: null, userExpiresOn: inDays(40).slice(0, 10) });
  });
  it("renews the owner's sign-in when it is within 15 days of running out", () => {
    expect(tokenPlan({ pageToken: "p", userToken: "u", userExpiresAt: inDays(10) }, now).refreshUser).toBe(true);
    expect(tokenPlan({ pageToken: "p", userToken: "u", userExpiresAt: inDays(16) }, now).refreshUser).toBe(false);
  });
  it("carries on with the Page token after the owner's sign-in has run out", () => {
    const p = tokenPlan({ pageToken: "p", userToken: "u", userExpiresAt: inDays(-3) }, now);
    expect(p).toMatchObject({ use: "page", refreshUser: false, reconnect: null });
  });
  it("falls back to the owner's sign-in before a Page is picked, and asks to connect again once that has run out", () => {
    expect(tokenPlan({ pageToken: null, userToken: "u", userExpiresAt: inDays(5) }, now)).toMatchObject({ use: "user", refreshUser: true, reconnect: null });
    expect(tokenPlan({ pageToken: null, userToken: "u", userExpiresAt: inDays(-1) }, now)).toMatchObject({ use: null, refreshUser: false });
    expect(tokenPlan({ pageToken: null, userToken: "u", userExpiresAt: inDays(-1) }, now).reconnect).toMatch(/Connect again/);
    expect(tokenPlan({ pageToken: null, userToken: null, userExpiresAt: null }, now).use).toBeNull();
  });
  it("treats a sign-in with no end date as good", () => {
    expect(tokenPlan({ pageToken: null, userToken: "u", userExpiresAt: null }, now)).toEqual({ use: "user", refreshUser: false, reconnect: null, userExpiresOn: null });
  });
});

describe("errors from Meta, in plain English", () => {
  it("reads Meta's error shape, and copes with anything else", () => {
    expect(parseMetaError(400, body({ message: "Error validating access token: Session has expired", type: "OAuthException", code: 190, error_subcode: 463, fbtrace_id: "x" }))).toEqual({ status: 400, code: 190, subcode: 463, type: "OAuthException", message: "Error validating access token: Session has expired" });
    expect(parseMetaError(502, "<html>Bad gateway</html>")).toEqual({ status: 502, code: null, subcode: null, type: "", message: "" });
    expect(parseMetaError(400, JSON.stringify({ error: "invalid_request", error_description: "nope" }))).toMatchObject({ message: "nope" });
  });
  it("an expired or removed sign-in asks to connect again", () => {
    for (const e of [err({ code: 190, subcode: 463 }), err({ code: 190, subcode: 460 }), err({ code: 102 }), err({ status: 401 })]) {
      expect(classifyMetaError(e)).toBe("auth");
      expect(friendlyMetaError(e)).toMatch(/Connect again/);
    }
    expect(friendlyMetaError(err({ code: 190, subcode: 460 }))).toMatch(/password/);
  });
  it("a permission that wasn't granted says which box to tick", () => {
    const e = err({ status: 403, code: 200, message: "(#200) Requires pages_read_engagement permission" });
    expect(classifyMetaError(e)).toBe("permission");
    expect(friendlyMetaError(e)).toMatch(/every box ticked/);
    expect(classifyMetaError(err({ code: 10, message: "(#10) Application does not have permission for this action" }))).toBe("permission");
  });
  it("someone who lost their place on the Page is told who should connect", () => {
    const e = err({ code: 190, subcode: 492, message: "Session is invalid" });
    expect(classifyMetaError(e)).toBe("role");
    expect(friendlyMetaError(e)).toMatch(/full control of the Page/);
  });
  it("an app in development mode says to add the person as a tester", () => {
    const e = err({ code: 200, message: "App is in development mode and the user does not have a role on the app" });
    expect(classifyMetaError(e)).toBe("not-tester");
    expect(friendlyMetaError(e)).toMatch(/App roles/);
    expect(friendlyMetaError(e)).toMatch(/Tester/);
  });
  it("a personal Instagram account says how to switch to a professional one", () => {
    const e = err({ code: 100, message: "(#100) The user must be an Instagram Business Account or a Creator account" });
    expect(classifyMetaError(e)).toBe("not-professional");
    expect(friendlyMetaError(e)).toMatch(/Switch to professional account/);
  });
  it("a metric Instagram has removed is skipped, not fatal", () => {
    const e = err({ code: 100, message: "(#100) metric[0] must be one of the following values: reach, views, likes" });
    expect(classifyMetaError(e)).toBe("invalid-metric");
    expect(isFatalKind("invalid-metric")).toBe(false);
    expect(friendlyMetaError(e)).toMatch(/no longer gives/);
  });
  it("a date range Meta no longer keeps ends the backfill quietly", () => {
    expect(classifyMetaError(err({ code: 100, message: "(#100) since param is not valid. Metrics data is available for the last 2 years" }))).toBe("range");
    expect(classifyMetaError(err({ code: 100, message: "(#100) There cannot be more than 30 days (2592000 s) between since and until" }))).toBe("range");
  });
  it("a post with no numbers yet is just skipped", () => {
    expect(classifyMetaError(err({ code: 10, message: "(#10) Not enough viewers for the media to show insights" }))).toBe("no-insights");
    expect(classifyMetaError(err({ code: 100, subcode: 2108006, message: "Media posted before business account conversion" }))).toBe("no-insights");
    expect(classifyMetaError(err({ code: 100, subcode: 33, message: "Unsupported get request. Object with ID '1' does not exist" }))).toBe("gone");
  });
  it("being asked to slow down, and an outage, wait for tomorrow", () => {
    for (const code of [4, 17, 32, 613, 80001, 80002]) expect(classifyMetaError(err({ code }))).toBe("rate");
    expect(classifyMetaError(err({ status: 429 }))).toBe("rate");
    expect(friendlyMetaError(err({ code: 80002 }))).toMatch(/slow down/);
    expect(classifyMetaError(err({ status: 503 }))).toBe("transient");
    expect(classifyMetaError(err({ code: 2 }))).toBe("transient");
    expect(classifyMetaError(err({ status: 0, message: "fetch failed" }))).toBe("transient");
    expect(friendlyMetaError(err({ status: 503 }))).toMatch(/next nightly sync/);
  });
  it("a wrong App secret or redirect address says where to fix it", () => {
    const secret = err({ code: 1, type: "OAuthException", message: "Error validating client secret." });
    expect(classifyMetaError(secret)).toBe("app");
    expect(friendlyMetaError(secret)).toMatch(/App ID or App secret/);
    const redirect = err({ code: 191, message: "Can't load URL: The domain of this URL isn't included in the app's domains." });
    expect(classifyMetaError(redirect)).toBe("redirect");
    expect(friendlyMetaError(redirect)).toMatch(/Valid OAuth Redirect URIs/);
    const used = err({ code: 100, subcode: 36009, message: "This authorization code has been used." });
    expect(classifyMetaError(used)).toBe("code");
    expect(friendlyMetaError(used)).toMatch(/Connect again/);
  });
  it("anything else is quoted, shortened", () => {
    expect(friendlyMetaError(err({ code: 12345, message: "Something odd ".repeat(40) })).length).toBeLessThan(240);
    expect(friendlyMetaError(err({ status: 418 }))).toBe("Facebook answered 418.");
  });
  it("only a dead sign-in, a throttle or broken app keys stop a run", () => {
    expect(["auth", "role", "rate", "app", "not-tester"].every((k) => isFatalKind(k as never))).toBe(true);
    expect(["invalid-metric", "no-insights", "gone", "transient", "range", "permission", "other", "not-professional"].some((k) => isFatalKind(k as never))).toBe(false);
  });
});

describe("Pages and the Instagram account", () => {
  const pages = {
    data: [
      { id: "10", name: "Subversive", access_token: "page-token-10", tasks: ["ANALYZE", "MANAGE"], instagram_business_account: { id: "1784", username: "drinksubversive" } },
      { id: "11", name: "A side project", access_token: "page-token-11", tasks: ["MODERATE"] },
      { name: "no id" },
    ],
    paging: { cursors: { after: "NEXT" }, next: "https://graph.facebook.com/next" },
  };
  it("lists Pages with their token, whether numbers can be read, and the linked Instagram account", () => {
    const r = parsePages(pages);
    expect(r.pages).toEqual([
      { id: "10", name: "Subversive", token: "page-token-10", canAnalyze: true, instagram: { id: "1784", username: "drinksubversive" } },
      { id: "11", name: "A side project", token: "page-token-11", canAnalyze: false, instagram: null },
    ]);
    expect(r.after).toBe("NEXT");
    expect(parsePages({}).pages).toEqual([]);
    expect(parsePages({ data: [] }).after).toBeNull();
  });
  it("keeps the Page picked before, else the only one, else the only one with Instagram", () => {
    const { pages: list } = parsePages(pages);
    expect(pickPage(list, "11")?.id).toBe("11");
    expect(pickPage(list, "gone")?.id).toBe("10");
    expect(pickPage([list[1]], null)?.id).toBe("11");
    expect(pickPage([list[1], { ...list[1], id: "12" }], null)).toBeNull();
    expect(pickPage([], null)).toBeNull();
  });
  it("reads the Instagram account and its follower count", () => {
    expect(parseIgAccount({ id: "1784", username: "drinksubversive", followers_count: 2140, media_count: 310 })).toEqual({ id: "1784", username: "drinksubversive", followers: 2140, mediaCount: 310 });
    expect(parseIgAccount({ id: "1784" })).toEqual({ id: "1784", username: null, followers: null, mediaCount: null });
    expect(parseIgAccount({})).toBeNull();
  });
});

describe("Instagram's daily numbers", () => {
  it("asks for one business day at a time, as a total", () => {
    const q = new URLSearchParams(igDayQuery("2026-11-14", "America/New_York", IG_DAY_METRICS));
    expect(q.get("metric")).toBe(IG_DAY_METRICS.join(","));
    expect(q.get("period")).toBe("day");
    expect(q.get("metric_type")).toBe("total_value");
    // Midnight in New York (UTC-5 in November) to one second before the next.
    expect(Number(q.get("since"))).toBe(Date.parse("2026-11-14T05:00:00Z") / 1000);
    expect(Number(q.get("until"))).toBe(Date.parse("2026-11-15T05:00:00Z") / 1000 - 1);
    expect(q.get("breakdown")).toBeNull();
    expect(new URLSearchParams(igDayQuery("2026-11-14", "America/New_York", ["profile_links_taps"], "contact_button_type")).get("breakdown")).toBe("contact_button_type");
  });
  it("only asks for metrics Meta's current reference lists", () => {
    for (const gone of ["impressions", "profile_views", "website_clicks", "email_contacts", "get_direction_clicks", "phone_call_clicks", "text_message_clicks"]) expect(IG_DAY_METRICS as readonly string[]).not.toContain(gone);
  });
  const total = (name: string, value: number) => ({ name, period: "day", total_value: { value } });
  it("turns totals into short stable metric names", () => {
    const r = parseIgTotals({ data: [total("reach", 812), total("views", 2305), total("accounts_engaged", 96), total("total_interactions", 140), total("likes", 110), total("comments", 9), total("saves", 12), total("shares", 9)] });
    expect(Object.fromEntries(r.rows.map((x) => [x.metric, x.value]))).toEqual({ reach: 812, views: 2305, engaged: 96, interactions: 140, likes: 110, comments: 9, saves: 12, shares: 9 });
    expect(r.seen.sort()).toEqual([...IG_DAY_METRICS].sort());
  });
  it("splits taps on the profile's buttons, and follows from unfollows", () => {
    const taps = parseIgTotals({
      data: [{ name: "profile_links_taps", total_value: { value: 14, breakdowns: [{ dimension_keys: ["contact_button_type"], results: [{ dimension_values: ["CALL"], value: 5 }, { dimension_values: ["DIRECTION"], value: 6 }, { dimension_values: ["EMAIL"], value: 1 }, { dimension_values: ["INSTANT_EXPERIENCE"], value: 1 }, { dimension_values: ["UNDEFINED"], value: 1 }] }] } }],
    });
    expect(Object.fromEntries(taps.rows.map((x) => [x.metric, x.value]))).toEqual({ profile_taps: 14, tap_call: 5, tap_directions: 6, tap_email: 1, tap_other: 2 });
    const follows = parseIgTotals({ data: [{ name: "follows_and_unfollows", total_value: { value: 9, breakdowns: [{ dimension_keys: ["follow_type"], results: [{ dimension_values: ["FOLLOWER"], value: 7 }, { dimension_values: ["NON_FOLLOWER"], value: 2 }, { dimension_values: ["UNKNOWN"], value: 1 }] }] } }] });
    expect(Object.fromEntries(follows.rows.map((x) => [x.metric, x.value]))).toEqual({ follows: 7, unfollows: 2 });
  });
  it("carries on when a metric the API no longer returns is simply missing", () => {
    // Asked for reach, views and likes; Instagram answered without views.
    const r = parseIgTotals({ data: [total("reach", 500), total("likes", 40)] });
    expect(r.rows).toEqual([{ metric: "reach", value: 500 }, { metric: "likes", value: 40 }]);
    expect(missingMetrics(["reach", "views", "likes"], r.seen)).toEqual(["views"]);
  });
  it("ignores names it doesn't know and values that aren't numbers", () => {
    const r = parseIgTotals({ data: [total("some_new_metric", 5), { name: "reach", total_value: { value: "n/a" } }, { name: "views" }, null] });
    expect(r.rows).toEqual([]);
    expect(r.seen).toEqual(["some_new_metric", "reach", "views"]);
  });
  it("is empty, not an error, for an empty account", () => {
    expect(parseIgTotals({ data: [] })).toEqual({ rows: [], seen: [] });
    expect(parseIgTotals(null)).toEqual({ rows: [], seen: [] });
    expect(parseIgTotals({})).toEqual({ rows: [], seen: [] });
  });
  it("still reads the older day-by-day shape", () => {
    const r = parseIgTotals({ data: [{ name: "reach", period: "day", values: [{ value: 30, end_time: "2026-11-14T08:00:00+0000" }, { value: 12, end_time: "2026-11-15T08:00:00+0000" }] }] });
    expect(r.rows).toEqual([{ metric: "reach", value: 42 }]);
  });
});

describe("the Facebook Page's daily numbers", () => {
  it("asks for a range of days, a little wider than needed", () => {
    const q = new URLSearchParams(pageInsightsQuery("2026-10-01", "2026-10-31", ["page_media_view", "page_follows"]));
    expect(q.get("metric")).toBe("page_media_view,page_follows");
    expect(q.get("period")).toBe("day");
    expect(q.get("since")).toBe("2026-09-30");
    expect(q.get("until")).toBe("2026-11-02");
  });
  it("names the day a value covers: the one that ended at end_time, in Pacific time", () => {
    expect(pageInsightDay("2026-11-14T08:00:00+0000")).toBe("2026-11-13");
    // Summer time: midnight in California is 07:00 UTC.
    expect(pageInsightDay("2026-07-04T07:00:00+0000")).toBe("2026-07-03");
    expect(pageInsightDay("nonsense")).toBeNull();
  });
  it("turns each series into rows by day, under the shared metric names", () => {
    const rows = parsePageInsights({
      data: [
        { name: "page_media_view", period: "day", values: [{ value: 410, end_time: "2026-11-13T08:00:00+0000" }, { value: 390, end_time: "2026-11-14T08:00:00+0000" }] },
        { name: "page_follows", period: "day", values: [{ value: 1810, end_time: "2026-11-14T08:00:00+0000" }] },
        { name: "page_total_actions", period: "day", values: [{ value: { "Call now": 2, Directions: 3 }, end_time: "2026-11-14T08:00:00+0000" }] },
        { name: "page_media_view", period: "week", values: [{ value: 9999, end_time: "2026-11-14T08:00:00+0000" }] },
        { name: "page_something_new", period: "day", values: [{ value: 1, end_time: "2026-11-14T08:00:00+0000" }] },
      ],
    });
    expect(rows.rows).toEqual([
      { day: "2026-11-12", metric: "views", value: 410 },
      { day: "2026-11-13", metric: "views", value: 390 },
      { day: "2026-11-13", metric: "followers", value: 1810 },
      { day: "2026-11-13", metric: "profile_taps", value: 5 },
    ]);
    expect(rows.seen).toEqual(["page_media_view", "page_follows", "page_total_actions", "page_something_new"]);
    expect(parsePageInsights({ data: [] })).toEqual({ rows: [], seen: [] });
  });
});

describe("posts and reels", () => {
  const media = {
    data: [
      { id: "m1", caption: "Trivia night is back this Thursday.\nTeams of up to six, starts at 7.", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://www.instagram.com/reel/abc/", thumbnail_url: "https://cdn.example/t1.jpg", media_url: "https://cdn.example/v1.mp4", timestamp: "2026-11-03T18:22:10+0000", like_count: 88, comments_count: 6 },
      { id: "m2", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", permalink: "https://www.instagram.com/p/def/", media_url: "https://cdn.example/i2.jpg", timestamp: "2026-11-01T15:00:00+0000" },
      { id: "m3", media_type: "IMAGE", media_product_type: "FEED", timestamp: "not a date" },
      { caption: "no id" },
    ],
  };
  it("reads the business's own posts: kind, when, a short caption, link and picture", () => {
    const list = parseIgMedia(media);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ externalId: "m1", postedAt: "2026-11-03T18:22:10.000Z", kind: "reel", caption: "Trivia night is back this Thursday. Teams of up to six, starts at 7.", permalink: "https://www.instagram.com/reel/abc/", thumbnailUrl: "https://cdn.example/t1.jpg", likes: 88, comments: 6, shares: null });
    // A photo's own address is its picture; a video's is not.
    expect(list[1]).toMatchObject({ externalId: "m2", kind: "carousel", caption: null, thumbnailUrl: "https://cdn.example/i2.jpg", likes: null, comments: null });
  });
  it("keeps captions short", () => {
    const long = parseIgMedia({ data: [{ id: "x", media_type: "IMAGE", timestamp: "2026-11-03T18:22:10+0000", caption: "word ".repeat(200) }] })[0];
    expect(long.caption!.length).toBeLessThanOrEqual(220);
    expect(long.caption!.endsWith("…")).toBe(true);
  });
  it("asks a reel and a feed post for the numbers each one has", () => {
    expect(igMediaMetrics("reel")).toContain("ig_reels_avg_watch_time");
    expect(igMediaMetrics("reel")).not.toContain("profile_visits");
    expect(igMediaMetrics("post")).toContain("profile_visits");
    for (const k of ["reel", "post", "carousel", "video"] as const) {
      expect(igMediaMetrics(k)).toEqual(expect.arrayContaining(["views", "reach", "likes", "comments", "saved", "shares"]));
      for (const gone of ["impressions", "plays", "video_views", "clips_replays_count"]) expect(igMediaMetrics(k)).not.toContain(gone);
    }
  });
  const v = (name: string, value: number) => ({ name, period: "lifetime", values: [{ value }] });
  it("reads a post's numbers", () => {
    const n = parseMediaInsights({ data: [v("views", 3400), v("reach", 2100), v("likes", 120), v("comments", 8), v("saved", 14), v("shares", 22), v("total_interactions", 164), v("profile_visits", 31), v("follows", 4), v("ig_reels_avg_watch_time", 6200)] });
    expect(n).toEqual({ views: 3400, reach: 2100, likes: 120, comments: 8, saves: 14, shares: 22, interactions: 164, profileVisits: 31, follows: 4, extra: { avgWatchSeconds: 6.2 }, any: true });
  });
  it("a post with no insights yet has no numbers, rather than zeros", () => {
    const none = parseMediaInsights({ data: [] });
    expect(none).toEqual({ views: null, reach: null, likes: null, comments: null, saves: null, shares: null, interactions: null, profileVisits: null, follows: null, extra: null, any: false });
    // The like and comment counts that came with the post still show.
    const base = parseIgMedia(media)[0];
    expect(mergePostNumbers(base, none)).toMatchObject({ views: null, reach: null, likes: 88, comments: 6, interactions: null, hasInsights: false });
    expect(mergePostNumbers(base, parseMediaInsights({ data: [v("reach", 10), v("likes", 90)] }))).toMatchObject({ reach: 10, likes: 90, comments: 6, hasInsights: true });
  });
  it("reads the Page's posts without asking who reacted or commented", () => {
    const posts = parsePagePosts({
      data: [
        { id: "10_1", created_time: "2026-11-02T16:00:00+0000", message: "New on tap: a dry-hopped pilsner.", permalink_url: "https://www.facebook.com/10/posts/1", full_picture: "https://cdn.example/p1.jpg", status_type: "added_photos", shares: { count: 3 }, reactions: { data: [], summary: { total_count: 41 } }, comments: { data: [], summary: { total_count: 5 } } },
        { id: "10_2", created_time: "2026-11-01T16:00:00+0000", status_type: "added_video" },
        { id: "10_3", created_time: "2026-10-30T16:00:00+0000", status_type: "shared_story", message: "We're in the paper" },
      ],
    });
    expect(posts[0]).toEqual({ externalId: "10_1", postedAt: "2026-11-02T16:00:00.000Z", kind: "post", caption: "New on tap: a dry-hopped pilsner.", permalink: "https://www.facebook.com/10/posts/1", thumbnailUrl: "https://cdn.example/p1.jpg", likes: 41, comments: 5, shares: 3 });
    expect(posts.map((p) => p.kind)).toEqual(["post", "video", "link"]);
    expect(posts[1]).toMatchObject({ likes: null, comments: null, shares: null, caption: null });
  });
  it("reads a Page post's numbers under the same names", () => {
    const n = parsePostInsights({ data: [v("post_media_view", 900), v("post_total_media_view_unique", 640), v("post_clicks", 37), { name: "post_reactions_by_type_total", period: "lifetime", values: [{ value: { like: 30, love: 8, haha: 1 } }] }] });
    expect(n).toMatchObject({ views: 900, reach: 640, likes: 39, extra: { clicks: 37 }, any: true });
    expect(parsePostInsights({ data: [] }).any).toBe(false);
  });
});

describe("which days a sync reads", () => {
  it("reads a month the first time, then the last few days so late numbers are corrected", () => {
    expect(recentWindow("2026-11-16", null)).toEqual({ from: "2026-10-17", to: "2026-11-15" });
    expect(recentWindow("2026-11-16", "2026-11-15")).toEqual({ from: "2026-11-11", to: "2026-11-15" });
    // After a gap, everything since the last good day (and a little before it).
    expect(recentWindow("2026-11-16", "2026-11-01")).toEqual({ from: "2026-10-28", to: "2026-11-15" });
    expect(recentWindow("2026-11-16", null, 4, 730).from).toBe("2024-11-16");
  });
  it("then works backwards a slice a night, until two years back", () => {
    expect(backfillWindow("2026-11-16", "2026-10-17", 60, 730)).toEqual({ from: "2026-08-18", to: "2026-10-16" });
    expect(backfillWindow("2026-11-16", "2024-11-20", 60, 730)).toEqual({ from: "2024-11-16", to: "2024-11-19" });
    expect(backfillWindow("2026-11-16", "2024-11-16", 60, 730)).toBeNull();
    expect(backfillWindow("2026-11-16", null, 60, 730)).toBeNull();
  });
  it("cuts a long range into pieces the API accepts", () => {
    expect(chunkDays("2026-01-01", "2026-01-10", 4)).toEqual([{ from: "2026-01-01", to: "2026-01-04" }, { from: "2026-01-05", to: "2026-01-08" }, { from: "2026-01-09", to: "2026-01-10" }]);
    expect(chunkDays("2026-01-02", "2026-01-01", 4)).toEqual([]);
  });
});

describe("a run, step by step", () => {
  const kindOf = (e: unknown) => (e as { kind: "auth" | "transient" | "rate" }).kind;
  const say = (e: unknown) => (e as Error).message;
  const fail = (kind: string, message: string) => Object.assign(new Error(message), { kind });
  it("runs every step and reports each", async () => {
    const ran: string[] = [];
    const r = await runSteps([{ name: "a", run: async () => void ran.push("a") }, { name: "b", run: async () => void ran.push("b") }], kindOf, say);
    expect(ran).toEqual(["a", "b"]);
    expect(r.stopped).toBeNull();
    expect(r.outcomes).toEqual([{ name: "a", status: "ok" }, { name: "b", status: "ok" }]);
  });
  it("one failed step is noted and the rest still run", async () => {
    const ran: string[] = [];
    const r = await runSteps(
      [
        { name: "a", run: async () => { throw fail("transient", "Facebook's service had a problem."); } },
        { name: "b", run: async () => void ran.push("b") },
      ],
      kindOf,
      say,
    );
    expect(ran).toEqual(["b"]);
    expect(r.stopped).toBeNull();
    expect(r.outcomes).toEqual([{ name: "a", status: "failed", kind: "transient", error: "Facebook's service had a problem." }, { name: "b", status: "ok" }]);
  });
  it("a token that expires mid-sync stops the run, keeps what was done, and skips the rest", async () => {
    const ran: string[] = [];
    const r = await runSteps(
      [
        { name: "page numbers", run: async () => void ran.push("page numbers") },
        { name: "instagram numbers", run: async () => { ran.push("instagram numbers"); throw fail("auth", "Facebook says the sign-in has expired."); } },
        { name: "instagram posts", run: async () => void ran.push("instagram posts") },
        { name: "page posts", run: async () => void ran.push("page posts") },
      ],
      kindOf,
      say,
    );
    expect(ran).toEqual(["page numbers", "instagram numbers"]);
    expect(r.stopped).toEqual({ step: "instagram numbers", kind: "auth", message: "Facebook says the sign-in has expired." });
    expect(r.outcomes.map((o) => o.status)).toEqual(["ok", "failed", "skipped", "skipped"]);
  });
  it("being throttled stops the run too, so the limit isn't made worse", async () => {
    const r = await runSteps([{ name: "a", run: async () => { throw fail("rate", "slow down"); } }, { name: "b", run: async () => undefined }], kindOf, say);
    expect(r.stopped?.kind).toBe("rate");
    expect(r.outcomes[1].status).toBe("skipped");
  });
});
