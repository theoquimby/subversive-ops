import "server-only";
import { addDays, ISODate, parseISODate, toISODate } from "@/domain/dates";
import { eventResults } from "@/domain/eventResults";
import { cleanTitle, EventDraft, eventSeries, nyHolidays } from "@/domain/events";
import { realOpenDays } from "@/domain/forecastMethod";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { dailySalesHistory } from "./forecasting";
import { businessToday } from "./sales";

/** Events this far back are scored; ordinary days are looked for up to a year and a half before the first of them. */
const RESULT_DAYS = 1095;
const LOOKBACK_DAYS = 78 * 7 + 30;

export interface EventRow {
  id: string;
  date: ISODate;
  title: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  impact: number;
  notes: string | null;
  series: string;
  /** The private event booking that keeps this entry up to date (edit it there, not here). */
  privateEventId: string | null;
}

const toRow = (e: { id: string; date: Date; title: string; kind: string; startTime: string | null; endTime: string | null; impact: Prisma.Decimal; notes: string | null; privateEvent?: { id: string } | null }): EventRow => ({
  id: e.id,
  date: toISODate(e.date),
  title: e.title,
  kind: e.kind,
  startTime: e.startTime,
  endTime: e.endTime,
  impact: e.impact.toNumber(),
  notes: e.notes,
  series: eventSeries(e.kind, e.title),
  privateEventId: e.privateEvent?.id ?? null,
});

export async function listEvents(from: ISODate, to: ISODate) {
  const rows = await db.event.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(to) } }, orderBy: [{ date: "asc" }, { startTime: "asc" }, { createdAt: "asc" }], include: { privateEvent: { select: { id: true } } } });
  return rows.map(toRow);
}

/** Insert events, skipping any that already exist on the same date with the same title. */
export async function createEvents(drafts: EventDraft[]) {
  if (drafts.length === 0) return 0;
  const dates = drafts.map((d) => d.date).sort();
  const existing = await db.event.findMany({ where: { date: { gte: parseISODate(dates[0]), lte: parseISODate(dates[dates.length - 1]) } }, select: { date: true, title: true } });
  const seen = new Set(existing.map((e) => `${toISODate(e.date)}|${e.title.toLowerCase()}`));
  const fresh = drafts
    .map((d) => ({ ...d, title: cleanTitle(d.title) }))
    .filter((d) => {
      const k = `${d.date}|${d.title.toLowerCase()}`;
      if (!d.title || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  await db.event.createMany({
    data: fresh.map((d) => ({
      date: parseISODate(d.date),
      title: d.title,
      kind: d.kind,
      impact: new Prisma.Decimal(d.kind === "CLOSURE" ? 0 : d.impact),
      startTime: d.startTime ?? null,
      endTime: d.endTime ?? null,
      notes: d.notes?.trim() || null,
    })),
  });
  return fresh.length;
}

/** NY holidays for a year, skipping dates already past and ones already on the list. */
export async function addHolidays(year: number) {
  const today = businessToday();
  return createEvents(nyHolidays(year).filter((h) => h.date >= today));
}

// ---- Learning ------------------------------------------------------------------------

/**
 * Did it work? Every past event of the last three years against an ordinary
 * day of that weekday at that time of year, and each series (every trivia
 * night, every home game) with a verdict only when its nights together say
 * more than chance would. Also how many upcoming events of each series could
 * take the measured number.
 */
export async function eventLearning() {
  const today = businessToday();
  const from = addDays(today, -RESULT_DAYS);
  const [past, future, history] = await Promise.all([
    db.event.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(today) } } }),
    db.event.findMany({ where: { date: { gte: parseISODate(today) } } }),
    dailySalesHistory(addDays(from, -LOOKBACK_DAYS), today),
  ]);
  // A day with only a stray sale isn't an open day, here as in the forecast.
  const results = eventResults({
    sales: history.sales,
    openDays: realOpenDays(history.sales),
    events: past.map((e) => ({ id: e.id, date: toISODate(e.date), title: e.title, kind: e.kind, impact: e.impact.toNumber() })),
    today,
  });
  const bySeries = new Map(results.series.map((s) => [s.series, s]));
  const upcoming = new Map<string, { count: number; differing: number }>();
  for (const e of future) {
    const s = eventSeries(e.kind, e.title);
    const impact = bySeries.get(s)?.impact;
    if (impact == null) continue;
    const cur = upcoming.get(s) ?? { count: 0, differing: 0 };
    cur.count++;
    if (Math.abs(e.impact.toNumber() - impact) >= 0.005) cur.differing++;
    upcoming.set(s, cur);
  }
  return { outcomes: results.outcomes, series: results.series, upcoming };
}

/** Set every upcoming event in a series to its measured effect (scaled back when the result is still unclear). */
export async function applyLearnedImpact(series: string) {
  const today = businessToday();
  const { series: all } = await eventLearning();
  const l = all.find((x) => x.series === series && x.impact != null);
  if (!l || l.impact == null) return { error: "There aren't enough nights to put a number on that yet." };
  // A booking's entry keeps the impact the booking works out; it isn't overwritten here.
  const future = await db.event.findMany({ where: { date: { gte: parseISODate(today) }, kind: { not: "CLOSURE" }, privateEvent: { is: null } } });
  const ids = future.filter((e) => eventSeries(e.kind, e.title) === series).map((e) => e.id);
  await db.event.updateMany({ where: { id: { in: ids } }, data: { impact: new Prisma.Decimal(l.impact) } });
  return { updated: ids.length, impact: l.impact };
}
