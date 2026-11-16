import "server-only";
import { addDays, dateRange, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import { coverPeak, coversFromChecks, hourlyCovers, parseGuestsPerCheck, productivity, type LaborProductivity } from "@/domain/covers";
import { blockHours, zonedTime } from "@/domain/timecards";
import { db } from "../db";
import { env } from "../env";
import { hourlySalesForecast } from "./forecasting";

/** Guest counts: actual from Square checks per hour, forecast from the hourly orders forecast. */

export const GUESTS_PER_CHECK_KEY = "covers.guestsPerCheck";

export async function getGuestsPerCheck(): Promise<number> {
  return parseGuestsPerCheck((await db.setting.findUnique({ where: { key: GUESTS_PER_CHECK_KEY } }))?.value);
}

export async function saveGuestsPerCheck(n: number) {
  const value = String(parseGuestsPerCheck(String(n)));
  await db.setting.upsert({ where: { key: GUESTS_PER_CHECK_KEY }, create: { key: GUESTS_PER_CHECK_KEY, value }, update: { value } });
}

export interface DayCovers {
  date: ISODate;
  sales: number;
  covers: number | null;
  /** Covers per hour (local 0–23); null before orders are synced or forecast. */
  hours: number[] | null;
  peak: { from: number; to: number; covers: number } | null;
}

/** Forecast covers for each date, alongside the sales forecast. */
export async function coversForecast(dates: ISODate[]): Promise<DayCovers[]> {
  const [f, gpc] = await Promise.all([hourlySalesForecast(dates), getGuestsPerCheck()]);
  return f.map((d) => {
    const hours = hourlyCovers(d.orderHours, gpc);
    return { date: d.date, sales: d.qty, covers: d.orders == null ? null : coversFromChecks(d.orders, gpc), hours, peak: hours ? coverPeak(hours) : null };
  });
}

/** Actual sales and covers per day in [from, to] from Square's hourly sync. */
export async function actualCovers(from: ISODate, to: ISODate): Promise<Map<ISODate, { sales: number; covers: number; hours: number[] }>> {
  const [rows, gpc] = await Promise.all([db.hourlySale.findMany({ where: { date: { gte: parseISODate(from), lte: parseISODate(to) } } }), getGuestsPerCheck()]);
  const out = new Map<ISODate, { sales: number; covers: number; hours: number[] }>();
  for (const r of rows) {
    const d = toISODate(r.date);
    const cur = out.get(d) ?? { sales: 0, covers: 0, hours: new Array(24).fill(0) };
    cur.sales += r.netSales.toNumber();
    const c = coversFromChecks(r.orders, gpc);
    cur.covers += c;
    if (r.hour >= 0 && r.hour < 24) cur.hours[r.hour] += c;
    out.set(d, cur);
  }
  return out;
}

/** Sales and covers per labor hour actually worked, over [from, to] (timecards vs Square). */
export async function actualProductivity(from: ISODate, to: ISODate, now = new Date()): Promise<LaborProductivity & { days: number }> {
  const tz = env.BUSINESS_TIMEZONE;
  const [cov, cards] = await Promise.all([
    actualCovers(from, to),
    db.timecard.findMany({ where: { clockIn: { gte: zonedTime(from, 0, tz), lt: zonedTime(addDays(to, 1), 0, tz) } }, select: { clockIn: true, clockOut: true, breakMinutes: true } }),
  ]);
  let sales = 0;
  let covers = 0;
  for (const d of dateRange(from, addDays(to, 1))) {
    const c = cov.get(d);
    if (!c) continue;
    sales += c.sales;
    covers += c.covers;
  }
  const hours = cards.reduce((a, c) => a + blockHours({ start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes, rate: null }, now), 0);
  return { ...productivity(sales, cov.size ? covers : null, hours), days: cov.size };
}
