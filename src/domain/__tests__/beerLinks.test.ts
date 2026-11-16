import { describe, expect, it } from "vitest";
import {
  abvView,
  brewBeer,
  brewCostPerMl,
  brewingKegPrice,
  kegPrice,
  chooseFillBatch,
  kegCostSource,
  kegIngredientMatches,
  kegPriceFromBrew,
  looksLikeBrewCode,
  sameMoney,
} from "../beerLinks";
import { GAL_PER_BBL, ML_PER_GAL } from "../brewMath";
import { PACKAGING_LOSS } from "../brewRecipes";

const HALF_ML = 15.5 * ML_PER_GAL;

describe("keg price from a brew", () => {
  it("shares the brew's cost over what reaches the kegs, per keg", () => {
    // 7 bbl for $700: 7 × 31 × 0.95 gal reach the kegs.
    const perGal = 700 / (7 * GAL_PER_BBL * (1 - PACKAGING_LOSS));
    expect(kegPriceFromBrew({ cost: 700, bbl: 7 }, HALF_ML)).toBeCloseTo(Math.round(perGal * 15.5 * 100) / 100, 2);
  });
  it("prices any keg size from the cost per ml, to the cent", () => {
    const perMl = brewCostPerMl({ cost: 700, bbl: 7 })!;
    expect(kegPrice(perMl, HALF_ML)).toBe(kegPriceFromBrew({ cost: 700, bbl: 7 }, HALF_ML));
    expect(brewCostPerMl({ cost: null, bbl: 7 })).toBeNull();
  });
  it("is null without a cost, a size or a keg", () => {
    expect(kegPriceFromBrew({ cost: null, bbl: 7 }, HALF_ML)).toBeNull();
    expect(kegPriceFromBrew({ cost: 700, bbl: null }, HALF_ML)).toBeNull();
    expect(kegPriceFromBrew({ cost: 700, bbl: 7 }, 0)).toBeNull();
    expect(kegPriceFromBrew({ cost: 0, bbl: 7 }, HALF_ML)).toBeNull();
  });
});

describe("which brewing cost a keg takes", () => {
  const brew = { brewBatchId: "b1", code: "26-031", packagedOn: "2026-11-12", price: 52.4 };
  const recipe = { brewRecipeId: "r1", name: "IPA v3", price: 49.1 };
  it("prefers the latest packaged brew, then the live recipe", () => {
    expect(brewingKegPrice({ brew, recipe })).toEqual({ kind: "brew", ...brew });
    expect(brewingKegPrice({ brew: null, recipe })).toEqual({ kind: "recipe", ...recipe });
    expect(brewingKegPrice({ brew: null, recipe: null })).toBeNull();
  });
});

describe("where a keg's cost comes from", () => {
  it("names the brew, the recipe, or says it was typed", () => {
    expect(kegCostSource({ price: 50, brewBatch: { code: "26-031", packagedOn: "2026-11-12" }, brewRecipe: null })).toEqual({ kind: "brew", code: "26-031", packagedOn: "2026-11-12" });
    expect(kegCostSource({ price: 50, brewBatch: null, brewRecipe: { name: "IPA v3" } })).toEqual({ kind: "recipe", name: "IPA v3" });
    expect(kegCostSource({ price: 50, brewBatch: null, brewRecipe: null })).toEqual({ kind: "typed" });
    expect(kegCostSource(null)).toEqual({ kind: "none" });
  });
  it("compares money to the cent", () => {
    expect(sameMoney(10, 10.004)).toBe(true);
    expect(sameMoney(10, 10.01)).toBe(false);
    expect(sameMoney(null, 10)).toBe(false);
  });
});

describe("filling a keg from a batch", () => {
  const ipaBatch = { id: "k1", code: "26-031", beerId: "ipa" };
  it("uses a picked batch of the same beer", () => {
    expect(chooseFillBatch({ beerId: "ipa", picked: ipaBatch, typed: null, byCode: null })).toEqual({ use: "k1", code: "26-031", setBeer: false });
  });
  it("never puts a fill on another beer's batch", () => {
    expect(chooseFillBatch({ beerId: "lager", picked: ipaBatch, typed: null, byCode: null, beerName: (id) => (id === "ipa" ? "IPA" : "?") })).toEqual({ error: "Batch 26-031 is IPA. Pick this beer's batch, or leave the batch blank." });
    expect("error" in chooseFillBatch({ beerId: "lager", picked: null, typed: "26-031", byCode: ipaBatch })).toBe(true);
  });
  it("finds a typed code's batch, or makes one for this beer", () => {
    expect(chooseFillBatch({ beerId: "ipa", picked: null, typed: " 26-031 ", byCode: ipaBatch })).toEqual({ use: "k1", code: "26-031", setBeer: false });
    expect(chooseFillBatch({ beerId: "ipa", picked: null, typed: "26-099", byCode: null })).toEqual({ create: "26-099" });
    expect(chooseFillBatch({ beerId: "ipa", picked: null, typed: "  ", byCode: null })).toEqual({ none: true });
  });
  it("fills in a batch's empty beer", () => {
    expect(chooseFillBatch({ beerId: "ipa", picked: null, typed: "x1", byCode: { id: "k2", code: "x1", beerId: null } })).toEqual({ use: "k2", code: "x1", setBeer: true });
  });
});

describe("a brew's beer", () => {
  it("follows its recipe's beer when the recipe names one", () => {
    expect(brewBeer({ recipeBeerId: "ipa", beerId: "ipa" })).toEqual({ beerId: "ipa", mismatch: false, locked: true });
    expect(brewBeer({ recipeBeerId: "ipa", beerId: "lager" })).toEqual({ beerId: "ipa", mismatch: true, locked: true });
    expect(brewBeer({ recipeBeerId: null, beerId: "lager" })).toEqual({ beerId: "lager", mismatch: false, locked: false });
  });
});

describe("brew codes", () => {
  it("knows the brewery's code shapes", () => {
    for (const c of ["26-031", "26-031B", "26-1", "26-014-3"]) expect(looksLikeBrewCode(c)).toBe(true);
    for (const c of ["2-2026", "IPA", "", "L123"]) expect(looksLikeBrewCode(c)).toBe(false);
  });
});

describe("ABV", () => {
  it("shows the typed ABV, else the measured one", () => {
    expect(abvView(6.5, 6.4)).toEqual({ shown: 6.5, measured: 6.4, differs: false });
    expect(abvView(null, 6.43)).toEqual({ shown: 6.4, measured: 6.4, differs: false });
    expect(abvView(6.5, 7.1)).toEqual({ shown: 6.5, measured: 7.1, differs: true });
    expect(abvView(null, null)).toEqual({ shown: null, measured: null, differs: false });
  });
});

describe("matching a keg ingredient to a beer", () => {
  const kegs = [
    { id: "a", name: "Subversive IPA (keg)" },
    { id: "b", name: "Golden Lager (keg)" },
    { id: "c", name: "IPA keg old" },
  ];
  it("puts the exact '<beer> (keg)' first, then names that contain the beer", () => {
    expect(kegIngredientMatches("subversive ipa", kegs).map((k) => k.id)).toEqual(["a"]);
    expect(kegIngredientMatches("IPA", kegs).map((k) => k.id)).toEqual(["a", "c"]);
    expect(kegIngredientMatches("Stout", kegs)).toEqual([]);
  });
});
