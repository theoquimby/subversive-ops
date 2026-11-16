import { describe, expect, it } from "vitest";
import { foldItemSales, foldRecipeSales } from "../salesRollup";
import { theoreticalByDay } from "../pnl";

describe("foldRecipeSales", () => {
  it("builds a series per linked recipe and counts open days from any group that sold", () => {
    const { byRecipe, openDays } = foldRecipeSales([
      { date: "2026-11-01", recipeId: "burger", qty: 12, anySold: true },
      { date: "2026-11-01", recipeId: null, qty: 3, anySold: true }, // unlinked or ignored items still mean "open"
      { date: "2026-11-02", recipeId: null, qty: 2, anySold: true },
      { date: "2026-11-03", recipeId: "burger", qty: -1, anySold: false }, // only a refund: not an open day, still in the series
      { date: "2026-11-04", recipeId: "fries", qty: 0, anySold: false },
    ]);
    expect(byRecipe.get("burger")).toEqual(new Map([["2026-11-01", 12], ["2026-11-03", -1]]));
    expect(byRecipe.get("fries")).toEqual(new Map([["2026-11-04", 0]]));
    expect(byRecipe.has("null")).toBe(false);
    expect([...openDays].sort()).toEqual(["2026-11-01", "2026-11-02"]);
  });

  it("adds up groups that repeat a date and recipe", () => {
    const { byRecipe } = foldRecipeSales([
      { date: "2026-11-01", recipeId: "a", qty: 1.5, anySold: true },
      { date: "2026-11-01", recipeId: "a", qty: 2, anySold: true },
    ]);
    expect(byRecipe.get("a")?.get("2026-11-01")).toBe(3.5);
  });
});

describe("foldItemSales", () => {
  const rows = [
    { date: "2026-11-01", recipeId: "burger", qty: 10, sales: 150 },
    { date: "2026-11-01", recipeId: null, qty: 4, sales: 20 },
    { date: "2026-11-02", recipeId: "ipa", qty: 30, sales: 210 },
  ];

  it("totals every non-ignored item per day and keeps linked recipes as sold lines", () => {
    const { sold, itemTotal } = foldItemSales(rows);
    expect(itemTotal).toEqual(new Map([["2026-11-01", 170], ["2026-11-02", 210]]));
    expect(sold).toEqual([
      { date: "2026-11-01", recipeId: "burger", qty: 10, sales: 150 },
      { date: "2026-11-02", recipeId: "ipa", qty: 30, sales: 210 },
    ]);
  });

  it("gives the same theoretical cost as the per-item lines it sums", () => {
    // Two Square variations of the same burger on one day, summed by the database into one group.
    const perItem = [
      { date: "2026-11-01", recipeId: "burger", qty: 6, sales: 90 },
      { date: "2026-11-01", recipeId: "burger", qty: 4, sales: 60 },
    ];
    const grouped = foldItemSales([{ date: "2026-11-01", recipeId: "burger", qty: 10, sales: 150 }]).sold;
    const cost = () => ({ cost: 4.25, incomplete: false });
    const cls = () => "food" as const;
    expect(theoreticalByDay(grouped, cost, cls).byDay).toEqual(theoreticalByDay(perItem, cost, cls).byDay);
  });
});

describe("bought-in items (a cost each, no recipe)", () => {
  it("come back as fixed lines in their class and add to that day's split", async () => {
    const { addFixedLines } = await import("../salesRollup");
    const { emptySplit } = await import("../revenueClass");
    const { sold, fixed, itemTotal } = foldItemSales([
      { date: "2026-11-01", recipeId: "burger", qty: 10, sales: 150 },
      { date: "2026-11-01", recipeId: null, qty: 6, sales: 96, fixedClass: "beer", fixedCost: 30 },
      { date: "2026-11-02", recipeId: null, qty: 2, sales: 50, fixedClass: "nonsense", fixedCost: 20 },
      { date: "2026-11-02", recipeId: null, qty: 4, sales: 20, fixedClass: null, fixedCost: null },
    ]);
    expect(sold).toHaveLength(1);
    expect(itemTotal.get("2026-11-02")).toBe(70);
    expect(fixed).toEqual([
      { date: "2026-11-01", cls: "beer", sales: 96, cogs: 30 },
      { date: "2026-11-02", cls: "retail", sales: 50, cogs: 20 },
    ]);
    const day1 = emptySplit();
    day1.food = { sales: 150, cogs: 45, uncostedSales: 0 };
    const byDay = addFixedLines(new Map([["2026-11-01", day1]]), fixed);
    expect(byDay.get("2026-11-01")!.beer).toMatchObject({ sales: 96, cogs: 30 });
    expect(byDay.get("2026-11-01")!.food).toMatchObject({ sales: 150, cogs: 45 });
    expect(byDay.get("2026-11-02")!.retail).toMatchObject({ sales: 50, cogs: 20 });
  });
});
