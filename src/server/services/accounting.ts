import "server-only";
import { AccountMap, accountMap, BillInput, SalesDay } from "@/domain/accountingExport";
import { addDays, dateRange, ISODate, parseISODate, toISODate } from "@/domain/dates";
import { db, num } from "../db";

/**
 * Data for accounting exports: approved invoices as bills, and daily sales by
 * revenue category with tax and tips.
 */

const ACCOUNTS_KEY = "accounting.accounts";
const TAX_RATE_KEY = "accounting.salesTaxRate";

export async function loadAccounts(): Promise<AccountMap> {
  const s = await db.setting.findUnique({ where: { key: ACCOUNTS_KEY } });
  try {
    return accountMap(s ? JSON.parse(s.value) : null);
  } catch {
    return accountMap(null);
  }
}

type Field = "billsDefault" | "billsOther" | "salesDefault" | "salesTax" | "tips" | "clearing" | "termsDays";

export async function saveAccount(field: Field | { bills: string } | { sales: string }, value: string) {
  const cur = await loadAccounts();
  const v = value.trim();
  if (typeof field === "object") {
    const [map, cat] = "bills" in field ? (["billsByCategory", field.bills] as const) : (["salesByCategory", field.sales] as const);
    const next = { ...cur[map] };
    if (v) next[cat] = v;
    else delete next[cat];
    cur[map] = next;
  } else if (field === "termsDays") {
    cur.termsDays = Number(v);
  } else {
    cur[field] = v;
  }
  const value2 = JSON.stringify(accountMap(cur));
  await db.setting.upsert({ where: { key: ACCOUNTS_KEY }, create: { key: ACCOUNTS_KEY, value: value2 }, update: { value: value2 } });
}

/** Optional sales tax rate (fraction) used when Square hasn't stored the day's tax. */
export async function loadTaxRate(): Promise<number | null> {
  const s = await db.setting.findUnique({ where: { key: TAX_RATE_KEY } });
  const n = Number(s?.value);
  return s && Number.isFinite(n) && n > 0 && n < 0.5 ? n : null;
}

export async function saveTaxRate(rate: number | null) {
  if (rate == null) await db.setting.deleteMany({ where: { key: TAX_RATE_KEY } });
  else await db.setting.upsert({ where: { key: TAX_RATE_KEY }, create: { key: TAX_RATE_KEY, value: String(rate) }, update: { value: String(rate) } });
}

/** Approved invoices dated in [from, toExclusive), with each line's ingredient category. */
export async function approvedBills(from: ISODate, toExclusive: ISODate): Promise<BillInput[]> {
  const rows = await db.invoice.findMany({
    where: { status: "APPROVED", invoiceDate: { gte: parseISODate(from), lt: parseISODate(toExclusive) } },
    orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      total: true,
      supplier: { select: { name: true, email: true } },
      lines: { orderBy: { id: "asc" }, select: { description: true, sku: true, qty: true, unitPrice: true, product: { select: { ingredient: { select: { category: true } } } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    supplier: r.supplier.name,
    supplierEmail: r.supplier.email,
    invoiceNumber: r.invoiceNumber,
    invoiceDate: toISODate(r.invoiceDate),
    total: num(r.total),
    lines: r.lines.map((l) => ({ description: l.description, sku: l.sku, qty: l.qty.toNumber(), unitPrice: l.unitPrice.toNumber(), category: l.product?.ingredient?.category ?? null })),
  }));
}

/** Ingredient categories in use (for the account mapping grid). */
export async function ingredientCategories() {
  const rows = await db.ingredient.findMany({ where: { active: true }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } });
  return rows.map((r) => r.category);
}

/** Revenue categories: recipe categories of mapped Square items, plus "Uncategorized". */
export async function revenueCategories() {
  const rows = await db.recipe.findMany({ where: { squareMaps: { some: { ignored: false } } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } });
  return [...rows.map((r) => r.category), "Uncategorized"];
}

/**
 * Daily sales for [from, toExclusive): net by revenue category (Square items
 * mapped to recipes take the recipe's category; unmapped items are
 * "Uncategorized"; items marked ignored — gift cards, merch — are left out),
 * tips from the Square sync, and tax from the sync when stored (`tax.<date>`)
 * or estimated from the sales tax rate setting.
 */
export async function salesDays(from: ISODate, toExclusive: ISODate): Promise<{ days: SalesDay[]; taxEstimated: boolean }> {
  const dates = dateRange(from, toExclusive);
  const [sales, mappings, recipes, settings, rate] = await Promise.all([
    db.dailySale.groupBy({ by: ["date", "squareId"], _sum: { netSales: true }, where: { date: { gte: parseISODate(from), lt: parseISODate(toExclusive) } } }),
    db.squareMapping.findMany({ select: { squareId: true, recipeId: true, ignored: true } }),
    db.recipe.findMany({ select: { id: true, category: true } }),
    db.setting.findMany({ where: { key: { in: dates.flatMap((d) => [`tips.${d}`, `tax.${d}`]) } } }),
    loadTaxRate(),
  ]);
  const map = new Map(mappings.map((m) => [m.squareId, m]));
  const cat = new Map(recipes.map((r) => [r.id, r.category]));
  const setting = new Map(settings.map((s) => [s.key, Number(s.value)]));
  let taxEstimated = false;
  const byDate = new Map<ISODate, Map<string, number>>();
  for (const r of sales) {
    const m = map.get(r.squareId);
    if (m?.ignored) continue;
    const category = (m?.recipeId && cat.get(m.recipeId)) || "Uncategorized";
    const date = toISODate(r.date);
    const day = byDate.get(date) ?? new Map<string, number>();
    day.set(category, (day.get(category) ?? 0) + (r._sum.netSales?.toNumber() ?? 0));
    byDate.set(date, day);
  }
  const days = dates.map((date) => {
    const cats = byDate.get(date) ?? new Map<string, number>();
    const net = [...cats.values()].reduce((a, b) => a + b, 0);
    const storedTax = setting.get(`tax.${date}`);
    let tax: number | null = storedTax != null && Number.isFinite(storedTax) ? storedTax : null;
    if (tax == null && rate != null && net > 0) {
      tax = net * rate;
      taxEstimated = true;
    }
    const tips = setting.get(`tips.${date}`);
    return {
      date,
      byCategory: [...cats].sort(([a], [b]) => a.localeCompare(b)).map(([category, n]) => ({ category, net: n })),
      tax,
      tips: tips != null && Number.isFinite(tips) ? tips : null,
    };
  });
  return { days, taxEstimated };
}

/** Default export range: the last full month. */
export function defaultRange(today: ISODate): { from: ISODate; to: ISODate } {
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const prevFirst = `${addDays(firstOfMonth, -1).slice(0, 7)}-01`;
  return { from: prevFirst, to: addDays(firstOfMonth, -1) };
}
