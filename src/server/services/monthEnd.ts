import "server-only";
import { accountantPack, packFileName, type PackInput } from "@/domain/accountantPack";
import { fixedTotal } from "@/domain/analytics";
import { addDays, businessDate, dateRange, ISODate, parseISODate, toISODate, zonedMidnightUTC } from "@/domain/dates";
import {
  actualCogs,
  closeChecklist,
  inventoryValue,
  monthEnd,
  monthLabel,
  monthOf,
  monthsIn,
  parseSalesTaxSettings,
  salesTaxReport,
  tipsPayable,
  usualDueDate,
  type ClosePeriod,
  type CountLine,
  type SalesTaxSettings,
} from "@/domain/monthEnd";
import { fixedForDays } from "@/domain/pnlStory";
import { classifyCategory, groupOf } from "@/domain/revenueClass";
import { DISCOUNT_CLASSES, discountClassLabel } from "@/domain/squareMoney";
import { cache } from "react";
import { db, num } from "../db";
import { env } from "../env";
import { approvedBills } from "./accounting";
import { getFixedCosts } from "./analytics";
import { buildContext, loadCostingSnapshot } from "./costing";
import { classSettings } from "./insights";
import { getBusinessProfile } from "./onboarding";
import { periodKpis } from "./kpis";
import { pendingInvoices, quickbooksStatus } from "./quickbooks";
import { businessToday, lastSquareSync, squareLinks } from "./sales";
import { moneyForRange, moneyTotals } from "./square-money";
import { readSettingJSON, writeSettingJSON } from "./square";
import type { JournalOverview } from "./monthEndJournal";

/**
 * Month-end close: the checklist, sales tax, inventory value and actual cost
 * of goods, tips payable and the figures behind the accountant pack. Reads
 * only; the QuickBooks sales journal lives in ./monthEndJournal.
 */

const tz = () => env.BUSINESS_TIMEZONE;
const range = (from: ISODate, toExclusive: ISODate) => ({ gte: parseISODate(from), lt: parseISODate(toExclusive) });
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---- Sales tax settings ------------------------------------------------------------------------

const TAX_KEY = "monthEnd.salesTax";

export const salesTaxSettings = cache(async (): Promise<SalesTaxSettings> => parseSalesTaxSettings(await readSettingJSON(TAX_KEY)));

export async function saveSalesTaxSettings(change: Partial<SalesTaxSettings>) {
  const cur = parseSalesTaxSettings(await readSettingJSON(TAX_KEY));
  const next = parseSalesTaxSettings({ ...cur, ...change });
  await writeSettingJSON(TAX_KEY, next);
  return next;
}

// ---- Sales by day ---------------------------------------------------------------------------------

export interface DaySales {
  date: ISODate;
  orders: number | null;
  /** Every net sale (ignored items included, gift card loads not): the base for sales tax and the journal. */
  allSales: number;
  /** Net sales as the P&L counts them (items marked Ignore left out). */
  pnlSales: number;
  food: number;
  beverage: number;
  /** Retail, items not linked to a recipe and ignored items. */
  other: number;
  /** Comps & discounts by group (every item); null = the orders sync hasn't covered the day. */
  discounts: { food: number; beverage: number; other: number } | null;
  tax: number | null;
  tips: number | null;
  cardFees: number | null;
  cardFeesCharged: number | null;
  feesReturned: number | null;
  cardVolume: number | null;
  feePending: number;
  /** Square sales arrived for the day. */
  synced: boolean;
}

/** Per business day in [from, toExclusive): sales by revenue group, tax, tips, card fees and discounts. */
export const salesByDay = cache(async (from: ISODate, toExclusive: ISODate): Promise<DaySales[]> => {
  const dates = dateRange(from, toExclusive);
  const [hourly, items, links, recipes, settings, money, discounts, cls] = await Promise.all([
    db.hourlySale.groupBy({ by: ["date"], where: { date: range(from, toExclusive) }, _sum: { netSales: true, orders: true } }),
    db.dailySale.groupBy({ by: ["date", "squareId"], where: { date: range(from, toExclusive) }, _sum: { netSales: true } }),
    squareLinks(),
    db.recipe.findMany({ select: { id: true, category: true } }),
    db.setting.findMany({ where: { key: { in: dates.flatMap((d) => [`tips.${d}`, `tax.${d}`]) } } }),
    db.squareDayMoney.findMany({ where: { date: range(from, toExclusive) } }),
    db.squareDiscount.groupBy({ by: ["date", "squareId"], where: { date: range(from, toExclusive) }, _sum: { amount: true } }),
    classSettings(),
  ]);
  const link = new Map(links.map((l) => [l.squareId, l]));
  const recipeCat = new Map(recipes.map((r) => [r.id, r.category]));
  const groupFor = (squareId: string): "food" | "beverage" | "other" => {
    const l = link.get(squareId);
    if (!l || l.ignored || !l.recipeId) return "other";
    return groupOf(classifyCategory(recipeCat.get(l.recipeId) ?? null, cls.map));
  };
  const setting = new Map(settings.map((s) => [s.key, Number(s.value)]));
  const val = (k: string) => {
    const v = setting.get(k);
    return v != null && Number.isFinite(v) ? v : null;
  };
  const byDay = new Map(dates.map((d) => [d, { food: 0, beverage: 0, other: 0, ignored: 0, items: 0, any: false, disc: { food: 0, beverage: 0, other: 0 } }]));
  for (const r of items) {
    const d = byDay.get(toISODate(r.date));
    if (!d) continue;
    const n = r._sum.netSales?.toNumber() ?? 0;
    d.any = true;
    d.items += n;
    if (link.get(r.squareId)?.ignored) d.ignored += n;
    d[groupFor(r.squareId)] += n;
  }
  for (const r of discounts) {
    const d = byDay.get(toISODate(r.date));
    if (d) d.disc[groupFor(r.squareId)] += r._sum.amount?.toNumber() ?? 0;
  }
  const hourlyBy = new Map(hourly.map((h) => [toISODate(h.date), h]));
  const moneyBy = new Map(money.map((m) => [toISODate(m.date), m]));
  return dates.map((date) => {
    const d = byDay.get(date)!;
    const h = hourlyBy.get(date);
    // Order totals where the hourly sync ran (they include every item, before tax and tips); else the item sum.
    const allSales = h ? h._sum.netSales?.toNumber() ?? 0 : d.items;
    const m = moneyBy.get(date);
    const feesSynced = m?.feesSyncedAt != null && m.cardFees != null;
    const charged = feesSynced ? m!.cardFees!.toNumber() : null;
    const returned = feesSynced ? m!.feesReturned?.toNumber() ?? 0 : null;
    return {
      date,
      orders: h ? h._sum.orders ?? 0 : null,
      allSales: r2(allSales),
      pnlSales: r2(Math.max(0, allSales - d.ignored)),
      food: r2(d.food),
      beverage: r2(d.beverage),
      other: r2(allSales - d.food - d.beverage),
      discounts: m?.discountsSyncedAt ? { food: r2(d.disc.food), beverage: r2(d.disc.beverage), other: r2(d.disc.other) } : null,
      tax: val(`tax.${date}`),
      tips: val(`tips.${date}`),
      cardFees: charged != null ? r2(charged - (returned ?? 0)) : null,
      cardFeesCharged: charged,
      feesReturned: returned,
      cardVolume: feesSynced ? m!.feeVolume?.toNumber() ?? 0 : null,
      feePending: m?.feePending ?? 0,
      synced: !!h || d.any,
    };
  });
});

// ---- Inventory value -----------------------------------------------------------------------------

/** What was on hand at the end of `asOf` (each ingredient's latest completed count), valued at that date's prices. */
export const inventoryAt = cache(async (asOf: ISODate) => {
  const until = zonedMidnightUTC(addDays(asOf, 1), tz());
  const [lines, snap, cls] = await Promise.all([
    db.stockCountLine.findMany({ where: { count: { completed: true, takenAt: { lt: until } } }, select: { ingredientId: true, qtyBase: true, count: { select: { takenAt: true } } }, orderBy: { count: { takenAt: "asc" } } }),
    loadCostingSnapshot(),
    classSettings(),
  ]);
  const ctx = buildContext(snap, asOf);
  const ing = new Map(snap.ingredients.map((i) => [i.id, i]));
  const counted: CountLine[] = lines.map((l) => ({ ingredientId: l.ingredientId, qtyBase: l.qtyBase.toNumber(), countedOn: businessDate(l.count.takenAt, tz()) }));
  return inventoryValue(counted, asOf, (id) => {
    const i = ing.get(id);
    if (!i) return null;
    const g = groupOf(classifyCategory(i.category, cls.map));
    return { name: i.name, category: i.category, group: g === "beverage" ? "beverage" : "food", baseUnit: i.baseUnit, unitCost: ctx.ingredients.get(id)?.costPerBase ?? null };
  });
});

// ---- Purchases ----------------------------------------------------------------------------------------

/** Approved invoices dated in the period: total, and split food / beverage / other by each line's ingredient category. */
export async function purchases(from: ISODate, toExclusive: ISODate) {
  const [bills, cls] = await Promise.all([approvedBills(from, toExclusive), classSettings()]);
  let food = 0;
  let beverage = 0;
  let total = 0;
  for (const b of bills) {
    const lines = b.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const t = b.total ?? lines;
    total += t;
    for (const l of b.lines) {
      const g = l.category ? groupOf(classifyCategory(l.category, cls.map)) : "other";
      if (g === "food") food += l.qty * l.unitPrice;
      else if (g === "beverage") beverage += l.qty * l.unitPrice;
    }
  }
  return { bills, total: r2(total), food: r2(food), beverage: r2(beverage), other: r2(total - food - beverage) };
}

// ---- Tips ----------------------------------------------------------------------------------------------

export async function tipsReport(from: ISODate, to: ISODate) {
  const toEx = addDays(to, 1);
  const [squareTips, daily, pools, pay] = await Promise.all([
    db.squareTip.groupBy({ by: ["date"], where: { kind: "CARD", date: range(from, toEx) }, _sum: { amount: true } }),
    db.setting.findMany({ where: { key: { in: dateRange(from, toEx).map((d) => `tips.${d}`) } } }),
    db.tipPeriod.findMany({ where: { finalized: true, startDate: { lte: parseISODate(to) }, endDate: { gte: parseISODate(from) } }, include: { allocations: { select: { cardAmount: true } } } }),
    db.payPeriod.findMany({ where: { status: "APPROVED", startDate: { lte: parseISODate(to) }, endDate: { gte: parseISODate(from) } }, select: { startDate: true, endDate: true } }),
  ]);
  // Card tips by payment where the payments sync has run; else the day's order tips.
  const collected = new Map<ISODate, number>();
  for (const s of daily) collected.set(s.key.slice(5), Number(s.value) || 0);
  for (const t of squareTips) collected.set(toISODate(t.date), t._sum.amount?.toNumber() ?? 0);
  const poolRows = pools.map((p) => {
    const split = p.allocations.some((a) => a.cardAmount != null);
    const card = split ? p.allocations.reduce((s, a) => s + (a.cardAmount?.toNumber() ?? 0), 0) : (num(p.cardTips) ?? p.totalTips.toNumber());
    return { start: toISODate(p.startDate), end: toISODate(p.endDate), card };
  });
  const approved = pay.map((p) => ({ start: toISODate(p.startDate), end: toISODate(p.endDate) }));
  const t = tipsPayable(collected, poolRows, approved, from, to);
  return { ...t, byDay: collected, pools: poolRows, payPeriods: approved };
}

/** Days in [from, to] (finished days only) not inside an approved pay period. */
async function payrollUncovered(from: ISODate, to: ISODate, today: ISODate) {
  const last = to < today ? to : addDays(today, -1);
  if (last < from) return 0;
  const pay = await db.payPeriod.findMany({ where: { status: "APPROVED", startDate: { lte: parseISODate(last) }, endDate: { gte: parseISODate(from) } }, select: { startDate: true, endDate: true } });
  const ps = pay.map((p) => ({ start: toISODate(p.startDate), end: toISODate(p.endDate) }));
  return dateRange(from, addDays(last, 1)).filter((d) => !ps.some((p) => d >= p.start && d <= p.end)).length;
}

// ---- The whole close --------------------------------------------------------------------------------------

/** Everything the Month-end page and the accountant pack show for a period. */
export async function closeReport(p: ClosePeriod, prev: ClosePeriod, journalP: Promise<JournalOverview | null> = Promise.resolve(null)) {
  const today = businessToday();
  const [taxSettings, days, kpis, money, inventoryEnd, inventoryStart, buys, tips, invoiceRows, qbo, countRows, payrollGap, fixed, lastSync, journal] = await Promise.all([
    salesTaxSettings(),
    salesByDay(p.from, p.toExclusive),
    periodKpis(p.from, p.toExclusive),
    moneyForRange(p.from, p.toExclusive).catch(() => null),
    inventoryAt(p.to),
    inventoryAt(prev.to),
    purchases(p.from, p.toExclusive),
    tipsReport(p.from, p.to),
    db.invoice.findMany({
      where: { invoiceDate: range(p.from, p.toExclusive) },
      orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
      select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, total: true, status: true, kind: true, paymentMethod: true, supplier: { select: { name: true } }, lines: { select: { qty: true, unitPrice: true } } },
    }),
    quickbooksStatus().catch(() => null),
    db.stockCount.findMany({ where: { completed: true, takenAt: { gte: zonedMidnightUTC(addDays(p.to, -20), tz()), lt: zonedMidnightUTC(addDays(p.to, 21), tz()) } }, select: { takenAt: true } }),
    payrollUncovered(p.from, p.to, today),
    getFixedCosts().catch(() => null),
    lastSquareSync(),
    journalP.catch((e) => {
      console.error("month-end: journal overview failed", e);
      return null;
    }),
  ]);

  const finished = days.filter((d) => d.date < today);
  const withSales = finished.filter((d) => Math.abs(d.allSales) >= 0.005);
  const tax = salesTaxReport(finished.map((d) => ({ date: d.date, sales: d.allSales, tax: d.tax })), taxSettings.rate);
  const taxByMonth = monthsIn(p).map((m) => {
    const rows = finished.filter((d) => d.date >= m.from && d.date <= m.to);
    const rep = salesTaxReport(rows.map((d) => ({ date: d.date, sales: d.allSales, tax: d.tax })), taxSettings.rate);
    return { ...m, ...rep.totals, missing: rep.missingTax.length };
  });

  // Bills in QuickBooks: approved invoices in the period that are waiting, and any that failed.
  let qboCheck: { waiting: number; failed: number } | null = null;
  const billStates = new Map<string, { status: string; qboId: string | null }>();
  if (qbo?.connected && qbo.realmId) {
    const ids = invoiceRows.map((i) => i.id);
    const [pending, links] = await Promise.all([pendingInvoices(), db.quickBooksLink.findMany({ where: { realmId: qbo.realmId, kind: "bill", localId: { in: ids } }, select: { localId: true, status: true, qboId: true } })]);
    for (const l of links) billStates.set(l.localId, { status: l.status, qboId: l.qboId });
    const inPeriod = new Set(ids);
    qboCheck = { waiting: pending.filter((x) => inPeriod.has(x.id)).length, failed: links.filter((l) => l.status === "error").length };
  }

  const m = money ? moneyTotals(money, withSales.map((d) => d.date)) : null;
  const purchasesTotal = buys.total;
  const cogs = inventoryEnd.items.length && inventoryStart.items.length ? actualCogs(inventoryStart.total, purchasesTotal, inventoryEnd.total) : null;
  const fixedMonthly = fixedTotal(fixed);
  const dayCount = kpis.counted.length;
  const fixedShare = fixedMonthly > 0 ? r2(fixedForDays(fixedMonthly, dayCount)) : null;

  const checklist = closeChecklist({
    period: p,
    today,
    invoices: { inPeriod: invoiceRows.length, unapproved: invoiceRows.filter((i) => i.status !== "APPROVED").length },
    quickbooks: qboCheck,
    countDates: countRows.map((c) => businessDate(c.takenAt, tz())),
    tips: { daysWithTips: [...tips.byDay.values()].filter((v) => v > 0.005).length, unpooled: tips.unpooled.length },
    payroll: { uncoveredDays: payrollGap },
    sales: {
      daysWithoutSales: finished.filter((d) => !d.synced || Math.abs(d.allSales) < 0.005).length,
      feesMissing: withSales.filter((d) => d.cardFees == null).length,
      taxMissing: tax.missingTax.length,
    },
    journal: journal?.enabled ? { notSent: journal.counts.notSent, changed: journal.counts.changed, notReady: journal.counts.notReady } : null,
  });

  return {
    period: p,
    prev,
    today,
    taxSettings,
    days,
    finished,
    tax,
    taxByMonth,
    kpis,
    money: m,
    discountSummary: money?.summary ?? null,
    inventory: { end: inventoryEnd, start: inventoryStart, change: r2(inventoryEnd.total - inventoryStart.total) },
    purchases: buys,
    cogs,
    tips,
    invoices: invoiceRows.map((i) => ({
      id: i.id,
      supplier: i.supplier.name,
      number: i.invoiceNumber,
      date: toISODate(i.invoiceDate),
      due: i.dueDate ? toISODate(i.dueDate) : null,
      // The printed total, else the lines added up (an invoice read without a total).
      total: num(i.total) ?? r2(i.lines.reduce((t, l) => t + l.qty.toNumber() * l.unitPrice.toNumber(), 0)),
      status: i.status,
      kind: i.kind,
      paymentMethod: i.paymentMethod,
      quickbooks: billStates.get(i.id) ?? null,
    })),
    quickbooks: qbo ? { connected: qbo.connected, companyName: qbo.companyName } : null,
    checklist,
    fixedMonthly: fixedMonthly > 0 ? fixedMonthly : null,
    fixedShare,
    lastSync,
    journal,
  };
}

export type CloseReport = Awaited<ReturnType<typeof closeReport>>;

/** Full months a period covers, for the journal (monthly entries always cover a whole month). */
export function journalSpan(p: { from: ISODate; to: ISODate }) {
  const from = `${monthOf(p.from)}-01`;
  const to = monthEnd(monthOf(p.to));
  return { from, toExclusive: addDays(to, 1) };
}

// ---- Accountant pack ------------------------------------------------------------------------------------

/** The report as the accountant pack's plain input (see @/domain/accountantPack). */
export function packInput(r: CloseReport, business: string, generatedAt: string): PackInput {
  const taxRows = new Map(r.tax.rows.map((x) => [x.date, x]));
  const k = r.kpis;
  const split = k.split;
  const bev = split.beverage.sales;
  const food = split.food.sales;
  const j = r.journal;
  const qboLabel = (q: { status: string; qboId: string | null } | null) => (!q ? (r.quickbooks?.connected ? "Not sent" : "") : q.status === "error" ? "Failed" : q.qboId ? "Sent" : "Not sent");
  return {
    business,
    period: { from: r.period.from, to: r.period.to, label: r.period.label },
    generatedAt,
    pnl: {
      sales: r2(k.total.sales),
      foodSales: r2(food),
      beverageSales: r2(bev),
      otherSales: r2(k.total.sales - food - bev),
      theoreticalCogs: r2(k.total.cogs),
      actualCogs: r.cogs,
      labor: r2(k.total.labor),
      cardFees: r.money?.fees != null ? r2(r.money.fees) : null,
      discounts: r.money?.discounts != null ? r2(r.money.discounts) : null,
      fixedShare: r.fixedShare,
      days: k.counted.length,
    },
    days: r.finished.map((d) => ({
      date: d.date,
      orders: d.orders,
      pnlSales: d.pnlSales,
      allSales: d.allSales,
      food: d.food,
      beverage: d.beverage,
      other: d.other,
      discounts: d.discounts ? r2(d.discounts.food + d.discounts.beverage + d.discounts.other) : null,
      tax: d.tax,
      taxable: taxRows.get(d.date)?.taxable ?? null,
      nonTaxable: taxRows.get(d.date)?.nonTaxable ?? null,
      tips: d.tips,
      cardVolume: d.cardVolume,
      cardFeesCharged: d.cardFeesCharged,
      feesReturned: d.feesReturned,
      cardFees: d.cardFees,
    })),
    tax: {
      jurisdiction: r.taxSettings.jurisdiction,
      rate: r.taxSettings.rate,
      filing: r.taxSettings.filing,
      dueNote: r.taxSettings.filing === "quarterly" && r.period.kind === "quarter" ? `Returns for a quarter are usually due by the 20th of the following month (${usualDueDate(r.period.to)}).` : null,
      byMonth: r.taxByMonth.map((m) => ({ month: monthLabel(m.month), sales: m.sales, taxable: m.taxable, nonTaxable: m.nonTaxable, tax: m.tax })),
      totals: { sales: r.tax.totals.sales, taxable: r.tax.totals.taxable, nonTaxable: r.tax.totals.nonTaxable, tax: r.tax.totals.tax },
      missingDays: r.tax.missingTax.length,
    },
    tips: {
      collected: r.tips.collected,
      allocated: r.tips.allocated,
      paid: r.tips.paid,
      owed: r.tips.owed,
      pools: r.tips.pools.map((p) => ({ ...p, card: r2(p.card) })),
      byDay: [...r.tips.byDay].filter(([d]) => d >= r.period.from && d <= r.period.to).sort(([a], [b]) => a.localeCompare(b)).map(([date, card]) => ({ date, card: r2(card) })),
    },
    inventory: {
      end: {
        asOf: r.inventory.end.asOf,
        total: r.inventory.end.total,
        food: r.inventory.end.food,
        beverage: r.inventory.end.beverage,
        items: r.inventory.end.items.map((x) => ({ name: x.name, category: x.category, group: x.group === "beverage" ? "Beverage" : "Food", countedOn: x.countedOn, qty: x.qtyBase, unit: x.baseUnit, unitCost: x.unitCost, value: x.value })),
      },
      start: { asOf: r.inventory.start.asOf, total: r.inventory.start.total },
      purchases: r.purchases.total,
      actualCogs: r.cogs,
    },
    invoices: r.invoices.map((i) => ({ date: i.date, supplier: i.supplier, number: i.number, kind: i.kind, status: i.status, total: i.total, due: i.due, quickbooks: qboLabel(i.quickbooks) })),
    comps: r.discountSummary
      ? {
          byReason: r.discountSummary.byReason.map((x) => ({ label: x.label, cls: discountClassLabel(x.cls), lines: x.lines, amount: r2(x.amount) })),
          byClass: DISCOUNT_CLASSES.map((c) => ({ label: c.label, amount: r2(r.discountSummary!.byClass[c.value]) })),
          total: r2(r.discountSummary.total),
        }
      : null,
    journal: (j?.entries ?? []).flatMap((e) => e.lines.map((l) => ({ key: e.key, date: e.txnDate, account: l.account ?? l.label, posting: l.posting, amount: l.amount, description: l.description, state: e.state === "sent" ? "In QuickBooks" : e.state === "changed" ? "Changed since sent" : "Not sent" }))),
  };
}

/** The pack as an .xlsx file. */
export async function accountantPackXlsx(r: CloseReport): Promise<{ bytes: Uint8Array; name: string }> {
  const XLSX = await import("xlsx");
  const { name: business } = await getBusinessProfile().catch(() => ({ name: "Subversive" }));
  const sheets = accountantPack(packInput(r, business, new Date().toISOString().slice(0, 10)));
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    ws["!cols"] = s.widths.map((w) => ({ wch: w }));
    // Number formats on data cells (below the header) in money and percent columns.
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let row = s.header + 1; row <= range.e.r; row++) {
      for (const col of s.money) {
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell && cell.t === "n") cell.z = "$#,##0.00;[Red]-$#,##0.00";
      }
      for (const col of s.percent ?? []) {
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell && cell.t === "n") cell.z = "0.0%";
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
  return { bytes: new Uint8Array(out), name: packFileName(r.period) };
}
