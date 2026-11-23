import { describe, expect, it } from "vitest";
import { addInputs, countsToward, rollupKpis, costTone, gapTone, hourlyShape, mondayOf, oneOffHours, paceStartHour, periodRange, projectClose, proratedBudget, salesTone, splitCents, summarize, theoreticalByDay, toCsv } from "../pnl";

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
    expect(gapTone(0.29, 0.3)).toBe("good");
    expect(gapTone(0.3, 0.3)).toBe("good");
    // Over the recipes is never green, even within a point (the Margin gap showed a green 15.4% beside a red $115).
    expect(gapTone(0.3, 0.295)).toBe("neutral");
    expect(gapTone(0.25, 0.3)).toBe("warn");
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
  it("waits for a meaningful share of the day before comparing (no 714329% on a morning sale)", () => {
    // Monday: closed until 4:30pm, a few cents of forecast in the morning.
    const f = new Array(24).fill(0);
    f[11] = 0.45;
    f[16] = 100;
    f[17] = 300;
    f[18] = 444;
    const actual = new Array(24).fill(0);
    actual[11] = 3195;
    const p = projectClose(actual, f, 12, 0);
    expect(p.forecastSoFar).toBeCloseTo(0.45);
    expect(p.pace).toBeNull();
    // From 5pm the forecast has expected 100.45 of 844.45: past 10% and $50, so pace compares.
    expect(projectClose(actual, f, 17, 0).pace).not.toBeNull();
  });
  it("says from which hour pace can compare", () => {
    const f = new Array(24).fill(0);
    f[16] = 100;
    f[17] = 300;
    f[18] = 444;
    expect(paceStartHour(f)).toBe(17);
    expect(paceStartHour(new Array(24).fill(0))).toBeNull();
  });
});

describe("oneOffHours", () => {
  it("flags an hour that is one big order, like a deposit, against a small day's forecast", () => {
    const sales = new Array(24).fill(0);
    const orders = new Array(24).fill(0);
    sales[11] = 3195;
    orders[11] = 1;
    sales[17] = 400;
    orders[17] = 20;
    expect(oneOffHours(sales, orders, 844)).toEqual([{ hour: 11, amount: 3195, orders: 1 }]);
  });
  it("leaves a busy hour of ordinary checks alone", () => {
    const sales = new Array(24).fill(0);
    const orders = new Array(24).fill(0);
    sales[18] = 1500;
    orders[18] = 40;
    expect(oneOffHours(sales, orders, 3000)).toEqual([]);
  });
  it("leaves a large tab on a big day alone", () => {
    const sales = new Array(24).fill(0);
    const orders = new Array(24).fill(0);
    sales[20] = 600;
    orders[20] = 1;
    expect(oneOffHours(sales, orders, 6000)).toEqual([]);
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
    expect(byDay.get("2026-11-06")!.beer).toMatchObject({ sales: 160, cogs: 24 });
    expect([...uncosted]).toEqual(["mystery"]);
    // The uncostable item's sales are tracked so food cost can say it's incomplete.
    expect(byDay.get("2026-11-06")!.food.uncostedSales).toBe(9);
    expect(byDay.get("2026-11-04")!.food.uncostedSales).toBe(0);
  });
});

describe("rollupKpis", () => {
  const today = "2026-11-13";
  const split = (foodSales: number, foodCogs: number, bevSales = 0, bevCogs = 0) => ({
    food: { sales: foodSales, cogs: foodCogs },
    beer: { sales: bevSales, cogs: bevCogs },
    otherBev: { sales: 0, cogs: 0 },
    retail: { sales: 0, cogs: 0 },
  });
  const days = [
    { date: "2026-11-11", sales: 1000, cogs: 300, labor: 250, laborHours: 10, orders: null, split: split(600, 180, 400, 120), salesSynced: true },
    { date: "2026-11-12", sales: 1000, cogs: 300, labor: 350, laborHours: 14, orders: null, split: split(600, 180, 400, 120), salesSynced: true },
    { date: today, sales: 0, cogs: 0, labor: 353, laborHours: 12, orders: null, split: split(0, 0), salesSynced: false },
  ];
  it("leaves today out unless asked, so a half-finished day doesn't skew the week", () => {
    expect(countsToward("2026-11-12", today, false)).toBe(true);
    expect(countsToward(today, today, false)).toBe(false);
    expect(countsToward(today, today, true)).toBe(true);
    expect(countsToward("2026-11-14", today, true)).toBe(false);
    const week = rollupKpis(days, today, false);
    expect(week.counted).toEqual(["2026-11-11", "2026-11-12"]);
    expect(week.partial).toBe(false);
    expect(week.laborPct).toBeCloseTo(0.3);
    const withToday = rollupKpis(days, today, true);
    expect(withToday.partial).toBe(true);
    expect(withToday.total.labor).toBeCloseTo(953);
  });
  it("defines food cost as % of food sales, separate from all-COGS %", () => {
    const k = rollupKpis(days, today, false);
    expect(k.foodPct).toBeCloseTo(0.3);
    expect(k.beveragePct).toBeCloseTo(0.3);
    expect(k.cogsPct).toBeCloseTo(0.3);
    expect(k.primePct).toBeCloseTo(0.6);
  });
});
