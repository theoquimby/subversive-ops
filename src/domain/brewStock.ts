/**
 * Brewing stock: what's on the shelf, kept apart from kitchen counts. Pure.
 *
 * On hand = the latest count, plus everything received, less everything brews
 * used, plus any fixes, since that count. Never counted: the same from zero.
 * It can go below zero (a brew used more than was recorded); that is shown,
 * never hidden, so it gets counted.
 *
 * Status looks ahead at planned brews: stock is given to the earliest brew
 * first. "short" when a brew in the next three weeks can't be covered (or the
 * shelf is below zero), "soon" when one in the next eight weeks can't.
 * "uncounted" when the shelf has never been counted: what's there isn't
 * known, so it's neither fine nor short until someone counts it.
 */

import { brewUnit, COUNT_UNITS } from "./brewMath";
import { brewToBase } from "./brewRecipes";
import { addDays, type ISODate } from "./dates";
import type { BaseUnit, CustomConversion } from "./units";

export type StockMoveKind = "count" | "received" | "used" | "adjust";
export const STOCK_MOVE_KINDS: StockMoveKind[] = ["count", "received", "used", "adjust"];
export const MOVE_LABEL: Record<StockMoveKind, string> = { count: "Counted", received: "Received", used: "Used in a brew", adjust: "Fixed" };

export interface StockMove {
  kind: StockMoveKind;
  /** In the ingredient's base unit. "used" is positive (and subtracted); "adjust" is signed. */
  qtyBase: number;
  at: Date;
  batchId?: string | null;
}

/** Look this far ahead for planned brews on the stock page. */
export const STOCK_HORIZON_DAYS = 56;
/** A brew this close that stock can't cover makes the ingredient "short". */
export const SHORT_DAYS = 21;
/** Recent use is over this many days. */
export const RECENT_USE_DAYS = 30;

export function onHand(moves: readonly StockMove[]): { qtyBase: number; counted: boolean; countedAt: Date | null; countedQty: number | null } {
  let last: StockMove | null = null;
  for (const m of moves) if (m.kind === "count" && (!last || m.at.getTime() > last.at.getTime())) last = m;
  const since = last?.at.getTime() ?? -Infinity;
  let q = last?.qtyBase ?? 0;
  for (const m of moves) {
    if (m === last || m.kind === "count" || m.at.getTime() <= since) continue;
    if (m.kind === "received") q += m.qtyBase;
    else if (m.kind === "used") q -= m.qtyBase;
    else if (m.kind === "adjust") q += m.qtyBase;
  }
  return { qtyBase: q, counted: !!last, countedAt: last?.at ?? null, countedQty: last?.qtyBase ?? null };
}

/** What brews used from `from` (inclusive) to `to` (exclusive). */
export function usedBetween(moves: readonly StockMove[], from: Date, to: Date): number {
  return moves.filter((m) => m.kind === "used" && m.at >= from && m.at < to).reduce((s, m) => s + m.qtyBase, 0);
}

// ---- Units --------------------------------------------------------------------------------

/** The unit a brewer reads stock in: lb for malt and hops, grams or packs for yeast, gallons for liquids. */
export function displayUnitFor(category: string, base: BaseUnit): string {
  if (base === "each") return "pkg";
  if (base === "ml") return "gal";
  return category === "Yeast" ? "g" : "lb";
}

/** A base amount in `unit`, or null when that unit doesn't fit the ingredient. */
export function fromBase(qtyBase: number, unit: string, base: BaseUnit, conversions: readonly CustomConversion[]): number | null {
  try {
    const per = brewToBase(1, unit, base, conversions);
    return per > 0 ? qtyBase / per : null;
  } catch {
    return null;
  }
}

/** Units an amount can be typed in: the ingredient's own (a sack, a box) first, then the usual ones. */
export function entryUnitsFor(base: BaseUnit, conversions: readonly CustomConversion[]): string[] {
  const usual = base === "g" ? ["lb", "oz", "kg", "g"] : base === "ml" ? ["gal", "l", "ml"] : ["pkg"];
  const own = conversions.map((c) => c.unit.trim()).filter((u) => u && !usual.includes(u.toLowerCase()));
  return [...new Set([...own, ...usual])];
}

/**
 * A recipe line's amount for a brew of another size. Packages round up to whole
 * ones (you can't pitch 4.3 packs); weights and volumes scale exactly.
 */
export function scaleBrewQty(qty: number, unit: string, recipeBbl: number, brewBbl: number): number {
  if (!(recipeBbl > 0) || !(brewBbl > 0)) return qty;
  const scaled = (qty * brewBbl) / recipeBbl;
  const u = brewUnit(unit);
  return u && COUNT_UNITS.includes(u) ? Math.ceil(scaled - 1e-9) : scaled;
}

// ---- Looking ahead ------------------------------------------------------------------------

/** Weeks the shelf lasts at the faster of recent use and what planned brews need. Null when neither uses any. */
export function weeksOfCover(onHandBase: number, usedRecent: number, neededAhead: number): number | null {
  const perWeek = Math.max((usedRecent / RECENT_USE_DAYS) * 7, (neededAhead / STOCK_HORIZON_DAYS) * 7);
  if (!(perWeek > 0)) return null;
  return Math.max(0, onHandBase) / perWeek;
}

export type StockStatus = "uncounted" | "short" | "soon" | "fine";
export const STATUS_LABEL: Record<StockStatus, string> = { uncounted: "Not counted", short: "Short", soon: "Order soon", fine: "Fine" };

/**
 * Give stock to planned brews in date order and see which brew first goes
 * without. A brew planned before today that hasn't been brewed counts as due now.
 * `counted: false` (never counted) makes it "uncounted" whatever the sums say.
 */
export function stockStatus(i: { onHandBase: number; needs: { on: ISODate; qtyBase: number }[]; today: ISODate; horizonDays?: number; counted?: boolean }): { status: StockStatus; firstShortOn: ISODate | null; neededBase: number; shortBase: number } {
  const end = addDays(i.today, i.horizonDays ?? STOCK_HORIZON_DAYS);
  const needs = i.needs.filter((n) => n.on <= end && n.qtyBase > 0).sort((a, b) => a.on.localeCompare(b.on));
  let left = Math.max(0, i.onHandBase);
  let firstShortOn: ISODate | null = null;
  let shortBase = 0;
  const neededBase = needs.reduce((s, n) => s + n.qtyBase, 0);
  for (const n of needs) {
    const take = Math.min(left, n.qtyBase);
    left -= take;
    if (n.qtyBase - take > 1e-9) {
      shortBase += n.qtyBase - take;
      firstShortOn ??= n.on;
    }
  }
  const shortBy = addDays(i.today, SHORT_DAYS);
  const status: StockStatus = i.counted === false ? "uncounted" : i.onHandBase < -1e-9 || (firstShortOn != null && firstShortOn <= shortBy) ? "short" : firstShortOn ? "soon" : "fine";
  return { status, firstShortOn, neededBase, shortBase };
}
