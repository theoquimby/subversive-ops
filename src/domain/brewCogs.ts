/**
 * Brewing cost of goods: what a recipe costs per batch, barrel, keg and pint,
 * what that leaves of the selling price, and "what if" — an ingredient's price,
 * the batch size or the yield loss changed, nothing saved. Pure: the costs page
 * works it out live in the browser.
 *
 * - Per-volume costs share the batch cost over what reaches the kegs: the batch
 *   less the yield loss (5% unless the what-if says otherwise).
 * - A different batch size scales every amount. Packages round up to whole
 *   ones, so per-pint cost can move a little; weights scale exactly.
 * - Pint margin is against the pour price, after foam and line loss (the
 *   measured pour yield). Keg margins are against wholesale keg prices.
 * - A recipe with unpriced lines has a cost that's a floor; its margin a ceiling.
 */

import { GAL_PER_BBL } from "./brewMath";
import { costBrewRecipe, HALF_BBL_GAL, PACKAGING_LOSS, PINT_GAL, SIXTH_BBL_GAL, type CostLine, type PricedIngredient } from "./brewRecipes";
import { scaleBrewQty } from "./brewStock";

export interface CogsRecipe {
  id: string;
  name: string;
  batchBbl: number;
  lines: CostLine[];
  /** What a 16 oz pour sells for (Square), or null */
  pintPrice: number | null;
  /** Wholesale price of a full 1/2 bbl and 1/6 bbl keg, or null */
  halfPrice: number | null;
  sixthPrice: number | null;
}

export interface WhatIfInput {
  /** Ingredient id → percent change (+10 = 10% dearer) */
  pricePct: Record<string, number>;
  /** Brew every recipe at this size (bbl); null = each recipe's own */
  batchBbl: number | null;
  /** Percent lost between brewhouse and kegs; null = the usual 5% */
  lossPct: number | null;
}

export const NO_CHANGE: WhatIfInput = { pricePct: {}, batchBbl: null, lossPct: null };

export interface Cogs {
  batchBbl: number;
  total: number;
  unpricedLines: number;
  complete: boolean;
  perBbl: number | null;
  perHalf: number | null;
  perSixth: number | null;
  /** 16 oz of packaged beer */
  perPint: number | null;
  /** A 16 oz pour after foam and line loss */
  pouredPint: number | null;
  pintMargin: number | null;
  halfMargin: number | null;
  sixthMargin: number | null;
}

export const margin = (price: number | null | undefined, cost: number | null | undefined): number | null =>
  price != null && price > 0 && cost != null && Number.isFinite(cost) ? (price - cost) / price : null;

/** The catalog with some prices moved by a percentage. Unchanged ingredients are the same objects. */
export function withPriceChanges(ingredients: ReadonlyMap<string, PricedIngredient>, pricePct: Record<string, number>): Map<string, PricedIngredient> {
  const out = new Map(ingredients);
  for (const [id, pct] of Object.entries(pricePct)) {
    const i = ingredients.get(id);
    if (!i || i.costPerBase == null || !Number.isFinite(pct) || pct === 0) continue;
    out.set(id, { ...i, costPerBase: i.costPerBase * (1 + pct / 100) });
  }
  return out;
}

export function cogsFor(r: CogsRecipe, ingredients: ReadonlyMap<string, PricedIngredient>, opts: WhatIfInput & { pourYield: number }): Cogs {
  const bbl = opts.batchBbl != null && opts.batchBbl > 0 ? opts.batchBbl : r.batchBbl;
  const lines = bbl === r.batchBbl ? r.lines : r.lines.map((l) => ({ ...l, qty: scaleBrewQty(l.qty, l.unit, r.batchBbl, bbl) }));
  const c = costBrewRecipe(lines, withPriceChanges(ingredients, opts.pricePct), bbl);
  const loss = opts.lossPct != null && opts.lossPct >= 0 && opts.lossPct < 100 ? opts.lossPct / 100 : PACKAGING_LOSS;
  const gal = c.batchBbl * GAL_PER_BBL * (1 - loss);
  const perGal = gal > 0 ? c.total / gal : null;
  const per = (g: number) => (perGal == null ? null : perGal * g);
  const perPint = per(PINT_GAL);
  const perHalf = per(HALF_BBL_GAL);
  const perSixth = per(SIXTH_BBL_GAL);
  const pouredPint = perPint != null && opts.pourYield > 0 ? perPint / opts.pourYield : null;
  return {
    batchBbl: c.batchBbl,
    total: c.total,
    unpricedLines: c.unpricedLines,
    complete: c.complete,
    perBbl: per(GAL_PER_BBL),
    perHalf,
    perSixth,
    perPint,
    pouredPint,
    pintMargin: margin(r.pintPrice, pouredPint),
    halfMargin: margin(r.halfPrice, perHalf),
    sixthMargin: margin(r.sixthPrice, perSixth),
  };
}

const moved = (a: number | null, b: number | null) => (a == null) !== (b == null) || (a != null && b != null && Math.abs(a - b) > 1e-6);

/** Every recipe as it is and with the what-if applied; `affected` when anything moved. */
export function whatIf(recipes: CogsRecipe[], ingredients: ReadonlyMap<string, PricedIngredient>, w: WhatIfInput, pourYield: number): { id: string; base: Cogs; next: Cogs; affected: boolean }[] {
  return recipes.map((r) => {
    const base = cogsFor(r, ingredients, { ...NO_CHANGE, pourYield });
    const next = cogsFor(r, ingredients, { ...w, pourYield });
    return { id: r.id, base, next, affected: moved(base.total, next.total) || moved(base.perPint, next.perPint) };
  });
}

/** A history chart needs at least two dates where every line had a price. */
export const historyChartable = (points: { date: string; perPint: number | null }[]) => points.filter((p) => p.perPint != null).length >= 2;
