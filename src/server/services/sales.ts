import "server-only";
import { addDays, businessDate, dateRange, ISODate, parseISODate, toISODate, todayIn, zonedMidnightUTC } from "@/domain/dates";
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { db } from "../db";
import { env } from "../env";
import { listOrders, listSellables } from "../integrations/square";
import { readSettingJSON, recordSquareSync, requireSquareClient, writeSettingJSON } from "./square";
import { discountStaff, discountWrites } from "./square-money";
import { foldItemSales, foldRecipeSales, type ItemDaySum, type RecipeDaySum } from "@/domain/salesRollup";

export const businessToday = () => todayIn(env.BUSINESS_TIMEZONE);

/**
 * Every Square item's link: the recipe it counts as and whether it's ignored.
 * Read once per server render (the P&L alone asked for it a dozen times); fresh in actions.
 */
export const squareLinks = cache(() => db.squareMapping.findMany({ select: { squareId: true, recipeId: true, ignored: true } }));

/** Square ids marked "Ignore" (merch, gift cards…), once per server render. */
export const ignoredSquareIds = cache(async () => (await squareLinks()).filter((m) => m.ignored).map((m) => m.squareId));

export interface CatalogMeta {
  baseName: string;
  price: number | null;
  category: string | null;
  archived: boolean;
  /** No longer in the Square catalog. */
  deleted: boolean;
  /** Square item description and modifier list names (for recipe drafting). */
  description?: string | null;
  modifiers?: string[];
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
  for (const s of sellables) meta[s.squareId] = { baseName: s.baseName, price: s.price, category: s.category, archived: s.archived, deleted: false, ...(s.description ? { description: s.description } : {}), ...(s.modifiers?.length ? { modifiers: s.modifiers } : {}) };
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
  const { units, orders, discounts } = await listOrders(client, zonedMidnightUTC(from, tz).toISOString(), zonedMidnightUTC(toExclusive, tz).toISOString());
  // Comps & discounts per order line, replaced with the day (who took the payment is kept; the payments pass fills new ones).
  const staff = await discountStaff(from, toExclusive);

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
    // Clear the days first, so a day that no longer has sales (a refund, a voided tab) doesn't keep old tips/tax.
    db.setting.deleteMany({ where: { key: { in: dateRange(from, toExclusive).flatMap((d) => [`tips.${d}`, `tax.${d}`]) } } }),
    ...tipRows(hourly),
    ...discountWrites(from, toExclusive, discounts, staff),
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
 * days the business was open — used by the forecaster. Summed per day and
 * recipe in the database (a stock estimate can reach back months), once per
 * render per range; don't mutate the result.
 */
export const salesByRecipe = cache(async (from: ISODate, toExclusive: ISODate) => {
  const rows = await db.$queryRaw<RecipeDaySum[]>`
    SELECT to_char(ds.date, 'YYYY-MM-DD') AS date,
           CASE WHEN sm.ignored = false THEN sm."recipeId" END AS "recipeId",
           SUM(ds.qty)::float8 AS qty,
           bool_or(ds.qty > 0) AS "anySold"
    FROM "DailySale" ds
    LEFT JOIN "SquareMapping" sm ON sm."squareId" = ds."squareId"
    WHERE ds.date >= ${from}::date AND ds.date < ${toExclusive}::date
    GROUP BY 1, 2`;
  return foldRecipeSales(rows);
});

/**
 * Item sales for [from, toExclusive) summed per business date and linked
 * recipe, ignored items left out (null recipe: not linked). Once per render per range.
 */
export const itemSalesByDay = cache(async (from: ISODate, toExclusive: ISODate) => {
  const rows = await db.$queryRaw<ItemDaySum[]>`
    SELECT to_char(ds.date, 'YYYY-MM-DD') AS date,
           sm."recipeId" AS "recipeId",
           SUM(ds.qty)::float8 AS qty,
           SUM(ds."netSales")::float8 AS sales
    FROM "DailySale" ds
    LEFT JOIN "SquareMapping" sm ON sm."squareId" = ds."squareId"
    WHERE ds.date >= ${from}::date AND ds.date < ${toExclusive}::date AND sm.ignored IS NOT TRUE
    GROUP BY 1, 2`;
  return foldItemSales(rows);
});

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
  const [all, minus] = await Promise.all([
    db.hourlySale.aggregate({ _sum: { netSales: true }, where: { date: range } }),
    ignoredSquareIds().then((ignored) =>
      ignored.length ? db.dailySale.aggregate({ _sum: { netSales: true }, where: { date: range, squareId: { in: ignored } } }) : { _sum: { netSales: null } },
    ),
  ]);
  return (all._sum.netSales?.toNumber() ?? 0) - (minus._sum.netSales?.toNumber() ?? 0);
}

/** Same as netSalesExcludingIgnored, per business date. */
export async function dailyNetSalesExcludingIgnored(from: ISODate, toExclusive: ISODate): Promise<Map<ISODate, number>> {
  const range = { gte: parseISODate(from), lt: parseISODate(toExclusive) };
  const [all, minus] = await Promise.all([
    db.hourlySale.groupBy({ by: ["date"], _sum: { netSales: true }, where: { date: range } }),
    ignoredSquareIds().then((ignored) => (ignored.length ? db.dailySale.groupBy({ by: ["date"], _sum: { netSales: true }, where: { date: range, squareId: { in: ignored } } }) : [])),
  ]);
  const out = new Map<ISODate, number>();
  for (const r of all) out.set(toISODate(r.date), r._sum.netSales?.toNumber() ?? 0);
  for (const r of minus) out.set(toISODate(r.date), (out.get(toISODate(r.date)) ?? 0) - (r._sum.netSales?.toNumber() ?? 0));
  return out;
}
