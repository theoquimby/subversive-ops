import { describe, expect, it } from "vitest";
import {
  chooseUnit, countIn, draftCost, draftFromSimilar, DraftItem, ExampleRecipe, indexItems, isDrink, looksLikeBrewSheet, matchItem, pourSize,
  parseRecipeText, parseYield, resolveAiDraft, similarRecipes, words,
} from "../recipeDraft";

// A slice of Max's kitchen: what he buys, and a few of his recipes.
const ing = (id: string, name: string, category: string, baseUnit: DraftItem["baseUnit"], costPerBase: number | null, conv: [string, number][] = []): DraftItem => ({
  key: `i:${id}`, name, kind: "ingredient", category, baseUnit, costPerBase,
  conversions: conv.map(([unit, baseQty]) => ({ unit, baseQty })),
  units: [...(baseUnit === "g" ? ["g", "kg", "oz", "lb"] : baseUnit === "ml" ? ["ml", "l", "tsp", "tbsp", "fl oz", "cup", "qt", "gal"] : ["each", "dozen"]), ...conv.map(([u]) => u)],
});
const prep = (id: string, name: string, baseUnit: DraftItem["baseUnit"], costPerBase: number): DraftItem => ({ key: `r:${id}`, name, kind: "recipe", category: "Sauces", baseUnit, costPerBase, conversions: [], units: baseUnit === "ml" ? ["ml", "l", "tsp", "tbsp", "fl oz", "cup", "qt", "gal"] : ["each", "dozen"] });

const items: DraftItem[] = [
  ing("beef", "Ground beef (Kilcoyne)", "Meat", "g", 0.0154),
  ing("imp", "Impossible meat", "Meat", "g", 0.025),
  ing("bacon", "Bacon", "Meat", "g", 0.012, [["slice", 20]]),
  ing("bun", "Milk bun", "Bakery", "each", 0.6, [["bun", 1]]),
  ing("potbun", "Martin's potato bun", "Prepared", "each", 0.45, [["bun", 1]]),
  ing("amer", "American cheese", "Dairy", "g", 0.011, [["slice", 21]]),
  ing("swiss", "Swiss cheese, sliced", "Dairy", "g", 0.014, [["slice", 21]]),
  ing("ched", "Cheddar cheese, sliced", "Dairy", "g", 0.013, [["slice", 21]]),
  ing("lett", "Iceberg lettuce", "Produce", "each", 1.5, [["oz", 1 / 16]]),
  ing("mush", "Mushrooms, cremini", "Produce", "g", 0.009),
  ing("wings", "Chicken wings", "Poultry", "g", 0.008, [["wing", 40]]),
  ing("celery", "Celery", "Produce", "each", 0.03, [["stick", 1]]),
  ing("liner", "Basket liner 9x12 (Choice)", "Packaging", "each", 0.03),
  ing("salt", "Kosher Salt", "Spices", "g", 0.002),
  ing("mayo", "Heavy Mayo", "Prepared", "ml", 0.004),
  ing("lemon", "Lemon Juice", "Beverage", "ml", 0.006),
  ing("garlic", "Garlic, peeled", "Produce", "g", 0.01),
  ing("bleach", "Bleach 6.25 %", "Cleaning", "ml", 0.001),
  prep("sub", "Subversive Sauce", "ml", 0.01),
  prep("buff", "Buffalo Sauce", "ml", 0.02),
  prep("aioli", "Garlic Aioli", "ml", 0.0075),
  prep("vaioli", "Vegan Garlic Aioli", "ml", 0.01),
  prep("mushaioli", "Wild Mushroom Aioli", "ml", 0.007),
];

const R = (id: string, name: string, category: string, price: number | null, lines: [string, number, string][], kind: ExampleRecipe["kind"] = "MENU"): ExampleRecipe => ({
  id, name, kind, category, menuPrice: price, yieldQty: 1, yieldUnit: "each", lines: lines.map(([itemKey, qty, unit]) => ({ itemKey, qty, unit })),
});

const examples: ExampleRecipe[] = [
  R("classic", "Classic Burger", "Burgers", 18, [["i:beef", 5.7, "oz"], ["i:bun", 1, "bun"], ["i:amer", 2, "slice"], ["i:lett", 1, "oz"], ["r:sub", 1, "fl oz"], ["i:liner", 1, "each"]]),
  R("bbq", "Bacon Cheddar Burger", "Burgers", 20, [["i:beef", 5.7, "oz"], ["i:bun", 1, "bun"], ["i:ched", 2, "slice"], ["i:bacon", 2, "slice"], ["i:liner", 1, "each"]]),
  R("ms", "Mushroom & Swiss Burger", "Burgers", 19, [["i:beef", 5.7, "oz"], ["i:bun", 1, "bun"], ["i:swiss", 2, "slice"], ["i:mush", 2, "oz"], ["r:mushaioli", 1, "fl oz"], ["i:liner", 1, "each"]]),
  R("w6", "Wings (6)", "Wings", 13, [["i:wings", 6, "wing"], ["i:celery", 4, "stick"], ["r:buff", 3, "fl oz"], ["i:liner", 2, "each"]]),
  R("sga", "Side of Garlic Aioli", "Sides", 1, [["r:aioli", 2, "fl oz"]]),
];

const ix = indexItems(items, examples);
const nameOf = (k: string | null) => (k ? ix.byKey.get(k)!.name : null);
const linesOf = (d: { lines: { itemKey: string | null; qty: number; unit: string }[] }) => d.lines.map((l) => [nameOf(l.itemKey), l.qty, l.unit]);

describe("words", () => {
  it("stems plurals and drops numbers, pack sizes and filler", () => {
    expect(words("Tomatoes, diced")).toEqual(["tomato", "diced"]);
    expect(words("Wings (10)")).toEqual(["wing"]);
    expect(words("Limes 12 CT")).toEqual(["lime"]);
    expect(words("Add bacon #100")).toEqual(["add", "bacon"]);
  });
});

describe("matchItem", () => {
  it("finds what Max buys from a plain phrase", () => {
    expect(matchItem("ground beef", ix)?.item.name).toBe("Ground beef (Kilcoyne)");
    expect(matchItem("potato buns", ix)?.item.name).toBe("Martin's potato bun");
    expect(matchItem("garlic aioli", ix)?.item.name).toBe("Garlic Aioli");
    expect(matchItem("swiss", ix)?.item.name).toBe("Swiss cheese, sliced");
  });
  it("returns null for things Max doesn't buy, and skips cleaning supplies", () => {
    expect(matchItem("2-row pale malt", ix)).toBeNull();
    expect(matchItem("cascade hops", ix)).toBeNull();
    expect(matchItem("bleach", ix)).toBeNull();
  });
});

describe("chooseUnit", () => {
  const bacon = ix.byKey.get("i:bacon")!;
  it("keeps units that convert, in the item's own spelling", () => {
    expect(chooseUnit(bacon, "slices")).toEqual({ unit: "slice", changed: false });
    expect(chooseUnit(bacon, "ounces")).toEqual({ unit: "oz", changed: false });
    expect(chooseUnit(ix.byKey.get("r:sub")!, "fl oz")).toEqual({ unit: "fl oz", changed: false });
  });
  it("falls back to a sensible default when the unit can't work", () => {
    expect(chooseUnit(bacon, "cup")).toEqual({ unit: "oz", changed: true });
    expect(chooseUnit(ix.byKey.get("i:bun")!, null)).toEqual({ unit: "bun", changed: false });
    expect(chooseUnit(ix.byKey.get("r:buff")!, "handful")).toEqual({ unit: "fl oz", changed: true });
  });
});

describe("similarRecipes", () => {
  it("prefers the same dish type and category", () => {
    expect(similarRecipes({ name: "Bacon Burger", kind: "MENU", category: "Burgers" }, examples)[0].recipe.name).toBe("Bacon Cheddar Burger");
    expect(similarRecipes({ name: "Wings (10)", kind: "MENU" }, examples)[0].recipe.name).toBe("Wings (6)");
  });
  it("never offers the recipe being drafted or prep recipes for a menu item", () => {
    const n = similarRecipes({ name: "Classic Burger", kind: "MENU", excludeRecipeId: "classic" }, examples);
    expect(n.map((x) => x.recipe.id)).not.toContain("classic");
  });
});

describe("draftFromSimilar", () => {
  it("adds the ingredient a new word names, at the usual portion", () => {
    const d = draftFromSimilar({ name: "Bacon Classic Burger", kind: "MENU", category: "Burgers", price: 20 }, examples, ix);
    expect(d.method).toBe("similar");
    expect(d.basis[0]).toBe("Classic Burger");
    expect(linesOf(d)).toContainEqual(["Bacon", 2, "slice"]);
    expect(linesOf(d)).toContainEqual(["Ground beef (Kilcoyne)", 5.7, "oz"]);
  });

  it("swaps the patty for an Impossible burger instead of adding a second one", () => {
    const d = draftFromSimilar({ name: "Impossible Classic Burger", kind: "MENU", category: "Burgers" }, examples, ix);
    const names = d.lines.map((l) => nameOf(l.itemKey));
    expect(names).toContain("Impossible meat");
    expect(names).not.toContain("Ground beef (Kilcoyne)");
    expect(d.lines.find((l) => l.itemKey === "i:imp")).toMatchObject({ qty: 5.7, unit: "oz" });
  });

  it("drops lines for words the example has and the new dish doesn't, swapping like for like", () => {
    const d = draftFromSimilar({ name: "Mushroom & Cheddar Burger", kind: "MENU", category: "Burgers" }, examples, ix);
    const names = d.lines.map((l) => nameOf(l.itemKey));
    expect(names).toContain("Cheddar cheese, sliced");
    expect(names).not.toContain("Swiss cheese, sliced");
    expect(names).toContain("Mushrooms, cremini");
  });

  it("scales counts in the name: Wings (10) from Wings (6)", () => {
    const d = draftFromSimilar({ name: "Wings (10)", kind: "MENU", category: "Wings" }, examples, ix);
    expect(linesOf(d)).toContainEqual(["Chicken wings", 10, "wing"]);
    expect(linesOf(d)).toContainEqual(["Buffalo Sauce", 3, "fl oz"]);
  });

  it("doubles the protein for a double", () => {
    const d = draftFromSimilar({ name: "Double Classic Burger", kind: "MENU", category: "Burgers" }, examples, ix);
    expect(linesOf(d)).toContainEqual(["Ground beef (Kilcoyne)", 11.4, "oz"]);
  });

  it("drafts a side from another side, picking the variant named", () => {
    const d = draftFromSimilar({ name: "Side of Vegan Garlic Aioli", kind: "MENU", category: "Sides", price: 1 }, examples, ix);
    expect(linesOf(d)).toEqual([["Vegan Garlic Aioli", 2, "fl oz"]]);
  });

  it("uses the Square description: a potato bun replaces the milk bun", () => {
    const d = draftFromSimilar({ name: "Classic Burger Plate", kind: "MENU", category: "Burgers", description: "Smash patty, American cheese, lettuce, Subversive sauce on a potato bun" }, examples, ix);
    const names = d.lines.map((l) => nameOf(l.itemKey));
    expect(names).toContain("Martin's potato bun");
    expect(names).not.toContain("Milk bun");
  });

  it("drafts an add-on from its name alone", () => {
    const d = draftFromSimilar({ name: "Add bacon #100", kind: "MODIFIER", category: "Add-ons", price: 3 }, examples, ix);
    expect(d.name).toBe("Add bacon");
    expect(linesOf(d)).toEqual([["Bacon", 2, "slice"]]);
  });

  it("says so when there's nothing to go on", () => {
    expect(draftFromSimilar({ name: "No onions", kind: "MODIFIER" }, examples, ix).lines).toEqual([]);
    const d = draftFromSimilar({ name: "Gift card", kind: "MENU" }, examples, ix);
    expect(d.lines).toEqual([]);
    expect(d.warnings[0]).toMatch(/Nothing/);
  });
});

describe("draftCost", () => {
  it("adds up priced lines and works out food cost %", () => {
    const c = draftCost({ kind: "MENU", menuPrice: 10, lines: [{ itemKey: "i:bun", qty: 1, unit: "bun" }, { itemKey: "i:beef", qty: 100, unit: "g" }, { itemKey: null, newName: "Truffle", qty: 1, unit: "each" }] }, ix);
    expect(c.total).toBeCloseTo(0.6 + 1.54);
    expect(c.missing).toBe(1);
    expect(c.foodCostPct).toBeCloseTo(0.214, 3);
  });
});

describe("countIn / parseYield", () => {
  it.each([["Wings (10)", 10], ["10 pc wings", 10], ["Half dozen wings", 6], ["Classic Burger", null]])("%s", (s, n) => expect(countIn(s as string)).toBe(n));
  it("reads yields", () => {
    expect(parseYield("7 bbl")).toEqual({ qty: 7, unit: "bbl", servings: false });
    expect(parseYield("2 quarts")).toEqual({ qty: 2, unit: "qt", servings: false });
    expect(parseYield("4 servings")).toMatchObject({ qty: 4, servings: true });
  });
});

describe("parseRecipeText", () => {
  it("reads a kitchen recipe from Notes", () => {
    const d = parseRecipeText("Chipotle Aioli\nYield: 2 qt\n- 4 cups heavy mayo\n2 tbsp lemon juice\n3 tbsp chipotle powder\n1 tsp kosher salt\n\nMethod:\nWhisk everything. Keeps 7 days.", ix);
    expect(d.name).toBe("Chipotle Aioli");
    expect(d.kind).toBe("PREP");
    expect([d.yieldQty, d.yieldUnit]).toEqual([2, "qt"]);
    expect(linesOf(d)).toContainEqual(["Heavy Mayo", 4, "cup"]);
    expect(linesOf(d)).toContainEqual(["Lemon Juice", 2, "tbsp"]);
    expect(d.lines.find((l) => !l.itemKey)).toMatchObject({ newName: "Chipotle powder", qty: 3, unit: "tbsp", newBaseUnit: "ml" });
    expect(d.notes).toMatch(/Whisk everything/);
  });

  it("divides a menu recipe written for several servings", () => {
    const d = parseRecipeText("Smash burgers\nServes 4\n1.5 lb ground beef\n4 potato buns", ix);
    expect(d.kind).toBe("MENU");
    expect(linesOf(d)).toEqual([["Ground beef (Kilcoyne)", 0.375, "lb"], ["Martin's potato bun", 1, "bun"]]);
  });

  it("reads a brewing sheet as a beer prep recipe in bbl", () => {
    const sheet = `Catskill Pils
Batch size: 7 bbl
OG 1.048  FG 1.010  IBU 32
Grain bill
380# Pilsner malt (90%)
40 lb Munich malt
Hops
4 lb Saaz @ 60 min
3 lb Saaz - whirlpool
Yeast
2 packs W-34/70
Mash 150F 60 min`;
    expect(looksLikeBrewSheet(sheet)).toBe(true);
    const d = parseRecipeText(sheet, ix);
    expect(d).toMatchObject({ name: "Catskill Pils", kind: "PREP", category: "Beer", yieldQty: 7, yieldUnit: "bbl" });
    const by = Object.fromEntries([...d.lines].reverse().map((l) => [l.newName, l]));
    expect(by["Pilsner malt"]).toMatchObject({ qty: 380, unit: "lb", newBaseUnit: "g", note: "90%" });
    expect(by["Saaz hops"]).toMatchObject({ qty: 4, unit: "lb", note: "60 min" });
    expect(by["W-34/70 yeast"]).toMatchObject({ qty: 2, unit: "each" });
    expect(d.lines).toHaveLength(5);
    expect(d.notes).toMatch(/OG 1.048/);
    expect(d.notes).toMatch(/Mash 150F/);
  });
});

describe("resolveAiDraft", () => {
  it("maps Claude's names to real items, keeps new ones, and fixes units", () => {
    const d = resolveAiDraft({
      name: "Bacon Blue Burger", kind: "MENU", category: "Burgers", yieldQty: 1, yieldUnit: "each", notes: "",
      lines: [
        { item: "Ground beef (Kilcoyne)", isNew: false, qty: 5.7, unit: "oz", note: "" },
        { item: "bacon", isNew: false, qty: 2, unit: "slices", note: "" },
        { item: "Milk bun", isNew: false, qty: 1, unit: "cup", note: "" },
        { item: "Blue cheese crumbles", isNew: true, qty: 1, unit: "oz", note: "Max doesn't stock this yet" },
        { item: "Subversive Sauce", isNew: false, qty: 0, unit: "fl oz", note: "" },
      ],
    }, ix, "ai", { menuPrice: 21 });
    expect(linesOf(d)).toEqual([["Ground beef (Kilcoyne)", 5.7, "oz"], ["Bacon", 2, "slice"], ["Milk bun", 1, "bun"], [null, 1, "oz"]]);
    expect(d.lines[2].note).toMatch(/check the amount/);
    expect(d.lines[3]).toMatchObject({ newName: "Blue cheese crumbles", newBaseUnit: "g" });
    expect(d.menuPrice).toBe(21);
    expect(d.warnings[0]).toMatch(/1 line needs a new ingredient/);
  });
});

describe("drinks", () => {
  const beer: DraftItem = { key: "r:pils", name: "Catskill Pils", kind: "recipe", category: "Beer", baseUnit: "ml", conversions: [], units: ["ml", "fl oz", "bbl"], costPerBase: 0.0006 };
  const bix = indexItems([...items, beer], examples);
  it.each([["Pils (Pint)", 16], ["IPA · Half pour", 8], ["Stout (Crowler)", 32], ["Sour (Growler)", 64], ["Lager 12 oz", 12], ["Classic Burger", null]])("pour size of %s", (n, v) => expect(pourSize(n as string)).toBe(v));
  it("never drafts a beer from a burger", () => {
    expect(isDrink("Classic Stout")).toBe(true);
    const d = draftFromSimilar({ name: "Classic Stout", kind: "MENU", category: "Burgers" }, examples, ix);
    expect(d.lines).toEqual([]);
    expect(d.warnings[0]).toMatch(/drink/);
  });
  it("pours the house beer named, at the pour size", () => {
    const d = draftFromSimilar({ name: "Catskill Pils (Pint)", kind: "MENU", category: "Draft beer", price: 7 }, examples, bix);
    expect(d.lines.map((l) => [bix.byKey.get(l.itemKey!)?.name, l.qty, l.unit])).toEqual([["Catskill Pils", 16, "fl oz"]]);
  });
});
