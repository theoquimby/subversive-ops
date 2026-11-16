import { describe, expect, it } from "vitest";
import {
  bandOf,
  beerGroups,
  classifyItem,
  coverage,
  defaultCostClass,
  describeState,
  isSettled,
  linkEffect,
  looksHouseMade,
  prepTwin,
  rankCandidates,
  safeToBulk,
  sameState,
  sizeConflict,
  suggestUnitCost,
  suspicious,
  unitCostEffect,
  UNLINKED,
  type LinkItem,
  type LinkRecipe,
} from "../linking";

const item = (name: string, extra: Partial<LinkItem> = {}): LinkItem => ({ squareId: name, name, baseName: name, modifier: false, category: null, price: null, ...extra });
const recipe = (id: string, name: string, extra: Partial<LinkRecipe> = {}): LinkRecipe => ({ id, name, kind: "MENU", category: "Food", menuPrice: null, cost: 3, incomplete: false, lines: 4, ...extra });

const RECIPES: LinkRecipe[] = [
  recipe("classic", "Classic Burger", { category: "Burgers", menuPrice: 18 }),
  recipe("bacon", "Bacon Barbecue Burger", { category: "Burgers", menuPrice: 20 }),
  recipe("w6", "Wings (6)", { category: "Wings", menuPrice: 13 }),
  recipe("w10", "Wings (10)", { category: "Wings", menuPrice: 16 }),
  recipe("caesar", "Caesar Salad", { category: "Salads", menuPrice: 16 }),
  recipe("imv", "Impossible Vegan Burger", { category: "Burgers", menuPrice: 20 }),
  recipe("ipa-full", "Subversive IPA · Full Pour", { category: "Beer", menuPrice: 7.5 }),
  recipe("fries", "Side of Fries", { category: "Sides", menuPrice: 6 }),
  recipe("aioli", "Garlic Aioli", { kind: "PREP", category: "Sauces" }),
];

describe("sizeConflict", () => {
  it("spots different counts and sizes, and stays quiet when one side has none", () => {
    expect(sizeConflict("Wings (6) · Buffalo", "Wings (10)")).toBe(true);
    expect(sizeConflict("Wings (6) · Buffalo", "Wings (6)")).toBe(false);
    expect(sizeConflict("Festbier · Half Pour", "Festbier · Full Pour")).toBe(true);
    expect(sizeConflict("Classic Burger", "Classic Burger (double)")).toBe(false);
    expect(sizeConflict("Kids Burger", "Classic Burger · Large")).toBe(true);
  });
});

describe("rankCandidates", () => {
  it("puts the same name first with full confidence and says why", () => {
    const [c] = rankCandidates(item("Vegan Impossible Burger", { price: 20, category: "Burgers" }), RECIPES);
    expect(c.recipeId).toBe("imv");
    expect(c.confidence).toBeGreaterThanOrEqual(0.95);
    expect(c.reasons).toContain("Same price");
    expect(c.reasons).toContain("Same category");
  });

  it("keeps the right size: Wings (6) · Buffalo is Wings (6), not Wings (10)", () => {
    const cs = rankCandidates(item("Wings (6) · Buffalo", { baseName: "Wings (6)" }), RECIPES);
    expect(cs[0].recipeId).toBe("w6");
    const ten = cs.find((c) => c.recipeId === "w10");
    expect(!ten || ten.confidence < cs[0].confidence - 0.2).toBe(true);
  });

  it("never offers prep recipes for a sold item", () => {
    expect(rankCandidates(item("Garlic Aioli"), RECIPES).map((c) => c.recipeId)).not.toContain("aioli");
  });

  it("doesn't match one beer's pour to another beer", () => {
    expect(rankCandidates(item("Subversive Saison · Full Pour"), RECIPES).map((c) => c.recipeId)).not.toContain("ipa-full");
    expect(rankCandidates(item("Subversive IPA · Half Pour"), RECIPES).map((c) => c.recipeId)).not.toContain("ipa-full");
    expect(rankCandidates(item("Subversive IPA · Full Pour"), RECIPES)[0].recipeId).toBe("ipa-full");
  });

  it("pulls a match down when the price is far off or Square calls it a drink", () => {
    const near = rankCandidates(item("Caesar Salad", { price: 16 }), RECIPES)[0].confidence;
    const far = rankCandidates(item("Caesar Salad", { price: 4 }), RECIPES)[0].confidence;
    expect(far).toBeLessThan(near);
    const drink = rankCandidates(item("Caesar Salad", { category: "Cocktails" }), RECIPES)[0];
    expect(drink.reasons.join(" ")).toMatch(/drink/);
  });

  it("skips rejected recipes and caps a near tie below 'sure'", () => {
    expect(rankCandidates(item("Classic Burger"), RECIPES, { rejected: new Set(["classic"]) }).map((c) => c.recipeId)).not.toContain("classic");
    const twins = [recipe("a", "Mushroom Swiss Burger"), recipe("b", "Mushroom & Swiss Burger")];
    const [top] = rankCandidates(item("Mushroom + Swiss Burger"), twins);
    expect(bandOf(top.confidence)).not.toBe("high");
  });

  it("lets an add-on match a side when there are no add-on recipes", () => {
    const cs = rankCandidates(item("Fries (Add a side:)", { baseName: "Fries", modifier: true }), RECIPES);
    expect(cs[0].recipeId).toBe("fries");
  });
});

describe("classifyItem", () => {
  const beers = [{ id: "nyn", name: "New York Nectar", squareNames: ["New York Nectar*"] }];
  it("sorts beer pours, cans, merch, gift cards, drinks and food", () => {
    expect(classifyItem(item("New York Nectar* · Full Pour"), beers)).toMatchObject({ kind: "beer", beerId: "nyn", beerName: "New York Nectar" });
    expect(classifyItem(item("Golden Lager · Half Pour"), beers)).toMatchObject({ kind: "beer", beerId: null, beerName: "Golden Lager" });
    expect(classifyItem(item("Festbier | 4 pack 16 oz cans"), beers).kind).toBe("packaged");
    expect(classifyItem(item("Dark Tee - Large"), beers).kind).toBe("retail");
    expect(classifyItem(item("Gift Card"), beers).kind).toBe("notSales");
    expect(classifyItem(item("Service fee"), beers).kind).toBe("notSales");
    expect(classifyItem(item("Moscow mule"), beers).kind).toBe("drink");
    expect(classifyItem(item("Cabernet Sauvignon · 6 oz pour"), beers).kind).toBe("drink");
    expect(classifyItem(item("Giant Pretzel · The Full Hookup - Full Pour"), beers).kind).toBe("food");
    expect(classifyItem(item("Classic Burger"), beers).kind).toBe("food");
  });

  it("uses the Square category when the name says nothing", () => {
    expect(classifyItem(item("Off Axis", { category: "Merch" })).kind).toBe("retail");
    expect(classifyItem(item("Off Axis · Full Pour", { category: "Draft beer" })).kind).toBe("beer");
  });
});

describe("beerGroups", () => {
  it("groups pours per beer with ounces, biggest sales first, leaving out cans and flights", () => {
    const rows = [
      { ...item("Golden Lager · Full Pour", { price: 8 }), sales30: 400 },
      { ...item("Golden Lager · Half Pour (9 oz)", { price: 5 }), sales30: 100 },
      { ...item("New York Nectar* · Full Pour"), sales30: 900 },
      { ...item("Golden Lager | 4-pack 16 oz cans"), sales30: 300 },
      { ...item("Flight"), sales30: 80 },
      { ...item("Classic Burger"), sales30: 1000 },
    ];
    const g = beerGroups(rows, [{ id: "nyn", name: "New York Nectar", squareNames: ["New York Nectar*"] }]);
    expect(g.map((x) => x.beer)).toEqual(["New York Nectar", "Golden Lager"]);
    expect(g[1].pours.map((p) => [p.label, p.oz])).toEqual([["Full Pour", 16], ["Half Pour (9 oz)", 9]]);
    expect(g[1].sales30).toBe(500);
  });
});

describe("linkEffect", () => {
  const burger = item("Classic Burger", { price: 18 });
  it("says what the link costs as a share of the price", () => {
    const e = linkEffect(burger, recipe("c", "Classic Burger", { cost: 5.4 }));
    expect(e.cost).toBe(5.4);
    expect(e.pct).toBeCloseTo(0.3);
    expect(e.flags).toEqual([]);
    expect(suspicious(e)).toBe(false);
  });

  it("flags too cheap, too dear, empty recipes, missing prices, sizes and prep recipes", () => {
    expect(linkEffect(burger, recipe("c", "Classic Burger", { cost: 0.5 })).flags.map((f) => f.code)).toContain("low");
    expect(linkEffect(burger, recipe("c", "Classic Burger", { cost: 16 })).flags.map((f) => f.code)).toContain("high");
    const empty = linkEffect(burger, recipe("c", "Classic Burger", { lines: 0, cost: 0 }));
    expect(empty.cost).toBe(0);
    expect(empty.flags.map((f) => f.code)).toEqual(["noLines"]);
    expect(linkEffect(burger, recipe("c", "Classic Burger", { incomplete: true })).flags.map((f) => f.code)).toContain("missingPrices");
    expect(linkEffect(item("Classic Burger"), recipe("c", "Classic Burger")).flags.map((f) => f.code)).toEqual(["noSquarePrice"]);
    expect(suspicious(linkEffect(item("Wings (6)", { price: 13 }), recipe("w", "Wings (10)", { cost: 4 })))).toBe(true);
    expect(linkEffect(burger, recipe("p", "Burger Patty", { kind: "PREP" })).flags.map((f) => f.code)).toContain("kind");
  });

  it("only bulk-accepts sure matches with nothing off", () => {
    const ok = linkEffect(burger, recipe("c", "Classic Burger", { cost: 5 }));
    expect(safeToBulk({ recipeId: "c", recipeName: "Classic Burger", confidence: 0.97, reasons: [] }, ok)).toBe(true);
    expect(safeToBulk({ recipeId: "c", recipeName: "Classic Burger", confidence: 0.7, reasons: [] }, ok)).toBe(false);
    const empty = linkEffect(burger, recipe("c", "Classic Burger", { lines: 0 }));
    expect(safeToBulk({ recipeId: "c", recipeName: "Classic Burger", confidence: 1, reasons: [] }, empty)).toBe(false);
  });
});

describe("bought-in costs", () => {
  it("suggests a starting cost and class, and checks a typed one", () => {
    expect(suggestUnitCost("retail", 20)).toBe(10);
    expect(suggestUnitCost("packaged", 16)).toBe(5.6);
    expect(suggestUnitCost("food", null)).toBeNull();
    expect(defaultCostClass("retail", item("Tee"))).toBe("retail");
    expect(defaultCostClass("packaged", item("Festbier 4-pack cans"))).toBe("beer");
    expect(defaultCostClass("packaged", item("Indian Ladder Cider 4-pack cans"))).toBe("otherBev");
    expect(defaultCostClass("drink", item("Mexican Coca Cola"))).toBe("otherBev");
    expect(unitCostEffect(item("Tee", { price: 25 }), 10).pct).toBeCloseTo(0.4);
    expect(unitCostEffect(item("4-pack", { price: 16 }), 60).flags.map((f) => f.code)).toContain("high");
  });
});

describe("coverage", () => {
  it("counts recipe and cost-each items as linked and leaves left-out items out of both sides", () => {
    const c = coverage([
      { state: { ...UNLINKED, recipeId: "r" }, sales: 600 },
      { state: { ...UNLINKED, unitCost: 2, costClass: "beer" }, sales: 100 },
      { state: UNLINKED, sales: 300 },
      { state: { ...UNLINKED, ignored: true }, sales: 5000 },
      { state: UNLINKED, sales: 0 },
    ]);
    expect(c.total).toBe(1000);
    expect(c.linked).toBe(700);
    expect(c.share).toBeCloseTo(0.7);
    expect(c.toTarget).toBeCloseTo(200);
    expect(c.unlinkedItems).toBe(1);
    expect(coverage([]).share).toBeNull();
  });
});

describe("states", () => {
  it("compares, describes and settles", () => {
    expect(isSettled(UNLINKED)).toBe(false);
    expect(isSettled({ ...UNLINKED, ignored: true })).toBe(true);
    expect(sameState({ ...UNLINKED, unitCost: 2 }, { ...UNLINKED, unitCost: 2.001 })).toBe(true);
    expect(sameState({ ...UNLINKED, recipeId: "a" }, { ...UNLINKED, recipeId: "b" })).toBe(false);
    expect(describeState({ ...UNLINKED, unitCost: 2.5 })).toBe("Bought in at $2.50 each");
    expect(describeState({ ...UNLINKED, recipeId: "a" }, "Classic Burger")).toBe("Classic Burger");
  });
});

describe("inside recipes", () => {
  it("knows house-made things and finds the prep recipe twin", () => {
    expect(looksHouseMade("House Pickles")).toBe(true);
    expect(looksHouseMade("Garlic Aioli")).toBe(true);
    expect(looksHouseMade("Pulled Pork")).toBe(true);
    expect(looksHouseMade("Ground beef 80/20")).toBe(false);
    expect(looksHouseMade("Worcestershire Sauce")).toBe(false);
    expect(looksHouseMade("Sweet chili sauce (Mae Ploy)")).toBe(false);
    const preps = [{ id: "p1", name: "House Pickles" }, { id: "p2", name: "Garlic Aioli" }];
    expect(prepTwin("Pickles, house", preps)?.id).toBe("p1");
    expect(prepTwin("Garlic aioli", preps)?.id).toBe("p2");
    expect(prepTwin("Garlic", preps)).toBeNull();
  });
});
