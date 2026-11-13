/**
 * House draft beer costing. A keg is costed like an ingredient (cost per keg →
 * cost per usable ounce after foam and line loss) and each pour is a menu
 * recipe that uses some ounces of it. This turns "1/2 bbl keg = 15.5 gal at
 * $140" into a cost per pint, per 10 oz and per flight. Pure.
 */

export const ML_PER_FL_OZ = 29.5735295625;
export const ML_PER_GAL = 3785.411784;

export interface KegSize {
  id: string;
  label: string;
  gallons: number;
}

export const KEG_SIZES: KegSize[] = [
  { id: "half", label: "1/2 bbl keg (15.5 gal)", gallons: 15.5 },
  { id: "quarter", label: "1/4 bbl pony (7.75 gal)", gallons: 7.75 },
  { id: "sixtel", label: "1/6 bbl sixtel (5.16 gal)", gallons: 5.16 },
  { id: "bbl", label: "1 bbl (31 gal)", gallons: 31 },
  { id: "euro50", label: "50 L euro keg (13.2 gal)", gallons: 50_000 / ML_PER_GAL },
];

export const kegSize = (id: string) => KEG_SIZES.find((k) => k.id === id);

export interface PourInput {
  label: string;
  /** Total beer in the pour, fl oz (a flight of 4 × 4 oz is 16). */
  oz: number;
  /** Menu price, or null if not sold on its own. */
  price: number | null;
  /** Square item to link this pour to, if any. */
  squareId?: string | null;
}

export const DEFAULT_POURS: PourInput[] = [
  { label: "16 oz", oz: 16, price: 8 },
  { label: "10 oz", oz: 10, price: 6 },
  { label: "Flight (4 × 4 oz)", oz: 16, price: 12 },
];

export interface DraftBeerInput {
  beer: string;
  kegSizeId: string;
  /** What one keg costs you (brewing cost for house beer, invoice price for guest taps). */
  kegCost: number;
  /** Usable fraction after foam, line flushes and the last pint (0–1). */
  yieldPct: number;
  pours: PourInput[];
}

export interface DraftBeerPlan {
  ingredientName: string;
  /** One keg in ml (the ingredient's base unit). */
  kegMl: number;
  /** Pours you can sell from one keg, in fl oz, after loss. */
  usableOz: number;
  costPerOz: number;
  pours: (PourInput & { recipeName: string; cost: number; pourCostPct: number | null })[];
}

export const kegIngredientName = (beer: string) => `${beer.trim()} (keg)`;
export const pourRecipeName = (beer: string, pour: string) => `${beer.trim()} · ${pour.trim()}`;

/** Validate and cost a draft beer setup. Returns { error } for bad input. */
export function planDraftBeer(input: DraftBeerInput): DraftBeerPlan | { error: string } {
  const beer = input.beer.trim();
  if (!beer) return { error: "Name the beer." };
  const size = kegSize(input.kegSizeId);
  if (!size) return { error: "Pick a keg size." };
  if (!(input.kegCost > 0)) return { error: "Enter what a keg costs." };
  if (!(input.yieldPct > 0 && input.yieldPct <= 1)) return { error: "Yield is between 1% and 100%." };
  const pours = input.pours.filter((p) => p.label.trim());
  if (pours.length === 0) return { error: "Add at least one pour." };
  if (pours.some((p) => !(p.oz > 0 && p.oz <= 128))) return { error: "Each pour needs a size in ounces." };
  if (pours.some((p) => p.price != null && !(p.price >= 0))) return { error: "Prices can't be negative." };
  const labels = pours.map((p) => p.label.trim().toLowerCase());
  if (new Set(labels).size !== labels.length) return { error: "Two pours have the same name." };

  const kegMl = size.gallons * ML_PER_GAL;
  const usableOz = (kegMl / ML_PER_FL_OZ) * input.yieldPct;
  const costPerOz = input.kegCost / usableOz;
  return {
    ingredientName: kegIngredientName(beer),
    kegMl,
    usableOz,
    costPerOz,
    pours: pours.map((p) => {
      const cost = p.oz * costPerOz;
      return { ...p, label: p.label.trim(), recipeName: pourRecipeName(beer, p.label), cost, pourCostPct: p.price && p.price > 0 ? cost / p.price : null };
    }),
  };
}
