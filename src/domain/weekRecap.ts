/**
 * "Last week vs budget" for the weekly brief: one row per headline number with
 * a red/amber/green against the week's budget (or the standing cost targets).
 */

import { Rag, rag } from "./budgets";

export type RecapKey = "sales" | "food" | "beverage" | "labor" | "prime";

export interface RecapRow {
  key: RecapKey;
  label: string;
  /** Sales in dollars; the rest are fractions of sales. */
  actual: number | null;
  target: number | null;
  /** Where the target came from, for the small print ("budget", "menu target"). */
  targetSource: string | null;
  /** actual − target (dollars for sales, points for %). */
  diff: number | null;
  rag: Rag;
}

export interface RecapInput {
  sales: number;
  foodPct: number | null;
  beveragePct: number | null;
  laborPct: number | null;
  primePct: number | null;
  /** The week's Budget row, if any. */
  budget: { sales: number | null; foodCostPct: number | null; laborPct: number | null } | null;
  /** Standing targets when the week has no food budget, and the beverage target. */
  targets: { food: number; beverage: number };
  /** Share of the week's days counted (e.g. 6/7 when Sunday is still running). */
  elapsed?: number;
}

const diff = (a: number | null, t: number | null) => (a == null || t == null ? null : a - t);

export function weekRecap(i: RecapInput): RecapRow[] {
  const elapsed = i.elapsed ?? 1;
  const salesTarget = i.budget?.sales ?? null;
  const foodTarget = i.budget?.foodCostPct ?? i.targets.food;
  const foodSource = i.budget?.foodCostPct != null ? "budget" : "menu target";
  const laborTarget = i.budget?.laborPct ?? null;
  // Prime has no budget of its own; food + labor budget is the honest comparison when both exist.
  const primeTarget = i.budget?.foodCostPct != null && laborTarget != null ? i.budget.foodCostPct + laborTarget : null;
  const sales = i.sales > 0 ? i.sales : null;
  return [
    { key: "sales", label: "Sales", actual: sales, target: salesTarget, targetSource: salesTarget != null ? "budget" : null, diff: diff(sales, salesTarget == null ? null : salesTarget * Math.min(1, elapsed)), rag: rag("sales", salesTarget, sales, elapsed) },
    { key: "food", label: "Food cost", actual: i.foodPct, target: foodTarget, targetSource: foodSource, diff: diff(i.foodPct, foodTarget), rag: rag("foodCostPct", foodTarget, i.foodPct) },
    { key: "beverage", label: "Beverage cost", actual: i.beveragePct, target: i.targets.beverage, targetSource: "beverage target", diff: diff(i.beveragePct, i.targets.beverage), rag: rag("foodCostPct", i.targets.beverage, i.beveragePct) },
    { key: "labor", label: "Labor", actual: i.laborPct, target: laborTarget, targetSource: laborTarget != null ? "budget" : null, diff: diff(i.laborPct, laborTarget), rag: rag("laborPct", laborTarget, i.laborPct) },
    { key: "prime", label: "Prime cost", actual: i.primePct, target: primeTarget, targetSource: primeTarget != null ? "food + labor budget" : null, diff: diff(i.primePct, primeTarget), rag: rag("laborPct", primeTarget, i.primePct) },
  ];
}

/** Worst RAG across rows (for a single headline dot). */
export function worstRag(rows: readonly { rag: Rag }[]): Rag {
  for (const r of ["bad", "warn", "good"] as const) if (rows.some((x) => x.rag === r)) return r;
  return "none";
}

export interface DecisionCounts {
  timeOff: number;
  swaps: number;
  badReviews: number;
  autoOrders: number;
  draftShifts: number;
  scheduleAutoDrafted: boolean;
  invoiceIssues: number;
}

export interface Decision {
  key: keyof DecisionCounts | "schedule";
  title: string;
  href: string;
  count: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What's waiting on a manager, most time-sensitive first. Empty when nothing is. */
export function decisions(c: DecisionCounts): Decision[] {
  const out: Decision[] = [];
  if (c.timeOff) out.push({ key: "timeOff", title: `${plural(c.timeOff, "time-off request")} to approve`, href: "/schedule/requests", count: c.timeOff });
  if (c.swaps) out.push({ key: "swaps", title: `${plural(c.swaps, "shift swap")} to approve`, href: "/schedule/requests", count: c.swaps });
  if (c.autoOrders) out.push({ key: "autoOrders", title: `${plural(c.autoOrders, "auto-drafted order")} to check and send`, href: "/ordering", count: c.autoOrders });
  if (c.draftShifts) out.push({ key: "schedule", title: c.scheduleAutoDrafted ? `Next week's schedule was drafted (${plural(c.draftShifts, "shift")}) — review and publish` : `${plural(c.draftShifts, "draft shift")} not published yet`, href: "/schedule", count: c.draftShifts });
  if (c.invoiceIssues) out.push({ key: "invoiceIssues", title: `${plural(c.invoiceIssues, "invoice")} with price or quantity issues`, href: "/invoices?status=OPEN", count: c.invoiceIssues });
  if (c.badReviews) out.push({ key: "badReviews", title: `${plural(c.badReviews, "low review")} (1–2★) without a reply`, href: "/reviews", count: c.badReviews });
  return out;
}
