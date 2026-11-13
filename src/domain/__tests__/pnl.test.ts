import { describe, expect, it } from "vitest";
import { addInputs, costTone, gapTone, hourlyShape, mondayOf, periodRange, projectClose, proratedBudget, salesTone, splitCents, summarize, theoreticalByDay, toCsv } from "../pnl";

describe("periodRange", () => {
  const today = "2026-11-13"; // Friday
  it("builds Monday-start weeks, months and custom ranges", () => {
    expect(mondayOf(today)).toBe("2026-11-09");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // Sunday
    expect(periodRange("today", today)).toEqual({ from: today, toExclusive: "2026-11-14" });
    expect(periodRange("week", today)).toEqual({ from: "2026-11-09", toExclusive: "2026-11-16" });
    expect(periodRange("lastweek", today)).toEqual({ from: "2026-11-02", toExclusive: "2026-11-09" });
    expect(periodRange("month", "2026-12-31")).toEqual({ from: "2026-12-01", toExclusive: "2027-01-01" });
    expect(periodRange("custom", today, { from: "2026-11-10", to: "2026-11-01" })).toEqual({ from: "2026-11-01", toExclusive: "2026-11-11" });
    expect(periodRange("custom", today, { from: "junk" })).toEqual({ from: "2026-11-07", toExclusive: "2026-11-14" });
  });
});

describe("summarize", () => {
  it("computes prime cost, percentages and productivity", () => {
    const s = summarize({ sales: 2000, cogs: 560, labor: 600, laborHours: 40, orders: 120 });
    expect(s.primeCost).toBe(1160);
    expect(s.profit).toBe(840);
    expect(s.foodPct).toBeCloseTo(0.28);
    expect(s.laborPct).toBeCloseTo(0.3);
    expect(s.salesPerLaborHour).toBe(50);
    expect(s.ordersPerLaborHour).toBe(3);
  });
  it("handles no sales and no hours", () => {
    const s = summarize({ sales: 0, cogs: 0, labor: 100, laborHours: 0, orders: null });
    expect(s.laborPct).toBeNull();
    expect(s.salesPerLaborHour).toBeNull();
    expect(s.profit).toBe(-100);
  });
  it("adds days, keeping orders unknown only if every day is", () => {
    expect(addInputs([{ sales: 1, cogs: 1, labor: 1, laborHours: 1, orders: null }, { sales: 2, cogs: 2, labor: 2, laborHours: 2, orders: 5 }])).toEqual({ sales: 3, cogs: 3, labor: 3, laborHours: 3, orders: 5 });
    expect(addInputs([{ sales: 1, cogs: 1, labor: 1, laborHours: 1, orders: null }]).orders).toBeNull();
  });
});

describe("budget tones", () => {
  it("rates costs and sales against targets", () => {
    expect(costTone(0.28, 0.3)).toBe("good");
    expect(costTone(0.315, 0.3)).toBe("warn");
    expect(costTone(0.35, 0.3)).toBe("bad");
    expect(costTone(0.35, null)).toBe("neutral");
    expect(salesTone(1000, 950)).toBe("good");
    expect(salesTone(900, 950)).toBe("warn");
    expect(salesTone(500, 950)).toBe("bad");
  });
  it("prorates weekly sales budget by weekday weights", () => {
    expect(proratedBudget(7000, ["2026-11-09", "2026-11-10"])).toBe(2000);
    const w = [2, 1, 0, 1, 1, 2, 3]; // closed Tuesdays, total 10
    expect(proratedBudget(10000, ["2026-11-10"], w)).toBe(0);
    expect(proratedBudget(10000, ["2026-11-14", "2026-11-15"], w)).toBe(5000);
  });
});

describe("hourlyShape / splitCents", () => {
  it("peaks at dinner and only covers open hours", () => {
    const w = hourlyShape(16, 21);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(w[15]).toBe(0);
    expect(w[21]).toBe(0);
    expect(w.indexOf(Math.max(...w))).toBe(18);
    const sat = hourlyShape(12, 21);
    expect(sat[13]).toBeGreaterThan(sat[15]);
  });
  it("splits money into cents that add back up", () => {
    const parts = splitCents(100, [1, 1, 1]);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
    expect(splitCents(1234.56, hourlyShape(12, 19)).reduce((a, b) => a + b, 0)).toBeCloseTo(1234.56, 2);
  });
});

describe("toCsv", () => {
  it("quotes only what needs quoting", () => {
    expect(toCsv([["Name", "Hours"], ['Ann "AJ" Lee, Jr', 40], [null, 1.5]])).toBe('Name,Hours\n"Ann ""AJ"" Lee, Jr",40\n,1.5\n');
  });
});

describe("gapTone", () => {
  it("rates actual against theoretical cost", () => {
    expect(gapTone(0.3, 0.295)).toBe("good");
    expect(gapTone(0.32, 0.3)).toBe("warn");
    expect(gapTone(0.34, 0.3)).toBe("bad");
    expect(gapTone(null, 0.3)).toBe("neutral");
  });
});

describe("projectClose", () => {
  const forecast = new Array(24).fill(0);
  forecast[17] = 200;
  forecast[18] = 400;
  forecast[19] = 400;
  it("adds the rest of the forecast to sales so far", () => {
    const actual = new Array(24).fill(0);
    actual[17] = 250;
    const p = projectClose(actual, forecast, 18, 0);
    expect(p.soFar).toBe(250);
    expect(p.forecastSoFar).toBe(200);
    expect(p.pace).toBeCloseTo(1.25);
    expect(p.projected).toBe(250 + 800);
    expect(p.forecastDay).toBe(1000);
  });
  it("counts the current hour as partly gone and doesn't double count a busy hour", () => {
    const actual = new Array(24).fill(0);
    actual[18] = 100;
    // Half way through 6pm: 200 expected so far, 200 left this hour.
    expect(projectClose(actual, forecast, 18, 30).projected).toBe(100 + 200 + 400 + 0);
    actual[18] = 350; // already 150 over this hour's half share
    expect(projectClose(actual, forecast, 18, 30).projected).toBe(350 + 50 + 400);
  });
  it("has no pace before anything was expected", () => {
    expect(projectClose(new Array(24).fill(0), forecast, 9, 0).pace).toBeNull();
  });
});

describe("theoreticalByDay", () => {
  it("costs each day at that day's recipe cost and splits by class", () => {
    const cost = (id: string, date: string) => (id === "burger" ? { cost: date < "2026-11-05" ? 3 : 4, incomplete: false } : id === "pint" ? { cost: 1.2, incomplete: false } : null);
    const cls = (id: string): "beer" | "food" => (id === "pint" ? "beer" : "food");
    const { byDay, uncosted } = theoreticalByDay(
      [
        { date: "2026-11-04", recipeId: "burger", qty: 10, sales: 190 },
        { date: "2026-11-06", recipeId: "burger", qty: 10, sales: 190 },
        { date: "2026-11-06", recipeId: "pint", qty: 20, sales: 160 },
        { date: "2026-11-06", recipeId: "mystery", qty: 1, sales: 9 },
      ],
      cost,
      cls,
    );
    expect(byDay.get("2026-11-04")!.food.cogs).toBe(30);
    expect(byDay.get("2026-11-06")!.food.cogs).toBe(40);
    expect(byDay.get("2026-11-06")!.food.sales).toBe(199);
    expect(byDay.get("2026-11-06")!.beer).toEqual({ sales: 160, cogs: 24 });
    expect([...uncosted]).toEqual(["mystery"]);
  });
});
