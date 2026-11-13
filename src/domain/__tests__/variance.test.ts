import { describe, expect, it } from "vitest";
import { computeVariance, dominantClass, explainVariance, friendlyUnit } from "../variance";

const base = { category: "Protein", received: 0, theoretical: 0, waste: 0, unitCost: 0.01 };

describe("computeVariance", () => {
  const s = computeVariance([
    // 10 kg + 20 kg delivered − 12 kg left = 18 kg used; sales say 15 kg, 1 kg logged waste → 2 kg unexplained
    { ...base, ingredientId: "beef", name: "Beef", opening: 10000, received: 20000, closing: 12000, theoretical: 15000, waste: 1000 },
    // used less than expected
    { ...base, ingredientId: "buns", name: "Buns", opening: 100, received: 0, closing: 60, theoretical: 45, waste: 0, unitCost: 0.65 },
    // not counted at the end → skipped
    { ...base, ingredientId: "salt", name: "Salt", opening: 1000, closing: null, theoretical: 50 },
  ]);
  it("splits actual usage into theoretical, waste and unexplained", () => {
    const beef = s.rows.find((r) => r.ingredientId === "beef")!;
    expect(beef.actual).toBe(18000);
    expect(beef.unexplained).toBe(2000);
    expect(beef.unexplainedCost).toBeCloseTo(20);
    expect(beef.unexplainedPct).toBeCloseTo(2000 / 15000);
  });
  it("handles under-use and skips incomplete rows in the totals", () => {
    expect(s.rows.find((r) => r.ingredientId === "buns")!.unexplained).toBe(-5);
    expect(s.skipped).toBe(1);
    expect(s.unexplainedCost).toBeCloseTo(20 - 5 * 0.65);
    expect(s.actualCost).toBeCloseTo(180 + 40 * 0.65);
  });
  it("sorts by size of the dollar gap", () => {
    expect(s.rows[0].ingredientId).toBe("beef");
  });
});

describe("explainVariance", () => {
  const burger = { recipeId: "b", name: "Subversive burger", perServing: 170, sold: 160 };
  const smash = { recipeId: "s", name: "Smash melt", perServing: 113, sold: 20 };
  const theoretical = 170 * 160 + 113 * 20;

  it("puts an overage in per-serving terms on the item that uses most", () => {
    const unexplained = 2400; // ~5.3 lb
    const e = explainVariance({ actual: theoretical + unexplained, theoretical, waste: 0, unexplained, unexplainedCost: 30 }, [smash, burger])!;
    expect(e.cause).toBe("over");
    expect(e.dish?.name).toBe("Subversive burger");
    expect(e.portionPct).toBeCloseTo(unexplained / theoretical);
    expect(e.perServing! / 28.35).toBeCloseTo(0.49, 1); // about half an ounce per burger
    expect(e.others).toBe(1);
  });

  it("names the other causes", () => {
    const row = { actual: 100, theoretical: 200, waste: 0, unexplained: -100, unexplainedCost: -20 };
    expect(explainVariance(row, [burger])!.cause).toBe("under");
    expect(explainVariance({ ...row, actual: 300, unexplained: 80, waste: 20, unexplainedCost: 16 }, [burger])!.cause).toBe("overWithWaste");
    expect(explainVariance({ actual: 500, theoretical: 0, waste: 0, unexplained: 500, unexplainedCost: 12 }, [])!.cause).toBe("unsold");
    expect(explainVariance({ ...row, unexplained: 4, unexplainedCost: 0.8 }, [burger])!.cause).toBe("small");
    // A few percent is noise unless it adds up to real money.
    expect(explainVariance({ ...row, actual: 204, unexplained: 4, unexplainedCost: 12 }, [burger])!.cause).toBe("small");
    expect(explainVariance({ ...row, actual: 204, unexplained: 4, unexplainedCost: 23 }, [burger])!.cause).toBe("over");
    expect(explainVariance({ ...row, actual: null, unexplained: null, unexplainedCost: null }, [burger])).toBeNull();
  });
});

describe("friendlyUnit", () => {
  it("picks the unit people say", () => {
    expect(friendlyUnit("g", 2400).unit).toBe("lb");
    expect(friendlyUnit("g", 100).unit).toBe("oz");
    expect(friendlyUnit("g", 2400, true).unit).toBe("oz");
    expect(friendlyUnit("ml", 20000).unit).toBe("gal");
    expect(friendlyUnit("ml", 1000).unit).toBe("qt");
    expect(friendlyUnit("ml", 50, true).unit).toBe("fl oz");
    expect(friendlyUnit("each", 3).unit).toBe("each");
  });
});

describe("dominantClass", () => {
  it("follows usage, else the fallback", () => {
    expect(dominantClass(new Map([["food", 10], ["beer", 30]]), "food")).toBe("beer");
    expect(dominantClass(new Map(), "beer")).toBe("beer");
  });
});
