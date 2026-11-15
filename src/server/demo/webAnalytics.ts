import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { addDays, parseISODate, toISODate, weekday, zonedMidnightUTC, type ISODate } from "@/domain/dates";
import { GBP_METRICS } from "@/domain/googleData";
import { classifySource, rollupDay, sessionId, type EventName } from "@/domain/webAnalytics";

/**
 * Demo website traffic: ~90 days of plausible visits shaped by the real
 * Square sales in the database (busier days get more visits), weekday and
 * event patterns, a realistic source mix and funnel, a few private-event
 * inquiries linked to bookings, and (optionally) Google Search Console and
 * Business Profile numbers so the Google cards can be seen before connecting.
 * Rollups are rebuilt at the end. Deterministic (seeded).
 */

const SITE = "https://drinksubversive.com";
const TZ = "America/New_York";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pick<T> = [T, number][];
const pick = <T,>(r: () => number, xs: Pick<T>): T => {
  const total = xs.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of xs) if ((x -= w) <= 0) return v;
  return xs[xs.length - 1][0];
};
const poisson = (r: () => number, lambda: number) => {
  // Normal approximation is fine for daily visit counts.
  const z = Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
};

/** [landing URL suffix, referrer] by source. */
const ENTRIES: Pick<{ ref: string; q?: string; src: string }> = [
  [{ src: "google", ref: "https://www.google.com/" }, 33],
  [{ src: "google-maps", ref: "https://www.google.com/maps/place/Subversive" }, 15],
  [{ src: "google-business", ref: "https://www.google.com/", q: "?utm_source=gbp&utm_medium=organic&utm_campaign=listing" }, 6],
  [{ src: "direct", ref: "" }, 18],
  [{ src: "instagram", ref: "https://l.instagram.com/" }, 11],
  [{ src: "facebook", ref: "https://lm.facebook.com/" }, 5],
  [{ src: "newsletter", ref: "", q: "?utm_source=newsletter&utm_medium=email&utm_campaign=this-week" }, 2],
  [{ src: "yelp", ref: "https://www.yelp.com/biz/subversive-catskill" }, 2],
  [{ src: "untappd", ref: "https://untappd.com/v/subversive" }, 1.5],
  [{ src: "bing", ref: "https://www.bing.com/" }, 2],
  [{ src: "duckduckgo", ref: "https://duckduckgo.com/" }, 1],
  [{ src: "apple-maps", ref: "https://maps.apple.com/" }, 2],
  [{ src: "hudsonvalleyone", ref: "https://www.hudsonvalleyone.com/best-breweries-catskills" }, 1],
  [{ src: "poster", ref: "", q: "?utm_source=poster&utm_medium=qr&utm_campaign=trivia" }, 0.6],
];

const PLACES: Pick<[string, string, string]> = [
  [["Catskill", "NY", "US"], 22],
  [["Hudson", "NY", "US"], 12],
  [["Kingston", "NY", "US"], 9],
  [["Albany", "NY", "US"], 11],
  [["Saugerties", "NY", "US"], 6],
  [["Coxsackie", "NY", "US"], 4],
  [["Woodstock", "NY", "US"], 3],
  [["Brooklyn", "NY", "US"], 9],
  [["New York", "NY", "US"], 8],
  [["Cairo", "NY", "US"], 2],
  [["Boston", "MA", "US"], 2],
  [["Hoboken", "NJ", "US"], 2],
  [["Stamford", "CT", "US"], 1.5],
  [["Montreal", "QC", "CA"], 1],
];

const EVENT_SLUGS = ["trivia-night", "jets-vs-bills", "first-friday-live-music", "oktoberfest-weekend", "movie-night-the-big-lebowski", "giants-vs-cowboys", "harvest-ale-release"];


export async function seedWebAnalytics(db: PrismaClient, today: ISODate, opts: { days?: number; google?: boolean } = {}): Promise<{ hits: number; days: number }> {
  const N = opts.days ?? 90;
  const r = rng(20261118);
  const from = addDays(today, -N);
  const to = addDays(today, -1);

  // Daily sales from Square, to give visits the same ups and downs (busy days get more visits).
  const sales = await db.hourlySale.groupBy({ by: ["date"], _sum: { netSales: true }, where: { date: { gte: parseISODate(from), lte: parseISODate(to) } } });
  const salesBy = new Map(sales.map((s) => [toISODate(s.date), s._sum.netSales?.toNumber() ?? 0]));
  const byWd = new Map<number, number[]>();
  for (const [d, v] of salesBy) if (v > 0) byWd.set(weekday(d), [...(byWd.get(weekday(d)) ?? []), v]);
  const wdMean = new Map([...byWd].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
  const events = await db.event.findMany({ where: { date: { gte: parseISODate(from), lte: parseISODate(addDays(today, 30)) } }, select: { date: true, title: true } });
  const eventDays = new Set(events.map((e) => toISODate(e.date)));
  const pes = await db.privateEvent.findMany({ select: { id: true, createdAt: true }, orderBy: { createdAt: "asc" } });

  await db.webHit.deleteMany({ where: { day: { gte: parseISODate(from), lte: parseISODate(to) } } });
  await db.webDaily.deleteMany({ where: { day: { gte: parseISODate(from), lte: parseISODate(to) } } });
  await db.webConversion.deleteMany({});

  let total = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const wd = weekday(day);
    const s = salesBy.get(day) ?? 0;
    const norm = wdMean.get(wd) ? s / wdMean.get(wd)! : 1;
    const weekdayBase = [95, 70, 45, 75, 90, 150, 170][wd];
    const growth = 1 + (0.25 * (N - (Date.parse(to) - Date.parse(day)) / 86_400_000)) / N;
    const lambda = weekdayBase * growth * (s > 0 ? Math.pow(Math.max(0.3, norm), 0.6) : 0.55) * (eventDays.has(day) ? 1.35 : 1);
    const visits = poisson(r, lambda);
    const dayStart = zonedMidnightUTC(day, TZ).getTime();
    const hits: Prisma.WebHitCreateManyInput[] = [];
    for (let v = 0; v < visits; v++) {
      const e = pick(r, ENTRIES);
      const device = pick(r, [["mobile", 72], ["desktop", 23], ["tablet", 5]] as Pick<"mobile" | "desktop" | "tablet">);
      const [city, region, country] = pick(r, PLACES);
      // Visits cluster late morning to early evening.
      const hour = pick(r, [[8, 1], [10, 2], [11, 4], [12, 6], [13, 6], [14, 6], [15, 7], [16, 9], [17, 10], [18, 8], [19, 6], [20, 4], [21, 3], [22, 2], [23, 1]] as Pick<number>);
      let t = dayStart + hour * 3_600_000 + Math.floor(r() * 3_600_000);
      // About one visit in eight is someone's second visit that day.
      const visitor = createHash("sha256").update(`demo:${day}:${Math.floor(v * 0.88)}`).digest("base64url").slice(0, 22);
      const landingPath = pick(r, e.src === "google-maps" || e.src === "apple-maps" ? [["/", 5], ["/menu", 4], ["/visit", 3]] : e.src === "instagram" || e.src === "facebook" ? [["/", 3], ["/events", 3], [`/events/${EVENT_SLUGS[Math.floor(r() * EVENT_SLUGS.length)]}`, 4], ["/menu", 2]] : e.src === "newsletter" ? [["/events", 5], ["/", 2]] : [["/", 8], ["/menu", 5], ["/events", 2], ["/beer", 1], ["/visit", 2], ["/private-events", 0.6]]);
      const a = classifySource({ url: `${SITE}${landingPath}${e.q ?? ""}`, referrer: e.ref || null, siteHosts: ["drinksubversive.com"] });
      const session = sessionId(visitor, new Date(t));
      const base = { day: parseISODate(day), visitor, session, source: a.source, medium: a.medium === "internal" ? "direct" : a.medium, campaign: a.campaign, content: a.content, term: a.term, referrer: a.referrer, device, country, region, city };
      const add = (kind: "pageview" | EventName, path: string, props?: Prisma.InputJsonValue) => {
        hits.push({ ...base, at: new Date(t), kind, path, props });
        t += 15_000 + Math.floor(r() * 90_000);
      };
      add("pageview", landingPath);
      const maps = a.medium === "maps";
      const social = a.medium === "social";
      // Rough funnel: maps visitors come to go; social visitors come for events.
      const bounce = r() < (maps ? 0.32 : social ? 0.45 : 0.4);
      if (bounce) continue;
      const lookMenu = landingPath === "/menu" || r() < (maps ? 0.5 : social ? 0.25 : 0.45);
      if (lookMenu) {
        if (landingPath !== "/menu") add("pageview", "/menu");
        add("menu_view", "/menu", { tab: r() < 0.6 ? "food" : "drinks" });
        if (r() < (maps ? 0.08 : 0.07)) add("click_order_online", "/menu", { href: "https://subversiveonline.square.site/" });
      }
      const lookEvent = landingPath.startsWith("/events") || r() < (social ? 0.5 : 0.18);
      if (lookEvent) {
        const slug = landingPath.startsWith("/events/") ? landingPath : `/events/${EVENT_SLUGS[Math.floor(r() * EVENT_SLUGS.length)]}`;
        if (landingPath === "/events" || !landingPath.startsWith("/events/")) add("pageview", slug);
        add("event_view", slug, { slug: slug.slice(8) });
        if (r() < 0.07) add("ticket_click", slug, { slug: slug.slice(8) });
        else if (r() < 0.06) add("rsvp_click", slug, { slug: slug.slice(8) });
      }
      // Directions and calls, more likely on busy days and from maps.
      const busy = Math.min(1.6, Math.max(0.5, norm));
      if (r() < (maps ? 0.3 : 0.11) * busy) {
        add("pageview", "/visit");
        add("click_directions", "/visit", { app: device === "mobile" && r() < 0.55 ? "apple" : "google" });
      } else if (r() < 0.05 * busy) add("click_call", landingPath === "/visit" ? "/visit" : "/", { where: "header" });
      if (r() < 0.012) add("newsletter_signup", "/");
      if (r() < 0.03) add("outbound_click", "/", { href: "https://www.instagram.com/subversivebeer/" });
      if (r() < 0.04) add("pageview", "/about");
      if (r() < 0.025) {
        add("pageview", "/private-events");
        if (r() < 0.25) add("inquiry_submit", "/private-events");
      }
    }
    // A few bots and junk that the collector would have dropped never reach the table.
    if (hits.length) await db.webHit.createMany({ data: hits });
    total += hits.length;
    const roll = rollupDay(hits.map((h) => ({ at: h.at as Date, kind: h.kind, path: h.path, visitor: h.visitor, session: h.session, source: h.source, medium: h.medium, campaign: h.campaign ?? null, referrer: h.referrer ?? null, device: h.device, country: h.country ?? null, region: h.region ?? null, city: h.city ?? null })));
    if (roll.length) await db.webDaily.createMany({ data: roll.map((x) => ({ day: parseISODate(day), ...x })) });
  }

  // Inquiries Ops recorded (linked to the demo private events), with sources.
  const srcs: Pick<[string, string]> = [[["google", "organic"], 4], [["google-business", "maps"], 2], [["instagram", "social"], 2], [["direct", "direct"], 1], [["facebook", "social"], 1]];
  for (const pe of pes) {
    const [source, medium] = pick(r, srcs);
    const d = toISODate(pe.createdAt) < from ? addDays(today, -Math.floor(r() * 60) - 2) : toISODate(pe.createdAt);
    await db.webConversion.create({ data: { day: parseISODate(d), at: zonedMidnightUTC(d, TZ), kind: "inquiry_submit", source, medium, path: "/private-events", privateEventId: pe.id } });
  }

  if (opts.google) await seedGoogleDemo(db, today, r);
  await db.setting.upsert({ where: { key: "webAnalytics.builtThrough" }, create: { key: "webAnalytics.builtThrough", value: to }, update: { value: to } });
  return { hits: total, days: N };
}

async function seedGoogleDemo(db: PrismaClient, today: ISODate, r: () => number) {
  const from = addDays(today, -120);
  const to = addDays(today, -3);
  await db.googleSearchDaily.deleteMany({});
  await db.googleProfileDaily.deleteMany({});
  await db.googleProfileKeyword.deleteMany({});
  const queries: [string, number, number][] = [
    ["subversive brewing", 9, 1.1],
    ["subversive catskill", 6, 1.2],
    ["subversive", 4, 2.4],
    ["brewery catskill ny", 3, 3.8],
    ["catskill restaurants", 2.5, 7.9],
    ["breweries near hudson ny", 2, 6.2],
    ["burgers catskill", 1.6, 4.4],
    ["things to do in catskill", 1.4, 9.8],
    ["trivia night catskill", 0.8, 2.9],
    ["dog friendly brewery hudson valley", 0.7, 8.6],
    ["new york grain beer", 0.4, 5.1],
    ["subversive menu", 1.1, 1.0],
  ];
  const rows: Prisma.GoogleSearchDailyCreateManyInput[] = [];
  const prof: Prisma.GoogleProfileDailyCreateManyInput[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = weekday(d);
    const m = [1.1, 0.9, 0.7, 0.9, 1.0, 1.4, 1.5][wd];
    let tc = 0;
    let ti = 0;
    let tp = 0;
    for (const [q, c, pos] of queries) {
      const clicks = poisson(r, c * m);
      const impressions = Math.max(clicks, poisson(r, c * m * (pos < 2 ? 2.6 : 9)));
      if (!impressions) continue;
      rows.push({ day: parseISODate(d), dim: "query", key: q, clicks, impressions, position: pos + (r() - 0.5) * 0.4 });
      tc += clicks;
      ti += impressions;
      tp += pos * impressions;
    }
    const anonymous = poisson(r, 6 * m);
    rows.push({ day: parseISODate(d), dim: "total", key: "all", clicks: tc + Math.round(anonymous * 0.3), impressions: ti + anonymous * 4, position: ti ? tp / ti : 0 });
    for (const [page, share] of [["https://drinksubversive.com/", 0.55], ["https://drinksubversive.com/menu", 0.25], ["https://drinksubversive.com/events", 0.1], ["https://drinksubversive.com/visit", 0.1]] as [string, number][]) {
      rows.push({ day: parseISODate(d), dim: "page", key: page, clicks: Math.round(tc * share), impressions: Math.round(ti * share), position: 3 });
    }
    const vals: Record<string, number> = {
      BUSINESS_IMPRESSIONS_MOBILE_MAPS: poisson(r, 140 * m),
      BUSINESS_IMPRESSIONS_DESKTOP_MAPS: poisson(r, 22 * m),
      BUSINESS_IMPRESSIONS_MOBILE_SEARCH: poisson(r, 95 * m),
      BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: poisson(r, 40 * m),
      BUSINESS_DIRECTION_REQUESTS: poisson(r, 16 * m),
      CALL_CLICKS: poisson(r, 3.5 * m),
      WEBSITE_CLICKS: poisson(r, 9 * m),
      BUSINESS_FOOD_MENU_CLICKS: poisson(r, 6 * m),
      BUSINESS_BOOKINGS: 0,
    };
    for (const k of GBP_METRICS) prof.push({ day: parseISODate(d), metric: k, value: vals[k] ?? 0 });
  }
  await db.googleSearchDaily.createMany({ data: rows });
  await db.googleProfileDaily.createMany({ data: prof });
  const months = [today.slice(0, 7), toISODate(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1))).slice(0, 7)];
  const kws: [string, number | null, number | null][] = [
    ["subversive brewing", 410, null],
    ["brewery", 260, null],
    ["subversive", 190, null],
    ["restaurants near me", 140, null],
    ["catskill brewery", 96, null],
    ["bar near me", 71, null],
    ["burgers", 44, null],
    ["food near me", 38, null],
    ["subversive taproom", 22, null],
    ["beer garden", null, 15],
  ];
  for (const month of months) await db.googleProfileKeyword.createMany({ data: kws.map(([keyword, value, threshold]) => ({ month, keyword, value, threshold })) });
}
