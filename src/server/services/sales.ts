import "server-only";
import { addDays, businessDate, dateRange, ISODate, parseISODate, toISODate, todayIn, zonedMidnightUTC } from "@/domain/dates";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env, squareConfigured } from "../env";
import { listSellables, listSoldUnits } from "../integrations/square";

export const businessToday = () => todayIn(env.BUSINESS_TIMEZONE);

/** Pull the Square catalog into SquareMapping (new rows unmapped; names refreshed). */
export async function syncCatalog() {
  const sellables = await listSellables();
  for (const s of sellables) {
    await db.squareMapping.upsert({
      where: { squareId: s.squareId },
      create: s,
      update: { squareName: s.squareName, squareType: s.squareType },
    });
  }
  return sellables.length;
}

/**
 * Re-import daily sales for business dates [from, toExclusive). Dates in the
 * range are replaced wholesale, so re-running is always safe.
 */
export async function syncSales(from: ISODate, toExclusive: ISODate) {
  const tz = env.BUSINESS_TIMEZONE;
  const units = await listSoldUnits(zonedMidnightUTC(from, tz).toISOString(), zonedMidnightUTC(toExclusive, tz).toISOString());

  const agg = new Map<string, { date: ISODate; squareId: string; name: string; qty: number; netSales: number }>();
  for (const u of units) {
    const date = businessDate(u.closedAt, tz);
    const key = `${date}|${u.squareId}`;
    const cur = agg.get(key) ?? { date, squareId: u.squareId, name: u.name, qty: 0, netSales: 0 };
    cur.qty += u.qty;
    cur.netSales += u.netSales;
    agg.set(key, cur);
  }

  await db.$transaction([
    db.dailySale.deleteMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(toExclusive) } } }),
    db.dailySale.createMany({
      data: [...agg.values()].map((r) => ({
        date: parseISODate(r.date),
        squareId: r.squareId,
        name: r.name,
        qty: new Prisma.Decimal(r.qty.toFixed(3)),
        netSales: new Prisma.Decimal(r.netSales.toFixed(2)),
      })),
    }),
    db.setting.upsert({ where: { key: "square.lastSync" }, create: { key: "square.lastSync", value: new Date().toISOString() }, update: { value: new Date().toISOString() } }),
  ]);
  return { orderLines: units.length, days: dateRange(from, toExclusive).length };
}

/** Daily job: catalog + the last 3 days (late-closed tabs, refunds). */
export async function dailySync() {
  if (!squareConfigured()) return { skipped: "Square is not configured" };
  const today = businessToday();
  const catalog = await syncCatalog();
  const sales = await syncSales(addDays(today, -3), addDays(today, 1));
  return { catalog, ...sales };
}

/** One-time history import, in two-week chunks to keep each request small. */
export async function backfillSales(days: number) {
  const today = businessToday();
  let total = 0;
  for (let start = addDays(today, -days); start <= today; start = addDays(start, 14)) {
    const end = addDays(start, 14) > addDays(today, 1) ? addDays(today, 1) : addDays(start, 14);
    total += (await syncSales(start, end)).orderLines;
  }
  return total;
}

/**
 * Sales history per recipe (mapped Square objects only), plus the set of
 * days the business was open — used by the forecaster.
 */
export async function salesByRecipe(from: ISODate, toExclusive: ISODate) {
  const [rows, mappings] = await Promise.all([
    db.dailySale.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(toExclusive) } } }),
    db.squareMapping.findMany({ where: { recipeId: { not: null }, ignored: false } }),
  ]);
  const recipeFor = new Map(mappings.map((m) => [m.squareId, m.recipeId!]));
  const byRecipe = new Map<string, Map<ISODate, number>>();
  const openDays = new Set<ISODate>();
  for (const r of rows) {
    const date = toISODate(r.date);
    if (r.qty.toNumber() > 0) openDays.add(date);
    const recipeId = recipeFor.get(r.squareId);
    if (!recipeId) continue;
    const series = byRecipe.get(recipeId) ?? new Map<ISODate, number>();
    series.set(date, (series.get(date) ?? 0) + r.qty.toNumber());
    byRecipe.set(recipeId, series);
  }
  return { byRecipe, openDays };
}

export async function lastSquareSync() {
  const s = await db.setting.findUnique({ where: { key: "square.lastSync" } });
  return s ? new Date(s.value) : null;
}
