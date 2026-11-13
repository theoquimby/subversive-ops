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

export interface VarianceSummary {
  rows: VarianceRow[];
  theoreticalCost: number;
  actualCost: number;
  wasteCost: number;
  unexplainedCost: number;
  /** Ingredients that couldn't be compared (missing a count or a price). */
  skipped: number;
}

const mul = (a: number | null, b: number | null) => (a == null || b == null ? null : a * b);

export function computeVariance(inputs: VarianceInput[]): VarianceSummary {
  let theoreticalCost = 0;
  let actualCost = 0;
  let wasteCost = 0;
  let unexplainedCost = 0;
  let skipped = 0;

  const rows = inputs.map((i): VarianceRow => {
    const comparable = i.opening != null && i.closing != null;
    const actual = comparable ? i.opening! + i.received - i.closing! : null;
    const unexplained = actual == null ? null : actual - i.theoretical - i.waste;
    const row: VarianceRow = {
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
