import { describe, expect, it } from "vitest";
import { DEFAULT_POURS, planDraftBeer } from "../draftBeer";

describe("planDraftBeer", () => {
  it("costs a half barrel per usable ounce and per pour", () => {
    const plan = planDraftBeer({ beer: "Subversive IPA", kegSizeId: "half", kegCost: 140, yieldPct: 0.95, pours: DEFAULT_POURS });
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.ingredientName).toBe("Subversive IPA (keg)");
    expect(plan.kegMl).toBeCloseTo(15.5 * 3785.411784);
    expect(plan.usableOz).toBeCloseTo(1984 * 0.95, 0);
    expect(plan.costPerOz).toBeCloseTo(140 / (1984 * 0.95), 4);
    const pint = plan.pours[0];
    expect(pint.recipeName).toBe("Subversive IPA · 16 oz");
    expect(pint.cost).toBeCloseTo(16 * plan.costPerOz);
    expect(pint.pourCostPct).toBeCloseTo(pint.cost / 8);
    expect(plan.pours[2].oz).toBe(16); // flight of 4 × 4 oz
  });

  it("rejects bad input with a plain message", () => {
    const ok = { beer: "Lager", kegSizeId: "sixtel", kegCost: 60, yieldPct: 0.95, pours: DEFAULT_POURS };
    expect(planDraftBeer({ ...ok, beer: " " })).toEqual({ error: "Name the beer." });
    expect(planDraftBeer({ ...ok, kegSizeId: "x" })).toEqual({ error: "Pick a keg size." });
    expect(planDraftBeer({ ...ok, kegCost: 0 })).toEqual({ error: "Enter what a keg costs." });
    expect(planDraftBeer({ ...ok, yieldPct: 1.2 })).toHaveProperty("error");
    expect(planDraftBeer({ ...ok, pours: [] })).toHaveProperty("error");
    expect(planDraftBeer({ ...ok, pours: [{ label: "Pint", oz: 0, price: 7 }] })).toHaveProperty("error");
    expect(planDraftBeer({ ...ok, pours: [{ label: "Pint", oz: 16, price: 7 }, { label: "pint", oz: 10, price: 5 }] })).toEqual({ error: "Two pours have the same name." });
  });

  it("leaves pour cost % empty for pours with no price", () => {
    const plan = planDraftBeer({ beer: "Lager", kegSizeId: "sixtel", kegCost: 60, yieldPct: 1, pours: [{ label: "Staff pour", oz: 12, price: null }] });
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.pours[0].pourCostPct).toBeNull();
  });
});
