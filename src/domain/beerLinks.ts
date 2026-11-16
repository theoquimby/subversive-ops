/**
 * How the pieces around a beer link up, so nothing is kept twice: the keg
 * ingredient's price comes from brewing when it can, a keg fill goes on a batch
 * of the same beer, a brew takes its recipe's beer, and the ABV on the board is
 * the typed one or else the measured one. Pure.
 */

import { GAL_PER_BBL, ML_PER_GAL } from "./brewMath";
import { PACKAGING_LOSS } from "./brewRecipes";

export const sameMoney = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && Math.abs(a - b) < 0.005;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What one keg costs from a brew's ingredient cost: the cost shared over what
 * reaches the kegs (the batch less packaging loss, as brewing recipes count
 * it), times what the keg holds. `kegMl` is the keg's size in ml (the keg
 * ingredient's "keg" unit). Null when anything is missing.
 */
export function kegPriceFromBrew(b: { cost: number | null; bbl: number | null }, kegMl: number): number | null {
  const perMl = brewCostPerMl(b);
  return perMl == null || !(kegMl > 0) ? null : kegPrice(perMl, kegMl);
}

/** A brew's (or recipe batch's) cost per ml that reaches the kegs. */
export function brewCostPerMl(b: { cost: number | null; bbl: number | null }): number | null {
  if (b.cost == null || !(b.cost > 0) || b.bbl == null || !(b.bbl > 0)) return null;
  return b.cost / (b.bbl * GAL_PER_BBL * (1 - PACKAGING_LOSS) * ML_PER_GAL);
}

/** A keg's price from a cost per ml, to the cent (the browser and the server round the same way). */
export const kegPrice = (perMl: number, kegMl: number) => round2(perMl * kegMl);

export type BrewingKegPrice =
  | { kind: "brew"; brewBatchId: string; code: string; packagedOn: string | null; price: number }
  | { kind: "recipe"; brewRecipeId: string; name: string; price: number };

/** Brewing's keg cost: the latest packaged brew with a cost, else the live brewing recipe when every line is priced. */
export function brewingKegPrice(s: {
  brew: { brewBatchId: string; code: string; packagedOn: string | null; price: number } | null;
  recipe: { brewRecipeId: string; name: string; price: number } | null;
}): BrewingKegPrice | null {
  if (s.brew) return { kind: "brew", ...s.brew };
  if (s.recipe) return { kind: "recipe", ...s.recipe };
  return null;
}

export type KegCostSource = { kind: "brew"; code: string; packagedOn: string | null } | { kind: "recipe"; name: string } | { kind: "typed" } | { kind: "none" };

/** Where a keg ingredient's current price came from (its latest price record). */
export function kegCostSource(latest: { price: number; brewBatch: { code: string; packagedOn: string | null } | null; brewRecipe: { name: string } | null } | null): KegCostSource {
  if (!latest) return { kind: "none" };
  if (latest.brewBatch) return { kind: "brew", code: latest.brewBatch.code, packagedOn: latest.brewBatch.packagedOn };
  if (latest.brewRecipe) return { kind: "recipe", name: latest.brewRecipe.name };
  return { kind: "typed" };
}

// ---- Keg fills and batches ---------------------------------------------------------------

export interface FillBatch {
  id: string;
  code: string;
  /** The batch's beer: its brew's beer when it came from a brew. */
  beerId: string | null;
}

export type FillBatchChoice = { use: string; code: string; setBeer: boolean } | { create: string } | { none: true } | { error: string };

/**
 * Which keg batch a fill goes on. A picked batch (by id) or a typed code that
 * finds one is used when it's the same beer (a batch with no beer takes this
 * one); a typed code nobody has becomes a new batch of this beer; a fill is
 * never put on another beer's batch.
 */
export function chooseFillBatch(i: { beerId: string | null; picked: FillBatch | null; typed: string | null; byCode: FillBatch | null; beerName?: (id: string) => string }): FillBatchChoice {
  const code = (i.typed ?? "").trim();
  const found = i.picked ?? (code ? i.byCode : null);
  if (found) {
    if (found.beerId && i.beerId && found.beerId !== i.beerId) {
      return { error: `Batch ${found.code} is ${i.beerName?.(found.beerId) ?? "another beer"}. Pick this beer's batch, or leave the batch blank.` };
    }
    return { use: found.id, code: found.code, setBeer: !found.beerId && !!i.beerId };
  }
  if (code) return { create: code.slice(0, 40) };
  return { none: true };
}

/** Codes the brewery gives brews: "26-031", a split "26-031B" or "26-014-3". */
export const looksLikeBrewCode = (code: string) => /^\d{2}-\d{1,4}([A-Z]|-\d{1,2})?$/i.test(code.trim());

// ---- Brews ------------------------------------------------------------------------------

/**
 * A brew's beer: the recipe's when the recipe names one (then the brew's own
 * beer can't be changed by hand), else the brew's. `mismatch` flags a brew
 * stored with a different beer from its recipe's, for a manager to look at.
 */
export function brewBeer(b: { recipeBeerId: string | null; beerId: string | null }): { beerId: string | null; mismatch: boolean; locked: boolean } {
  if (b.recipeBeerId) return { beerId: b.recipeBeerId, mismatch: b.beerId !== b.recipeBeerId, locked: true };
  return { beerId: b.beerId, mismatch: false, locked: false };
}

// ---- ABV ---------------------------------------------------------------------------------

/** More than this apart (ABV points), the beer's page says what was measured. */
export const ABV_HINT_GAP = 0.3;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The ABV to show (typed, else measured from the latest packaged brew), and whether the two disagree. */
export function abvView(typed: number | null, measured: number | null): { shown: number | null; measured: number | null; differs: boolean } {
  const m = measured == null ? null : r1(measured);
  return { shown: typed ?? m, measured: m, differs: typed != null && m != null && Math.abs(typed - m) > ABV_HINT_GAP + 1e-9 };
}

// ---- Keg ingredients ---------------------------------------------------------------------

/** Keg ingredients that could be this beer's: "<beer> (keg)" first, then names that contain the beer's name. */
export function kegIngredientMatches<T extends { id: string; name: string }>(beer: string, kegs: readonly T[]): T[] {
  const b = beer.trim().toLowerCase();
  if (!b) return [];
  const exact = kegs.filter((k) => k.name.trim().toLowerCase() === `${b} (keg)`);
  const rest = kegs.filter((k) => !exact.includes(k) && k.name.toLowerCase().includes(b));
  return [...exact, ...rest];
}
