import { describe, expect, it } from "vitest";
import { buildPlan, detectTable, parsePastedTable } from "../bulkImport";

const ingredientsTab = parsePastedTable(
  [
    "Ingredient\tCategory\tVendor\tItem #\tCase Price\tPack Size\tYield",
    "Ground beef\tProtein\tGreene County Beef\tGCB-80\t$61.50\t10 LB\t100%",
    "Fries\tFrozen\tUS Foods\t50215\t47.80\t6/5 LB\t",
    "Burger bun\tBakery\tCatskill Bread\tBUN\t7.80\t12 CT\t",
    "Mayo\tPantry\tUS Foods\t30120\t63\t4/1 GAL\t",
    "Garlic\tProduce\tUS Foods\t10777\t23.9\t\t",
  ].join("\n"),
  "Prices",
);

const recipesTab = parsePastedTable(
  [
    "Recipe,Menu Price,Ingredient,Qty,Unit",
    "Burger,19,ground beef,6,oz",
    "Burger,,Burger Bun,1,each",
    "Burger,,Aioli,1,tbsp",
    "Aioli,,mayo,950,ml",
    "Aioli,,garlic,50,g",
    "Burger,,Pickles,15,g",
  ].join("\n"),
  "Recipes",
);

describe("detectTable", () => {
  it("recognises an ingredients/prices tab", () => {
    const d = detectTable(ingredientsTab);
    expect(d.kind).toBe("ingredients");
    expect(d.mapping).toMatchObject({ ingredient: "Ingredient", supplier: "Vendor", sku: "Item #", price: "Case Price", pack: "Pack Size", yield: "Yield" });
  });
  it("recognises a recipes tab", () => {
    const d = detectTable(recipesTab);
    expect(d.kind).toBe("recipes");
    expect(d.mapping).toMatchObject({ recipe: "Recipe", ingredient: "Ingredient", qty: "Qty", unit: "Unit", menuPrice: "Menu Price" });
  });
});

describe("buildPlan", () => {
  const plan = buildPlan(
    [ingredientsTab, recipesTab].map((t) => ({ table: t, ...detectTable(t) })),
    { ingredients: [], recipes: [], suppliers: [] },
  );
  it("creates ingredients with base units and pack sizes", () => {
    const beef = plan.ingredients.find((i) => i.name === "Ground beef")!;
    expect(beef.baseUnit).toBe("g");
    expect(beef.product?.packQtyBase).toBeCloseTo(4535.9237);
    expect(beef.product?.price).toBe(61.5);
    expect(plan.ingredients.find((i) => i.name === "Mayo")!.baseUnit).toBe("ml");
    expect(plan.ingredients.find((i) => i.name === "Burger bun")!.product?.packQtyBase).toBe(12);
  });
  it("links recipe lines case-insensitively and detects sub-recipes", () => {
    const burger = plan.recipes.find((r) => r.name === "Burger")!;
    expect(burger.menuPrice).toBe(19);
    expect(burger.lines.map((l) => l.ingredient ?? `sub:${l.subRecipe}`)).toEqual(["Ground beef", "Burger bun", "sub:Aioli", "Pickles"]);
    expect(plan.recipes.find((r) => r.name === "Aioli")!.kind).toBe("PREP");
  });
  it("creates missing ingredients and explains what needs attention", () => {
    expect(plan.ingredients.find((i) => i.name === "Pickles")?.baseUnit).toBe("g");
    const msgs = plan.issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/Pickles.*created without a price/);
    expect(msgs).toMatch(/Garlic: pack size unclear/);
    expect(msgs).toMatch(/Aioli.*needs a batch yield/);
  });
  it("collects suppliers", () => {
    expect(plan.suppliers.sort()).toEqual(["Catskill Bread", "Greene County Beef", "US Foods"]);
  });
});

