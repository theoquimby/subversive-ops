/**
 * Month-end close: periods (month, sales-tax quarter, custom), the sales tax
 * report, inventory value from counts, actual cost of goods, tips payable and
 * the closing checklist. Pure: callers pass plain rows, out come numbers.
 *
 * Sales tax rules here are settings with defaults, not legal fact. The
 * defaults follow what New York publishes for quarterly filers (quarters run
 * Mar–May, Jun–Aug, Sep–Nov, Dec–Feb) and Greene County's combined 8% rate
 * (4% state + 4% county), but the business's accountant has the final word.
 */

import { addDays, daysBetween, ISODate } from "./dates";

const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---- Periods ------------------------------------------------------------------------------

export type CloseKind = "month" | "quarter" | "custom";

export interface ClosePeriod {
  kind: CloseKind;
  from: ISODate;
  /** Inclusive last day. */
  to: ISODate;
  toExclusive: ISODate;
  label: string;
}

const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isDate = (s: unknown): s is ISODate => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** "2026-10" plus `n` months. */
export function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

export const monthOf = (d: ISODate) => d.slice(0, 7);
/** Last day of a month, e.g. "2026-02" → "2026-02-28". */
export const monthEnd = (ym: string): ISODate => addDays(`${addMonths(ym, 1)}-01`, -1);
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** The last month that has fully ended. */
export const lastFullMonth = (today: ISODate) => addMonths(monthOf(today), -1);

export function monthPeriod(ym: string): ClosePeriod {
  const from = `${ym}-01`;
  const to = monthEnd(ym);
  return { kind: "month", from, to, toExclusive: addDays(to, 1), label: monthLabel(ym) };
}

/**
 * The sales tax quarter containing `date`. Quarters start in `startMonth`
 * (1–12) and every third month after: 3 → Mar–May, Jun–Aug, Sep–Nov, Dec–Feb.
 */
export function taxQuarter(date: ISODate, startMonth = 3): ClosePeriod {
  const sm = Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12 ? startMonth : 3;
  const m = Number(date.slice(5, 7));
  const back = (((m - sm) % 3) + 3) % 3;
  const first = addMonths(monthOf(date), -back);
  const last = addMonths(first, 2);
  const to = monthEnd(last);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const label = sameYear ? `${MONTHS[Number(first.slice(5, 7)) - 1]}–${MONTHS[Number(last.slice(5, 7)) - 1]} ${last.slice(0, 4)}` : `${monthLabel(first)} – ${monthLabel(last)}`;
  return { kind: "quarter", from: `${first}-01`, to, toExclusive: addDays(to, 1), label };
}

/** When a return for a period is usually due: the 20th of the month after it ends. A default, not a rule. */
export const usualDueDate = (periodEnd: ISODate): ISODate => `${addMonths(monthOf(periodEnd), 1)}-20`;

export function customPeriod(from: ISODate, to: ISODate): ClosePeriod {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return { kind: "custom", from: a, to: b, toExclusive: addDays(b, 1), label: a === b ? a : `${a} to ${b}` };
}

/**
 * The period a page shows, from its query: `month=YYYY-MM`, `quarter=<any date
 * in it>`, or `from`/`to`. Defaults to the last full month (or the last full
 * quarter). Never runs past a sane span (a custom range is capped at 400 days).
 */
export function closePeriod(kind: string | undefined, today: ISODate, q: { month?: string; quarter?: string; from?: string; to?: string }, quarterStartMonth = 3): ClosePeriod {
  if (kind === "quarter") {
    if (isDate(q.quarter)) return taxQuarter(q.quarter, quarterStartMonth);
    const current = taxQuarter(today, quarterStartMonth);
    return taxQuarter(addDays(current.from, -1), quarterStartMonth);
  }
  if (kind === "custom" && isDate(q.from) && isDate(q.to)) {
    const p = customPeriod(q.from, q.to);
    return daysBetween(p.from, p.to) > 400 ? customPeriod(addDays(p.to, -400), p.to) : p;
  }
  return monthPeriod(isMonth(q.month) ? q.month : lastFullMonth(today));
}

/** The period just before: previous month, previous quarter, or the same number of days before. */
export function previousPeriod(p: ClosePeriod, quarterStartMonth = 3): ClosePeriod {
  if (p.kind === "month") return monthPeriod(addMonths(monthOf(p.from), -1));
  if (p.kind === "quarter") return taxQuarter(addDays(p.from, -1), quarterStartMonth);
  const days = daysBetween(p.from, p.to) + 1;
  return customPeriod(addDays(p.from, -days), addDays(p.from, -1));
}

/** Months to offer in the picker, newest first (this month included). */
export const recentMonths = (today: ISODate, n = 18) => Array.from({ length: n }, (_, i) => addMonths(monthOf(today), -i));

/** Quarters to offer, newest first (the current one included). */
export function recentQuarters(today: ISODate, n = 8, startMonth = 3): ClosePeriod[] {
  const out: ClosePeriod[] = [];
  let d = today;
  for (let i = 0; i < n; i++) {
    const q = taxQuarter(d, startMonth);
    out.push(q);
    d = addDays(q.from, -1);
  }
  return out;
}

/** Calendar months a period touches, each clipped to the period. */
export function monthsIn(p: { from: ISODate; to: ISODate }): { month: string; from: ISODate; to: ISODate }[] {
  const out: { month: string; from: ISODate; to: ISODate }[] = [];
  for (let m = monthOf(p.from); m <= monthOf(p.to); m = addMonths(m, 1)) {
    const from = `${m}-01` < p.from ? p.from : `${m}-01`;
    const to = monthEnd(m) > p.to ? p.to : monthEnd(m);
    out.push({ month: m, from, to });
  }
  return out;
}

// ---- Sales tax settings ---------------------------------------------------------------------

export type FilingFrequency = "quarterly" | "monthly" | "annual";

export interface SalesTaxSettings {
  /** Combined rate as a fraction (0.08 = 8%). */
  rate: number;
  filing: FilingFrequency;
  /** First month of a filing quarter (3 = Mar–May, Jun–Aug, Sep–Nov, Dec–Feb). */
  quarterStartMonth: number;
  /** Where the rate applies, for the report's heading. */
  jurisdiction: string;
}

export const DEFAULT_SALES_TAX: SalesTaxSettings = { rate: 0.08, filing: "quarterly", quarterStartMonth: 3, jurisdiction: "Greene County, NY" };

export function parseSalesTaxSettings(raw: unknown): SalesTaxSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rate = typeof s.rate === "number" && s.rate > 0 && s.rate < 0.3 ? s.rate : DEFAULT_SALES_TAX.rate;
  const filing = s.filing === "monthly" || s.filing === "annual" || s.filing === "quarterly" ? s.filing : DEFAULT_SALES_TAX.filing;
  const qs = typeof s.quarterStartMonth === "number" && Number.isInteger(s.quarterStartMonth) && s.quarterStartMonth >= 1 && s.quarterStartMonth <= 12 ? s.quarterStartMonth : DEFAULT_SALES_TAX.quarterStartMonth;
  const j = typeof s.jurisdiction === "string" && s.jurisdiction.trim() ? s.jurisdiction.trim().slice(0, 80) : DEFAULT_SALES_TAX.jurisdiction;
  return { rate, filing, quarterStartMonth: qs, jurisdiction: j };
}

// ---- Sales tax report -----------------------------------------------------------------------

export interface TaxDayInput {
  date: ISODate;
  /** Every net sale Square reported that day (ignored items included; gift card loads are not sales). */
  sales: number;
  /** Tax Square collected that day; null when the sync hasn't stored it. */
  tax: number | null;
}

export interface TaxRow {
  date: ISODate;
  sales: number;
  tax: number | null;
  /** Worked out from tax ÷ rate (Square doesn't store which items were taxed). */
  taxable: number | null;
  nonTaxable: number | null;
}

export interface TaxTotals {
  sales: number;
  tax: number;
  taxable: number;
  nonTaxable: number;
  /** Tax ÷ all sales. */
  effectiveRate: number | null;
}

export interface TaxReport {
  rows: TaxRow[];
  totals: TaxTotals;
  /** Days with sales but no stored tax (left out of the taxable split). */
  missingTax: ISODate[];
  /** Days where tax ÷ rate came out above the day's sales: the rate setting is likely too low for them. */
  overRate: ISODate[];
}

/**
 * Taxable and non-taxable sales from the tax Square collected. Square's daily
 * totals carry tax but not which lines were taxed, so taxable = tax ÷ rate
 * (capped at the day's sales) and the rest is non-taxable. Days without stored
 * tax are listed rather than guessed.
 */
export function salesTaxReport(days: readonly TaxDayInput[], rate: number): TaxReport {
  const rows: TaxRow[] = [];
  const missingTax: ISODate[] = [];
  const overRate: ISODate[] = [];
  let sales = 0;
  let tax = 0;
  let taxable = 0;
  let nonTaxable = 0;
  for (const d of days) {
    sales += d.sales;
    if (d.tax == null) {
      if (Math.abs(d.sales) >= 0.005) missingTax.push(d.date);
      rows.push({ date: d.date, sales: r2(d.sales), tax: null, taxable: null, nonTaxable: null });
      continue;
    }
    let t = rate > 0 ? r2(d.tax / rate) : 0;
    if (d.sales >= 0 && t > d.sales + 0.01) {
      overRate.push(d.date);
      t = r2(d.sales);
    }
    const n = r2(d.sales - t);
    tax += d.tax;
    taxable += t;
    nonTaxable += n;
    rows.push({ date: d.date, sales: r2(d.sales), tax: r2(d.tax), taxable: t, nonTaxable: n });
  }
  return {
    rows,
    totals: { sales: r2(sales), tax: r2(tax), taxable: r2(taxable), nonTaxable: r2(nonTaxable), effectiveRate: sales > 0 ? tax / sales : null },
    missingTax,
    overRate,
  };
}

// ---- Inventory value ------------------------------------------------------------------------

export interface CountLine {
  ingredientId: string;
  qtyBase: number;
  /** Business date of the count. */
  countedOn: ISODate;
}

/** Each ingredient's most recent counted quantity on or before `asOf` (later counts of the same day win, in input order). */
export function latestCounts(lines: readonly CountLine[], asOf: ISODate): Map<string, CountLine> {
  const out = new Map<string, CountLine>();
  for (const l of lines) {
    if (l.countedOn > asOf) continue;
    const cur = out.get(l.ingredientId);
    if (!cur || l.countedOn >= cur.countedOn) out.set(l.ingredientId, l);
  }
  return out;
}

export interface ValuedItem {
  ingredientId: string;
  name: string;
  category: string;
  group: "food" | "beverage";
  qtyBase: number;
  baseUnit: string;
  countedOn: ISODate;
  /** $ per base unit at the as-of date; null = no price on file. */
  unitCost: number | null;
  value: number;
}

export interface InventoryValue {
  asOf: ISODate;
  total: number;
  food: number;
  beverage: number;
  items: ValuedItem[];
  /** Counted but no price on file (valued at $0). */
  unpriced: string[];
  /** Counted more than `staleDays` before the as-of date. */
  stale: number;
  oldest: ISODate | null;
  newest: ISODate | null;
}

/**
 * Value of what was on hand at `asOf`: each ingredient's latest count on or
 * before that date × its price per base unit at that date.
 */
export function inventoryValue(
  lines: readonly CountLine[],
  asOf: ISODate,
  info: (ingredientId: string) => { name: string; category: string; group: "food" | "beverage"; baseUnit: string; unitCost: number | null } | null,
  staleDays = 45,
): InventoryValue {
  const latest = latestCounts(lines, asOf);
  const items: ValuedItem[] = [];
  const unpriced: string[] = [];
  let stale = 0;
  let oldest: ISODate | null = null;
  let newest: ISODate | null = null;
  for (const l of latest.values()) {
    const i = info(l.ingredientId);
    if (!i) continue;
    if (l.qtyBase === 0) continue;
    const value = i.unitCost != null ? r2(l.qtyBase * i.unitCost) : 0;
    if (i.unitCost == null) unpriced.push(i.name);
    if (daysBetween(l.countedOn, asOf) > staleDays) stale++;
    if (!oldest || l.countedOn < oldest) oldest = l.countedOn;
    if (!newest || l.countedOn > newest) newest = l.countedOn;
    items.push({ ingredientId: l.ingredientId, name: i.name, category: i.category, group: i.group, qtyBase: l.qtyBase, baseUnit: i.baseUnit, countedOn: l.countedOn, unitCost: i.unitCost, value });
  }
  items.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const sum = (g?: "food" | "beverage") => r2(items.filter((x) => !g || x.group === g).reduce((s, x) => s + x.value, 0));
  return { asOf, total: sum(), food: sum("food"), beverage: sum("beverage"), items, unpriced: unpriced.sort(), stale, oldest, newest };
}

/** Actual cost of goods = opening inventory + purchases − closing inventory. */
export const actualCogs = (opening: number, purchases: number, closing: number) => r2(opening + purchases - closing);

// ---- Tips payable ---------------------------------------------------------------------------

export interface TipPool {
  start: ISODate;
  end: ISODate;
  /** Card tips the pool hands out (paid through payroll). */
  card: number;
}

export interface TipsPayable {
  /** Card tips Square collected in the period. */
  collected: number;
  /** Card tips finalized tip pools allocate to the period's days (pools spanning the edge are prorated by days). */
  allocated: number;
  /** Of that, on days inside approved (exported) pay periods. */
  paid: number;
  /** Collected but not yet paid through payroll at the period's end. */
  owed: number;
  /** Days with card tips that no finalized pool covers. */
  unpooled: ISODate[];
  /** Days covered by a finalized pool but not by an approved pay period. */
  unpaid: ISODate[];
}

/**
 * Card tips collected vs paid out through payroll for [from, to]. A tip pool's
 * card total is spread evenly over its days, the same way the payroll export
 * prorates a pool that crosses a pay period.
 */
export function tipsPayable(collectedByDay: ReadonlyMap<ISODate, number>, pools: readonly TipPool[], approvedPayPeriods: readonly { start: ISODate; end: ISODate }[], from: ISODate, to: ISODate): TipsPayable {
  const perDay = new Map<ISODate, number>();
  for (const p of pools) {
    const n = daysBetween(p.start, p.end) + 1;
    if (n <= 0) continue;
    for (let d = p.start; d <= p.end; d = addDays(d, 1)) if (d >= from && d <= to) perDay.set(d, (perDay.get(d) ?? 0) + p.card / n);
  }
  const paidDay = (d: ISODate) => approvedPayPeriods.some((p) => d >= p.start && d <= p.end);
  let collected = 0;
  let allocated = 0;
  let paid = 0;
  const unpooled: ISODate[] = [];
  const unpaid: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = collectedByDay.get(d) ?? 0;
    collected += c;
    const a = perDay.get(d);
    if (a == null) {
      if (c > 0.005) unpooled.push(d);
      continue;
    }
    allocated += a;
    if (paidDay(d)) paid += a;
    else unpaid.push(d);
  }
  return { collected: r2(collected), allocated: r2(allocated), paid: r2(paid), owed: r2(collected - paid), unpooled, unpaid };
}

// ---- Checklist ------------------------------------------------------------------------------

export type CheckStatus = "done" | "todo" | "warn" | "na";

export interface CheckItem {
  id: "invoices" | "quickbooks" | "count" | "tips" | "payroll" | "sales" | "journal";
  title: string;
  status: CheckStatus;
  detail: string;
  href: string;
}

export interface ChecklistInput {
  period: { from: ISODate; to: ISODate };
  today: ISODate;
  invoices: { inPeriod: number; unapproved: number };
  /** null = QuickBooks not connected. */
  quickbooks: { waiting: number; failed: number } | null;
  /** Completed counts' business dates (any order). */
  countDates: ISODate[];
  /** How close to the period's end a count must be (days either side). */
  countWindow?: number;
  tips: { daysWithTips: number; unpooled: number };
  payroll: { uncoveredDays: number };
  sales: { daysWithoutSales: number; feesMissing: number; taxMissing: number };
  /** null = the QuickBooks sales journal is off. */
  journal: { notSent: number; changed: number; notReady: number } | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Oct 31" */
const nice = (d: ISODate) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

/** The month-end checklist: one line per job, each done / to do / worth a look / not needed. */
export function closeChecklist(i: ChecklistInput): CheckItem[] {
  const ended = i.period.to < i.today;
  const out: CheckItem[] = [];

  out.push(
    i.invoices.inPeriod === 0
      ? { id: "invoices", title: "Invoices approved", status: "warn", detail: "No invoices dated in this period. Snap any that are still in the office.", href: "/invoices" }
      : i.invoices.unapproved > 0
        ? { id: "invoices", title: "Invoices approved", status: "todo", detail: `${plural(i.invoices.unapproved, "invoice")} still to check and approve.`, href: "/invoices" }
        : { id: "invoices", title: "Invoices approved", status: "done", detail: `All ${plural(i.invoices.inPeriod, "invoice")} approved.`, href: "/invoices" },
  );

  if (!i.quickbooks) out.push({ id: "quickbooks", title: "Bills in QuickBooks", status: "na", detail: "QuickBooks isn't connected. The accountant pack has the invoices list instead.", href: "/settings/quickbooks" });
  else if (i.quickbooks.failed > 0) out.push({ id: "quickbooks", title: "Bills in QuickBooks", status: "todo", detail: `${plural(i.quickbooks.failed, "bill")} didn't go through. Open it to see why.`, href: "/invoices" });
  else if (i.quickbooks.waiting > 0) out.push({ id: "quickbooks", title: "Bills in QuickBooks", status: "todo", detail: `${plural(i.quickbooks.waiting, "approved invoice")} not sent yet.`, href: "/invoices" });
  else out.push({ id: "quickbooks", title: "Bills in QuickBooks", status: "done", detail: "Every approved invoice is in QuickBooks.", href: "/invoices" });

  const win = i.countWindow ?? 3;
  const near = i.countDates.filter((d) => Math.abs(daysBetween(i.period.to, d)) <= win).sort((a, b) => Math.abs(daysBetween(i.period.to, a)) - Math.abs(daysBetween(i.period.to, b)))[0];
  const before = i.countDates.filter((d) => d <= i.period.to).sort().at(-1);
  if (near) out.push({ id: "count", title: "Stock count at the end", status: "done", detail: `Counted ${nice(near)}${near === i.period.to ? ", the last day" : ""}.`, href: "/count" });
  else out.push({ id: "count", title: "Stock count at the end", status: ended || daysBetween(i.today, i.period.to) <= win ? "todo" : "na", detail: before ? `Last count was ${nice(before)}. Count within ${win} days of ${nice(i.period.to)} for an accurate cost of goods.` : `No count yet. Count within ${win} days of ${nice(i.period.to)}.`, href: "/count" });

  if (i.tips.daysWithTips === 0) out.push({ id: "tips", title: "Tips finalized", status: "na", detail: "No card tips in this period.", href: "/tips" });
  else if (i.tips.unpooled > 0) out.push({ id: "tips", title: "Tips finalized", status: "todo", detail: `${plural(i.tips.unpooled, "day")} with card tips aren't in a finalized tip pool.`, href: "/tips" });
  else out.push({ id: "tips", title: "Tips finalized", status: "done", detail: "Every day with tips is in a finalized pool.", href: "/tips" });

  out.push(
    i.payroll.uncoveredDays > 0
      ? { id: "payroll", title: "Payroll exported", status: ended ? "todo" : "warn", detail: `${plural(i.payroll.uncoveredDays, "day")} not in an approved pay period yet.`, href: "/labor/payroll" }
      : { id: "payroll", title: "Payroll exported", status: "done", detail: "Every day is in an approved pay period.", href: "/labor/payroll" },
  );

  const s = i.sales;
  if (s.feesMissing > 0 || s.taxMissing > 0) {
    const parts = [s.taxMissing ? `tax missing on ${plural(s.taxMissing, "day")}` : "", s.feesMissing ? `card fees missing on ${plural(s.feesMissing, "day")}` : ""].filter(Boolean);
    out.push({ id: "sales", title: "Sales synced", status: "todo", detail: `${parts.join(", ")}. Import those days again from Square.`.replace(/^./, (c) => c.toUpperCase()), href: "/settings/square#import" });
  } else if (s.daysWithoutSales > 0) out.push({ id: "sales", title: "Sales synced", status: "warn", detail: `${plural(s.daysWithoutSales, "day")} with no Square sales. Fine if you were closed.`, href: "/sales" });
  else out.push({ id: "sales", title: "Sales synced", status: "done", detail: "Sales, tax, tips and card fees are in for every day.", href: "/sales" });

  if (i.journal) {
    const j = i.journal;
    if (j.notSent + j.changed > 0) out.push({ id: "journal", title: "Sales in QuickBooks", status: "todo", detail: [j.notSent ? `${plural(j.notSent, "entry", "entries")} to send` : "", j.changed ? `${j.changed} changed since sent` : ""].filter(Boolean).join(", ") + ".", href: "#journal" });
    else if (j.notReady > 0) out.push({ id: "journal", title: "Sales in QuickBooks", status: "warn", detail: `${plural(j.notReady, "entry", "entries")} waiting on Square data.`, href: "#journal" });
    else out.push({ id: "journal", title: "Sales in QuickBooks", status: "done", detail: "Every sales entry is in QuickBooks.", href: "#journal" });
  }
  return out;
}

/**
 * The checklist's counts, adding up to the total: done (not-needed counts as done), to do, and worth a look.
 */
export function checklistProgress(items: readonly CheckItem[]) {
  const done = items.filter((x) => x.status === "done" || x.status === "na").length;
  return { done, total: items.length, open: items.filter((x) => x.status === "todo").length, look: items.filter((x) => x.status === "warn").length };
}

/**
 * The order to work the list in: what blocks the rest first (sales and tax come from Square, and the
 * QuickBooks entries wait on them), then the rest of the to-dos, then what's worth a look, then what's done.
 */
const CLOSE_ORDER = ["sales", "invoices", "quickbooks", "count", "tips", "payroll", "journal"];
export function closeOrder(items: readonly CheckItem[]): CheckItem[] {
  const rank = { todo: 0, warn: 1, done: 2, na: 3 } as const;
  const at = (id: string) => (CLOSE_ORDER.indexOf(id) + 1 || 99);
  return [...items].sort((a, b) => rank[a.status] - rank[b.status] || at(a.id) - at(b.id));
}

/** The top of Month-end: can this period close, and the first thing to do if not. */
export function closeVerdict(items: readonly CheckItem[], label: string, ended: boolean): { tone: "good" | "warn" | "bad" | "neutral"; title: string; line: string; first: CheckItem | null } {
  const ordered = closeOrder(items);
  const p = checklistProgress(items);
  const first = ordered[0]?.status === "todo" || ordered[0]?.status === "warn" ? ordered[0] : null;
  const counts = [`${p.done} done`, p.open ? `${p.open} to do` : "", p.look ? `${p.look} worth a look` : ""].filter(Boolean).join(", ");
  if (p.open) {
    return {
      tone: ended ? "bad" : "warn",
      title: ended ? `${label} can't close yet: ${plural(p.open, "thing")} left` : `${label} isn't over yet: ${plural(p.open, "thing")} to do before it closes`,
      line: `Of the ${p.total} jobs, ${counts}.`,
      first,
    };
  }
  if (p.look) return { tone: "warn", title: `${label} is nearly ready to close`, line: `Of the ${p.total} jobs, ${counts}. ${first!.title}: ${first!.detail}`, first };
  return { tone: ended ? "good" : "neutral", title: ended ? `${label} is ready to close` : `${label} is on track so far`, line: `All ${p.total} done. The accountant pack has everything in one file.`, first: null };
}
