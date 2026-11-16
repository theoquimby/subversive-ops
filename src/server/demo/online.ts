import type { Prisma, PrismaClient } from "@prisma/client";
import { addDays, parseISODate, todayIn, weekday, type ISODate } from "../../domain/dates";
import { GBP_METRICS } from "../../domain/googleData";

/**
 * Online demo: about 120 days of Google Search Console rows (daily totals,
 * searches, pages, devices), Google Business Profile daily metrics and three
 * months of listing search terms, so Online → Overview and Online → Google
 * listing can be judged before Google is connected (or approved).
 *
 * Shaped like a taproom: busy Fridays and Saturdays, search growing slowly,
 * Maps views steady, direction requests climbing, and calls falling off over
 * the last four weeks so "Worth a look" has something to say. Deterministic.
 *
 * Adds only: rows that already exist are left alone, nothing is deleted, and
 * no other table is touched, so it is safe to run on its own against a
 * database that already has data:
 *
 *   npx tsx -e "import('./src/server/demo/online').then(async (m) => { const { PrismaClient } = await import('@prisma/client'); const db = new PrismaClient(); console.log(await m.seedOnline(db)); await db.$disconnect(); })"
 *
 * `replace: true` clears the three Google tables first (a clean re-run).
 * Google runs a few days behind, so the rows stop three days ago.
 */

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";
const DAYS = 120;
const LAG = 3;

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

/** A count around `lambda` (a normal approximation is plenty for daily counts). */
const around = (r: () => number, lambda: number) => {
  if (lambda <= 0) return 0;
  const z = Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
};

/** [search, clicks a day, average spot] */
const QUERIES: [string, number, number][] = [
  ["subversive brewing", 9, 1.1],
  ["subversive catskill", 6, 1.2],
  ["subversive", 4, 2.4],
  ["subversive menu", 1.1, 1.0],
  ["brewery catskill ny", 3, 3.8],
  ["catskill restaurants", 2.5, 7.9],
  ["breweries near hudson ny", 2, 6.2],
  ["burgers catskill", 1.6, 4.4],
  ["things to do in catskill", 1.4, 9.8],
  ["trivia night catskill", 0.8, 2.9],
  ["dog friendly brewery hudson valley", 0.7, 8.6],
  ["new york grain beer", 0.4, 5.1],
];

const PAGES: [string, number][] = [
  ["https://drinksubversive.com/", 0.55],
  ["https://drinksubversive.com/menu", 0.25],
  ["https://drinksubversive.com/events", 0.1],
  ["https://drinksubversive.com/visit", 0.1],
];

/** [search term, people in a month (null when Google only gives "fewer than"), threshold] */
const KEYWORDS: [string, number | null, number | null][] = [
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
  ["trivia night", null, 15],
];

const monthBefore = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

export async function seedOnline(db: PrismaClient, today: ISODate = todayIn(TZ), opts: { replace?: boolean } = {}): Promise<{ search: number; listing: number; keywords: number; from: ISODate; to: ISODate }> {
  const r = rng(20261116);
  const from = addDays(today, -DAYS);
  const to = addDays(today, -LAG);
  if (opts.replace) await db.$transaction([db.googleSearchDaily.deleteMany({}), db.googleProfileDaily.deleteMany({}), db.googleProfileKeyword.deleteMany({})]);

  const search: Prisma.GoogleSearchDailyCreateManyInput[] = [];
  const listing: Prisma.GoogleProfileDailyCreateManyInput[] = [];
  let i = 0;
  for (let d = from; d <= to; d = addDays(d, 1), i++) {
    const day = parseISODate(d);
    const busy = [1.1, 0.9, 0.7, 0.9, 1.0, 1.4, 1.5][weekday(d)];
    const age = DAYS - LAG - i; // days before the last day
    const grow = 1 + (0.3 * i) / DAYS; // search climbs about 30% over the four months
    let clicks = 0;
    let shown = 0;
    let spot = 0;
    for (const [q, c, pos] of QUERIES) {
      const qc = around(r, c * busy * grow);
      const qs = Math.max(qc, around(r, c * busy * grow * (pos < 2 ? 2.6 : 9)));
      if (!qs) continue;
      const p = Math.max(1, pos + (r() - 0.5) * 0.4);
      search.push({ day, dim: "query", key: q, clicks: qc, impressions: qs, position: Math.round(p * 100) / 100 });
      clicks += qc;
      shown += qs;
      spot += p * qs;
    }
    // Google leaves rare searches out of the list, but counts them in the day's total.
    const unnamed = around(r, 6 * busy * grow);
    const totalClicks = clicks + Math.round(unnamed * 0.3);
    const totalShown = shown + unnamed * 4;
    search.push({ day, dim: "total", key: "all", clicks: totalClicks, impressions: totalShown, position: shown ? Math.round((spot / shown) * 100) / 100 : 0 });
    for (const [page, share] of PAGES) search.push({ day, dim: "page", key: page, clicks: Math.round(totalClicks * share), impressions: Math.round(totalShown * share), position: 3 });
    for (const [device, share] of [["MOBILE", 0.68], ["DESKTOP", 0.28], ["TABLET", 0.04]] as [string, number][]) search.push({ day, dim: "device", key: device, clicks: Math.round(totalClicks * share), impressions: Math.round(totalShown * share), position: 3 });

    const values: Record<string, number> = {
      BUSINESS_IMPRESSIONS_MOBILE_MAPS: around(r, 140 * busy),
      BUSINESS_IMPRESSIONS_DESKTOP_MAPS: around(r, 22 * busy),
      BUSINESS_IMPRESSIONS_MOBILE_SEARCH: around(r, 95 * busy * grow),
      BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: around(r, 40 * busy * grow),
      // Direction requests have been climbing; calls dropped off in the last four weeks.
      BUSINESS_DIRECTION_REQUESTS: around(r, 16 * busy * (1 + (0.35 * i) / DAYS)),
      CALL_CLICKS: around(r, 4.2 * busy * (age < 28 ? 0.55 : 1)),
      WEBSITE_CLICKS: around(r, 9 * busy),
      BUSINESS_FOOD_MENU_CLICKS: around(r, 6 * busy),
      BUSINESS_BOOKINGS: 0,
    };
    for (const metric of GBP_METRICS) listing.push({ day, metric, value: values[metric] ?? 0 });
  }

  // This month (still filling in, so smaller), last month and the one before.
  const thisMonth = today.slice(0, 7);
  const months: [string, number][] = [[thisMonth, Number(today.slice(8, 10)) / 30], [monthBefore(thisMonth), 1], [monthBefore(monthBefore(thisMonth)), 0.9]];
  const keywords: Prisma.GoogleProfileKeywordCreateManyInput[] = months.flatMap(([month, scale]) =>
    KEYWORDS.map(([keyword, value, threshold]) => {
      const v = value == null ? null : Math.round(value * scale);
      // Google only gives "fewer than 15" for small numbers.
      return v != null && v >= 15 ? { month, keyword, value: v, threshold: null } : { month, keyword, value: null, threshold: threshold ?? 15 };
    }),
  );

  const [s, l, k] = await Promise.all([
    db.googleSearchDaily.createMany({ data: search, skipDuplicates: true }),
    db.googleProfileDaily.createMany({ data: listing, skipDuplicates: true }),
    db.googleProfileKeyword.createMany({ data: keywords, skipDuplicates: true }),
  ]);
  return { search: s.count, listing: l.count, keywords: k.count, from, to };
}
