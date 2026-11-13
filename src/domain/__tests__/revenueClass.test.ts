import { describe, expect, it } from "vitest";
import { addSplits, classifyCategory, emptySplit, groupOf, groupSplit, parseClassSettings } from "../revenueClass";

describe("classifyCategory", () => {
  it("guesses from the category name", () => {
    expect(classifyCategory("Mains")).toBe("food");
    expect(classifyCategory("Snacks")).toBe("food");
    expect(classifyCategory("Beer")).toBe("beer");
    expect(classifyCategory("Draft")).toBe("beer");
    expect(classifyCategory("House IPAs")).toBe("beer");
    expect(classifyCategory("Cans to go")).toBe("beer");
    expect(classifyCategory("Wine")).toBe("otherBev");
    expect(classifyCategory("N/A drinks")).toBe("otherBev");
    expect(classifyCategory("Merch")).toBe("retail");
    expect(classifyCategory("")).toBe("food");
    expect(classifyCategory(null)).toBe("food");
    // Whole words only: "Bartender specials" and "Steak" aren't drinks.
    expect(classifyCategory("Steak")).toBe("food");
  });

  it("lets the saved mapping win, case- and space-insensitively", () => {
    const map = { "beer cheese": "food" as const, specials: "otherBev" as const };
    expect(classifyCategory("Beer  Cheese", map)).toBe("food");
    expect(classifyCategory("SPECIALS", map)).toBe("otherBev");
  });

  it("groups classes for the P&L", () => {
    expect(groupOf("food")).toBe("food");
    expect(groupOf("beer")).toBe("beverage");
    expect(groupOf("otherBev")).toBe("beverage");
    expect(groupOf("retail")).toBe("other");
  });
});

describe("parseClassSettings", () => {
  it("normalizes keys and drops junk", () => {
    expect(parseClassSettings(JSON.stringify({ map: { " Beer ": "beer", Odd: "nonsense" }, bevTarget: 0.2 }))).toEqual({ map: { beer: "beer" }, bevTarget: 0.2 });
    expect(parseClassSettings("not json")).toEqual({ map: {}, bevTarget: null });
    expect(parseClassSettings(JSON.stringify({ bevTarget: 5 }))).toEqual({ map: {}, bevTarget: null });
    expect(parseClassSettings(null)).toEqual({ map: {}, bevTarget: null });
  });
});

describe("groupSplit", () => {
  it("splits food, beverage and total with separate cost %", () => {
    const s = emptySplit();
    s.food = { sales: 600, cogs: 180 };
    s.beer = { sales: 300, cogs: 45 };
    s.otherBev = { sales: 50, cogs: 12.5 };
    s.retail = { sales: 20, cogs: 8 };
    const g = groupSplit(s, 1000);
    expect(g.food.pct).toBeCloseTo(0.3);
    expect(g.beverage.sales).toBe(350);
    expect(g.beverage.pct).toBeCloseTo(57.5 / 350);
    expect(g.beer.pct).toBeCloseTo(0.15);
    // Retail + unlinked sales land in "other"; total uses the store figure.
    expect(g.other.sales).toBe(50);
    expect(g.total.cogs).toBeCloseTo(245.5);
    expect(g.total.pct).toBeCloseTo(0.2455);
    expect(g.food.mix).toBeCloseTo(0.6);
  });

  it("has no % without sales", () => {
    const g = groupSplit(emptySplit(), 0);
    expect(g.food.pct).toBeNull();
    expect(g.total.mix).toBeNull();
  });

  it("adds splits", () => {
    const a = emptySplit();
    a.beer = { sales: 10, cogs: 2 };
    expect(addSplits(a, a).beer).toEqual({ sales: 20, cogs: 4 });
  });
});
