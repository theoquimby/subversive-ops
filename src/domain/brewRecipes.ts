/**
 * What a brewing recipe costs, from today's ingredient prices. Pure: the
 * browser (live as lines change) and the server work it out the same way.
 *
 * A line costs its amount × the matched ingredient's price per base unit (the
 * same price the menu costs use). A line with no matched ingredient, no price
 * or a unit that doesn't fit is listed, never counted as $0: the total is
 * then the least the batch costs.
 *
 * Per-volume costs share the batch cost over what reaches the kegs: the batch
 * size less PACKAGING_LOSS (trub, tank bottoms, transfers). Foam and line loss
 * at the tap are not in them (the keg pages add those).
 */

import { brewUnit, COUNT_UNITS, GAL_PER_BBL, ML_PER_GAL, unitDimension, type BrewLineKind } from "./brewMath";
import { toBase, UnitError, type BaseUnit, type CustomConversion } from "./units";

/** Share of the batch lost between the brewhouse and the kegs. */
export const PACKAGING_LOSS = 0.05;
export const HALF_BBL_GAL = 15.5;
export const SIXTH_BBL_GAL = 5.17;
/** A 16 oz pint, in US gallons */
export const PINT_GAL = 16 / 128;
const ML_PER_FL_OZ = 29.5735295625;

export type BrewRecipeStatus = "live" | "dev" | "archived";
export const RECIPE_STATUSES: { value: BrewRecipeStatus; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "dev", label: "In development" },
  { value: "archived", label: "Archived" },
];
export const isRecipeStatus = (s: string): s is BrewRecipeStatus => s === "live" || s === "dev" || s === "archived";

export const HOP_USE_LABEL: Record<string, string> = { boil: "Boil", firstwort: "First wort", whirlpool: "Whirlpool", dryhop: "Dry hop", mash: "Mash" };
export const KIND_LABEL: Record<BrewLineKind, string> = { grain: "Grain", hop: "Hop", yeast: "Yeast", adjunct: "Adjunct", water: "Water salt", other: "Other" };

export interface PricedIngredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  /** What one base unit actually costs (after yield), or null with no price yet */
  costPerBase: number | null;
  conversions: CustomConversion[];
}

export interface CostLine {
  name: string;
  ingredientId?: string | null;
  qty: number;
  unit: string;
}

export type UnpricedReason = "unmatched" | "no price" | "unit";
export type LineCost = { cost: number } | { cost: null; reason: UnpricedReason };

/** A brewing amount in the ingredient's base unit. "pkg" is one of a counted thing unless the ingredient says what a package holds. Throws UnitError. */
export function brewToBase(qty: number, unit: string, base: BaseUnit, conversions: readonly CustomConversion[]): number {
  const own = conversions.find((c) => c.unit.trim().toLowerCase() === unit.trim().toLowerCase());
  if (own) return qty * own.baseQty;
  const u = brewUnit(unit);
  if (u && COUNT_UNITS.includes(u)) {
    if (base === "each") return qty;
    throw new UnitError(`A ${unit} of this is weighed or measured: say what one ${unit} holds on the ingredient.`);
  }
  return toBase(qty, u ?? unit, base, conversions);
}

export function brewLineCost(line: CostLine, ing: PricedIngredient | undefined): LineCost {
  if (!line.ingredientId || !ing) return { cost: null, reason: "unmatched" };
  if (ing.costPerBase == null) return { cost: null, reason: "no price" };
  if (!(line.qty > 0)) return { cost: 0 };
  try {
    return { cost: brewToBase(line.qty, line.unit, ing.baseUnit, ing.conversions) * ing.costPerBase };
  } catch {
    return { cost: null, reason: "unit" };
  }
}

export interface BrewCost {
  total: number;
  lines: LineCost[];
  unpricedLines: number;
  unpriced: { index: number; name: string; reason: UnpricedReason }[];
  /** Every line priced: the total is the whole cost, not a floor */
  complete: boolean;
  batchBbl: number;
  /** Gallons that reach the kegs */
  sellableGal: number;
  perBbl: number | null;
  perHalf: number | null;
  perSixth: number | null;
  perPint: number | null;
}

export function costBrewRecipe(lines: CostLine[], ingredients: ReadonlyMap<string, PricedIngredient>, batchBbl: number): BrewCost {
  const costs = lines.map((l) => brewLineCost(l, l.ingredientId ? ingredients.get(l.ingredientId) : undefined));
  const total = costs.reduce((s, c) => s + (c.cost ?? 0), 0);
  const unpriced = costs.flatMap((c, index) => (c.cost == null ? [{ index, name: lines[index].name, reason: c.reason }] : []));
  const bbl = Number.isFinite(batchBbl) && batchBbl > 0 ? batchBbl : 0;
  const sellableGal = bbl * GAL_PER_BBL * (1 - PACKAGING_LOSS);
  const perGal = sellableGal > 0 ? total / sellableGal : null;
  return {
    total,
    lines: costs,
    unpricedLines: unpriced.length,
    unpriced,
    complete: unpriced.length === 0,
    batchBbl: bbl,
    sellableGal,
    perBbl: perGal == null ? null : perGal * GAL_PER_BBL,
    perHalf: perGal == null ? null : perGal * HALF_BBL_GAL,
    perSixth: perGal == null ? null : perGal * SIXTH_BBL_GAL,
    perPint: perGal == null ? null : perGal * PINT_GAL,
  };
}

/** The same recipe brewed at another size: costs scale with the amounts. */
export function scaleBrewCost(c: { total: number; unpricedLines: number }, fromBbl: number, toBbl: number): { total: number; unpricedLines: number } {
  if (!(fromBbl > 0) || !(toBbl > 0)) return { total: c.total, unpricedLines: c.unpricedLines };
  return { total: (c.total * toBbl) / fromBbl, unpricedLines: c.unpricedLines };
}

/**
 * Keg pour cost from a brewing recipe: cost per ml of packaged beer, then a pint
 * ÷ the pour yield (foam and line loss) and a full ½ bbl keg. Null unless every
 * line is priced, so a partial cost never undercuts the keg pages.
 */
export function pourCostFromBrew(c: { total: number; unpricedLines: number; batchBbl: number }, pourYield: number, halfKegOz: number): { perPint: number; perHalf: number } | null {
  if (c.unpricedLines > 0 || !(c.batchBbl > 0) || !(c.total > 0) || !(pourYield > 0)) return null;
  const perMl = c.total / (c.batchBbl * GAL_PER_BBL * (1 - PACKAGING_LOSS) * ML_PER_GAL);
  return { perPint: (perMl * 16 * ML_PER_FL_OZ) / pourYield, perHalf: perMl * halfKegOz * ML_PER_FL_OZ };
}

/** Keg cost per beer: from its live brewing recipe when that is fully priced, else from its kitchen PREP recipe as before. */
export function preferBrewCosts<B, P>(brew: ReadonlyMap<string, B>, prep: ReadonlyMap<string, P>): Map<string, B | P> {
  const out = new Map<string, B | P>(prep);
  for (const [beerId, c] of brew) out.set(beerId, c);
  return out;
}

/** The beer's live brewing recipe (the most recently changed when there are several). */
export function liveRecipeForBeer<T extends { beerId: string | null; status: string; updatedAt: Date | string }>(recipes: T[], beerId: string): T | null {
  const live = recipes.filter((r) => r.beerId === beerId && r.status === "live");
  if (!live.length) return null;
  return live.reduce((a, b) => (new Date(b.updatedAt).getTime() > new Date(a.updatedAt).getTime() ? b : a));
}

/** Base unit for a new ingredient first used in this unit: weights → g, volumes → ml, packages → each. */
export function baseUnitForBrewUnit(unit: string): BaseUnit {
  const d = unitDimension(unit);
  return d === "volume" ? "ml" : d === "count" ? "each" : "g";
}

export function categoryForKind(kind: BrewLineKind): "Malt" | "Hops" | "Yeast" | "Brewing" {
  return kind === "grain" ? "Malt" : kind === "hop" ? "Hops" : kind === "yeast" ? "Yeast" : "Brewing";
}

export const BREWING_CATEGORIES = ["Malt", "Hops", "Yeast", "Brewing"];

/** A recipe's brew-day targets and timing (shared by the server and the editor in the browser). */
export interface RecipeProcess {
  targetMt: number | null;
  targetBk: number | null;
  targetKo: number | null;
  strikeF: number | null;
  mashF: number | null;
  mashMinutes: number | null;
  /** "hazy" | "sour" | "lager" | "pale" | "custom" | null */
  profile: string | null;
  dryHopDay: number | null;
  tapDay: number | null;
  artworkDone: boolean;
}

export const BLANK_PROCESS: RecipeProcess = { targetMt: null, targetBk: null, targetKo: null, strikeF: null, mashF: null, mashMinutes: null, profile: null, dryHopDay: null, tapDay: null, artworkDone: false };
