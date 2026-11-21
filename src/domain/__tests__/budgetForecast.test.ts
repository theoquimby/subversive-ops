import { describe, expect, it } from "vitest";
import { forecastSalesTargets } from "../budgets";

const row = (weekStart: string, when: "past" | "current" | "future", sales: number | null, sales_forecast: number | null) => ({ weekStart, when, sales, foodCostPct: 0.28, laborPct: null, sales_forecast });

describe("forecastSalesTargets", () => {
  it("fills blank sales targets for this week and weeks ahead from the forecast, rounded to $50", () => {
    const rows = [row("2026-11-09", "past", null, null), row("2026-11-16", "current", null, 14_123), row("2026-11-23", "future", 15_000, 16_010), row("2026-11-30", "future", null, 12_980)];
    expect(forecastSalesTargets(rows)).toEqual([
      { weekStart: "2026-11-16", sales: 14_100, foodCostPct: 0.28, laborPct: null },
      { weekStart: "2026-11-30", sales: 13_000, foodCostPct: 0.28, laborPct: null },
    ]);
  });
  it("skips weeks with no forecast", () => {
    expect(forecastSalesTargets([row("2026-11-23", "future", null, 0), row("2026-11-30", "future", null, null)])).toEqual([]);
  });
});
