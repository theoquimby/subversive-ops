import { describe, expect, it } from "vitest";
import { allergenMatrix, normalizeAllergens, recipeAllergens, toggleAllergen, type AllergenContext } from "../allergens";

const ctx: AllergenContext = {
  ingredients: new Map([
    ["mayo", { id: "mayo", name: "Mayonnaise", allergens: ["eggs", "soy"] }],
    ["bun", { id: "bun", name: "Brioche bun", allergens: ["wheat", "milk", "eggs", "sesame"] }],
    ["beef", { id: "beef", name: "Ground beef", allergens: [] }],
    ["garlic", { id: "garlic", name: "Garlic", allergens: [] }],
    ["cheese", { id: "cheese", name: "Cheddar", allergens: ["MILK", "nonsense"] }],
  ]),
  recipes: new Map([
    ["aioli", { id: "aioli", name: "Aioli", lines: [{ ingredientId: "mayo" }, { ingredientId: "garlic" }] }],
    ["sauce", { id: "sauce", name: "Burger sauce", lines: [{ subRecipeId: "aioli" }, { ingredientId: "cheese" }] }],
    ["burger", { id: "burger", name: "Burger", lines: [{ ingredientId: "beef" }, { ingredientId: "bun" }, { subRecipeId: "sauce" }] }],
    ["salad", { id: "salad", name: "Green salad", lines: [{ ingredientId: "garlic" }] }],
    ["loopA", { id: "loopA", name: "Loop A", lines: [{ subRecipeId: "loopB" }, { ingredientId: "mayo" }] }],
    ["loopB", { id: "loopB", name: "Loop B", lines: [{ subRecipeId: "loopA" }] }],
  ]),
};

describe("allergens", () => {
  it("normalizes to known ids in standard order", () => {
    expect(normalizeAllergens(["sesame", "Milk", "bogus", "milk"])).toEqual(["milk", "sesame"]);
    expect(toggleAllergen(["milk"], "eggs", true)).toEqual(["milk", "eggs"]);
    expect(toggleAllergen(["milk", "eggs"], "milk", false)).toEqual(["eggs"]);
  });

  it("rolls up through nested sub-recipes with sources", () => {
    const r = recipeAllergens(ctx, "burger");
    expect(r.allergens).toEqual(["milk", "eggs", "wheat", "soy", "sesame"]);
    expect(r.sources.eggs).toEqual(["Brioche bun", "Mayonnaise"]);
    expect(r.sources.milk).toEqual(["Brioche bun", "Cheddar"]);
    expect(r.sources.soy).toEqual(["Mayonnaise"]);
  });

  it("returns nothing for items without tagged ingredients", () => {
    expect(recipeAllergens(ctx, "salad").allergens).toEqual([]);
    expect(recipeAllergens(ctx, "missing").allergens).toEqual([]);
  });

  it("doesn't loop forever on circular sub-recipes", () => {
    expect(recipeAllergens(ctx, "loopA").allergens).toEqual(["eggs", "soy"]);
  });

  it("builds a sorted matrix", () => {
    const m = allergenMatrix(ctx, [
      { id: "salad", name: "Green salad", category: "Starters" },
      { id: "burger", name: "Burger", category: "Mains" },
    ]);
    expect(m.map((r) => r.name)).toEqual(["Burger", "Green salad"]);
    expect(m[0].allergens).toContain("sesame");
  });
});
