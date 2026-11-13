/**
 * Suggested purchase orders.
 *
 * For each ingredient bought from a supplier:
 *   projected on hand at delivery = on hand now − usage until delivery + already-ordered
 *   needed for the cover window   = forecast usage (delivery → next delivery) × (1 + safety)
 *   order                         = max(0, needed − projected), rounded up to whole packs
 *
 * Items with no recipe usage (cleaning supplies, napkins, garnish bought by
 * eye) fall back to a minimum-on-hand par: order up to the par.
 *
 * Every number that goes into a suggestion is returned alongside it, so the
 * person placing the order can see *why* and override confidently.
 */

import { addDays, ISODate, nextWeekdayOnOrAfter } from "./dates";

export interface OrderableProduct {
  supplierProductId: string;
  ingredientId: string;
  ingredientName: string;
  description: string;
  purchaseUnit: string;
  packQtyBase: number | null;
  unitPrice: number | null;
  safetyPct: number;
}

export interface IngredientPosition {
  onHandNow: number; // base units, may be estimated
  /** False when the ingredient has never been counted — stock is unknown, not zero. */
  onHandKnown?: boolean;
  usageUntilDelivery: number; // base units
  usageDuringCover: number; // base units
  incomingBeforeDelivery: number; // base units already on open orders
  /** Minimum on hand (base units) for items forecasts don't move. */
  parLevel?: number | null;
  /** Days from today to delivery, and delivery to the end of the cover window (for days of cover). */
  daysUntilDelivery?: number;
  coverDays?: number;
  /** Forecast use per day from today (base units); makes days of cover follow busy weekends. */
  dailyUsage?: readonly number[];
}

export interface OrderSuggestion {
  supplierProductId: string;
  ingredientId: string;
  ingredientName: string;
  description: string;
  purchaseUnit: string;
  packQtyBase: number | null;
  unitPrice: number | null;
  projectedAtDelivery: number;
  neededForCover: number;
  shortfall: number;
  suggestedUnits: number;
  lineCost: number | null;
  status: OrderStatus;
  /** On hand now ÷ average forecast daily use; null when nothing uses it. */
  daysOfCover: number | null;
  /** Ordered up to a par level instead of from the forecast. */
  byPar: boolean;
  note?: string;
}

/** `runs-out`: stock runs out before this delivery arrives (order anyway, and find a bridge). */
export type OrderStatus = "covered" | "order" | "runs-out" | "needs-setup" | "needs-count";

/** Days the stock on hand lasts at the forecast rate of use. */
export function daysOfCover(onHand: number, usage: number, days: number): number | null {
  if (days <= 0 || usage <= 0) return null;
  return Math.max(0, onHand) / (usage / days);
}

/**
 * Days of cover walking the day-by-day forecast (so a busy Saturday eats more),
 * extrapolating at the average rate past the end of the forecast.
 */
export function daysOfCoverDaily(onHand: number, daily: readonly number[]): number | null {
  const total = daily.reduce((a, b) => a + b, 0);
  if (daily.length === 0 || total <= 0) return null;
  let left = Math.max(0, onHand);
  for (let i = 0; i < daily.length; i++) {
    const u = daily[i];
    if (u > 0 && left < u) return i + left / u;
    left -= u;
  }
  return daily.length + left / (total / daily.length);
}

export function suggestLine(p: OrderableProduct, pos: IngredientPosition): OrderSuggestion {
  const projected = pos.onHandNow - pos.usageUntilDelivery + pos.incomingBeforeDelivery;
  const noUsage = pos.usageUntilDelivery <= 0 && pos.usageDuringCover <= 0;
  const byPar = noUsage && pos.parLevel != null && pos.parLevel > 0;
  const needed = byPar ? pos.parLevel! : pos.usageDuringCover * (1 + p.safetyPct);
  const shortfall = Math.max(0, needed - Math.max(0, projected));
  const known = pos.onHandKnown !== false;
  const days = (pos.daysUntilDelivery ?? 0) + (pos.coverDays ?? 0);
  const cover = !known ? null : pos.dailyUsage?.length ? daysOfCoverDaily(pos.onHandNow, pos.dailyUsage) : daysOfCover(pos.onHandNow, pos.usageUntilDelivery + pos.usageDuringCover, days);
  // Runs dry before the truck: what we have plus what's already coming won't last until delivery.
  const runsOut = known && pos.usageUntilDelivery > 0 && pos.onHandNow + pos.incomingBeforeDelivery < pos.usageUntilDelivery;

  const base = {
    supplierProductId: p.supplierProductId,
    ingredientId: p.ingredientId,
    ingredientName: p.ingredientName,
    description: p.description,
    purchaseUnit: p.purchaseUnit,
    packQtyBase: p.packQtyBase,
    unitPrice: p.unitPrice,
    projectedAtDelivery: projected,
    neededForCover: needed,
    shortfall,
    daysOfCover: cover,
    byPar,
  };

  if (!p.packQtyBase || p.packQtyBase <= 0) {
    return { ...base, suggestedUnits: 0, lineCost: null, status: "needs-setup", note: "Set the pack size so this can be ordered automatically." };
  }
  if (pos.onHandKnown === false) {
    // Don't guess: ordering a full case because we *don't know* is how over-ordering happens.
    return { ...base, suggestedUnits: 0, lineCost: 0, status: "needs-count", note: "Count this once so it can be ordered automatically." };
  }
  // Tiny tolerance so 2.0000001 cases doesn't become 3.
  const units = shortfall <= 0 ? 0 : Math.ceil(shortfall / p.packQtyBase - 1e-6);
  return {
    ...base,
    suggestedUnits: units,
    lineCost: p.unitPrice == null ? null : units * p.unitPrice,
    status: runsOut ? "runs-out" : units > 0 ? "order" : "covered",
    note: runsOut
      ? `Runs out about ${Math.max(0, Math.floor(cover ?? 0))} day${Math.floor(cover ?? 0) === 1 ? "" : "s"} from now, before this delivery. Borrow, buy locally or ask for an earlier drop.`
      : byPar
        ? "No recipe uses this, so it's ordered up to its minimum on hand."
        : undefined,
  };
}

/**
 * Estimated on-hand quantity: last count, plus deliveries received after it,
 * minus theoretical usage from sales and logged waste since the count.
 */
export function estimateOnHand(args: {
  lastCountQty: number | null;
  receivedSinceCount: number;
  usageSinceCount: number;
  wasteSinceCount: number;
}): { qty: number; estimated: boolean } {
  if (args.lastCountQty == null) return { qty: 0, estimated: true };
  const qty = args.lastCountQty + args.receivedSinceCount - args.usageSinceCount - args.wasteSinceCount;
  return { qty: Math.max(0, qty), estimated: true };
}

// ---- Order cutoffs and auto-drafts ---------------------------------------------------

export interface CutoffRule {
  /** Order deadline, local "HH:MM" (default 14:00). */
  time: string;
  /** Days before delivery the order must be in (default: the supplier's lead time). */
  daysBefore: number;
  /** Draft automatically ahead of the cutoff (default true). */
  autoDraft: boolean;
}

export const DEFAULT_CUTOFF_TIME = "14:00";

export function cutoffRule(saved: Partial<CutoffRule> | undefined, leadTimeDays: number): CutoffRule {
  const time = saved?.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(saved.time) ? saved.time : DEFAULT_CUTOFF_TIME;
  const daysBefore = Number.isInteger(saved?.daysBefore) && saved!.daysBefore! >= 0 ? saved!.daysBefore! : Math.max(0, leadTimeDays);
  return { time, daysBefore, autoDraft: saved?.autoDraft !== false };
}

/**
 * The next delivery whose order cutoff hasn't passed, and that cutoff.
 * `nowDate`/`nowTime` are the business-local date and "HH:MM".
 */
export function nextCutoff(deliveryDays: readonly number[], rule: CutoffRule, nowDate: ISODate, nowTime: string): { deliveryDate: ISODate; cutoffDate: ISODate; cutoffTime: string } | null {
  if (deliveryDays.length === 0) return null;
  let d = nextWeekdayOnOrAfter(addDays(nowDate, rule.daysBefore), deliveryDays);
  for (let i = 0; d && i < 3; i++) {
    const cutoffDate = addDays(d, -rule.daysBefore);
    if (cutoffDate > nowDate || (cutoffDate === nowDate && nowTime < rule.time)) return { deliveryDate: d, cutoffDate, cutoffTime: rule.time };
    d = nextWeekdayOnOrAfter(addDays(d, 1), deliveryDays);
  }
  return null;
}

/** Hours from now (local date + "HH:MM") until a local cutoff. */
export function hoursUntil(nowDate: ISODate, nowTime: string, cutoffDate: ISODate, cutoffTime: string): number {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const dayDiff = (Date.parse(`${cutoffDate}T00:00:00Z`) - Date.parse(`${nowDate}T00:00:00Z`)) / 86400000;
  return dayDiff * 24 + (mins(cutoffTime) - mins(nowTime)) / 60;
}

/**
 * Should a draft be created now? Yes when auto-drafting is on, the cutoff is
 * within `windowHours` (default 36 — a daily job always catches it at least
 * once, the day before or the morning of) and nothing is on order yet for that delivery.
 */
export function shouldAutoDraft(args: { rule: CutoffRule; hoursToCutoff: number; hasOrderForDelivery: boolean; windowHours?: number }): boolean {
  const w = args.windowHours ?? 36;
  return args.rule.autoDraft && !args.hasOrderForDelivery && args.hoursToCutoff > 0 && args.hoursToCutoff <= w;
}
