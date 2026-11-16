/**
 * Guest counts ("covers"). Square orders don't carry a party size — the Order
 * object has no guest or seat count (checked against Square's API reference) —
 * so covers are worked out from checks: each closed order is one check, times
 * the house's guests-per-check (1 at a counter-service taproom; raise it if a
 * table usually pays on one check). Pure; see services/covers.ts.
 */

export const DEFAULT_GUESTS_PER_CHECK = 1;

export function parseGuestsPerCheck(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0.5 && n <= 8 ? Math.round(n * 100) / 100 : DEFAULT_GUESTS_PER_CHECK;
}

/** Covers from a number of checks. */
export const coversFromChecks = (checks: number, guestsPerCheck: number) => Math.max(0, checks) * guestsPerCheck;

/** Covers for each hour from checks per hour (null hours stay null — no data yet). */
export function hourlyCovers(checksByHour: readonly (number | null)[] | null, guestsPerCheck: number): number[] | null {
  if (!checksByHour) return null;
  return checksByHour.map((c) => coversFromChecks(c ?? 0, guestsPerCheck));
}

export interface LaborProductivity {
  sales: number;
  covers: number | null;
  laborHours: number;
  /** Sales per labor hour (SPLH). Null with no hours. */
  salesPerLaborHour: number | null;
  /** Covers per labor hour. Null with no hours or no covers. */
  coversPerLaborHour: number | null;
  /** Average spend per cover. */
  perCover: number | null;
}

export function productivity(sales: number, covers: number | null, laborHours: number): LaborProductivity {
  const h = laborHours > 0 ? laborHours : 0;
  return {
    sales,
    covers,
    laborHours,
    salesPerLaborHour: h ? sales / h : null,
    coversPerLaborHour: h && covers != null ? covers / h : null,
    perCover: covers ? sales / covers : null,
  };
}

/** The busiest stretch of covers (consecutive hours, default 2), for "rush 6–8pm, ~40 covers". */
export function coverPeak(covers: readonly number[], width = 2): { from: number; to: number; covers: number } | null {
  let best: { from: number; to: number; covers: number } | null = null;
  for (let h = 0; h + width <= covers.length; h++) {
    let sum = 0;
    for (let k = 0; k < width; k++) sum += covers[h + k] ?? 0;
    if (sum > 0 && (!best || sum > best.covers)) best = { from: h, to: h + width, covers: sum };
  }
  return best;
}

/** "38" for whole numbers, "about 38" when there's a fraction (a forecast). */
export const coversLabel = (n: number) => `${Math.round(n)}`;
