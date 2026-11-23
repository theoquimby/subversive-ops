import { describe, expect, it } from "vitest";
import { decisions, weekRecap, worstRag } from "../weekRecap";

describe("last week recap", () => {
  const base = { sales: 24000, foodPct: 0.29, beveragePct: 0.25, laborPct: 0.32, primePct: 0.6, targets: { food: 0.3, beverage: 0.22 } };
  it("compares with the week's budget", () => {
    const rows = weekRecap({ ...base, budget: { sales: 25000, foodCostPct: 0.28, laborPct: 0.29 } });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.sales.rag).toBe("warn"); // 96% of target
    expect(by.sales.diff).toBe(-1000);
    expect(by.food.target).toBe(0.28);
    expect(by.food.rag).toBe("warn");
    expect(by.beverage.rag).toBe("bad");
    expect(by.labor.rag).toBe("bad");
    expect(by.prime.target).toBeCloseTo(0.57);
    expect(worstRag(rows)).toBe("bad");
  });
  it("falls back to the menu target without a budget and leaves the rest untargeted", () => {
    const by = Object.fromEntries(weekRecap({ ...base, budget: null }).map((r) => [r.key, r]));
    expect(by.food.target).toBe(0.3);
    expect(by.food.targetSource).toBe("menu target");
    expect(by.sales.rag).toBe("none");
    expect(by.labor.target).toBeNull();
    expect(by.prime.target).toBeNull();
  });
  it("never reads a week with no timecards as 0% labor in the green", () => {
    const by = Object.fromEntries(weekRecap({ ...base, laborPct: 0, primePct: 0.29, laborIn: false, budget: { sales: 25000, foodCostPct: 0.28, laborPct: 0.29 } }).map((r) => [r.key, r]));
    expect(by.labor.actual).toBeNull();
    expect(by.labor.rag).toBe("none");
    expect(by.labor.missing).toBe("No timecards");
    expect(by.prime.actual).toBeNull();
    expect(by.prime.rag).toBe("none");
    expect(by.food.missing).toBeNull();
  });
  it("holds sales back while days aren't in yet", () => {
    const by = Object.fromEntries(weekRecap({ ...base, sales: 2940, salesNotIn: 6, budget: { sales: 25000, foodCostPct: null, laborPct: null } }).map((r) => [r.key, r]));
    expect(by.sales.actual).toBe(2940);
    expect(by.sales.rag).toBe("none");
    expect(by.sales.diff).toBeNull();
    expect(by.sales.missing).toBe("6 days not in yet");
  });
  it("pro-rates sales when part of the week is still running", () => {
    const by = Object.fromEntries(weekRecap({ ...base, sales: 22000, budget: { sales: 28000, foodCostPct: null, laborPct: null }, elapsed: 6 / 7 }).map((r) => [r.key, r]));
    expect(by.sales.rag).toBe("warn"); // 22k of 24k due
    expect(by.sales.diff).toBeCloseTo(-2000);
  });
});

describe("needs a decision", () => {
  it("lists only what's waiting, in order", () => {
    const d = decisions({ timeOff: 2, swaps: 0, badReviews: 1, autoOrders: 1, draftShifts: 12, scheduleAutoDrafted: true, invoiceIssues: 3 });
    expect(d.map((x) => x.key)).toEqual(["timeOff", "autoOrders", "schedule", "invoiceIssues", "badReviews"]);
    expect(d[0].title).toBe("2 time-off requests to approve");
    expect(d[2].title).toContain("drafted");
    expect(decisions({ timeOff: 0, swaps: 0, badReviews: 0, autoOrders: 0, draftShifts: 0, scheduleAutoDrafted: false, invoiceIssues: 0 })).toEqual([]);
  });
});
