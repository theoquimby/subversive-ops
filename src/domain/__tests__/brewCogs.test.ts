import { describe, expect, it } from "vitest";
import { cogsFor, historyChartable, margin, NO_CHANGE, whatIf, withPriceChanges, type CogsRecipe } from "../brewCogs";
import type { PricedIngredient } from "../brewRecipes";

const LB = 453.59237;
const ing = (id: string, baseUnit: PricedIngredient["baseUnit"], costPerBase: number | null): PricedIngredient => ({ id, name: id, baseUnit, costPerBase, conversions: [] });
const catalog = new Map<string, PricedIngredient>([
  ["pils", ing("pils", "g", 1 / LB)], // $1 a lb
  ["citra", ing("citra", "g", 20 / LB)], // $20 a lb
  ["yeast", ing("yeast", "each", 100)], // $100 a pack
]);

const lager: CogsRecipe = {
  id: "lager",
  name: "Lager",
  batchBbl: 7,
  lines: [
    { name: "Pils", ingredientId: "pils", qty: 600, unit: "lb" },
    { name: "Yeast", ingredientId: "yeast", qty: 2, unit: "pkg" },
  ],
  pintPrice: 7,
  halfPrice: 180,
  sixthPrice: null,
};
const ipa: CogsRecipe = { ...lager, id: "ipa", name: "IPA", lines: [{ name: "Pils", ingredientId: "pils", qty: 500, unit: "lb" }, { name: "Citra", ingredientId: "citra", qty: 10, unit: "lb" }], pintPrice: null, halfPrice: null };

const gal = (bbl: number, loss: number) => bbl * 31 * (1 - loss);

describe("margin", () => {
  it("is what's left of the price after cost", () => {
    expect(margin(8, 2)).toBeCloseTo(0.75, 9);
    expect(margin(null, 2)).toBeNull();
    expect(margin(8, null)).toBeNull();
    expect(margin(0, 2)).toBeNull();
  });
});

describe("cost of a recipe", () => {
  it("shares the batch cost over what reaches the kegs", () => {
    const c = cogsFor(lager, catalog, { ...NO_CHANGE, pourYield: 1 });
    expect(c.total).toBeCloseTo(800, 6); // 600 + 2 × 100
    expect(c.perBbl).toBeCloseTo((800 / gal(7, 0.05)) * 31, 6);
    expect(c.perHalf).toBeCloseTo((800 / gal(7, 0.05)) * 15.5, 6);
    expect(c.perSixth).toBeCloseTo((800 / gal(7, 0.05)) * 5.17, 6);
    expect(c.perPint).toBeCloseTo((800 / gal(7, 0.05)) / 8, 6);
    expect(c.pintMargin).toBeCloseTo(margin(7, c.perPint)!, 9);
    expect(c.halfMargin).toBeCloseTo(margin(180, c.perHalf)!, 9);
    expect(c.sixthMargin).toBeNull();
  });

  it("takes foam and line loss out of the pint margin", () => {
    const c = cogsFor(lager, catalog, { ...NO_CHANGE, pourYield: 0.8 });
    expect(c.pouredPint).toBeCloseTo(c.perPint! / 0.8, 9);
    expect(c.pintMargin).toBeCloseTo(margin(7, c.perPint! / 0.8)!, 9);
  });

  it("says when the cost is only a floor", () => {
    const c = cogsFor({ ...lager, lines: [...lager.lines, { name: "Lactose", ingredientId: null, qty: 5, unit: "lb" }] }, catalog, { ...NO_CHANGE, pourYield: 1 });
    expect(c.complete).toBe(false);
    expect(c.unpricedLines).toBe(1);
  });
});

describe("what if", () => {
  it("changes an ingredient's price by a percentage", () => {
    const m = withPriceChanges(catalog, { pils: 10 });
    expect(m.get("pils")!.costPerBase).toBeCloseTo(1.1 / LB, 12);
    expect(m.get("citra")).toBe(catalog.get("citra"));
  });

  it("updates every recipe that uses the ingredient, and only those", () => {
    const rows = whatIf([lager, ipa, { ...ipa, id: "stout", lines: [{ name: "Citra", ingredientId: "citra", qty: 1, unit: "lb" }] }], catalog, { ...NO_CHANGE, pricePct: { pils: 10 } }, 1);
    const l = rows.find((r) => r.id === "lager")!;
    expect(l.next.total).toBeCloseTo(860, 6);
    expect(l.affected).toBe(true);
    expect(rows.find((r) => r.id === "stout")!.affected).toBe(false);
  });

  it("a bigger batch scales the amounts: packs round up, so per pint can move", () => {
    const [r] = whatIf([lager], catalog, { ...NO_CHANGE, batchBbl: 15 }, 1);
    // 600 lb × 15/7 = 1285.7 lb, yeast 2 × 15/7 = 4.29 → 5 packs
    expect(r.next.total).toBeCloseTo((600 * 15) / 7 + 500, 6);
    expect(r.next.batchBbl).toBe(15);
    expect(r.next.perPint).not.toBeCloseTo(r.base.perPint!, 6);
  });

  it("more yield loss spreads the cost over less beer", () => {
    const [r] = whatIf([lager], catalog, { ...NO_CHANGE, lossPct: 10 }, 1);
    expect(r.next.total).toBeCloseTo(r.base.total, 9);
    expect(r.next.perPint).toBeCloseTo(r.base.perPint! * (0.95 / 0.9), 9);
    expect(r.affected).toBe(true);
  });

  it("with nothing changed, nothing is affected", () => {
    expect(whatIf([lager, ipa], catalog, NO_CHANGE, 1).some((r) => r.affected)).toBe(false);
  });
});

describe("cost history", () => {
  it("is worth a chart with two priced points", () => {
    expect(historyChartable([{ date: "2026-01-01", perPint: null }, { date: "2026-02-01", perPint: 0.5 }])).toBe(false);
    expect(historyChartable([{ date: "2026-01-01", perPint: 0.5 }, { date: "2026-02-01", perPint: 0.5 }])).toBe(true);
  });
});
