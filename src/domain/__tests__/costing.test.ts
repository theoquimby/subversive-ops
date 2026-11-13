import { describe, expect, it } from "vitest";
import { CostIngredient, CostRecipe, costRecipe, explodeUsage } from "../costing";

const ing = (o: Partial<CostIngredient> & Pick<CostIngredient, "id" | "baseUnit">): CostIngredient => ({
  name: o.id, yieldPct: 1, conversions: [], costPerBase: null, ...o,
});

// Beef $5.00/lb with 75% yield, bun $0.60 each, mayo $0.01/ml, garlic $0.02/g.
const ingredients = new Map([
  ["beef", ing({ id: "beef", baseUnit: "g", costPerBase: 5 / 453.59237, yieldPct: 0.75 })],
  ["bun", ing({ id: "bun", baseUnit: "each", costPerBase: 0.6 })],
  ["mayo", ing({ id: "mayo", baseUnit: "ml", costPerBase: 0.01 })],
  ["garlic", ing({ id: "garlic", baseUnit: "g", costPerBase: 0.02 })],
  ["cheese", ing({ id: "cheese", baseUnit: "g", costPerBase: null, conversions: [{ unit: "slice", baseQty: 20 }] })],
]);

const aioli: CostRecipe = {
  id: "aioli", name: "Aioli", yieldQty: 1, yieldUnit: "l", yieldBase: "ml", menuPrice: null,
  lines: [{ ingredientId: "mayo", qty: 950, unit: "ml" }, { ingredientId: "garlic", qty: 50, unit: "g" }],
};
const burger: CostRecipe = {
  id: "burger", name: "Burger", yieldQty: 1, yieldUnit: "each", yieldBase: "each", menuPrice: 18,
  lines: [
    { ingredientId: "beef", qty: 6, unit: "oz" },
    { ingredientId: "bun", qty: 1, unit: "each" },
    { subRecipeId: "aioli", qty: 2, unit: "tbsp" },
  ],
};
const ctx = { ingredients, recipes: new Map([["aioli", aioli], ["burger", burger]]) };

describe("costRecipe", () => {
  it("costs a prep recipe per batch", () => {
    expect(costRecipe(ctx, "aioli").totalCost).toBeCloseTo(9.5 + 1, 6);
  });
  it("costs a menu item with yield loss and a sub-recipe", () => {
    const r = costRecipe(ctx, "burger");
    const beef = (6 * 28.349523125 * (5 / 453.59237)) / 0.75; // $2.50
    const aioliCost = (10.5 / 1000) * 2 * 14.78676478125;
    expect(r.totalCost).toBeCloseTo(beef + 0.6 + aioliCost, 6);
    expect(r.incomplete).toBe(false);
    expect(r.foodCostPct).toBeCloseTo(r.totalCost / 18, 6);
  });
  it("flags missing prices without failing", () => {
    const withCheese = { ...burger, id: "cb", name: "Cheeseburger", lines: [...burger.lines, { ingredientId: "cheese", qty: 2, unit: "slice" }] };
    const r = costRecipe({ ...ctx, recipes: new Map([...ctx.recipes, ["cb", withCheese]]) }, "cb");
    expect(r.incomplete).toBe(true);
    expect(r.lines.at(-1)?.error).toBe("No price yet");
  });
  it("detects recipe loops", () => {
    const a: CostRecipe = { ...aioli, id: "a", name: "A", lines: [{ subRecipeId: "b", qty: 1, unit: "ml" }] };
    const b: CostRecipe = { ...aioli, id: "b", name: "B", lines: [{ subRecipeId: "a", qty: 1, unit: "ml" }] };
    expect(() => costRecipe({ ingredients, recipes: new Map([["a", a], ["b", b]]) }, "a")).toThrow(/loop/);
  });
});

describe("explodeUsage", () => {
  it("returns purchased quantities including yield loss and sub-recipes", () => {
    const { usage, problems } = explodeUsage(ctx, "burger", 10);
    expect(problems).toEqual([]);
    expect(usage.get("beef")).toBeCloseTo((6 * 28.349523125 * 10) / 0.75, 6);
    expect(usage.get("bun")).toBe(10);
    const aioliMl = 2 * 14.78676478125 * 10; // ml of aioli used
    expect(usage.get("mayo")).toBeCloseTo((aioliMl / 1000) * 950, 6);
    expect(usage.get("garlic")).toBeCloseTo((aioliMl / 1000) * 50, 6);
  });
});
