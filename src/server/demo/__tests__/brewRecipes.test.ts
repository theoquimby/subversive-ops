import { describe, expect, it } from "vitest";
import { recipeStats, type BrewLineKind, type HopUse } from "@/domain/brewMath";
import { costBrewRecipe, type PricedIngredient } from "@/domain/brewRecipes";
import { INGREDIENTS, RECIPES } from "../brewRecipes";

// Today's price per base unit for each demo ingredient: the latest price ÷ the pack.
const priced = new Map<string, PricedIngredient>(
  INGREDIENTS.map((i) => {
    const latest = i.prices?.slice().sort((a, b) => a[0] - b[0]).at(-1)?.[1];
    return [i.name, { id: i.name, name: i.name, baseUnit: i.base, costPerBase: latest != null && i.packQty ? latest / i.packQty : null, conversions: [] }];
  }),
);

const linesOf = (r: (typeof RECIPES)[number]) =>
  r.lines.map(([kind, name, qty, unit, x]) => ({ kind: kind as BrewLineKind, name, qty, unit, ingredientId: x?.ing ?? null, potentialPpg: x?.ppg ?? null, colorL: x?.colorL ?? null, alphaPct: x?.alpha ?? null, use: (x?.use as HopUse) ?? null, minutes: x?.minutes ?? null, attenuationPct: x?.att ?? null }));

describe("brewing recipes demo", () => {
  it("brews believable beers", () => {
    for (const r of RECIPES) {
      const s = recipeStats({ batchBbl: r.bbl, efficiencyPct: 72, boilMinutes: 60, lines: linesOf(r) });
      expect(s.og, r.name).toBeGreaterThan(1.04);
      expect(s.og, r.name).toBeLessThan(1.08);
      expect(s.abv, r.name).toBeGreaterThan(4);
      expect(s.abv, r.name).toBeLessThan(8);
    }
    const stout = RECIPES.find((r) => r.key === "demo:stout")!;
    expect(recipeStats({ batchBbl: 7, efficiencyPct: 72, boilMinutes: 60, lines: linesOf(stout) }).srm).toBeGreaterThan(30);
  });

  it("prices every line of the live recipes, and leaves two unpriced on the trial", () => {
    for (const r of RECIPES) {
      const c = costBrewRecipe(linesOf(r), priced, r.bbl);
      if (r.status === "live") {
        expect(c.unpricedLines, r.name).toBe(0);
        expect(c.perPint!, r.name).toBeGreaterThan(0.2);
        expect(c.perPint!, r.name).toBeLessThan(1.5);
      } else {
        expect(c.unpriced.map((u) => u.name)).toEqual(["Lactose", "Gypsum"]);
      }
    }
  });
});
