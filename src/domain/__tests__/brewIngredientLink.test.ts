import { describe, expect, it } from "vitest";
import {
  brewIngredientIdentity,
  ingredientKey,
  knownBrewSupplier,
  linkSummaryText,
  planBrewIngredientLinks,
  productSkuFor,
  purchaseUnitFor,
  type PlanIngredient,
  type PlanLine,
} from "../brewIngredientLink";

const id = (kind: string, name: string, unit = "lb") => brewIngredientIdentity({ kind, name, unit });

describe("brewIngredientIdentity: real Brew Manager names", () => {
  it("grain: malt, origin, maltster", () => {
    expect(id("grain", "Pils, Hudson Valley Malt (NYS)")).toEqual({
      key: "pils malt nys hudson valley malt",
      name: "Pils malt (NYS) · Hudson Valley Malt",
      category: "Malt",
      baseUnit: "g",
      supplierHint: "Hudson Valley Malt",
    });
    expect(id("grain", "Chit Malt, Hudson Valley Malt (NYS)")?.name).toBe("Chit Malt (NYS) · Hudson Valley Malt");
  });

  it("their own malt keeps the maltster in the name but has no supplier", () => {
    const m = id("grain", "Munich, Subversive (NYS)");
    expect(m?.name).toBe("Munich malt (NYS) · Subversive");
    expect(m?.supplierHint).toBeNull();
    expect(m?.category).toBe("Malt");
  });

  it("hops: variety, origin, supplier short names spelled out", () => {
    const c = id("hop", "Cascade (NYS), NYHG", "oz");
    expect(c?.name).toBe("Cascade hops (NYS) · NY Hop Guild");
    expect(c?.supplierHint).toBe("NY Hop Guild");
    expect(c?.category).toBe("Hops");
    expect(c?.baseUnit).toBe("g");
    expect(id("hop", "Excelsior (NYS), NYHG")?.name).toBe("Excelsior hops (NYS) · NY Hop Guild");
    expect(id("hop", "Tettnang, Yakima Quality Hops")).toMatchObject({ name: "Tettnang hops · Yakima Quality Hops", supplierHint: "Yakima Quality Hops" });
    expect(id("hop", "Tettnang")).toMatchObject({ name: "Tettnang hops", supplierHint: null });
    expect(id("hop", "AHHHHROMAH (NON_NYS)")).toMatchObject({ name: "AHHHHROMAH hops (not NYS)", supplierHint: null });
  });

  it("yeast: the lab in brackets goes when the supplier says it; co-pitches keep both strains and hint the first supplier", () => {
    const y = id("yeast", "Helio Gazer (Omega) + CellarScience HAZY co-pitch, Omega Yeast + MoreBeerPro", "pkg");
    expect(y).toEqual({
      key: "helio gazer cellarscience hazy yeast omega yeast morebeer",
      name: "Helio Gazer + CellarScience HAZY yeast · Omega Yeast + MoreBeer",
      category: "Yeast",
      baseUnit: "each",
      supplierHint: "Omega Yeast",
    });
    expect(id("yeast", "Philly Sour (Lallemand), MoreBeer", "pkg")).toMatchObject({ name: "Philly Sour yeast · MoreBeer", supplierHint: "MoreBeer" });
    expect(id("yeast", "Helio Gazer (Omega), Omega Yeast", "pkg")?.name).toBe("Helio Gazer yeast · Omega Yeast");
  });

  it("a development beer's yeast with only the lab in brackets matches the recipe's", () => {
    expect(id("yeast", "Helio Gazer (Omega)", "pkg")?.key).toBe(id("yeast", "Helio Gazer (Omega), Omega Yeast", "pkg")?.key);
    expect(id("yeast", "Philly Sour (Lallemand)", "pkg")?.key).toBe(id("yeast", "Philly Sour (Lallemand), MoreBeer", "pkg")?.key);
  });

  it("other lines: just the cleaned name", () => {
    expect(id("other", "Pickling  spice", "oz")).toEqual({ key: "pickling spice", name: "Pickling spice", category: "Brewing", baseUnit: "g", supplierHint: null });
    expect(id("adjunct", "Brewzyme D", "ml")).toMatchObject({ name: "Brewzyme D", category: "Brewing", baseUnit: "ml" });
    expect(id("other", "Brewzyme D, MoreBeer", "ml")).toMatchObject({ name: "Brewzyme D · MoreBeer", supplierHint: "MoreBeer" });
    expect(id("other", "Sea salt, flaked", "oz")?.name).toBe("Sea salt, flaked");
  });

  it("spices Brew Manager kept with the hops aren't called hops", () => {
    expect(id("hop", "Pickling spice", "oz")).toMatchObject({ name: "Pickling spice", category: "Brewing" });
    expect(id("hop", "Lime zest", "oz")).toMatchObject({ name: "Lime zest", category: "Brewing" });
    expect(id("hop", "Lemondrop", "oz")).toMatchObject({ name: "Lemondrop hops", category: "Hops" });
  });

  it("doesn't add malt, hops or yeast twice", () => {
    expect(id("grain", "Pilsner malt")?.name).toBe("Pilsner malt");
    expect(id("grain", "Flaked oats, Hudson Valley Malt")?.name).toBe("Flaked oats · Hudson Valley Malt");
    expect(id("hop", "Hop extract", "ml")?.name).toBe("Hop extract");
    expect(id("yeast", "House yeast", "pkg")?.name).toBe("House yeast");
  });

  it("the same malt from the same maltster is one ingredient however it's written", () => {
    expect(id("grain", "pils,  hudson valley malt (NYS)")?.key).toBe(id("grain", "Pils, Hudson Valley Malt (NYS)")?.key);
    expect(id("grain", "Pils, HVM (NYS)")?.key).toBe(id("grain", "Pils, Hudson Valley Malt (NYS)")?.key);
    expect(id("grain", "pils, Hudson Valley Malt (NYS)")?.name).toBe("Pils malt (NYS) · Hudson Valley Malt");
  });

  it("origin and supplier keep ingredients apart", () => {
    const keys = [id("hop", "Cascade (NYS), NYHG"), id("hop", "Cascade, NYHG"), id("hop", "Cascade"), id("hop", "Cascade, Yakima Quality Hops")].map((x) => x?.key);
    expect(new Set(keys).size).toBe(4);
  });

  it("base unit from the line's unit", () => {
    expect(id("grain", "Pils", "kg")?.baseUnit).toBe("g");
    expect(id("other", "Lactic acid", "gal")?.baseUnit).toBe("ml");
    expect(id("yeast", "US-05", "each")?.baseUnit).toBe("each");
  });

  it("an unknown supplier is passed on as written; no name is no identity", () => {
    expect(id("hop", "Citra, Hopsteiner")).toMatchObject({ name: "Citra hops · Hopsteiner", supplierHint: "Hopsteiner" });
    expect(id("grain", "   ")).toBeNull();
  });
});

describe("helpers", () => {
  it("known suppliers", () => {
    expect(knownBrewSupplier("NYHG")).toBe("NY Hop Guild");
    expect(knownBrewSupplier("HVM")).toBe("Hudson Valley Malt");
    expect(knownBrewSupplier("MoreBeerPro")).toBe("MoreBeer");
    expect(knownBrewSupplier("Lallemand")).toBe("MoreBeer");
    expect(knownBrewSupplier("NYS")).toBeNull();
    expect(knownBrewSupplier("Weyermann")).toBeNull();
  });

  it("key, sku and purchase unit", () => {
    expect(ingredientKey("Cascade hops (NYS) · NY Hop Guild")).toBe("cascade hops nys ny hop guild");
    expect(productSkuFor("cascade hops nys ny hop guild")).toBe("BM-CASCADE-HOPS-NYS-NY-HOP-GUILD");
    expect(purchaseUnitFor("g")).toEqual({ unit: "lb", packQtyBase: 453.59237 });
    expect(purchaseUnitFor("ml")).toEqual({ unit: "gal", packQtyBase: 3785.411784 });
    expect(purchaseUnitFor("each")).toEqual({ unit: "pkg", packQtyBase: 1 });
  });
});

describe("planBrewIngredientLinks", () => {
  const line = (id: string, kind: string, name: string, unit = "lb", recipe = "Hazy"): PlanLine => ({ id, recipe, kind, name, unit });

  it("one new ingredient for the same malt in many recipes", () => {
    const p = planBrewIngredientLinks(
      [line("a", "grain", "Pils, Hudson Valley Malt (NYS)"), line("b", "grain", "Pils, HVM (NYS)", "kg", "Lager"), line("c", "hop", "Cascade (NYS), NYHG", "oz")],
      [],
    );
    expect(p.creates.map((c) => c.name)).toEqual(["Pils malt (NYS) · Hudson Valley Malt", "Cascade hops (NYS) · NY Hop Guild"]);
    expect(p.links).toEqual([
      { lineId: "a", key: "pils malt nys hudson valley malt", ingredientId: null },
      { lineId: "b", key: "pils malt nys hudson valley malt", ingredientId: null },
      { lineId: "c", key: "cascade hops nys ny hop guild", ingredientId: null },
    ]);
    expect(p.left).toEqual([]);
    expect(p.reused).toEqual([]);
  });

  it("uses an existing ingredient (any department) by name, or by the line's own name", () => {
    const ings: PlanIngredient[] = [
      { id: "i1", name: "pils malt (NYS) · Hudson Valley Malt", baseUnit: "g", conversions: [] },
      { id: "i2", name: "Pickling Spice", baseUnit: "g", conversions: [] },
    ];
    const p = planBrewIngredientLinks([line("a", "grain", "Pils, Hudson Valley Malt (NYS)"), line("b", "other", "Pickling spice", "oz")], ings);
    expect(p.creates).toEqual([]);
    expect(p.links).toEqual([
      { lineId: "a", key: "pils malt nys hudson valley malt", ingredientId: "i1" },
      { lineId: "b", key: "pickling spice", ingredientId: "i2" },
    ]);
    expect(p.reused).toEqual(["i1", "i2"]);
  });

  it("leaves a line whose unit doesn't fit, and says why", () => {
    const ings: PlanIngredient[] = [{ id: "i2", name: "Pickling spice", baseUnit: "g", conversions: [] }];
    const p = planBrewIngredientLinks([line("a", "other", "Pickling spice", "ml", "Gose")], ings);
    expect(p.links).toEqual([]);
    expect(p.left).toEqual([{ lineId: "a", recipe: "Gose", line: "Pickling spice", why: "It's in ml, but Pickling spice is weighed. Say what 1 ml weighs on the ingredient, then match it on the recipe." }]);
  });

  it("a unit conversion on the ingredient lets the line link", () => {
    const ings: PlanIngredient[] = [{ id: "i2", name: "Pickling spice", baseUnit: "g", conversions: [{ unit: "ml", baseQty: 0.6 }] }];
    expect(planBrewIngredientLinks([line("a", "other", "Pickling spice", "ml")], ings).links).toHaveLength(1);
  });

  it("a new ingredient is measured the way most of its lines are; the odd one out is left", () => {
    const p = planBrewIngredientLinks([line("a", "other", "Lactic acid", "ml"), line("b", "other", "Lactic acid", "gal"), line("c", "other", "Lactic acid", "oz", "Gose")], []);
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0].baseUnit).toBe("ml");
    expect(p.links.map((l) => l.lineId)).toEqual(["a", "b"]);
    expect(p.left[0]).toMatchObject({ lineId: "c", recipe: "Gose", why: "It's in oz, but Lactic acid is measured by volume. Say what 1 oz holds on the ingredient, then match it on the recipe." });
  });

  it("packages of a weighed ingredient are left", () => {
    const p = planBrewIngredientLinks([line("a", "grain", "Pils, HVM", "lb"), line("b", "grain", "Pils, HVM", "lb"), line("c", "grain", "Pils, HVM", "pkg")], []);
    expect(p.left.map((l) => l.lineId)).toEqual(["c"]);
  });
});

describe("linkSummaryText", () => {
  it("says what was linked and what's left", () => {
    expect(linkSummaryText({ ingredientsCreated: 40, ingredientsReused: 7, linesLinked: 118, productsCreated: 30, linesLeft: [{ recipe: "Gose", line: "Pickling spice", why: "x" }, { recipe: "Gose", line: "Salt", why: "y" }, { recipe: "Sour", line: "Lime", why: "z" }] })).toBe(
      "Linked 118 recipe lines to 47 ingredients (40 new); 3 left: Pickling spice in Gose, Salt in Gose, Lime in Sour.",
    );
    expect(linkSummaryText({ ingredientsCreated: 0, ingredientsReused: 1, linesLinked: 1, productsCreated: 0, linesLeft: [] })).toBe("Linked 1 recipe line to 1 ingredient.");
    expect(linkSummaryText({ ingredientsCreated: 0, ingredientsReused: 0, linesLinked: 0, productsCreated: 0, linesLeft: [] })).toBe("Every recipe line is already linked to an ingredient.");
    const many = Array.from({ length: 5 }, (_, i) => ({ recipe: "R", line: `L${i}`, why: "" }));
    expect(linkSummaryText({ ingredientsCreated: 0, ingredientsReused: 0, linesLinked: 0, productsCreated: 0, linesLeft: many })).toBe("No lines linked; 5 left: L0 in R, L1 in R, L2 in R, and 2 more.");
  });
});
