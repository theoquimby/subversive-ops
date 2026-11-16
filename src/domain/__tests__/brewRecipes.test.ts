import { describe, expect, it } from "vitest";
import {
  baseUnitForBrewUnit,
  brewLineCost,
  brewToBase,
  categoryForKind,
  costBrewRecipe,
  liveRecipeForBeer,
  pourCostFromBrew,
  preferBrewCosts,
  scaleBrewCost,
  type PricedIngredient,
} from "../brewRecipes";

const LB = 453.59237;
const ing = (id: string, baseUnit: PricedIngredient["baseUnit"], costPerBase: number | null, conversions: PricedIngredient["conversions"] = []): PricedIngredient => ({ id, name: id, baseUnit, costPerBase, conversions });

const catalog = new Map<string, PricedIngredient>([
  ["pils", ing("pils", "g", 1 / LB)], // $1.00 a lb
  ["cascade", ing("cascade", "g", 20 / LB)], // $20 a lb
  ["yeast", ing("yeast", "each", 150)], // $150 a pack
  ["finings", ing("finings", "ml", null)], // no price yet
  ["salt", ing("salt", "g", 0.01, [{ unit: "pkg", baseQty: 500 }])], // a 500 g bag
]);

describe("units on brewing lines", () => {
  it("converts brewing units to the ingredient's base unit", () => {
    expect(brewToBase(1, "lb", "g", [])).toBeCloseTo(LB, 6);
    expect(brewToBase(2, "pkg", "each", [])).toBe(2); // a package is one of something counted
    expect(brewToBase(1, "pkg", "g", [{ unit: "pkg", baseQty: 500 }])).toBe(500); // the ingredient says what a package weighs
    expect(() => brewToBase(1, "pkg", "g", [])).toThrow();
    expect(() => brewToBase(1, "gal", "g", [])).toThrow();
  });

  it("picks a base unit and category for a new ingredient", () => {
    expect(baseUnitForBrewUnit("lb")).toBe("g");
    expect(baseUnitForBrewUnit("gal")).toBe("ml");
    expect(baseUnitForBrewUnit("pkg")).toBe("each");
    expect(baseUnitForBrewUnit("cups")).toBe("g");
    expect(categoryForKind("grain")).toBe("Malt");
    expect(categoryForKind("hop")).toBe("Hops");
    expect(categoryForKind("yeast")).toBe("Yeast");
    expect(categoryForKind("adjunct")).toBe("Brewing");
    expect(categoryForKind("water")).toBe("Brewing");
  });
});

describe("line cost", () => {
  it("costs a matched, priced line", () => {
    const c = brewLineCost({ name: "Pils", ingredientId: "pils", qty: 700, unit: "lb" }, catalog.get("pils"));
    expect(c.cost).toBeCloseTo(700, 6);
  });

  it("says why a line has no cost, never zero", () => {
    expect(brewLineCost({ name: "Brewzyme", ingredientId: null, qty: 100, unit: "ml" }, undefined)).toEqual({ cost: null, reason: "unmatched" });
    expect(brewLineCost({ name: "Finings", ingredientId: "finings", qty: 100, unit: "ml" }, catalog.get("finings"))).toEqual({ cost: null, reason: "no price" });
    expect(brewLineCost({ name: "Pils", ingredientId: "pils", qty: 5, unit: "gal" }, catalog.get("pils"))).toEqual({ cost: null, reason: "unit" });
    expect(brewLineCost({ name: "Gone", ingredientId: "deleted", qty: 5, unit: "lb" }, undefined)).toEqual({ cost: null, reason: "unmatched" });
  });

  it("costs a zero amount as nothing", () => {
    expect(brewLineCost({ name: "Pils", ingredientId: "pils", qty: 0, unit: "lb" }, catalog.get("pils")).cost).toBe(0);
  });
});

describe("recipe cost", () => {
  const lines = [
    { name: "Pils", ingredientId: "pils", qty: 700, unit: "lb" }, // $700
    { name: "Cascade", ingredientId: "cascade", qty: 2, unit: "lb" }, // $40
    { name: "House ale yeast", ingredientId: "yeast", qty: 1, unit: "pkg" }, // $150
  ];

  it("works out batch, barrel, keg and pint costs after packaging loss", () => {
    // Total $890 for 7 bbl. 5% lost to packaging → 6.65 bbl = 206.15 gal sold.
    // Per bbl = 890 / 6.65 = 133.83; per gal = 4.3172; ½ bbl (15.5 gal) = 66.92;
    // ⅙ bbl (5.17 gal) = 22.32; pint (1/8 gal) = 0.5397
    const c = costBrewRecipe(lines, catalog, 7);
    expect(c.total).toBeCloseTo(890, 6);
    expect(c.complete).toBe(true);
    expect(c.unpricedLines).toBe(0);
    expect(c.sellableGal).toBeCloseTo(206.15, 6);
    expect(c.perBbl).toBeCloseTo(133.8346, 3);
    expect(c.perHalf).toBeCloseTo(66.9173, 3);
    expect(c.perSixth).toBeCloseTo(22.3202, 3);
    expect(c.perPint).toBeCloseTo(0.53966, 4);
  });

  it("lists lines without a price and keeps the total as a floor", () => {
    const c = costBrewRecipe([...lines, { name: "Finings", ingredientId: "finings", qty: 100, unit: "ml" }, { name: "Brewzyme", ingredientId: null, qty: 50, unit: "ml" }], catalog, 7);
    expect(c.total).toBeCloseTo(890, 6);
    expect(c.complete).toBe(false);
    expect(c.unpricedLines).toBe(2);
    expect(c.unpriced).toEqual([{ index: 3, name: "Finings", reason: "no price" }, { index: 4, name: "Brewzyme", reason: "unmatched" }]);
    expect(c.lines[3]).toEqual({ cost: null, reason: "no price" });
  });

  it("handles an empty recipe and a zero batch", () => {
    const empty = costBrewRecipe([], catalog, 7);
    expect(empty.total).toBe(0);
    expect(empty.complete).toBe(true);
    expect(empty.perPint).toBe(0);
    const none = costBrewRecipe(lines, catalog, 0);
    expect(none.total).toBeCloseTo(890, 6);
    expect(none.perBbl).toBeNull();
    expect(none.perPint).toBeNull();
  });

  it("scales a cost to another batch size", () => {
    // 890 × 10 / 7 = 1271.43
    expect(scaleBrewCost({ total: 890, unpricedLines: 1 }, 7, 10)).toEqual({ total: (890 * 10) / 7, unpricedLines: 1 });
    expect(scaleBrewCost({ total: 890, unpricedLines: 0 }, 0, 10).total).toBe(890);
  });
});

describe("keg pour cost from a brewing recipe", () => {
  it("gives cost per pint after packaging and pour loss, and cost per full ½ bbl keg", () => {
    // $890 for 7 bbl, 5% packaging loss → $/ml = 890 / (206.15 gal × 3785.41 ml)
    // pint = $/ml × 16 oz × 29.5735 ml ÷ 0.9 pour yield = 0.5996; ½ bbl keg (1984 oz) = 66.92
    const c = pourCostFromBrew({ total: 890, unpricedLines: 0, batchBbl: 7 }, 0.9, 1984);
    expect(c).not.toBeNull();
    expect(c!.perPint).toBeCloseTo(0.59962, 4);
    expect(c!.perHalf).toBeCloseTo(66.9173, 3);
  });

  it("is not used when a line has no price or the batch has no size", () => {
    expect(pourCostFromBrew({ total: 890, unpricedLines: 1, batchBbl: 7 }, 0.9, 1984)).toBeNull();
    expect(pourCostFromBrew({ total: 890, unpricedLines: 0, batchBbl: 0 }, 0.9, 1984)).toBeNull();
    expect(pourCostFromBrew({ total: 0, unpricedLines: 0, batchBbl: 7 }, 0.9, 1984)).toBeNull();
  });

  it("prefers the brewing recipe's cost and falls back to the prep recipe's", () => {
    const brew = new Map([["ipa", { perPint: 0.6, recipe: "brewing recipe IPA" }]]);
    const prep = new Map([
      ["ipa", { perPint: 0.9, recipe: "IPA batch" }],
      ["lager", { perPint: 0.5, recipe: "Lager batch" }],
    ]);
    const merged = preferBrewCosts(brew, prep);
    expect(merged.get("ipa")).toEqual({ perPint: 0.6, recipe: "brewing recipe IPA" });
    expect(merged.get("lager")).toEqual({ perPint: 0.5, recipe: "Lager batch" });
    expect(preferBrewCosts(new Map(), prep).get("ipa")).toEqual({ perPint: 0.9, recipe: "IPA batch" });
  });

  it("picks the live recipe for a beer, the newest if there are several", () => {
    const rs = [
      { id: "a", beerId: "b1", status: "live", updatedAt: new Date("2026-01-01") },
      { id: "b", beerId: "b1", status: "dev", updatedAt: new Date("2026-06-01") },
      { id: "c", beerId: "b1", status: "live", updatedAt: new Date("2026-03-01") },
      { id: "d", beerId: "b2", status: "archived", updatedAt: new Date("2026-03-01") },
    ];
    expect(liveRecipeForBeer(rs, "b1")?.id).toBe("c");
    expect(liveRecipeForBeer(rs, "b2")).toBeNull();
    expect(liveRecipeForBeer(rs, "b3")).toBeNull();
  });
});
