/**
 * Theoretical vs actual usage between two stock counts ("the gap").
 *
 *   actual usage      = opening count + deliveries received − closing count
 *   theoretical usage = Σ (items sold × recipe usage)
 *   logged waste      = what staff recorded in the waste log
 *   unexplained       = actual − theoretical − logged waste
 *
 * Positive unexplained = more went out than sales + waste explain (over-portioning,
 * unlogged waste, theft, a missed sale mapping). Negative = less was used than
 * expected (under-portioning, a delivery that wasn't checked in, a count error).
 */

export interface VarianceInput {
  ingredientId: string;
  name: string;
  category: string;
  opening: number | null; // base units; null = not counted at start
  closing: number | null; // base units; null = not counted at end
  received: number;
  theoretical: number;
  waste: number;
  /** Cost per base unit (purchase cost, before yield). */
  unitCost: number | null;
}

export interface VarianceRow extends VarianceInput {
  actual: number | null;
  unexplained: number | null;
  actualCost: number | null;
  theoreticalCost: number | null;
  wasteCost: number | null;
  unexplainedCost: number | null;
  /** unexplained as a fraction of theoretical usage */
  unexplainedPct: number | null;
}

export interface VarianceSummary<T extends VarianceInput = VarianceInput> {
  rows: (VarianceRow & T)[];
  theoreticalCost: number;
  actualCost: number;
  wasteCost: number;
  unexplainedCost: number;
  /** Ingredients that couldn't be compared (missing a count or a price). */
  skipped: number;
}

const mul = (a: number | null, b: number | null) => (a == null || b == null ? null : a * b);

export function computeVariance<T extends VarianceInput>(inputs: T[]): VarianceSummary<T> {
  let theoreticalCost = 0;
  let actualCost = 0;
  let wasteCost = 0;
  let unexplainedCost = 0;
  let skipped = 0;

  const rows = inputs.map((i): VarianceRow & T => {
    const comparable = i.opening != null && i.closing != null;
    const actual = comparable ? i.opening! + i.received - i.closing! : null;
    const unexplained = actual == null ? null : actual - i.theoretical - i.waste;
    const row: VarianceRow & T = {
      ...i,
      actual,
      unexplained,
      actualCost: mul(actual, i.unitCost),
      theoreticalCost: mul(i.theoretical, i.unitCost),
      wasteCost: mul(i.waste, i.unitCost),
      unexplainedCost: mul(unexplained, i.unitCost),
      unexplainedPct: unexplained != null && i.theoretical > 0 ? unexplained / i.theoretical : null,
    };
    if (!comparable || i.unitCost == null) {
      skipped++;
      return row;
    }
    theoreticalCost += row.theoreticalCost!;
    actualCost += row.actualCost!;
    wasteCost += row.wasteCost!;
    unexplainedCost += row.unexplainedCost!;
    return row;
  });

  rows.sort((a, b) => Math.abs(b.unexplainedCost ?? 0) - Math.abs(a.unexplainedCost ?? 0));
  return { rows, theoreticalCost, actualCost, wasteCost, unexplainedCost, skipped };
}

// ---- Plain-English explanations ----------------------------------------------------

/** A menu item that uses the ingredient, and how much one serving uses (base units, yield loss included). */
export interface Consumer {
  recipeId: string;
  name: string;
  perServing: number;
  sold: number;
}

export type VarianceCause =
  /** More went out than sales explain, nothing logged as waste. */
  | "over"
  /** More went out, even after the waste that was logged. */
  | "overWithWaste"
  /** Less went out than sales say it should have. */
  | "under"
  /** Product went out but nothing sold uses it. */
  | "unsold"
  /** Within normal noise. */
  | "small";

export interface VarianceExplanation {
  cause: VarianceCause;
  /** Unexplained amount, base units (+ over, − under). */
  amount: number;
  /** The item that uses most of it, to put the gap in per-serving terms. */
  dish: Consumer | null;
  /** Extra (or missing) amount per serving of `dish`, base units. */
  perServing: number | null;
  /** perServing as a share of the recipe's portion. */
  portionPct: number | null;
  /** How many other sold items also use it. */
  others: number;
}

/**
 * Turn a variance row into something a chef can act on: "5.3 lb more than
 * recipes explain — about 1 extra oz per burger". The gap is spread over the
 * items that use the ingredient in proportion to their recipe usage, so the
 * per-serving figure is the recipe portion × the unexplained %.
 */
export function explainVariance(
  row: Pick<VarianceRow, "actual" | "theoretical" | "waste" | "unexplained" | "unexplainedCost">,
  consumers: Consumer[],
  opts: { minPct?: number; minCost?: number } = {},
): VarianceExplanation | null {
  if (row.actual == null || row.unexplained == null) return null;
  const minPct = opts.minPct ?? 0.05;
  const minCost = opts.minCost ?? 5;
  const used = consumers.filter((c) => c.sold > 0 && c.perServing > 0).sort((a, b) => b.perServing * b.sold - a.perServing * a.sold);
  const u = row.unexplained;
  const base = { amount: u, dish: null, perServing: null, portionPct: null, others: Math.max(0, used.length - 1) };

  if (row.theoretical <= 0) return { ...base, cause: row.actual > 0 && Math.abs(row.unexplainedCost ?? u) >= minCost ? "unsold" : "small" };
  const pctOff = u / row.theoretical;
  // Small = a few percent and not much money, or trivial money either way.
  const cost = row.unexplainedCost == null ? null : Math.abs(row.unexplainedCost);
  if ((cost != null && cost < minCost) || (Math.abs(pctOff) < minPct && (cost == null || cost < minCost * 4))) return { ...base, cause: "small" };

  const dish = used[0] ?? null;
  const cause: VarianceCause = u < 0 ? "under" : row.waste > 0 ? "overWithWaste" : "over";
  return { ...base, cause, dish, perServing: dish ? dish.perServing * pctOff : null, portionPct: dish ? pctOff : null };
}

/**
 * The unit a person would say an amount in. Per-serving amounts are small
 * (oz, fl oz); totals go up to lb / gal.
 */
export function friendlyUnit(base: "g" | "ml" | "each", amountBase: number, perServing = false): { unit: string; factor: number } {
  const a = Math.abs(amountBase);
  if (base === "g") return perServing || a < 226 ? { unit: "oz", factor: 28.349523125 } : { unit: "lb", factor: 453.59237 };
  if (base === "ml") {
    if (perServing || a < 473) return { unit: "fl oz", factor: 29.5735295625 };
    return a >= 3785 ? { unit: "gal", factor: 3785.411784 } : { unit: "qt", factor: 946.352946 };
  }
  return { unit: "each", factor: 1 };
}

/** Which class an ingredient belongs to: whichever class's sales used most of it, else its own category's class. */
export function dominantClass<C extends string>(usageByClass: ReadonlyMap<C, number>, fallback: C): C {
  let best: C = fallback;
  let max = 0;
  for (const [c, q] of usageByClass) if (q > max) [best, max] = [c, q];
  return best;
}
