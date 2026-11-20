import "server-only";
import { fixedTotal } from "@/domain/analytics";
import { addDays, dateRange, ISODate, parseISODate, toISODate } from "@/domain/dates";
import { crewOutlook, DAY_PROFIT_RULES, dayProfit, dayProfitStory, hourProfit, type CrewOutlook, type DayProfit, type HourInput, type ProfitStory, type WeekdayHours } from "@/domain/dayProfit";
import { realOpenDays } from "@/domain/forecastMethod";
import { TYPICAL_COST_SHARE, unlinkedSales } from "@/domain/pnlStory";
import { laborByHour, zonedTime } from "@/domain/timecards";
import { db } from "../db";
import { env } from "../env";
import { getFixedCosts } from "./analytics";
import { laborByDay } from "./budgets";
import { dailySalesForecast } from "./forecasting";
import { dailyKpis } from "./kpis";
import { loadTimecards } from "./labor";
import { getLaborRules } from "./labor-rules";
import { businessToday } from "./sales";
import { readSettingJSON, writeSettingJSON } from "./square";
import { moneyForRange } from "./square-money";

/**
 * Profit by open day: the last 12 months of finished days, from the same
 * figures the P&L uses (net sales, recipe costs as of each day, timecards
 * with employer taxes, Square's card fees), grouped by weekday, by season and
 * by hour. Worked out once a day and kept, since it reads a year of everything.
 */

const KEY = "profit.byDay";
/** Days looked at: 52 whole weeks, so every weekday has the same number of chances. */
const SPAN_DAYS = 364;

export interface StoredDayProfit {
  rules: number;
  computedOn: ISODate;
  profit: DayProfit;
  hours: WeekdayHours[];
  /** Share of open-day sales whose cost comes from a recipe; the rest is estimated at the typical share. */
  coverage: number | null;
  /** Timecards with no pay rate (their wages are missing from every figure). */
  missingRates: number;
  /** Recipes sold but missing a price somewhere. */
  uncosted: number;
}

const cents = (x: number) => Math.round(x * 100) / 100;

export async function computeDayProfit(now = new Date()): Promise<StoredDayProfit> {
  const today = businessToday();
  const from = addDays(today, -SPAN_DAYS);
  const tz = env.BUSINESS_TIMEZONE;
  const [daily, money, fixed, hourRows, cards, rules] = await Promise.all([
    dailyKpis(from, today, { now }),
    moneyForRange(from, today).catch(() => null),
    getFixedCosts().catch(() => null),
    db.hourlySale.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(today) } } }),
    loadTimecards(from, today),
    getLaborRules(),
  ]);
  const done = daily.days.filter((d) => d.state === "done");
  const open = realOpenDays(new Map(done.map((d) => [d.date, d.sales])));

  let sales = 0;
  let unlinked = 0;
  const input = done.map((d) => {
    const un = unlinkedSales(d.split, d.sales);
    if (open.has(d.date)) {
      sales += d.sales;
      unlinked += un;
    }
    return { date: d.date, sales: cents(d.sales), goods: cents(d.cogs + un * TYPICAL_COST_SHARE), labor: cents(d.labor), fees: money?.byDay.get(d.date)?.fees ?? null };
  });
  const profit = dayProfit({ days: input, open, fixedMonthly: fixedTotal(fixed) || null });

  // Hour by hour: sales from the order totals, wages from the timecards spread over the hours they cover.
  const hourly: HourInput[] = [];
  const at = new Map<string, HourInput>();
  const cell = (date: ISODate, hour: number) => {
    const k = `${date}|${hour}`;
    let c = at.get(k);
    if (!c) {
      c = { date, hour, sales: 0, labor: 0 };
      at.set(k, c);
      hourly.push(c);
    }
    return c;
  };
  for (const h of hourRows) {
    const date = toISODate(h.date);
    if (open.has(date) && h.hour >= 0 && h.hour <= 23) cell(date, h.hour).sales += h.netSales.toNumber();
  }
  const byDate = new Map<ISODate, typeof cards>();
  for (const c of cards) if (open.has(c.date)) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c]);
  for (const [date, cs] of byDate) {
    const l = laborByHour(cs.map((c) => ({ start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes, rate: c.rate })), zonedTime(date, 0, tz), rules.employerBurdenPct, now);
    l.cost.forEach((cost, hour) => {
      if (cost > 0) cell(date, hour).labor += cost;
    });
  }

  const stored: StoredDayProfit = {
    rules: DAY_PROFIT_RULES,
    computedOn: today,
    profit: { ...profit, days: profit.days.map((d) => ({ ...d, fees: cents(d.fees), left: cents(d.left) })) },
    hours: hourProfit(hourly, profit),
    coverage: sales > 0 ? 1 - unlinked / sales : null,
    missingRates: daily.missingRates,
    uncosted: daily.uncosted.length,
  };
  await writeSettingJSON(KEY, stored);
  return stored;
}

/** Same, but a failure is logged instead of thrown: the nightly sync must not stop for it. */
export async function computeDayProfitQuietly() {
  try {
    return await computeDayProfit();
  } catch (e) {
    console.error("profit by day failed", e);
    return null;
  }
}

export interface DayProfitView extends StoredDayProfit {
  story: ProfitStory | null;
  /** Today and the six days after: each day's forecast against its crew (scheduled, or the weekday's usual one). */
  ahead: CrewOutlook[];
}

/** The next seven days: the live forecast, and the shifts scheduled if there are any. */
async function weekAhead(profit: DayProfit): Promise<CrewOutlook[]> {
  const today = businessToday();
  const to = addDays(today, 7);
  const dates = dateRange(today, to);
  try {
    const [forecast, shifts] = await Promise.all([dailySalesForecast(dates), laborByDay(today, to, "shifts")]);
    const sales = new Map(forecast.map((f) => [f.date, f.qty]));
    return crewOutlook(dates.map((date) => ({ date, sales: sales.get(date) ?? 0, cost: shifts.get(date)?.cost ?? 0, hours: shifts.get(date)?.hours ?? 0 })), profit, today);
  } catch (e) {
    console.error("profit by day: week ahead failed", e);
    return [];
  }
}

/** The kept copy as it stands, without working anything out: for pages that only borrow its figures. */
export const keptDayProfit = () => readSettingJSON<StoredDayProfit>(KEY);

/** The kept copy, worked out again when it's from another day or an older method. */
export async function dayProfitView(): Promise<DayProfitView> {
  const kept = await readSettingJSON<StoredDayProfit>(KEY);
  const stored = !kept || kept.computedOn !== businessToday() || kept.rules !== DAY_PROFIT_RULES ? await computeDayProfit() : kept;
  return { ...stored, story: dayProfitStory(stored.profit, stored.hours), ahead: await weekAhead(stored.profit) };
}
