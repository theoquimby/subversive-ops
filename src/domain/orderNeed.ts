/**
 * Does a supplier we only order from "when stock runs low" need an order now?
 *
 * Ordering now is the last chance before the delivery after next: skip this
 * one and the next truck you can get is that one. So for each item:
 *
 *   left at the delivery after next = on hand now + already on order
 *                                     − forecast use until then
 *   safety level                     = the item's buffer (safety %) of one
 *                                     delivery's use, or its minimum on hand
 *
 * The supplier needs an order only if some item would be left below its
 * safety level (or already is). Items with no count, or a count older than
 * COUNT_STALE_DAYS, aren't guessed at: they don't raise an alert, they ask
 * for a count. Pure: no DB.
 */

import { daysBetween, type ISODate } from "./dates";

/** Counts older than this (days) are too old to decide on. */
export const COUNT_STALE_DAYS = 21;

export interface ItemNeedInput {
  name: string;
  today: ISODate;
  /** Business date of the last count, null when never counted. */
  countedOn: ISODate | null;
  /** Estimated on hand now (base units): last count + received − used since. */
  onHandNow: number;
  /** Already on order and arriving before the delivery after next (base units). */
  incoming: number;
  /** Forecast use from today until the next delivery, and from it to the delivery after (base units). */
  usageToNext: number;
  usageNextToAfter: number;
  /** The item's buffer, e.g. 0.2 = 20%. */
  safetyPct: number;
  /** Minimum on hand (base units) for items no recipe uses. */
  par: number | null;
}

export type ItemNeedStatus = "short" | "ok" | "unknown" | "unused";

export interface ItemNeed {
  name: string;
  status: ItemNeedStatus;
  /** Left when the delivery after next arrives (base units). */
  projected: number;
  /** The level it shouldn't drop below (base units). */
  safety: number;
}

export function itemNeed(i: ItemNeedInput, opts: { staleDays?: number } = {}): ItemNeed {
  const staleDays = opts.staleDays ?? COUNT_STALE_DAYS;
  const usage = Math.max(0, i.usageToNext) + Math.max(0, i.usageNextToAfter);
  const byPar = usage <= 0 && i.par != null && i.par > 0;
  const safety = byPar ? i.par! : Math.max(0, i.usageNextToAfter) * Math.max(0, i.safetyPct);
  const projected = i.onHandNow + i.incoming - usage;
  if (usage <= 0 && !byPar) return { name: i.name, status: "unused", projected, safety };
  const fresh = i.countedOn != null && daysBetween(i.countedOn, i.today) <= staleDays;
  if (!fresh) return { name: i.name, status: "unknown", projected, safety };
  const alreadyBelow = i.incoming <= 0 && i.onHandNow < safety;
  return { name: i.name, status: projected < safety || alreadyBelow ? "short" : "ok", projected, safety };
}

export interface SupplierNeed {
  /** Some item runs below its safety level before the delivery after next. */
  needs: boolean;
  /** Items that run short. */
  short: string[];
  /** Items that matter but have no recent count ("count needed to know"). */
  countNeeded: string[];
  /** Items with a recent count that were checked. */
  checked: number;
}

export function supplierNeed(items: readonly ItemNeed[]): SupplierNeed {
  const short = items.filter((i) => i.status === "short").map((i) => i.name);
  return {
    needs: short.length > 0,
    short,
    countNeeded: items.filter((i) => i.status === "unknown").map((i) => i.name),
    checked: items.filter((i) => i.status === "short" || i.status === "ok").length,
  };
}

// ---- Cadence and alert mode ------------------------------------------------------------

export type OrderCadence = "regular" | "as_needed";

export const CADENCE_OPTIONS: { value: OrderCadence; label: string; hint: string }[] = [
  { value: "regular", label: "Every delivery", hint: "You order for every truck. Ops reminds you when nothing is placed before the deadline." },
  { value: "as_needed", label: "When stock runs low", hint: "Only when counts and sales say something runs short before the delivery after next. Otherwise it stays quiet." },
];

export const cadenceOf = (v: string | null | undefined): OrderCadence => (v === "as_needed" ? "as_needed" : "regular");

/** on: every delivery · low: only when stock runs short · off: never. */
export type AlertMode = "on" | "low" | "off";

export const ALERT_OPTIONS: { value: AlertMode; label: string }[] = [
  { value: "on", label: "Every delivery" },
  { value: "low", label: "Only when stock runs low" },
  { value: "off", label: "Off" },
];

/** The alert mode in force: what was set for the supplier, else what its cadence implies. */
export function alertMode(cadence: string | null | undefined, set: AlertMode | null | undefined): AlertMode {
  if (set === "on" || set === "low" || set === "off") return set;
  return cadenceOf(cadence) === "as_needed" ? "low" : "on";
}

/** Should a missing order for this supplier raise an alert? */
export function shouldNag(mode: AlertMode, need: Pick<SupplierNeed, "needs"> | null | undefined): boolean {
  if (mode === "off") return false;
  if (mode === "on") return true;
  return need?.needs === true;
}

/** Brewery suppliers and ingredients belong to the Brewery's own ordering, not the kitchen's. */
export const isBrewery = (department: string | null | undefined) => department === "brewery";
