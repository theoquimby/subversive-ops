import { describe, expect, it } from "vitest";
import { computeVariance } from "../variance";

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
