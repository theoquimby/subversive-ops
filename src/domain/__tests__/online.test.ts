import { describe, expect, it } from "vitest";
import {
  alignToData,
  channelOf,
  compare,
  coverage,
  delta,
  listingState,
  listingViews,
  nextSteps,
  ONLINE_RANGES,
  parseRange,
  rangeWindows,
  ratio,
  reviewSummary,
  searchState,
  signInState,
  sourceMix,
  sumByMetric,
  sumDays,
  trendPoints,
  websiteState,
  worthALook,
  type GoogleFacts,
  type LookInput,
} from "../online";

const days = (from: string, values: number[]) => values.map((value, i) => ({ day: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), value }));

describe("ranges", () => {
  it("offers 7 days, 28 days, 3 months and 12 months, all whole weeks", () => {
    expect(ONLINE_RANGES.map((r) => r.label)).toEqual(["7 days", "28 days", "3 months", "12 months"]);
    for (const r of ONLINE_RANGES) expect(r.days % 7, r.id).toBe(0);
  });
  it("reads ?range= and falls back to 28 days", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("12m")).toBe("12m");
    expect(parseRange(undefined)).toBe("28d");
    expect(parseRange("")).toBe("28d");
    expect(parseRange("90d")).toBe("28d");
    expect(parseRange(["3m", "7d"])).toBe("3m");
  });
  it("ends on yesterday (today is only part of a day) and compares with the same length before", () => {
    const w = rangeWindows("28d", "2026-11-15");
    expect(w.cur).toEqual({ from: "2026-10-18", to: "2026-11-14", days: 28 });
    expect(w.prev).toEqual({ from: "2026-09-20", to: "2026-10-17", days: 28 });
    const y = rangeWindows("12m", "2026-11-15");
    expect(y.cur.days).toBe(364);
    expect(y.prev.to).toBe("2025-11-15");
  });
});

describe("lining a window up with a source that runs behind", () => {
  const w = rangeWindows("7d", "2026-11-15");
  it("leaves the window alone when the data is up to date", () => {
    expect(alignToData(w, "2026-11-14")).toMatchObject({ cur: w.cur, prev: w.prev, lag: 0, stale: false, through: "2026-11-14" });
    expect(alignToData(w, "2026-11-15").cur).toEqual(w.cur);
  });
  it("slides both periods back by the lag, so missing days don't read as a drop", () => {
    const a = alignToData(w, "2026-11-12");
    expect(a.lag).toBe(2);
    expect(a.cur).toEqual({ from: "2026-11-06", to: "2026-11-12", days: 7 });
    expect(a.prev).toEqual({ from: "2026-10-30", to: "2026-11-05", days: 7 });
    expect(a.stale).toBe(false);
  });
  it("calls a source stale, and does not slide, when it is further behind than a normal delay", () => {
    const a = alignToData(w, "2026-10-20");
    expect(a.stale).toBe(true);
    expect(a.cur).toEqual(w.cur);
    expect(a.through).toBe("2026-10-20");
  });
  it("copes with a source that has no data at all", () => {
    expect(alignToData(w, null)).toMatchObject({ cur: w.cur, lag: 0, stale: false, through: null });
  });
});

describe("coverage of a period", () => {
  const span = { from: "2026-10-18", to: "2026-11-14", days: 28 };
  it("is full when the data starts on or before the first day", () => {
    expect(coverage(span, "2026-10-18")).toEqual({ kind: "full", since: null, days: 28 });
    expect(coverage(span, "2025-01-01").kind).toBe("full");
  });
  it("is partial when the data starts inside the period", () => {
    expect(coverage(span, "2026-11-08")).toEqual({ kind: "partial", since: "2026-11-08", days: 7 });
  });
  it("is none with no data, or data that only starts afterwards", () => {
    expect(coverage(span, null)).toEqual({ kind: "none", since: null, days: 0 });
    expect(coverage(span, "2026-11-15").kind).toBe("none");
  });
});

describe("period over period", () => {
  it("gives the change as a share of the period before", () => {
    expect(delta(150, 100)).toMatchObject({ cur: 150, prev: 100, change: 0.5, trend: "up", clear: true });
    expect(delta(60, 100)).toMatchObject({ change: -0.4, trend: "down", clear: true });
  });
  it("has no change to show when there was no period before", () => {
    expect(delta(150, null)).toEqual({ cur: 150, prev: null, change: null, clear: false, trend: null });
  });
  it("never divides by zero", () => {
    expect(delta(12, 0)).toMatchObject({ change: null, trend: "new" });
    expect(delta(0, 0)).toMatchObject({ change: null, trend: "same", clear: false });
    expect(delta(0, 40)).toMatchObject({ change: -1, trend: "down", clear: true });
  });
  it("calls small wobbles about the same", () => {
    // 9 against 7 is +29%, on numbers too small to mean anything.
    expect(delta(9, 7)).toMatchObject({ trend: "same", clear: false });
    // 1,020 against 1,000 is inside normal ups and downs.
    expect(delta(1020, 1000)).toMatchObject({ trend: "same", clear: false });
  });
  it("only compares against a period the data fully covers", () => {
    expect(compare(150, 100, "full").change).toBe(0.5);
    expect(compare(150, 40, "partial")).toMatchObject({ prev: null, change: null, trend: null });
    expect(compare(150, 0, "none")).toMatchObject({ prev: null, change: null, trend: null });
  });
  it("gives a rate, or nothing when there is nothing to divide by", () => {
    expect(ratio(25, 100)).toBe(0.25);
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(5, 0)).toBeNull();
  });
});

describe("trend points", () => {
  it("is one point a day for short ranges, with the same day of the period before", () => {
    const w = rangeWindows("7d", "2026-11-15");
    const pts = trendPoints(days("2026-11-08", [1, 2, 3, 4, 5, 6, 7]), days("2026-11-01", [7, 6, 5, 4, 3, 2, 1]), w);
    expect(pts).toHaveLength(7);
    expect(pts[0]).toEqual({ x: "2026-11-08", to: "2026-11-08", cur: 1, prev: 7 });
    expect(pts[6]).toEqual({ x: "2026-11-14", to: "2026-11-14", cur: 7, prev: 1 });
  });
  it("fills days with nothing recorded as zero", () => {
    const w = rangeWindows("7d", "2026-11-15");
    const pts = trendPoints([{ day: "2026-11-10", value: 4 }], [], w);
    expect(pts.map((p) => p.cur)).toEqual([0, 0, 4, 0, 0, 0, 0]);
    expect(pts.every((p) => p.prev === 0)).toBe(true);
  });
  it("is one point a week for longer ranges", () => {
    const w = rangeWindows("3m", "2026-11-15");
    const pts = trendPoints(days(w.cur.from, Array(91).fill(2)), days(w.prev.from, Array(91).fill(1)), w);
    expect(pts).toHaveLength(13);
    expect(pts[0]).toEqual({ x: w.cur.from, to: "2026-08-22", cur: 14, prev: 7 });
    expect(pts[12].to).toBe(w.cur.to);
  });
  it("leaves the period before out when there isn't one", () => {
    const w = rangeWindows("7d", "2026-11-15");
    expect(trendPoints(days("2026-11-08", [1, 1, 1, 1, 1, 1, 1]), null, w).every((p) => p.prev === null)).toBe(true);
  });
  it("starts where the data starts, not with made-up zeros", () => {
    const w = rangeWindows("28d", "2026-11-15");
    const pts = trendPoints(days("2026-11-10", [3, 3, 3, 3, 3]), null, w, "2026-11-10");
    expect(pts.map((p) => p.x)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]);
  });
  it("is empty with no data and no window to fill", () => {
    const w = rangeWindows("7d", "2026-11-15");
    expect(trendPoints([], null, w, "2026-12-01")).toEqual([]);
  });
  it("adds up the days inside a span only", () => {
    expect(sumDays(days("2026-11-01", [1, 2, 3, 4]), { from: "2026-11-02", to: "2026-11-03", days: 2 })).toBe(5);
    expect(sumDays([], { from: "2026-11-02", to: "2026-11-03", days: 2 })).toBe(0);
  });
});

describe("where website visits came from", () => {
  it("groups sources into a few plain channels", () => {
    expect(channelOf("google")).toBe("google-search");
    expect(channelOf("google-maps")).toBe("google-listing");
    expect(channelOf("google-business")).toBe("google-listing");
    expect(channelOf("bing")).toBe("search-other");
    expect(channelOf("apple-maps")).toBe("search-other");
    expect(channelOf("instagram")).toBe("social");
    expect(channelOf("direct")).toBe("direct");
    expect(channelOf("newsletter")).toBe("email");
    expect(channelOf("yelp")).toBe("listings");
    expect(channelOf("hudsonvalleyone.com")).toBe("other");
    expect(channelOf("(not set)")).toBe("other");
  });
  it("gives each channel its visits and share, biggest first", () => {
    const m = sourceMix([
      { source: "google", visits: 50 },
      { source: "google-maps", visits: 20 },
      { source: "google-business", visits: 10 },
      { source: "direct", visits: 15 },
      { source: "instagram", visits: 5 },
    ]);
    expect(m.total).toBe(100);
    expect(m.parts.map((p) => [p.key, p.visits, p.share])).toEqual([
      ["google-search", 50, 0.5],
      ["google-listing", 30, 0.3],
      ["direct", 15, 0.15],
      ["social", 5, 0.05],
    ]);
    expect(m.parts[1].label).toBe("Google Maps and the listing");
  });
  it("folds the smallest channels into everything else", () => {
    const m = sourceMix(
      [
        { source: "google", visits: 40 },
        { source: "google-maps", visits: 30 },
        { source: "direct", visits: 20 },
        { source: "instagram", visits: 6 },
        { source: "yelp", visits: 3 },
        { source: "newsletter", visits: 1 },
      ],
      4,
    );
    expect(m.parts.map((p) => p.key)).toEqual(["google-search", "google-listing", "direct", "other"]);
    expect(m.parts[3].visits).toBe(10);
    expect(m.parts.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1);
  });
  it("is empty, not NaN, with no visits", () => {
    expect(sourceMix([])).toEqual({ total: 0, parts: [] });
    expect(sourceMix([{ source: "google", visits: 0 }])).toEqual({ total: 0, parts: [] });
  });
});

describe("the Google listing", () => {
  const rows = [
    { metric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS", value: 100 },
    { metric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS", value: 40 },
    { metric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", value: 20 },
    { metric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", value: 60 },
    { metric: "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", value: 30 },
    { metric: "CALL_CLICKS", value: 4 },
  ];
  it("adds up each metric", () => {
    expect(sumByMetric(rows)).toMatchObject({ BUSINESS_IMPRESSIONS_MOBILE_MAPS: 140, CALL_CLICKS: 4 });
    expect(sumByMetric([])).toEqual({});
  });
  it("splits views by Maps and Search, and by phone and computer", () => {
    expect(listingViews(sumByMetric(rows))).toEqual({ total: 250, maps: 160, search: 90, phone: 200, computer: 50 });
    expect(listingViews({})).toEqual({ total: 0, maps: 0, search: 0, phone: 0, computer: 0 });
  });
});

describe("what people did next", () => {
  const listing = { cur: { BUSINESS_DIRECTION_REQUESTS: 300, CALL_CLICKS: 60, WEBSITE_CLICKS: 150, BUSINESS_FOOD_MENU_CLICKS: 90, BUSINESS_BOOKINGS: 0 }, prev: { BUSINESS_DIRECTION_REQUESTS: 200, CALL_CLICKS: 60, WEBSITE_CLICKS: 100, BUSINESS_FOOD_MENU_CLICKS: 90, BUSINESS_BOOKINGS: 0 } };
  const website = { cur: { click_directions: 80, click_call: 20, click_order_online: 12, ticket_click: 5, rsvp_click: 3, inquiry_submit: 2, menu_view: 400 }, prev: { click_directions: 100, click_call: 20, click_order_online: 0, ticket_click: 4, rsvp_click: 4, inquiry_submit: 1, menu_view: 380 } };
  it("puts the same intent side by side for the listing and the website", () => {
    const steps = nextSteps({ listing, website });
    expect(steps.map((s) => s.key)).toEqual(["directions", "call", "site", "menu", "order", "tickets", "inquiry"]);
    const dir = steps[0];
    expect(dir.listing).toMatchObject({ cur: 300, prev: 200, change: 0.5 });
    expect(dir.website).toMatchObject({ cur: 80, prev: 100 });
    expect(dir.website!.change).toBeCloseTo(-0.2);
    expect(steps.find((s) => s.key === "site")).toMatchObject({ website: null, listing: { cur: 150 } });
    expect(steps.find((s) => s.key === "tickets")!.website).toMatchObject({ cur: 8, prev: 8 });
    expect(steps.find((s) => s.key === "order")!.website).toMatchObject({ cur: 12, change: null, trend: "new" });
  });
  it("leaves bookings out until there are some", () => {
    expect(nextSteps({ listing, website }).some((s) => s.key === "booking")).toBe(false);
    const withBookings = nextSteps({ listing: { ...listing, cur: { ...listing.cur, BUSINESS_BOOKINGS: 3 } }, website });
    expect(withBookings.find((s) => s.key === "booking")!.listing).toMatchObject({ cur: 3 });
  });
  it("shows the website's side alone while the listing is not connected, and the other way round", () => {
    const web = nextSteps({ listing: null, website });
    expect(web.map((s) => s.key)).toEqual(["directions", "call", "menu", "order", "tickets", "inquiry"]);
    expect(web.every((s) => s.listing === null)).toBe(true);
    const gbp = nextSteps({ listing, website: null });
    expect(gbp.map((s) => s.key)).toEqual(["directions", "call", "site", "menu"]);
  });
  it("has no change to show when a source has no period before", () => {
    const steps = nextSteps({ listing: { cur: listing.cur, prev: null }, website });
    expect(steps[0].listing).toMatchObject({ cur: 300, prev: null, change: null });
  });
  it("is empty with nothing connected", () => {
    expect(nextSteps({ listing: null, website: null })).toEqual([]);
  });
});

describe("reviews", () => {
  const w = rangeWindows("28d", "2026-11-15");
  const r = (day: string, rating: number) => ({ day, rating });
  it("gives the 90-day rating, how many came in, and the rating in each period", () => {
    const s = reviewSummary([r("2026-11-10", 5), r("2026-11-02", 4), r("2026-10-20", 3), r("2026-10-10", 5), r("2026-10-01", 5), r("2026-09-25", 5), r("2026-06-01", 1)], w, "2026-11-15");
    expect(s.rating).toBeCloseTo(4.5);
    expect(s.ratingCount).toBe(6);
    expect(s.total).toBe(7);
    expect(s.inPeriod).toMatchObject({ cur: 3, prev: 3 });
    expect(s.avg).toBe(4);
    expect(s.prevAvg).toBe(5);
    expect(s.ratingChange).toBe(-1);
  });
  it("does not compare ratings built on one or two reviews", () => {
    const s = reviewSummary([r("2026-11-10", 1), r("2026-10-10", 5), r("2026-10-01", 5), r("2026-09-25", 5)], w, "2026-11-15");
    expect(s.avg).toBe(1);
    expect(s.ratingChange).toBeNull();
  });
  it("has nothing to compare when reviews only started in this period", () => {
    const s = reviewSummary([r("2026-11-10", 5), r("2026-11-01", 4)], w, "2026-11-15");
    expect(s.inPeriod).toMatchObject({ cur: 2, prev: null, change: null });
    expect(s.prevAvg).toBeNull();
  });
  it("is all empty with no reviews", () => {
    expect(reviewSummary([], w, "2026-11-15")).toMatchObject({ rating: null, ratingCount: 0, total: 0, avg: null, prevAvg: null, ratingChange: null, inPeriod: { cur: 0, prev: null } });
  });
});

const facts = (patch: Partial<GoogleFacts> = {}): GoogleFacts => ({ connected: true, needsReconnect: false, searchAllowed: true, listingAllowed: true, siteUrl: "sc-domain:drinksubversive.com", location: null, hasSearchData: true, hasListingData: false, listingSynced: false, ...patch });

describe("what each block says when its source isn't ready", () => {
  it("says the listing is waiting on Google's approval, and what will show", () => {
    const s = listingState(facts());
    expect(s.kind).toBe("waiting");
    expect(s.title).toBe("Waiting on Google's approval");
    expect(s.body).toMatch(/Search and Maps/);
    expect(s.body).toMatch(/calls, direction requests and website clicks/);
    expect(s.href).toBe("/settings/connections/google");
  });
  it("adds what to do when the listing wasn't allowed at sign-in", () => {
    expect(listingState(facts({ listingAllowed: false })).body).toMatch(/connect Google again/i);
  });
  it("is ready as soon as there are numbers, whatever the connection says", () => {
    expect(listingState(facts({ hasListingData: true })).kind).toBe("ready");
    expect(listingState(facts({ hasListingData: true, connected: false })).kind).toBe("ready");
    expect(searchState(facts()).kind).toBe("ready");
  });
  it("asks to connect, connect again, or pick the website", () => {
    expect(listingState(facts({ connected: false })).kind).toBe("connect");
    expect(searchState(facts({ connected: false, hasSearchData: false, siteUrl: null }))).toMatchObject({ kind: "connect", href: "/settings/connections/google", action: "Connect Google" });
    expect(searchState(facts({ needsReconnect: true, connected: false, hasSearchData: false })).kind).toBe("reconnect");
    expect(listingState(facts({ needsReconnect: true, connected: false })).kind).toBe("reconnect");
    expect(searchState(facts({ hasSearchData: false, siteUrl: null })).kind).toBe("pick");
    expect(searchState(facts({ hasSearchData: false })).kind).toBe("syncing");
  });
  it("says a synced listing with no rows has nothing yet", () => {
    expect(listingState(facts({ location: "locations/1", listingSynced: true })).kind).toBe("empty");
  });
  it("points the website at its tracking setup", () => {
    expect(websiteState({ hasVisits: true, hasAddress: true }).kind).toBe("ready");
    expect(websiteState({ hasVisits: false, hasAddress: false })).toMatchObject({ kind: "setup", href: "/website/analytics#tracking" });
    expect(websiteState({ hasVisits: false, hasAddress: true }).title).toBe("Waiting for the first visit");
  });
});

describe("worth a look", () => {
  const ready = { kind: "ready" as const, title: "", body: "", href: null, action: null };
  const base = (patch: Partial<LookInput> = {}): LookInput => ({ period: "28 days", metrics: [], states: [], stale: [], rating: { cur: null, prev: null }, needReply: 0, ...patch });
  it("is empty when nothing stands out", () => {
    expect(worthALook(base())).toEqual([]);
    expect(worthALook(base({ metrics: [{ key: "visits", label: "Website visits", delta: delta(1020, 1000), href: "/website/analytics" }], states: [{ key: "search", state: ready }] }))).toEqual([]);
  });
  it("raises a metric that is down sharply, with both numbers and a link", () => {
    const out = worthALook(base({ metrics: [{ key: "dir", label: "Direction requests from the listing", delta: delta(200, 320), href: "/online/google" }] }));
    expect(out).toEqual([{ key: "down-dir", tone: "warn", title: "Direction requests from the listing are down 38%", detail: "200 in the last 28 days, 320 in the 28 days before.", href: "/online/google" }]);
  });
  it("marks a halving as serious, and ignores drops on tiny numbers", () => {
    expect(worthALook(base({ metrics: [{ key: "v", label: "Website visits", delta: delta(400, 1000), href: "/website/analytics" }] }))[0].tone).toBe("bad");
    expect(worthALook(base({ metrics: [{ key: "c", label: "Calls from the listing", delta: delta(3, 6), href: "/online/google" }] }))).toEqual([]);
  });
  it("ignores a metric with no period before or a zero before", () => {
    expect(worthALook(base({ metrics: [{ key: "a", label: "Website visits", delta: delta(500, null), href: "/x" }, { key: "b", label: "Calls", delta: delta(50, 0), href: "/x" }] }))).toEqual([]);
  });
  it("mentions a sharp rise too, after the things that need attention", () => {
    const out = worthALook(base({ metrics: [{ key: "up", label: "Website visits", delta: delta(1500, 1000), href: "/website/analytics" }, { key: "dn", label: "Calls from the listing", delta: delta(40, 80), href: "/online/google" }] }));
    expect(out.map((i) => [i.key, i.tone])).toEqual([["down-dn", "bad"], ["up-up", "good"]]);
    expect(out[1].title).toBe("Website visits are up 50%");
  });
  it("lists a source that still needs setting up, but not one that is only waiting on Google", () => {
    const out = worthALook(base({ states: [{ key: "search", state: searchState(facts({ connected: false, hasSearchData: false })) }, { key: "listing", state: listingState(facts()) }, { key: "website", state: websiteState({ hasVisits: false, hasAddress: false }) }] }));
    expect(out.map((i) => i.key)).toEqual(["setup-search", "setup-website"]);
    expect(out[0]).toMatchObject({ tone: "neutral", href: "/settings/connections/google" });
    expect(out[1].href).toBe("/website/analytics#tracking");
  });
  it("warns when a sign-in has expired or a source has stopped updating", () => {
    const out = worthALook(base({ states: [{ key: "search", state: searchState(facts({ needsReconnect: true, connected: false, hasSearchData: false })) }], stale: [{ key: "listing", label: "The Google listing's numbers", through: "2026-10-20", href: "/settings/connections/google" }] }));
    expect(out.map((i) => [i.key, i.tone])).toEqual([["setup-search", "warn"], ["stale-listing", "warn"]]);
    expect(out[1].title).toBe("The Google listing's numbers stopped on Oct 20");
  });
  it("says an expired sign-in once, however many sources it stops", () => {
    const f = facts({ needsReconnect: true, connected: false, hasSearchData: false });
    const out = worthALook(base({ states: [{ key: "google", state: signInState(f) }, { key: "search", state: searchState(f) }, { key: "listing", state: listingState(f) }] }));
    expect(out.map((i) => i.key)).toEqual(["setup-google"]);
    expect(signInState(facts()).kind).toBe("ready");
  });
  it("raises a slipping rating and reviews waiting for a reply", () => {
    const out = worthALook(base({ rating: { cur: 4.1, prev: 4.6 }, needReply: 2 }));
    expect(out.map((i) => i.key)).toEqual(["rating", "reply"]);
    expect(out[0].title).toBe("The rating slipped to 4.1 from 4.6");
    expect(out[1]).toMatchObject({ title: "2 reviews are waiting for a reply", href: "/reviews?show=open" });
    expect(worthALook(base({ rating: { cur: 4.5, prev: 4.6 }, needReply: 1 }))[0].title).toBe("1 review is waiting for a reply");
  });
  it("keeps the list short, most serious first", () => {
    const metrics = Array.from({ length: 9 }, (_, i) => ({ key: `m${i}`, label: `Metric ${i}`, delta: delta(100, i === 8 ? 400 : 160), href: "/x" }));
    const out = worthALook(base({ metrics }));
    expect(out).toHaveLength(6);
    expect(out[0].key).toBe("down-m8");
  });
});
