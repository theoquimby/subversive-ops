import { describe, expect, it } from "vitest";
import { matchConfidence, planRecipesFromSquare, priceDrift, SquareMenuItem, suggestMatches } from "../squareMenu";

const item = (squareId: string, name: string, over: Partial<SquareMenuItem> = {}): SquareMenuItem => ({
  squareId, squareType: "ITEM_VARIATION", name, baseName: name, price: null, category: null, ...over,
});

describe("matchConfidence", () => {
  it("treats case, punctuation and plurals as the same", () => {
    expect(matchConfidence("Fish Tacos", "fish taco")).toBe(1);
    expect(matchConfidence("Mac & Cheese", "Mac and Cheese")).toBe(1);
  });
  it("matches reordered words", () => {
    expect(matchConfidence("Smash Burger · Double", "Double Smash Burger")).toBeGreaterThan(0.9);
  });
  it("scores unrelated names low", () => {
    expect(matchConfidence("Coke", "Cheeseburger")).toBeLessThan(0.3);
    expect(matchConfidence("Caesar Salad", "Wings")).toBeLessThan(0.3);
  });
});

describe("suggestMatches", () => {
  const recipes = [
    { id: "r1", name: "Smash Burger", kind: "MENU" as const, menuPrice: 16 },
    { id: "r2", name: "Fish Tacos", kind: "MENU" as const, menuPrice: 15 },
    { id: "r3", name: "Bacon", kind: "MODIFIER" as const, menuPrice: 2 },
    { id: "r4", name: "Bacon Burger", kind: "MENU" as const, menuPrice: 18 },
  ];
  it("suggests confident matches only, within the same kind", () => {
    const s = suggestMatches(
      [
        item("a", "Smash Burger"),
        item("b", "Fish Taco"),
        item("c", "Bacon (Add-ons)", { squareType: "MODIFIER", baseName: "Bacon" }),
        item("d", "IPA Pint"),
      ],
      recipes,
    );
    expect(s.map((x) => [x.squareId, x.recipeId])).toEqual([["a", "r1"], ["b", "r2"], ["c", "r3"]]);
    expect(s[0].confidence).toBe(1);
  });
  it("leaves near-ties for a person", () => {
    const s = suggestMatches([item("x", "Burger")], [
      { id: "1", name: "Burger One", kind: "MENU", menuPrice: null },
      { id: "2", name: "Burger Two", kind: "MENU", menuPrice: null },
    ], 0.5);
    expect(s).toEqual([]);
  });
});

describe("planRecipesFromSquare", () => {
  it("creates new recipes with Square price and category", () => {
    const plan = planRecipesFromSquare(
      [item("a", "Pierogi", { price: 12, category: "Small plates" }), item("m", "Extra Cheese (Add-ons)", { squareType: "MODIFIER", baseName: "Extra Cheese", price: 1.5 })],
      [],
    );
    expect(plan.create).toEqual([
      { name: "Pierogi", kind: "MENU", category: "Small plates", menuPrice: 12, squareIds: ["a"] },
      { name: "Extra Cheese", kind: "MODIFIER", category: "Add-ons", menuPrice: 1.5, squareIds: ["m"] },
    ]);
    expect(plan.link).toEqual([]);
  });
  it("links to an existing recipe of the same name and kind, suffixes other clashes", () => {
    const plan = planRecipesFromSquare(
      [item("a", "Pierogi"), item("b", "Bacon", { squareType: "MODIFIER" })],
      [{ id: "r1", name: "pierogi", kind: "MENU" }, { id: "r2", name: "Bacon", kind: "MENU" }],
    );
    expect(plan.link).toEqual([{ recipeId: "r1", squareIds: ["a"] }]);
    expect(plan.create.map((c) => c.name)).toEqual(["Bacon (add-on)"]);
  });
  it("groups duplicate names into one recipe", () => {
    const plan = planRecipesFromSquare([item("a", "Soup", { price: 6 }), item("b", "Soup", { price: 6 })], []);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].squareIds).toEqual(["a", "b"]);
  });
});

describe("priceDrift", () => {
  const base = { recipeName: "R", squareName: "S" };
  it("lists only differing prices, biggest first, missing menu price first", () => {
    const d = priceDrift([
      { ...base, squareId: "a", squarePrice: 16, recipeId: "r1", menuPrice: 16 },
      { ...base, squareId: "b", squarePrice: 17, recipeId: "r2", menuPrice: 15 },
      { ...base, squareId: "c", squarePrice: 9.5, recipeId: "r3", menuPrice: 9 },
      { ...base, squareId: "d", squarePrice: 4, recipeId: "r4", menuPrice: null },
      { ...base, squareId: "e", squarePrice: null, recipeId: "r5", menuPrice: 3 },
    ]);
    expect(d.map((x) => x.squareId)).toEqual(["d", "b", "c"]);
    expect(d[1].diff).toBe(2);
    expect(d.every((x) => !x.conflict)).toBe(true);
  });
  it("flags recipes linked to several Square prices", () => {
    const d = priceDrift([
      { ...base, squareId: "a", squarePrice: 12, recipeId: "r1", menuPrice: 10 },
      { ...base, squareId: "b", squarePrice: 14, recipeId: "r1", menuPrice: 10 },
    ]);
    expect(d.every((x) => x.conflict)).toBe(true);
  });
});
