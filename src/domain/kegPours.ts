/**
 * From Square sales to beer poured: which beer a Square line is ("New York
 * Nectar* · Full Pour"), how many ounces each pour is, how much is left in a
 * keg on tap, and what kicked kegs say about real yield. Pure.
 */

import { addDays, dateRange, type ISODate } from "./dates";
import { HALF_BBL_OZ } from "./kegs";

// ---- Square item names --------------------------------------------------------------------

/** "New York Nectar* · Full Pour" → { base: "New York Nectar*", variation: "Full Pour" }. Also reads "Golden Lager (Half pour)". */
export function splitItemName(name: string): { base: string; variation: string | null } {
  const n = String(name ?? "").trim();
  const dot = n.split(" · ");
  if (dot.length > 1) return { base: dot[0].trim(), variation: dot.slice(1).join(" · ").trim() || null };
  const paren = n.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (paren && POUR_WORD.test(paren[2])) return { base: paren[1].trim(), variation: paren[2].trim() };
  const dash = n.match(/^(.*?)\s+-\s+(.+)$/);
  if (dash && POUR_WORD.test(dash[2])) return { base: dash[1].trim(), variation: dash[2].trim() };
  return { base: n, variation: null };
}

const POUR_WORD = /pour|pint|oz|ounce|taster|sample|flight|growler|crowler|glass|large|small|full|half|mug|stein|pitcher|\d/i;

/** Compare names loosely: case, stars, punctuation and extra spaces don't matter. */
export const beerKey = (s: string) => String(s ?? "").toLowerCase().replace(/[*™®]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Ordered: the first match wins, so "half pour" beats "pour".
const DEFAULT_POUR_OZ: [RegExp, number][] = [
  [/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?oz/, -1], // "10 oz" → 10
  [/growler/, 64],
  [/crowler/, 32],
  [/pitcher/, 60],
  [/flight/, 16],
  [/taster|sample|tasting/, 4],
  [/half|small|short|kid/, 8],
  [/large|stein|mug|imperial|20/, 20],
  [/full|pint|regular|glass|standard/, 16],
];

export const DEFAULT_OZ = 16;

/** Ounces in one pour. `overrides` (lowercased variation → oz) wins; then a recipe's ounces; then the name; then a pint. 0 means "not from a keg" (cans). */
export function pourOz(variation: string | null, opts: { overrides?: Record<string, number>; recipeOz?: number | null } = {}): number {
  const v = (variation ?? "").trim().toLowerCase();
  const o = opts.overrides?.[v];
  if (o != null && Number.isFinite(o) && o >= 0) return o;
  if (opts.recipeOz && opts.recipeOz > 0) return opts.recipeOz;
  if (/\bcans?\b|4.?pack|6.?pack|bottle/.test(v)) return 0;
  for (const [re, oz] of DEFAULT_POUR_OZ) {
    const m = v.match(re);
    if (m) return oz === -1 ? Number(m[1]) : oz;
  }
  return DEFAULT_OZ;
}

export interface BeerMatcher {
  id: string;
  name: string;
  squareNames: string[];
}

/** The beer a Square item base name belongs to: an explicit Square name first, then the beer's own name. */
export function matchBeer(base: string, beers: BeerMatcher[]): string | null {
  const k = beerKey(base);
  if (!k) return null;
  for (const b of beers) if (b.squareNames.some((s) => beerKey(s) === k)) return b.id;
  for (const b of beers) if (beerKey(b.name) === k) return b.id;
  return null;
}

export interface SaleRow {
  date: ISODate;
  squareId: string;
  name: string;
  qty: number;
}

/** Which beer and how many ounces one Square line is (cached per item). */
export function pourResolver(beers: BeerMatcher[], opts: { overrides?: Record<string, number>; recipeOz?: Record<string, number> } = {}) {
  const cache = new Map<string, { beer: string | null; oz: number }>();
  return (squareId: string, name: string) => {
    const key = `${squareId}|${name}`;
    let hit = cache.get(key);
    if (!hit) {
      const { base, variation } = splitItemName(name);
      hit = { beer: matchBeer(base, beers), oz: pourOz(variation, { overrides: opts.overrides, recipeOz: opts.recipeOz?.[squareId] }) };
      cache.set(key, hit);
    }
    return hit;
  };
}

/** Ounces per beer per day from Square lines. Lines that aren't a known beer are skipped. */
export function ozByBeerDay(rows: SaleRow[], beers: BeerMatcher[], opts: { overrides?: Record<string, number>; recipeOz?: Record<string, number> } = {}): Map<string, Map<ISODate, number>> {
  const out = new Map<string, Map<ISODate, number>>();
  const resolve = pourResolver(beers, opts);
  for (const r of rows) {
    const hit = resolve(r.squareId, r.name);
    if (!hit.beer || hit.oz <= 0) continue;
    const m = out.get(hit.beer) ?? new Map<ISODate, number>();
    m.set(r.date, (m.get(r.date) ?? 0) + r.qty * hit.oz);
    out.set(hit.beer, m);
  }
  return out;
}

/** Net sales per ounce per beer (what an ounce of it brings in). */
export function dollarsPerOz(rows: (SaleRow & { netSales: number })[], beers: BeerMatcher[], opts: { overrides?: Record<string, number>; recipeOz?: Record<string, number> } = {}): Map<string, number> {
  const resolve = pourResolver(beers, opts);
  const oz = new Map<string, number>(), dollars = new Map<string, number>();
  for (const r of rows) {
    const hit = resolve(r.squareId, r.name);
    if (!hit.beer || hit.oz <= 0) continue;
    oz.set(hit.beer, (oz.get(hit.beer) ?? 0) + r.qty * hit.oz);
    dollars.set(hit.beer, (dollars.get(hit.beer) ?? 0) + r.netSales);
  }
  const out = new Map<string, number>();
  for (const [b, o] of oz) if (o > 0) out.set(b, (dollars.get(b) ?? 0) / o);
  return out;
}

/** Square base names that look like draft beer and aren't matched yet, with how many sold — suggestions for the beer list. */
export function unmatchedDraftNames(rows: { name: string; qty: number }[], beers: BeerMatcher[]): { base: string; qty: number }[] {
  const by = new Map<string, { base: string; qty: number }>();
  for (const r of rows) {
    const { base, variation } = splitItemName(r.name);
    if (!variation || !POUR_WORD.test(variation) || matchBeer(base, beers)) continue;
    const k = beerKey(base);
    const cur = by.get(k) ?? { base, qty: 0 };
    cur.qty += r.qty;
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => b.qty - a.qty);
}

// ---- Poured since a time --------------------------------------------------------------------

/** A business date and hour (0–23), e.g. tapped at 7pm on Nov 12 → { date: "2026-11-12", hour: 19 }. */
export interface DayHour {
  date: ISODate;
  hour: number;
}

/**
 * Ounces poured from `from` to `to` (exclusive end, null = now). Square gives
 * beer by day only, so the first and last day count the share of that day's
 * store sales that came after (or before) the hour — from hourly sales, or
 * an even split of the hours if there's none.
 */
export function ozBetween(daily: Map<ISODate, number> | undefined, from: DayHour, to: DayHour | null, hourShare: (date: ISODate, fromHour: number, toHour: number) => number): number {
  if (!daily) return 0;
  const endDate = to?.date ?? null;
  let total = 0;
  const last = endDate ?? [...daily.keys()].sort().at(-1) ?? from.date;
  if (last < from.date) return 0;
  for (const d of dateRange(from.date, addDays(last, 1))) {
    const oz = daily.get(d) ?? 0;
    if (!oz) continue;
    const a = d === from.date ? from.hour : 0;
    const b = to && d === to.date ? to.hour : 24;
    if (b <= a) continue;
    total += oz * (a === 0 && b === 24 ? 1 : hourShare(d, a, b));
  }
  return total;
}

/** Share of a day's sales between two hours from an hourly profile (24 numbers); even split without one. */
export function shareFromHours(hours: number[] | undefined, fromHour: number, toHour: number): number {
  const a = Math.max(0, Math.min(24, fromHour));
  const b = Math.max(a, Math.min(24, toHour));
  if (!hours || hours.length !== 24) return (b - a) / 24;
  const all = hours.reduce((s, x) => s + Math.max(0, x), 0);
  if (all <= 0) return (b - a) / 24;
  let part = 0;
  for (let h = a; h < b; h++) part += Math.max(0, hours[h]);
  return part / all;
}

// ---- Yield --------------------------------------------------------------------------------

/** What we assume before any keg has kicked: foam, line flushes and the last pint. */
export const DEFAULT_YIELD = 0.9;

export interface KickSample {
  /** Full keg, fl oz. */
  kegOz: number;
  /** Poured from it per Square, fl oz. */
  soldOz: number;
}

/**
 * Real yield from kicked kegs: Square ounces ÷ keg ounces. Odd ones (a keg
 * tapped with no sales matched, or two kegs of one beer confused) are left
 * out; the median of the rest is the answer.
 */
export function calibrateYield(samples: KickSample[], fallback = DEFAULT_YIELD): { yield: number; samples: number; pintsPerHalf: number; measured: boolean } {
  const ratios = samples.filter((s) => s.kegOz > 0 && s.soldOz > 0).map((s) => s.soldOz / s.kegOz).filter((r) => r >= 0.5 && r <= 1.1).sort((a, b) => a - b);
  if (ratios.length === 0) return { yield: fallback, samples: 0, pintsPerHalf: (HALF_BBL_OZ * fallback) / 16, measured: false };
  const mid = ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2;
  // With one or two kicks, lean on the assumption a little.
  const w = Math.min(1, ratios.length / 3);
  // Over 100% means pour sizes are set too small somewhere; never promise more than 98%.
  const y = Math.min(0.98, w * mid + (1 - w) * fallback);
  return { yield: y, samples: ratios.length, pintsPerHalf: (HALF_BBL_OZ * y) / 16, measured: true };
}

export interface TapEstimate {
  /** 0..1 of what you'll actually pour. */
  pctLeft: number;
  ozLeft: number;
  pintsLeft: number;
  /** null when we have no recent pace. */
  daysLeft: number | null;
  /** Poured so much more than the keg should hold that it's probably kicked already. */
  overdue: boolean;
}

/** How much is left in a keg on tap and how long it lasts at the recent pace (oz a day). */
export function tapEstimate(kegOz: number, yieldPct: number, soldOz: number, ozPerDay: number | null): TapEstimate {
  const usable = kegOz * yieldPct;
  const ozLeft = Math.max(0, usable - soldOz);
  const pctLeft = usable > 0 ? ozLeft / usable : 0;
  return {
    pctLeft,
    ozLeft,
    pintsLeft: ozLeft / 16,
    daysLeft: ozPerDay && ozPerDay > 0 ? ozLeft / ozPerDay : null,
    overdue: soldOz > usable * 1.08,
  };
}
