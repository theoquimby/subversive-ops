import { describe, expect, it } from "vitest";
import { recipeStats, type BrewLineKind, type HopUse } from "@/domain/brewMath";
import { costBrewRecipe, type PricedIngredient } from "@/domain/brewRecipes";
import { hopAdditions, readBrewLog, whatsMissing } from "@/domain/brewDay";
import { demoBrewLog, INGREDIENTS, RECIPES } from "../brewRecipes";

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

describe("brew-day demo", () => {
  it("has targets on every recipe and one development beer with its artwork done", () => {
    for (const r of RECIPES) expect(r.process.og, r.name).toBeGreaterThan(r.process.fg);
    const dev = RECIPES.filter((r) => r.status === "dev");
    expect(dev).toHaveLength(1);
    expect(dev[0].process.artwork).toBe(true);
    const missing = whatsMissing({
      lines: linesOf(dev[0]).map((l) => ({ name: l.name, kind: l.kind, hasSupplier: !!l.ingredientId && priced.get(l.ingredientId)?.costPerBase != null })),
      targetOg: dev[0].process.og,
      targetFg: dev[0].process.fg,
      batchBbl: dev[0].bbl,
      artworkDone: true,
    });
    expect(missing.map((m) => [m.id, m.done])).toEqual([["suppliers", false], ["gravity", true], ["batch", true], ["artwork", true]]);
  });

  it("is a readable log partway through the boil, with the bittering hops ticked", () => {
    const log = readBrewLog(JSON.parse(JSON.stringify(demoBrewLog(new Date("2026-11-16T15:00:00Z")))))!;
    expect(log.stage).toBe("boil");
    expect(log.values.mash.mtSg).toBe(1.0815);
    const ipa = RECIPES.find((r) => r.key === "demo:ipa")!;
    const hops = hopAdditions(linesOf(ipa), 60);
    expect(Object.keys(log.hops)).toEqual([hops[0].key]);
    expect(hops[0].name).toBe("Magnum");
  });
});
