/**
 * Where a beer stands: core (we never want to run out), in rotation (brewed
 * sometimes) or retired (not brewed any more). Stored as two flags on Beer,
 * `active` and `core`, so a retired beer keeps its history.
 *
 * Only core beers are nagged about (fill suggestions, run-out warnings,
 * alerts). Stock lists show what is in stock against what should be: core
 * beers always, beers in rotation while they have full kegs or one on tap,
 * retired beers only while kegs still hold them. Also here: a beer's kegs by
 * size, and the first-time suggestion of each beer's standing from its keg
 * history and recent sales. Pure: no I/O.
 */

import { addDays, type ISODate } from "./dates";
import { KEG_SIZE_LIST, type KegStatus } from "./kegs";

export type Standing = "core" | "rotation" | "retired";
export const STANDINGS: Standing[] = ["core", "rotation", "retired"];

export const STANDING_LABEL: Record<Standing, string> = { core: "Core", rotation: "In rotation", retired: "Retired" };
export const STANDING_HINT: Record<Standing, string> = {
  core: "We never want to run out",
  rotation: "Brewed sometimes",
  retired: "Not brewed any more",
};

export interface StandingFlags {
  active: boolean;
  core: boolean;
}

export function standingOf(b: StandingFlags): Standing {
  return !b.active ? "retired" : b.core ? "core" : "rotation";
}

export function standingFlags(s: Standing): StandingFlags {
  return { active: s !== "retired", core: s === "core" };
}

export const isStanding = (v: unknown): v is Standing => typeof v === "string" && (STANDINGS as string[]).includes(v);

/** Fill suggestions, run-out warnings, alerts and "nothing full behind it" are for core beers only. */
export const nagsAbout = (b: StandingFlags) => standingOf(b) === "core";

const RANK: Record<Standing, number> = { core: 0, rotation: 1, retired: 2 };

/** Core first, then in rotation, then retired; by name within each. */
export function byStanding(a: StandingFlags & { name: string }, b: StandingFlags & { name: string }): number {
  return RANK[standingOf(a)] - RANK[standingOf(b)] || a.name.localeCompare(b.name);
}

// ---- Stock lists ---------------------------------------------------------------------------------

export interface Held {
  /** Full kegs: filled or in cold storage. */
  full: number;
  onTap: number;
  /** Out at accounts. */
  out: number;
}

export interface Listing {
  show: boolean;
  /** Shown with a quiet "retired" tag. */
  retired: boolean;
  /** Nothing full: the important case for a core beer. */
  noneFull: boolean;
}

/**
 * Whether a beer belongs on a stock list ("what's in stock against what
 * should be"): core always, in rotation with full kegs or one on tap, retired
 * while any keg still holds it (full, on tap or out at an account).
 */
export function stockListing(s: Standing, h: Held): Listing {
  const noneFull = h.full === 0;
  if (s === "core") return { show: true, retired: false, noneFull };
  if (s === "rotation") return { show: h.full > 0 || h.onTap > 0, retired: false, noneFull };
  return { show: h.full + h.onTap + h.out > 0, retired: true, noneFull };
}

/** Every beer, kept or not by `stockListing`, core first then by name. */
export function stockRows<T extends StandingFlags & Held & { name: string }>(beers: T[]): (T & Listing & { standing: Standing })[] {
  return beers
    .map((b) => ({ ...b, ...stockListing(standingOf(b), b), standing: standingOf(b) }))
    .filter((b) => b.show)
    .sort(byStanding);
}

// ---- Kegs of a beer by size ------------------------------------------------------------------------

export interface SizeCount extends Held {
  sizeId: string;
  total: number;
}

/**
 * One beer's kegs that hold beer right now, by size: full, on tap and out at
 * accounts, sizes in the usual order, and a total. Kicked, dirty and clean
 * kegs hold no beer and are left out.
 */
export function kegsBySize(kegs: { sizeId: string; status: KegStatus }[]): { rows: SizeCount[]; total: Held & { total: number } } {
  const by = new Map<string, SizeCount>();
  const total = { full: 0, onTap: 0, out: 0, total: 0 };
  for (const k of kegs) {
    const key = k.status === "FILLED" || k.status === "COLD" ? "full" : k.status === "ON_TAP" ? "onTap" : k.status === "OUT" ? "out" : null;
    if (!key) continue;
    const r = by.get(k.sizeId) ?? { sizeId: k.sizeId, full: 0, onTap: 0, out: 0, total: 0 };
    r[key]++;
    r.total++;
    total[key]++;
    total.total++;
    by.set(k.sizeId, r);
  }
  const order = new Map(KEG_SIZE_LIST.map((s, i) => [s.id, i]));
  const rows = [...by.values()].sort((a, b) => (order.get(a.sizeId) ?? 99) - (order.get(b.sizeId) ?? 99) || a.sizeId.localeCompare(b.sizeId));
  return { rows, total };
}

// ---- Suggesting a standing -----------------------------------------------------------------------

/**
 * The first-time suggestion. Core: filled in the last 90 days and at least
 * three times in the last year. In rotation: filled in the last year, or not
 * but still selling (10+ pints in 90 days), or added lately. Retired: not
 * filled for over a year (or never) and not selling now. Old sales don't count.
 */
export const SUGGEST = { recentDays: 90, yearDays: 365, coreFills: 3, sellingPints: 10, newDays: 90 } as const;

export type SuggestWhy = "regular" | "lately" | "selling" | "new" | "stale" | "never";

export interface Suggestion {
  standing: Standing;
  why: SuggestWhy;
  lastFill: ISODate | null;
  /** Fills in the last year, and in the last 90 days. */
  fills12: number;
  fills90: number;
  pints90: number;
}

export function suggestStanding(i: { fills: ISODate[]; pints90: number; today: ISODate; addedOn?: ISODate | null }): Suggestion {
  const past = i.fills.filter((d) => d <= i.today).sort();
  const lastFill = past[past.length - 1] ?? null;
  const yearAgo = addDays(i.today, -SUGGEST.yearDays);
  const recent = addDays(i.today, -SUGGEST.recentDays);
  const fills12 = past.filter((d) => d > yearAgo).length;
  const fills90 = past.filter((d) => d > recent).length;
  const base = { lastFill, fills12, fills90, pints90: i.pints90 };
  if (fills90 > 0 && fills12 >= SUGGEST.coreFills) return { ...base, standing: "core", why: "regular" };
  if (fills12 > 0) return { ...base, standing: "rotation", why: "lately" };
  if (i.pints90 >= SUGGEST.sellingPints) return { ...base, standing: "rotation", why: "selling" };
  if (!lastFill && i.addedOn && i.addedOn > addDays(i.today, -SUGGEST.newDays)) return { ...base, standing: "rotation", why: "new" };
  return { ...base, standing: "retired", why: lastFill ? "stale" : "never" };
}

/** Why, in a few plain words. `dated` formats a date for people ("Mar 4, 2023"). */
export function suggestionReason(s: Suggestion, dated: (d: ISODate) => string): string {
  const pints = `about ${Math.round(s.pints90)} pints sold in the last 90 days`;
  switch (s.why) {
    case "regular":
      return `Filled ${s.fills12} times in the last year, last on ${dated(s.lastFill!)}`;
    case "lately":
      return s.fills12 === 1 ? `Filled once in the last year, on ${dated(s.lastFill!)}` : `Filled ${s.fills12} times in the last year, last on ${dated(s.lastFill!)}`;
    case "selling":
      return s.lastFill ? `Last filled ${dated(s.lastFill)}, but ${pints}` : `No fill on record, but ${pints}`;
    case "new":
      return "Added lately, not filled yet";
    case "stale":
      return `Last filled ${dated(s.lastFill!)}, over a year ago`;
    case "never":
      return "Never filled, as far as the keg history goes";
  }
}

/** "Pick your core beers" shows until one beer is core or a manager puts it away, and only with beers to pick from. */
export function showCoreHelper(i: { anyCore: boolean; dismissed: boolean; activeBeers: number }): boolean {
  return !i.anyCore && !i.dismissed && i.activeBeers > 0;
}
