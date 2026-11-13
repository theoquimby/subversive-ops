import { describe, expect, it } from "vitest";
import { buildPlan, detectTable, parseConversions, parsePastedTable, parToBase } from "../bulkImport";

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
    expect(beef.products[0].packQtyBase).toBeCloseTo(4535.9237);
    expect(beef.products[0].price).toBe(61.5);
    expect(plan.ingredients.find((i) => i.name === "Mayo")!.baseUnit).toBe("ml");
    expect(plan.ingredients.find((i) => i.name === "Burger bun")!.products[0].packQtyBase).toBe(12);
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


describe("order-guide columns", () => {
  const guide = parsePastedTable(
    [
      "Ingredient\tSupplier\tItem #\tDescription\tPack\tPack qty\tPack unit\tOrder unit\tPrice\tBase unit\tConversions\tCount unit\tPar",
      "Bacon\tDriscoll\t871506\tBacon Layout 18/22 Slice CT\t1/15 LBA\t6803.8855\tg\tCase\t67.20\tg\t1 slice = 22.9087 g\tcase\t2",
      "Butter\tDriscoll\t013602\tButter Solid AA Unsalted\t36/1 LB\t453.5924\tg\tPiece\t2.22\tg\t1 tbsp = 0.5 oz\tpiece\t10",
      "Butter\tPrice Chopper\tPC-BUTTER\tCabot butter 1 lb\t1 LB\t\t\tEach\t4.99\t\t\t\t",
      "Beef\tKilcoyne\tKIL-1\t\t1 LB\t453.5924\tg\tlb\t6.25\tg\t1 ball = 2.85 oz; nonsense\tlb\t110",
    ].join("\n"),
    "Guide",
  );
  const d = detectTable(guide);
  const plan = buildPlan([{ table: guide, ...d }], { ingredients: [], recipes: [], suppliers: [] });
  const get = (n: string) => plan.ingredients.find((i) => i.name === n)!;

  it("maps the new columns", () => {
    expect(d.kind).toBe("ingredients");
    expect(d.mapping).toMatchObject({ description: "Description", purchaseUnit: "Order unit", conversions: "Conversions", countUnit: "Count unit", par: "Par", baseUnit: "Base unit" });
  });
  it("keeps the supplier description and order unit", () => {
    expect(get("Bacon").products[0]).toMatchObject({ description: "Bacon Layout 18/22 Slice CT", purchaseUnit: "case", packQtyBase: 6803.8855, price: 67.2 });
    expect(get("Butter").products[0].purchaseUnit).toBe("piece");
  });
  it("turns repeated ingredient rows into extra products, first one preferred", () => {
    expect(get("Butter").products.map((p) => p.supplier)).toEqual(["Driscoll", "Price Chopper"]);
    expect(get("Butter").products[1].packQtyBase).toBeCloseTo(453.59237);
    expect(plan.ingredients.filter((i) => i.name === "Butter")).toHaveLength(1);
  });
  it("reads conversions, count unit and par", () => {
    expect(get("Bacon").conversions).toEqual([{ unit: "slice", baseQty: 22.9087 }]);
    expect(get("Butter").conversions[0].baseQty).toBeCloseTo(14.17476);
    expect(get("Bacon").countUnit).toBe("case");
    expect(parToBase(get("Bacon"))).toBeCloseTo(2 * 6803.8855);
    expect(parToBase(get("Butter"))).toBeCloseTo(10 * 453.5924);
    expect(parToBase(get("Beef"))).toBeCloseTo(110 * 453.59237);
    expect(plan.issues.map((i) => i.message).join("\n")).toMatch(/Beef: couldn't read conversion "nonsense"/);
  });
});

describe("parseConversions", () => {
  it("accepts any standard unit of the base on the right", () => {
    expect(parseConversions("1 cup = 340 g; 2 slices = 1.5 oz", "g").conversions).toEqual([
      { unit: "cup", baseQty: 340 },
      { unit: "slices", baseQty: (1.5 * 28.349523125) / 2 },
    ]);
    expect(parseConversions("1 bottle = 28 fl oz", "ml").conversions[0].baseQty).toBeCloseTo(828.06);
  });
  it("rejects units of another dimension", () => {
    expect(parseConversions("1 cup = 8 oz", "ml").errors).toHaveLength(1);
  });
});
