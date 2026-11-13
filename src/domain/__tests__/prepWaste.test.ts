import { describe, expect, it } from "vitest";
import type { CostIngredient, CostRecipe } from "../costing";
import { batchesFor, explodeWaste, recipeWasteUnits, wasteCost } from "../prepWaste";

const ing = (o: Partial<CostIngredient> & Pick<CostIngredient, "id" | "baseUnit">): CostIngredient => ({ name: o.id, yieldPct: 1, conversions: [], costPerBase: null, ...o });
const ingredients = new Map([
  ["mayo", ing({ id: "mayo", baseUnit: "ml", costPerBase: 0.01 })],
  ["garlic", ing({ id: "garlic", baseUnit: "g", costPerBase: 0.02, yieldPct: 0.8 })],
  ["bun", ing({ id: "bun", baseUnit: "each", costPerBase: 0.6 })],
  ["salt", ing({ id: "salt", baseUnit: "g" })],
]);
const aioli: CostRecipe = { id: "aioli", name: "Aioli", yieldQty: 2, yieldUnit: "qt", yieldBase: "ml", menuPrice: null, lines: [{ ingredientId: "mayo", qty: 1800, unit: "ml" }, { ingredientId: "garlic", qty: 80, unit: "g" }] };
const burger: CostRecipe = { id: "burger", name: "Burger", yieldQty: 1, yieldUnit: "each", yieldBase: "each", menuPrice: 18, lines: [{ ingredientId: "bun", qty: 1, unit: "each" }, { subRecipeId: "aioli", qty: 2, unit: "tbsp" }, { ingredientId: "salt", qty: 1, unit: "pinch" }] };
const ctx = { ingredients, recipes: new Map([["aioli", aioli], ["burger", burger]]) };

describe("prep waste", () => {
  it("offers the yield unit first for prep, each for menu items", () => {
    expect(recipeWasteUnits({ ...aioli, kind: "PREP" })[0]).toBe("qt");
    expect(recipeWasteUnits({ ...aioli, kind: "PREP" })).toContain("ml");
    expect(recipeWasteUnits({ ...burger, kind: "MENU" })).toEqual(["each"]);
  });

  it("converts a prep quantity to batches", () => {
    expect(batchesFor({ ...aioli, kind: "PREP" }, 2, "qt")).toBeCloseTo(1, 6);
    expect(batchesFor({ ...aioli, kind: "PREP" }, 1, "qt")).toBeCloseTo(0.5, 6);
    expect(() => batchesFor({ ...aioli, kind: "PREP" }, 1, "each")).toThrow();
    expect(() => batchesFor({ ...aioli, kind: "PREP" }, 0, "qt")).toThrow();
  });

  it("explodes 2 qt aioli into ingredients, with yield loss", () => {
    const r = explodeWaste(ctx, "aioli", 2, "qt", "PREP");
    expect(r.usage.get("mayo")).toBeCloseTo(1800, 6);
    expect(r.usage.get("garlic")).toBeCloseTo(100, 6); // 80 g usable / 0.8 yield
    expect(wasteCost(ctx, r.usage)).toBeCloseTo(18 + 2, 6);
  });

  it("explodes 3 burgers through the sub-recipe and reports unit problems", () => {
    const r = explodeWaste(ctx, "burger", 3, "each", "MENU");
    expect(r.batches).toBe(3);
    expect(r.usage.get("bun")).toBeCloseTo(3, 6);
    const tbspPerBatch = (2 * 14.78676478125) / (2 * 946.352946);
    expect(r.usage.get("mayo")).toBeCloseTo(3 * tbspPerBatch * 1800, 6);
    expect(r.usage.has("salt")).toBe(false);
    expect(r.problems[0]).toMatch(/salt/);
  });

  it("wasteCost is null when nothing is priced", () => {
    expect(wasteCost(ctx, new Map([["salt", 5]]))).toBeNull();
  });
});
