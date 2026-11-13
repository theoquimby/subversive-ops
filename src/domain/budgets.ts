/**
 * Weekly targets (sales, food cost %, labor %) and how a week is tracking
 * against them. Weeks start on Monday.
 */

import { addDays, ISODate, weekday } from "./dates";

/** Monday on or before `date`. */
export const weekStartOf = (date: ISODate): ISODate => addDays(date, -((weekday(date) + 6) % 7));

/** `n` consecutive week starts beginning at `from` (snapped to Monday). */
export function weekStarts(from: ISODate, n: number): ISODate[] {
  const first = weekStartOf(from);
  return Array.from({ length: n }, (_, i) => addDays(first, 7 * i));
}

export interface WeekTarget {
  weekStart: ISODate;
  sales: number | null;
  foodCostPct: number | null;
  laborPct: number | null;
}

/**
 * Targets to write when copying `source` into `weeks`. Weeks that already have
 * a value keep it unless `overwrite`; only the fields the source has are copied.
 */
export function copyTargets(source: WeekTarget | undefined, weeks: ISODate[], existing: ReadonlyMap<ISODate, WeekTarget>, overwrite = false): WeekTarget[] {
  if (!source) return [];
  const out: WeekTarget[] = [];
  for (const w of weeks) {
    if (w === source.weekStart) continue;
    const cur = existing.get(w);
    const pick = (k: "sales" | "foodCostPct" | "laborPct") => (overwrite || cur?.[k] == null ? source[k] ?? cur?.[k] ?? null : cur[k]);
    const next = { weekStart: w, sales: pick("sales"), foodCostPct: pick("foodCostPct"), laborPct: pick("laborPct") };
    if (cur && next.sales === cur.sales && next.foodCostPct === cur.foodCostPct && next.laborPct === cur.laborPct) continue;
    if (next.sales == null && next.foodCostPct == null && next.laborPct == null) continue;
    out.push(next);
  }
  return out;
}

export type Rag = "good" | "warn" | "bad" | "none";

export interface RagBands {
  /** Sales: fraction of target below which it's amber / red. */
  salesWarn: number;
  salesBad: number;
  /** Cost %: points over target (0.01 = 1 pt) before amber / red. */
  costWarn: number;
  costBad: number;
}

export const DEFAULT_BANDS: RagBands = { salesWarn: 0.97, salesBad: 0.9, costWarn: 0.005, costBad: 0.02 };

/**
 * Red/amber/green for one metric. Sales: higher is better, compared to the
 * target pro-rated by `elapsed` (share of the week's expected sales already
 * past, 0–1). Cost %: lower is better, compared directly.
 */
export function rag(metric: "sales" | "foodCostPct" | "laborPct", target: number | null, actual: number | null, elapsed = 1, bands: RagBands = DEFAULT_BANDS): Rag {
  if (target == null || actual == null || elapsed <= 0) return "none";
  if (metric === "sales") {
    const due = target * Math.min(1, elapsed);
    if (due <= 0) return "none";
    const r = actual / due;
    return r >= bands.salesWarn ? "good" : r >= bands.salesBad ? "warn" : "bad";
  }
  const over = actual - target;
  return over <= bands.costWarn ? "good" : over <= bands.costBad ? "warn" : "bad";
}

export interface WeekActuals {
  sales: number | null;
  foodCost: number | null; // theoretical cost of items sold
  foodSales: number | null; // sales of costed items
  laborCost: number | null;
}

export interface WeekStatus {
  sales: Rag;
  foodCostPct: Rag;
  laborPct: Rag;
  actualFoodCostPct: number | null;
  actualLaborPct: number | null;
  /** Worst of the three, for a single dot. */
  overall: Rag;
}

const ratio = (a: number | null, b: number | null) => (a == null || b == null || b <= 0 ? null : a / b);

export function weekStatus(t: WeekTarget, a: WeekActuals, elapsed = 1, bands: RagBands = DEFAULT_BANDS): WeekStatus {
  const actualFoodCostPct = ratio(a.foodCost, a.foodSales);
  const actualLaborPct = ratio(a.laborCost, a.sales);
  const s = {
    sales: rag("sales", t.sales, a.sales, elapsed, bands),
    foodCostPct: rag("foodCostPct", t.foodCostPct, actualFoodCostPct, elapsed, bands),
    laborPct: rag("laborPct", t.laborPct, actualLaborPct, elapsed, bands),
  };
  const order: Rag[] = ["bad", "warn", "good"];
  const overall = order.find((r) => Object.values(s).includes(r)) ?? "none";
  return { ...s, actualFoodCostPct, actualLaborPct, overall };
}

/** Parse a percentage typed by a person: "28", "28%", "0.28" → 0.28. */
export function parsePct(raw: string): number | null | "invalid" {
  const s = raw.replace(/[%\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  const v = n >= 1 ? n / 100 : n;
  return v > 0 && v < 1 ? v : "invalid";
}

/** Parse money typed by a person: "$12,500", "12.5k" → 12500. */
export function parseMoney(raw: string): number | null | "invalid" {
  const s = raw.replace(/[$,\s]/g, "").toLowerCase();
  if (s === "") return null;
  const k = s.endsWith("k");
  const n = Number(k ? s.slice(0, -1) : s);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.round(n * (k ? 1000 : 1) * 100) / 100;
}

/** The `n` highest-forecast days, in date order. */
export function busiestDays<T extends { date: ISODate; qty: number }>(days: readonly T[], n = 2): T[] {
  return [...days]
    .filter((d) => d.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, n)
    .sort((a, b) => a.date.localeCompare(b.date));
}
