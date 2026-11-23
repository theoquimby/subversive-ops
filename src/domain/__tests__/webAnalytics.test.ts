import { describe, expect, it } from "vitest";
import {
  changeIsClear,
  classifySource,
  continuesVisit,
  conversionRates,
  createRateLimiter,
  daysToRoll,
  deviceClass,
  expandOrigins,
  funnel,
  parsePeriod,
  PERIODS,
  inquiryAttribution,
  isBot,
  KEY_SEP,
  normalizeOrigin,
  normalizePath,
  parsePayload,
  periods,
  retentionCutoff,
  rollupDay,
  saltIsCurrent,
  sessionId,
  sumByKey,
  visitorHash,
  wilson,
  type RollupHit,
} from "../webAnalytics";

const SITE = ["drinksubversive.com"];
const src = (url: string, referrer?: string) => {
  const a = classifySource({ url, referrer, siteHosts: SITE });
  return `${a.source}/${a.medium}`;
};

describe("source and medium", () => {
  it("reads search engines, maps and social from the referrer", () => {
    expect(src("https://drinksubversive.com/", "https://www.google.com/")).toBe("google/organic");
    expect(src("https://drinksubversive.com/", "https://www.google.co.uk/")).toBe("google/organic");
    expect(src("https://drinksubversive.com/", "https://www.google.com/maps/place/Subversive")).toBe("google-maps/maps");
    expect(src("https://drinksubversive.com/", "https://maps.google.com/")).toBe("google-maps/maps");
    expect(src("https://drinksubversive.com/", "android-app://com.google.android.googlequicksearchbox/")).toBe("google/organic");
    expect(src("https://drinksubversive.com/", "https://l.instagram.com/")).toBe("instagram/social");
    expect(src("https://drinksubversive.com/", "https://lm.facebook.com/l.php")).toBe("facebook/social");
    expect(src("https://drinksubversive.com/", "https://t.co/abc")).toBe("x/social");
    expect(src("https://drinksubversive.com/", "https://duckduckgo.com/")).toBe("duckduckgo/organic");
    expect(src("https://drinksubversive.com/", "https://www.yelp.com/biz/subversive")).toBe("yelp/listing");
    expect(src("https://drinksubversive.com/", "https://untappd.com/v/subversive")).toBe("untappd/listing");
    expect(src("https://drinksubversive.com/", "https://maps.apple.com/")).toBe("apple-maps/maps");
  });
  it("UTM tags win over the referrer, with friendly aliases", () => {
    expect(src("https://drinksubversive.com/?utm_source=gbp&utm_medium=organic", "https://www.google.com/")).toBe("google-business/maps");
    expect(src("https://drinksubversive.com/?utm_source=GMB")).toBe("google-business/maps");
    expect(src("https://drinksubversive.com/?utm_source=ig&utm_medium=bio")).toBe("instagram/social");
    expect(src("https://drinksubversive.com/?utm_source=newsletter&utm_medium=email&utm_campaign=oktoberfest")).toBe("newsletter/email");
    expect(src("https://drinksubversive.com/?utm_source=poster&utm_medium=qr")).toBe("poster/other");
    const a = classifySource({ url: "https://drinksubversive.com/?utm_source=fb&utm_campaign=Trivia%20Night&utm_content=story", siteHosts: SITE });
    expect(a).toMatchObject({ source: "facebook", medium: "social", campaign: "Trivia Night", content: "story" });
  });
  it("click ids mean ads", () => {
    expect(src("https://drinksubversive.com/?gclid=abc")).toBe("google/paid");
    expect(src("https://drinksubversive.com/?msclkid=abc")).toBe("bing/paid");
    expect(src("https://drinksubversive.com/?fbclid=abc")).toBe("facebook/social");
  });
  it("no referrer is direct; our own site is internal; anything else is a referral by host", () => {
    expect(src("https://drinksubversive.com/")).toBe("direct/direct");
    expect(src("https://drinksubversive.com/menu", "https://www.drinksubversive.com/")).toBe("direct/internal");
    expect(src("https://drinksubversive.com/", "https://www.hudsonvalleyone.com/best-breweries")).toBe("hudsonvalleyone.com/referral");
    expect(classifySource({ url: "https://drinksubversive.com/", referrer: "https://www.timesunion.com/x?y", siteHosts: SITE }).referrer).toBe("timesunion.com");
  });
  it("tolerates junk", () => {
    expect(src("not a url", "also not")).toBe("direct/direct");
  });
});

describe("bot filtering", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  it("lets real browsers through", () => {
    expect(isBot({ ua: iphone, acceptLanguage: "en-US" })).toBe(false);
    expect(isBot({ ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", acceptLanguage: "en" })).toBe(false);
  });
  it("drops crawlers, previews, scripts, headless browsers and prefetches", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
      "curl/8.4.0",
      "python-requests/2.31",
      "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome-Lighthouse",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)",
      "",
    ])
      expect(isBot({ ua, acceptLanguage: "en" }), ua).toBe(true);
    expect(isBot({ ua: iphone, acceptLanguage: "en", purpose: "prefetch" })).toBe(true);
    expect(isBot({ ua: iphone, acceptLanguage: null })).toBe(true);
  });
});

describe("visitor hash and the daily salt", () => {
  it("is stable within a day, different across salts, and never contains the IP", () => {
    const a = visitorHash("salt-day-1-xxxxxxxxxxxxxxxxxxxxxxxx", "drinksubversive.com", "203.0.113.9", "UA");
    expect(visitorHash("salt-day-1-xxxxxxxxxxxxxxxxxxxxxxxx", "drinksubversive.com", "203.0.113.9", "UA")).toBe(a);
    expect(visitorHash("salt-day-2-xxxxxxxxxxxxxxxxxxxxxxxx", "drinksubversive.com", "203.0.113.9", "UA")).not.toBe(a);
    expect(visitorHash("salt-day-1-xxxxxxxxxxxxxxxxxxxxxxxx", "drinksubversive.com", "203.0.113.10", "UA")).not.toBe(a);
    expect(a).not.toContain("203");
    expect(a).toHaveLength(22);
  });
  it("rotates: a salt is only good for its own day", () => {
    const s = { day: "2026-11-15", salt: "x".repeat(43) };
    expect(saltIsCurrent(s, "2026-11-15")).toBe(true);
    expect(saltIsCurrent(s, "2026-11-16")).toBe(false);
    expect(saltIsCurrent({ day: "2026-11-15", salt: "short" }, "2026-11-15")).toBe(false);
    expect(saltIsCurrent(null, "2026-11-15")).toBe(false);
  });
  it("continues a visit within 30 minutes unless they came back from somewhere new", () => {
    const t = new Date("2026-11-15T20:00:00Z");
    const internal = classifySource({ url: "https://drinksubversive.com/menu", referrer: "https://drinksubversive.com/", siteHosts: SITE });
    const fromGoogle = classifySource({ url: "https://drinksubversive.com/", referrer: "https://www.google.com/", siteHosts: SITE });
    expect(continuesVisit({ at: new Date(t.getTime() - 10 * 60_000) }, t, internal)).toBe(true);
    expect(continuesVisit({ at: new Date(t.getTime() - 31 * 60_000) }, t, internal)).toBe(false);
    expect(continuesVisit({ at: new Date(t.getTime() - 5 * 60_000) }, t, fromGoogle)).toBe(false);
    expect(continuesVisit(null, t, internal)).toBe(false);
    expect(sessionId("v", t)).not.toBe(sessionId("v", new Date(t.getTime() + 1)));
  });
});

describe("payload, paths, origins, devices, limits", () => {
  it("accepts the tiny beacon and rejects anything else", () => {
    expect(parsePayload(JSON.stringify({ n: "pageview", u: "https://drinksubversive.com/menu?x=1", r: "https://www.google.com/", w: 390 }))).toMatchObject({ n: "pageview", w: 390 });
    expect(parsePayload(JSON.stringify({ n: "click_call", u: "https://drinksubversive.com/visit", p: { label: "Call", bad: { nested: 1 }, "x y": 1 } }))?.p).toEqual({ label: "Call" });
    expect(parsePayload(JSON.stringify({ n: "made_up", u: "https://drinksubversive.com/" }))).toBeNull();
    expect(parsePayload(JSON.stringify({ n: "pageview", u: "javascript:alert(1)" }))).toBeNull();
    expect(parsePayload("{")).toBeNull();
    expect(parsePayload("x".repeat(3000))).toBeNull();
  });
  it("normalizes paths", () => {
    expect(normalizePath("/events/trivia-night/")).toBe("/events/trivia-night");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("//menu")).toBe("/menu");
    expect(normalizePath("/menu?show=food#x")).toBe("/menu");
  });
  it("normalizes origins and adds the www twin", () => {
    expect(normalizeOrigin("drinksubversive.com/")).toBe("https://drinksubversive.com");
    expect(normalizeOrigin("  ")).toBeNull();
    expect(expandOrigins(["https://www.drinksubversive.com"]).sort()).toEqual(["https://drinksubversive.com", "https://www.drinksubversive.com"]);
    expect(expandOrigins(["http://localhost:3100"])).toEqual(["http://localhost:3100"]);
  });
  it("classifies devices", () => {
    expect(deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile/15E148 Safari/604.1", 390)).toBe("mobile");
    expect(deviceClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 820)).toBe("tablet");
    expect(deviceClass("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120 Safari/537.36", 1200)).toBe("tablet");
    expect(deviceClass("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 820)).toBe("tablet");
    expect(deviceClass("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36", 1440)).toBe("desktop");
  });
  it("rate limits per key per minute", () => {
    const ok = createRateLimiter(3, 60_000);
    expect([1, 2, 3, 4].map(() => ok("a", 1000))).toEqual([true, true, true, false]);
    expect(ok("b", 1000)).toBe(true);
    expect(ok("a", 61_001)).toBe(true);
  });
});

const T = (min: number) => new Date(Date.UTC(2026, 10, 14, 20, min));
const hit = (o: Partial<RollupHit> & { kind: string; session: string; at: Date }): RollupHit => ({
  path: "/",
  visitor: `v-${o.session}`,
  source: "google",
  medium: "organic",
  campaign: null,
  referrer: null,
  device: "mobile",
  country: "US",
  region: "NY",
  city: "Catskill",
  ...o,
});

describe("daily rollups", () => {
  const hits: RollupHit[] = [
    // Visit 1 (Google): home → menu → directions
    hit({ session: "s1", at: T(0), kind: "pageview", path: "/" }),
    hit({ session: "s1", at: T(1), kind: "pageview", path: "/menu" }),
    hit({ session: "s1", at: T(2), kind: "menu_view", path: "/menu" }),
    hit({ session: "s1", at: T(3), kind: "click_directions", path: "/visit" }),
    // Visit 2 (Instagram): one event page, then a ticket click
    hit({ session: "s2", at: T(5), kind: "pageview", path: "/events/trivia", source: "instagram", medium: "social", device: "desktop" }),
    hit({ session: "s2", at: T(6), kind: "ticket_click", path: "/events/trivia", source: "instagram", medium: "social", device: "desktop" }),
    // Visit 3 (direct): a bounce
    hit({ session: "s3", at: T(7), kind: "pageview", path: "/", source: "direct", medium: "direct", city: null }),
    // Visit 4: same visitor as s1, second visit, just the menu
    hit({ session: "s4", visitor: "v-s1", at: T(50), kind: "pageview", path: "/menu" }),
  ];
  const rows = rollupDay(hits);
  const get = (dim: string, key: string) => rows.find((r) => r.dim === dim && r.key === key)!;

  it("totals: visits, people, views, bounces, interest and actions", () => {
    expect(get("total", "all")).toMatchObject({ sessions: 4, visitors: 3, views: 5, bounces: 2, engaged: 3, converted: 2, count: 2 });
  });
  it("credits each visit to its source, device and place", () => {
    expect(get("source", "google")).toMatchObject({ sessions: 2, visitors: 1, converted: 1, views: 3 });
    expect(get("source", "instagram")).toMatchObject({ sessions: 1, converted: 1, engaged: 1 });
    expect(get("device", "desktop").sessions).toBe(1);
    expect(get("city", `Catskill${KEY_SEP}NY${KEY_SEP}US`).sessions).toBe(3);
    expect(get("region", "US-NY").sessions).toBe(4);
  });
  it("pages count views, entries, bounces, and visits that went on to act", () => {
    expect(get("page", "/")).toMatchObject({ views: 2, entries: 2, bounces: 1, sessions: 2, converted: 1 });
    expect(get("page", "/menu")).toMatchObject({ views: 2, sessions: 2, converted: 1 });
    expect(get("page", "/events/trivia")).toMatchObject({ views: 1, converted: 1, count: 1 });
  });
  it("events by kind, source and page", () => {
    expect(get("event", "click_directions")).toMatchObject({ count: 1, sessions: 1 });
    expect(get("eventSource", `ticket_click${KEY_SEP}instagram`).count).toBe(1);
    expect(get("eventPage", `click_directions${KEY_SEP}/visit`).count).toBe(1);
    expect(get("action", "ticket_click")).toMatchObject({ count: 1, sessions: 1 });
    expect(rows.find((r) => r.dim === "action" && r.key === "menu_view")).toBeUndefined();
  });
  it("sums days by key, biggest first", () => {
    const s = sumByKey([{ key: "a", sessions: 2 }, { key: "b", sessions: 5 }, { key: "a", sessions: 4 }]);
    expect(s.map((r) => [r.key, r.sessions])).toEqual([["a", 6], ["b", 5]]);
  });
  it("an empty day has no rows", () => {
    expect(rollupDay([])).toEqual([{ dim: "total", key: "all", views: 0, visitors: 0, sessions: 0, entries: 0, bounces: 0, engaged: 0, converted: 0, count: 0 }]);
  });
});

describe("funnel and rates", () => {
  it("rates from the start and from the step before", () => {
    const f = funnel([
      { id: "v", label: "Visits", value: 1000 },
      { id: "i", label: "Interest", value: 400 },
      { id: "a", label: "Action", value: 100 },
    ]);
    expect(f.map((s) => s.ofStart)).toEqual([1, 0.4, 0.1]);
    expect(f.map((s) => s.ofPrev)).toEqual([null, 0.4, 0.25]);
    expect(funnel([{ id: "v", label: "", value: 0 }, { id: "a", label: "", value: 0 }])[1]).toMatchObject({ ofStart: null, ofPrev: null });
  });
  it("wilson ranges are sane", () => {
    const w = wilson(10, 100)!;
    expect(w.rate).toBe(0.1);
    expect(w.low).toBeGreaterThan(0.05);
    expect(w.high).toBeLessThan(0.17);
    expect(wilson(0, 0)).toBeNull();
  });
  it("only calls a source better or worse when the range says so, and never on a handful of visits", () => {
    const r = conversionRates(
      [
        { key: "google-maps", sessions: 400, converted: 120 },
        { key: "instagram", sessions: 400, converted: 12 },
        { key: "google", sessions: 400, converted: 44 },
        { key: "yelp", sessions: 12, converted: 6 },
      ],
      { sessions: 1212, converted: 182 },
    );
    expect(r.map((x) => x.vsAll)).toEqual(["above", "below", "below", "few"]);
    const same = conversionRates([{ key: "x", sessions: 100, converted: 15 }], { sessions: 1000, converted: 150 });
    expect(same[0].vsAll).toBe("same");
  });
  it("a change only counts as clear when it's beyond ordinary ups and downs", () => {
    expect(changeIsClear(12, 8)).toBe(false);
    expect(changeIsClear(140, 100)).toBe(true);
    expect(changeIsClear(105, 100)).toBe(false);
  });
});

describe("periods and retention", () => {
  it("compares with the same number of days just before", () => {
    const { cur, prev } = periods("7d", "2026-11-15");
    expect(cur).toEqual({ from: "2026-11-08", to: "2026-11-14", days: 7 });
    expect(prev).toEqual({ from: "2026-11-01", to: "2026-11-07", days: 7 });
  });
  it("keeps raw hits 400 days", () => {
    expect(retentionCutoff("2026-11-15")).toBe("2025-10-11");
  });
  it("rebuilds recent days only", () => {
    expect(daysToRoll("2026-11-15", "2026-11-15")).toEqual(["2026-11-14", "2026-11-15"]);
    expect(daysToRoll("2026-11-15", "2026-11-13")).toEqual(["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(daysToRoll("2026-11-15", null)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  });
});

describe("inquiry attribution", () => {
  it("follows each inquiry to its quote and booking, once per booking", () => {
    const rows = inquiryAttribution(
      [
        { source: "google", privateEventId: "a" },
        { source: "google", privateEventId: "a" },
        { source: "google", privateEventId: "b" },
        { source: "instagram", privateEventId: "c" },
        { source: "(not set)", privateEventId: null },
      ],
      [
        { id: "a", quoted: true, booked: true, total: 2400 },
        { id: "b", quoted: true, booked: false, total: 900 },
        { id: "c", quoted: false, booked: false, total: 0 },
      ],
    );
    expect(rows[0]).toEqual({ source: "google", inquiries: 2, quoted: 2, booked: 1, revenue: 2400 });
    expect(rows.find((r) => r.source === "instagram")).toMatchObject({ inquiries: 1, quoted: 0, booked: 0 });
    expect(rows.find((r) => r.source === "(not set)")?.inquiries).toBe(1);
  });
});

describe("periods, the same as Online", () => {
  it("offers 7 days, 28 days, 3 months and 12 months, all whole weeks", () => {
    expect(PERIODS.map((p) => p.label)).toEqual(["7 days", "28 days", "3 months", "12 months"]);
    for (const p of PERIODS) expect(p.days % 7, p.id).toBe(0);
  });
  it("ends yesterday, like Online, and compares with the same length before", () => {
    const p = periods("28d", "2026-11-23");
    expect(p.cur).toEqual({ from: "2026-10-26", to: "2026-11-22", days: 28 });
    expect(p.prev).toEqual({ from: "2026-09-28", to: "2026-10-25", days: 28 });
  });
  it("still reads the old 90-day and 12-month links", () => {
    expect(parsePeriod("90d")).toBe("3m");
    expect(parsePeriod("365d")).toBe("12m");
    expect(parsePeriod("3m")).toBe("3m");
    expect(parsePeriod("x")).toBe("28d");
  });
});
