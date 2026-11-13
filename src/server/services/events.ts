import "server-only";
import { addDays, ISODate, parseISODate, toISODate } from "@/domain/dates";
import { cleanTitle, EventDraft, eventLifts, eventSeries, learnedImpacts, nyHolidays } from "@/domain/events";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { dailySalesHistory } from "./forecasting";
import { businessToday } from "./sales";

const LEARN_DAYS = 365;

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
}

const toRow = (e: { id: string; date: Date; title: string; kind: string; startTime: string | null; endTime: string | null; impact: Prisma.Decimal; notes: string | null }): EventRow => ({
  id: e.id,
  date: toISODate(e.date),
  title: e.title,
  kind: e.kind,
  startTime: e.startTime,
  endTime: e.endTime,
  impact: e.impact.toNumber(),
  notes: e.notes,
  series: eventSeries(e.kind, e.title),
});

export async function listEvents(from: ISODate, to: ISODate) {
  const rows = await db.event.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(to) } }, orderBy: [{ date: "asc" }, { startTime: "asc" }, { createdAt: "asc" }] });
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
 * For every past event in the last year: actual sales ÷ what the day would
 * have done without it. Grouped by series ("GAME:knicks") into a learned
 * impact, with how many upcoming events of that series could use it.
 */
export async function eventLearning() {
  const today = businessToday();
  const from = addDays(today, -LEARN_DAYS);
  const [past, future, history] = await Promise.all([
    db.event.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(today) } } }),
    db.event.findMany({ where: { date: { gte: parseISODate(today) } } }),
    dailySalesHistory(addDays(from, -70), today),
  ]);
  const lifts = eventLifts(history.sales, history.openDays, past.map((e) => ({ id: e.id, date: toISODate(e.date), title: e.title, kind: e.kind })));
  const learned = learnedImpacts(lifts);
  const upcoming = new Map<string, { count: number; differing: number }>();
  for (const e of future) {
    const s = eventSeries(e.kind, e.title);
    const l = learned.get(s);
    if (!l) continue;
    const cur = upcoming.get(s) ?? { count: 0, differing: 0 };
    cur.count++;
    if (Math.abs(e.impact.toNumber() - l.impact) >= 0.005) cur.differing++;
    upcoming.set(s, cur);
  }
  return { lifts: new Map(lifts.map((l) => [l.id, l])), learned, upcoming };
}

/** Set every upcoming event in a series to its learned impact. */
export async function applyLearnedImpact(series: string) {
  const today = businessToday();
  const { learned } = await eventLearning();
  const l = learned.get(series);
  if (!l) return { error: "Nothing learned for that kind of event yet." };
  const future = await db.event.findMany({ where: { date: { gte: parseISODate(today) }, kind: { not: "CLOSURE" } } });
  const ids = future.filter((e) => eventSeries(e.kind, e.title) === series).map((e) => e.id);
  await db.event.updateMany({ where: { id: { in: ids } }, data: { impact: new Prisma.Decimal(l.impact) } });
  return { updated: ids.length, impact: l.impact };
}
