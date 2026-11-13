import "server-only";
import { addDays, businessDate, dateRange, ISODate, parseISODate, toISODate, todayIn, zonedMidnightUTC } from "@/domain/dates";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { listOrders, listSellables } from "../integrations/square";
import { readSettingJSON, recordSquareSync, requireSquareClient, writeSettingJSON } from "./square";

export const businessToday = () => todayIn(env.BUSINESS_TIMEZONE);

export interface CatalogMeta {
  baseName: string;
  price: number | null;
  category: string | null;
  archived: boolean;
  /** No longer in the Square catalog. */
  deleted: boolean;
}

export const CATALOG_META_KEY = "square.catalog";

/** Square price, category and archived/deleted flags per Square id (kept beside SquareMapping). */
export async function squareCatalogMeta(): Promise<Record<string, CatalogMeta>> {
  return (await readSettingJSON<Record<string, CatalogMeta>>(CATALOG_META_KEY)) ?? {};
}

/** Pull the Square catalog into SquareMapping (new rows unmapped; names refreshed) plus price/category metadata. */
export async function syncCatalog() {
  const client = await requireSquareClient();
  const sellables = await listSellables(client);
  const existing = await db.squareMapping.findMany({ select: { squareId: true, squareName: true, squareType: true } });
  const known = new Map(existing.map((m) => [m.squareId, m]));
  const creates = sellables.filter((s) => !known.has(s.squareId));
  const updates = sellables.filter((s) => {
    const k = known.get(s.squareId);
    return k && (k.squareName !== s.squareName || k.squareType !== s.squareType);
  });
  if (creates.length) {
    await db.squareMapping.createMany({ data: creates.map((s) => ({ squareId: s.squareId, squareName: s.squareName, squareType: s.squareType })), skipDuplicates: true });
  }
  for (const s of updates) await db.squareMapping.update({ where: { squareId: s.squareId }, data: { squareName: s.squareName, squareType: s.squareType } });

  const meta: Record<string, CatalogMeta> = {};
  const live = new Set(sellables.map((s) => s.squareId));
  for (const m of existing) {
    if (!live.has(m.squareId)) meta[m.squareId] = { baseName: m.squareName, price: null, category: null, archived: false, deleted: true };
  }
  for (const s of sellables) meta[s.squareId] = { baseName: s.baseName, price: s.price, category: s.category, archived: s.archived, deleted: false };
  await writeSettingJSON(CATALOG_META_KEY, meta);
  await recordSquareSync("catalog", sellables.length, `${creates.length} new`);
  return sellables.length;
}

/**
 * Re-import daily sales for business dates [from, toExclusive). Dates in the
 * range are replaced wholesale, so re-running is always safe.
 */
export async function syncSales(from: ISODate, toExclusive: ISODate) {
  const tz = env.BUSINESS_TIMEZONE;
  const client = await requireSquareClient();
  const { units, orders } = await listOrders(client, zonedMidnightUTC(from, tz).toISOString(), zonedMidnightUTC(toExclusive, tz).toISOString());

  const hourly = new Map<string, { date: ISODate; hour: number; netSales: number; orders: number; tips: number; tax: number }>();
  for (const o of orders) {
    const date = businessDate(o.closedAt, tz);
    const hour = localHour(new Date(o.closedAt), tz);
    const k = `${date}|${hour}`;
    const cur = hourly.get(k) ?? { date, hour, netSales: 0, orders: 0, tips: 0, tax: 0 };
    cur.netSales += o.netSales;
    cur.orders += 1;
    cur.tips += o.tips;
    cur.tax += o.tax;
    hourly.set(k, cur);
  }

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
    db.hourlySale.deleteMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(toExclusive) } } }),
    db.hourlySale.createMany({
      data: [...hourly.values()].map((h) => ({ date: parseISODate(h.date), hour: h.hour, netSales: new Prisma.Decimal(h.netSales.toFixed(2)), orders: h.orders })),
    }),
    ...tipRows(hourly),
    db.setting.upsert({ where: { key: "square.lastSync" }, create: { key: "square.lastSync", value: new Date().toISOString() }, update: { value: new Date().toISOString() } }),
  ]);
  await recordSquareSync("sales", orders.length, `${from} → ${addDays(toExclusive, -1)}`);
  return { orderLines: units.length, orders: orders.length, days: dateRange(from, toExclusive).length };
}

/** Card tips (for tip pooling) and sales tax (for the accounting journal) per business day. */
function tipRows(hourly: Map<string, { date: ISODate; tips: number; tax: number }>) {
  const byDay = new Map<ISODate, { tips: number; tax: number }>();
  for (const h of hourly.values()) {
    const d = byDay.get(h.date) ?? { tips: 0, tax: 0 };
    d.tips += h.tips;
    d.tax += h.tax;
    byDay.set(h.date, d);
  }
  const put = (key: string, value: string) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return [...byDay].flatMap(([date, d]) => [put(`tips.${date}`, d.tips.toFixed(2)), put(`tax.${date}`, d.tax.toFixed(2))]);
}

export const localHour = (d: Date, timeZone: string) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(d));

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

/**
 * Net sales for business dates [from, toExclusive): every completed order
 * (before tax, tips and service charges; gift card loads excluded), minus
 * items marked "Ignore" on the Sales page (merch, gift cards, retail…).
 */
export async function netSalesExcludingIgnored(from: ISODate, toExclusive: ISODate): Promise<number> {
  const range = { gte: parseISODate(from), lt: parseISODate(toExclusive) };
  const ignored = await db.squareMapping.findMany({ where: { ignored: true }, select: { squareId: true } });
  const [all, minus] = await Promise.all([
    db.hourlySale.aggregate({ _sum: { netSales: true }, where: { date: range } }),
    ignored.length
      ? db.dailySale.aggregate({ _sum: { netSales: true }, where: { date: range, squareId: { in: ignored.map((i) => i.squareId) } } })
      : Promise.resolve({ _sum: { netSales: null } }),
  ]);
  return (all._sum.netSales?.toNumber() ?? 0) - (minus._sum.netSales?.toNumber() ?? 0);
}

/** Same as netSalesExcludingIgnored, per business date. */
export async function dailyNetSalesExcludingIgnored(from: ISODate, toExclusive: ISODate): Promise<Map<ISODate, number>> {
  const range = { gte: parseISODate(from), lt: parseISODate(toExclusive) };
  const ignored = await db.squareMapping.findMany({ where: { ignored: true }, select: { squareId: true } });
  const [all, minus] = await Promise.all([
    db.hourlySale.groupBy({ by: ["date"], _sum: { netSales: true }, where: { date: range } }),
    ignored.length ? db.dailySale.groupBy({ by: ["date"], _sum: { netSales: true }, where: { date: range, squareId: { in: ignored.map((i) => i.squareId) } } }) : Promise.resolve([]),
  ]);
  const out = new Map<ISODate, number>();
  for (const r of all) out.set(toISODate(r.date), r._sum.netSales?.toNumber() ?? 0);
  for (const r of minus) out.set(toISODate(r.date), (out.get(toISODate(r.date)) ?? 0) - (r._sum.netSales?.toNumber() ?? 0));
  return out;
}
