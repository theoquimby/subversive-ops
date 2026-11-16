import { describe, expect, it } from "vitest";
import { asCountEvery, countProgress, isDue, parseItemKey, prepKey, usedOnMenu, valueBreakdown, valueChange } from "../countPlan";

describe("isDue", () => {
  it("every count is always due", () => expect(isDue("every", "2026-11-10", "2026-11-16")).toBe(true));
  it("monthly is due after 30 days", () => {
    expect(isDue("monthly", "2026-10-20", "2026-11-16")).toBe(false);
    expect(isDue("monthly", "2026-10-17", "2026-11-16")).toBe(true);
  });
  it("only-when-it-changes is never due once it has a count", () => {
    expect(isDue("changes", "2026-01-01", "2026-11-16")).toBe(false);
    expect(isDue("changes", null, "2026-11-16")).toBe(true);
  });
  it("reads unknown frequencies as every count", () => expect(asCountEvery("weekly")).toBe("every"));
});

describe("item keys", () => {
  it("round-trips prep and ingredient keys", () => {
    expect(parseItemKey(prepKey("abc"))).toEqual({ kind: "prep", id: "abc" });
    expect(parseItemKey("cxyz")).toEqual({ kind: "ingredient", id: "cxyz" });
  });
});

describe("countProgress", () => {
  it("counts what's left per area in walking order", () => {
    const items = [{ id: "a", area: "Walk-in" }, { id: "b", area: "Walk-in" }, { id: "c", area: "Dry storage" }, { id: "d", area: "Dry storage" }];
    const p = countProgress(items, new Set(["a"]));
    expect(p).toMatchObject({ total: 4, done: 1, remaining: 3 });
    expect(p.left).toEqual([{ area: "Walk-in", left: 1, firstId: "b" }, { area: "Dry storage", left: 2, firstId: "c" }]);
  });
});

describe("usedOnMenu", () => {
  it("walks menu items through sub-recipes, ignoring inactive ones", () => {
    const u = usedOnMenu([
      { id: "burger", kind: "MENU", active: true, lines: [{ ingredientId: "bun", subRecipeId: null }, { ingredientId: null, subRecipeId: "aioli" }] },
      { id: "aioli", kind: "PREP", active: true, lines: [{ ingredientId: "mayo", subRecipeId: null }] },
      { id: "old", kind: "MENU", active: false, lines: [{ ingredientId: "beans", subRecipeId: null }] },
      { id: "pickles", kind: "PREP", active: true, lines: [{ ingredientId: "cukes", subRecipeId: null }] },
    ]);
    expect([...u.ingredients].sort()).toEqual(["bun", "mayo"]);
    expect([...u.preps]).toEqual(["aioli"]);
  });
});

describe("valueBreakdown", () => {
  it("totals by area and category and the carried share", () => {
    const b = valueBreakdown([
      { key: "a", name: "Beans", area: "Dry", category: "Canned", value: 40, carriedFrom: "2026-10-02" },
      { key: "b", name: "Flour", area: "Dry", category: "Baking", value: 20.005, carriedFrom: null },
      { key: "c", name: "Wings", area: "Freezer", category: "Meat", value: 100, carriedFrom: null },
    ]);
    expect(b.total).toBe(160.01);
    expect(b.byArea[0]).toEqual({ name: "Freezer", value: 100 });
    expect(b.byArea[1].name).toBe("Dry");
    expect(b.carriedValue).toBe(40);
    expect(b.carriedCount).toBe(1);
  });
  it("change vs the last count", () => {
    expect(valueChange(110, 100)).toEqual({ amount: 10, pct: 0.1 });
    expect(valueChange(110, null)).toBeNull();
  });
});

describe("isSupplyCategory", () => {
  it("spots supplies, not food", async () => {
    const { isSupplyCategory } = await import("../countPlan");
    expect(["Packaging", "Cleaning", "Kitchen supplies", "Supplies"].every(isSupplyCategory)).toBe(true);
    expect(["Grocery", "Produce", "Prepared", "Bar", "Dry goods"].some(isSupplyCategory)).toBe(false);
  });
});

describe("counting one item in several places", () => {
  it("lists the storage area first, then extra home areas, once each", async () => {
    const { homeAreas } = await import("../countPlan");
    expect(homeAreas("Dry storage", ["Walk-in", "dry storage", ""])).toEqual(["Dry storage", "Walk-in"]);
  });
  it("replaces one area's count and keeps the others", async () => {
    const { mergeAreaParts, partsByArea } = await import("../countPlan");
    const before = [{ area: "Dry storage", qty: 3, unit: "gal" }, { qty: 1, unit: "gal" }];
    const after = mergeAreaParts(before, "Walk-in", [{ qty: 1.5, unit: "gal" }], "Lowboy");
    expect(after).toEqual([{ area: "Dry storage", qty: 3, unit: "gal" }, { area: "Lowboy", qty: 1, unit: "gal" }, { area: "Walk-in", qty: 1.5, unit: "gal" }]);
    expect(mergeAreaParts(after, "Walk-in", [], "Lowboy")).toHaveLength(2);
    expect(partsByArea(after, "x").map((p) => p.area)).toEqual(["Dry storage", "Lowboy", "Walk-in"]);
  });
  it("flags a likely double count, and big swings", async () => {
    const { totalCheck } = await import("../countPlan");
    expect(totalCheck({ total: 12, places: 3, expected: 5, last: 6 })).toEqual({ kind: "double", ratio: 2.4 });
    expect(totalCheck({ total: 12, places: 1, expected: 5, last: 6 })).toBeNull();
    expect(totalCheck({ total: 25, places: 1, expected: 5, last: 6 })?.kind).toBe("high");
    expect(totalCheck({ total: 1, places: 1, expected: null, last: 6 })?.kind).toBe("low");
    expect(totalCheck({ total: 5, places: 2, expected: 5, last: 6 })).toBeNull();
    expect(totalCheck({ total: 4, places: 2, expected: 1, last: null, minGap: 4 })).toBeNull();
  });
});
