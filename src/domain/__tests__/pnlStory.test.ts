import { describe, expect, it } from "vitest";
import { emptySplit } from "../revenueClass";
import { bridge, comparisonRanges, DAYS_PER_MONTH, fixedForDays, pointsChange, shiftMonths, storyNotes, TYPICAL_COST_SHARE, unlinkedSales, weeklyTrend } from "../pnlStory";

describe("unlinkedSales", () => {
  it("is store sales that no linked recipe accounts for", () => {
    const s = emptySplit();
    s.food.sales = 600;
    s.beer.sales = 100;
    s.retail.sales = 50;
    expect(unlinkedSales(s, 1000)).toBe(250);
    expect(unlinkedSales(s, 700)).toBe(0); // never negative
  });
});

describe("bridge", () => {
  it("adds a typical-cost estimate for unlinked sales and adds up", () => {
    const b = bridge({ sales: 10_000, cogs: 1_500, labor: 3_000, unlinkedSales: 5_000 });
    expect(b.cogsEstimate).toBe(5_000 * TYPICAL_COST_SHARE);
    expect(b.estimated).toBe(true);
    expect(b.profit).toBe(10_000 - 1_500 - 1_500 - 3_000);
    expect(b.sales - b.cogs - b.cogsEstimate - b.labor).toBe(b.profit);
    expect(b.margin).toBeCloseTo(0.4);
    expect(b.coverage).toBeCloseTo(0.5);
    expect(b.cogsPct).toBeCloseTo(0.3);
    expect(b.laborPct).toBeCloseTo(0.3);
    expect(b.primePct).toBeCloseTo(0.6);
    expect(b.fixed).toBeNull();
    expect(b.afterFixed).toBeNull();
  });
  it("subtracts fixed costs when set and caps the estimate at sales", () => {
    const b = bridge({ sales: 1_000, cogs: 0, labor: 200, unlinkedSales: 5_000 }, 300);
    expect(b.cogsEstimate).toBe(300);
    expect(b.coverage).toBe(0);
    expect(b.afterFixed).toBe(1_000 - 300 - 200 - 300);
    expect(b.afterFixedMargin).toBeCloseTo(0.2);
  });
  it("fully linked: no estimate; no sales: no ratios", () => {
    expect(bridge({ sales: 500, cogs: 150, labor: 100, unlinkedSales: 0 }).estimated).toBe(false);
    const z = bridge({ sales: 0, cogs: 0, labor: 120, unlinkedSales: 0 }, 0);
    expect(z.profit).toBe(-120);
    expect(z.margin).toBeNull();
    expect(z.coverage).toBeNull();
    expect(z.fixed).toBeNull();
  });
});

describe("fixedForDays", () => {
  it("spreads a monthly figure over calendar days", () => {
    expect(fixedForDays(DAYS_PER_MONTH * 100, 7)).toBeCloseTo(700);
    expect(fixedForDays(7160, 0)).toBe(0);
    expect(fixedForDays(0, 7)).toBe(0);
  });
});

describe("shiftMonths", () => {
  it("keeps the day of month and clamps to short months", () => {
    expect(shiftMonths("2026-11-13", -1)).toBe("2026-10-13");
    expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftMonths("2024-03-31", -1)).toBe("2024-02-29");
    expect(shiftMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(shiftMonths("2026-11-01", -12)).toBe("2025-11-01");
  });
});

describe("comparisonRanges", () => {
  const counted = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]; // Mon–Thu
  it("lines weeks up on the same weekdays", () => {
    const r = comparisonRanges("week", counted);
    expect(r.prev).toEqual({ from: "2026-11-02", toExclusive: "2026-11-06", label: "the same days last week" });
    expect(r.year).toEqual({ from: "2025-11-10", toExclusive: "2025-11-14", label: "the same days last year" });
    expect(comparisonRanges("lastweek", ["2026-11-02", "2026-11-08"]).prev?.label).toBe("the week before");
  });
  it("lines a whole week up as last week", () => {
    const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
    expect(comparisonRanges("week", week).prev).toEqual({ from: "2026-10-26", toExclusive: "2026-11-02", label: "last week" });
  });
  it("months use the same dates", () => {
    const r = comparisonRanges("month", ["2026-11-01", "2026-11-12"]);
    expect(r.prev).toEqual({ from: "2026-10-01", toExclusive: "2026-10-13", label: "the same dates last month" });
    expect(r.year).toEqual({ from: "2025-11-01", toExclusive: "2025-11-13", label: "the same dates last year" });
  });
  it("custom ranges compare with the days just before, or the same weekdays when under a week", () => {
    const days = Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    const r = comparisonRanges("custom", days);
    expect(r.prev).toEqual({ from: "2026-10-22", toExclusive: "2026-11-01", label: "the 10 days before" });
    expect(r.year?.from).toBe("2025-11-02");
    expect(comparisonRanges("custom", ["2026-11-07"]).prev).toEqual({ from: "2026-10-31", toExclusive: "2026-11-01", label: "the same day last week" });
  });
  it("today and empty periods get no comparison", () => {
    expect(comparisonRanges("today", ["2026-11-13"])).toEqual({ prev: null, year: null });
    expect(comparisonRanges("week", [])).toEqual({ prev: null, year: null });
  });
});

describe("weeklyTrend", () => {
  it("rolls days into Monday weeks with the same bridge", () => {
    const days = [
      { date: "2026-11-01", sales: 1000, cogs: 100, labor: 300, unlinkedSales: 500 }, // Sun → week of Oct 26
      { date: "2026-11-02", sales: 500, cogs: 150, labor: 200, unlinkedSales: 0 },
      { date: "2026-11-03", sales: 700, cogs: 210, labor: 250, unlinkedSales: 100 },
    ];
    const w = weeklyTrend(days);
    expect(w.map((x) => x.weekStart)).toEqual(["2026-10-26", "2026-11-02"]);
    expect(w[0]).toMatchObject({ days: 1, sales: 1000, cogs: 100, cogsEstimate: 150, labor: 300, profit: 450 });
    expect(w[1]).toMatchObject({ days: 2, sales: 1200, cogs: 360, labor: 450 });
    expect(w[1].cogsEstimate).toBeCloseTo(30);
    expect(w[1].profit).toBeCloseTo(1200 - 360 - 30 - 450);
  });
});

describe("storyNotes", () => {
  const fig = (o: Partial<Parameters<typeof storyNotes>[0]["cur"]> = {}) => ({ sales: 10_000, cogs: 2_000, labor: 3_000, laborHours: 150, unlinkedSales: 0, foodSales: 6_000, foodCogs: 1_800, ...o });

  it("explains a labor jump from the sales and labor changes", () => {
    const notes = storyNotes({ cur: fig({ sales: 8_000, labor: 3_000 }), prev: { ...fig(), label: "last week" }, year: null, days: [], forecast: null });
    const labor = notes.find((n) => n.kind === "labor");
    expect(labor).toMatchObject({ tone: "warn", label: "last week", prevPct: 0.3 });
    if (labor?.kind !== "labor") throw new Error();
    expect(labor.pct).toBeCloseTo(0.375);
    expect(labor.salesChange).toBeCloseTo(-0.2);
    expect(labor.laborChange).toBeCloseTo(0);
    expect(labor.hoursChange).toBeCloseTo(0);
  });

  it("stays quiet when ratios barely move", () => {
    const notes = storyNotes({ cur: fig({ labor: 3_100, foodCogs: 1_850 }), prev: { ...fig(), label: "last week" }, year: null, days: [], forecast: { actual: 10_000, forecast: 10_500 } });
    expect(notes.map((n) => n.kind)).toEqual(["sales"]);
  });

  it("compares sales with both periods and flags food cost and forecast misses", () => {
    const notes = storyNotes({
      cur: fig({ foodCogs: 2_100 }),
      prev: { ...fig({ sales: 8_000 }), label: "last week" },
      year: { ...fig({ sales: 12_500 }), label: "the same week last year" },
      days: [],
      forecast: { actual: 10_000, forecast: 12_500 },
    });
    const sales = notes[0];
    if (sales.kind !== "sales") throw new Error();
    expect(sales.prev?.change).toBeCloseTo(0.25);
    expect(sales.year?.change).toBeCloseTo(-0.2);
    expect(notes.find((n) => n.kind === "food")).toMatchObject({ tone: "warn", pct: 0.35, prevPct: 0.3 });
    expect(notes.find((n) => n.kind === "forecast")).toMatchObject({ change: expect.closeTo(-0.2) });
  });

  it("finds the best day and days that lost money", () => {
    const days = [
      { date: "2026-11-09", sales: 362, cogs: 0, labor: 368, unlinkedSales: 300 },
      { date: "2026-11-10", sales: 0, cogs: 0, labor: 40, unlinkedSales: 0 }, // closed: not a "loss day"
      { date: "2026-11-11", sales: 1403, cogs: 200, labor: 449, unlinkedSales: 700 },
      { date: "2026-11-12", sales: 991, cogs: 150, labor: 441, unlinkedSales: 500 },
    ];
    const notes = storyNotes({ cur: fig({ sales: 2756 }), prev: null, year: null, days, forecast: null });
    expect(notes.find((n) => n.kind === "bestDay")).toMatchObject({ date: "2026-11-11", sales: 1403 });
    const loss = notes.find((n) => n.kind === "lossDays");
    if (loss?.kind !== "lossDays") throw new Error();
    expect(loss.days.map((d) => d.date)).toEqual(["2026-11-09"]);
    expect(loss.days[0].loss).toBeCloseTo(368 + 90 - 362);
  });

  it("ignores rounding-sized losses", () => {
    const days = [
      { date: "2026-11-05", sales: 397, cogs: 80, labor: 284, unlinkedSales: 112 }, // −$0.6
      { date: "2026-11-06", sales: 2709, cogs: 500, labor: 705, unlinkedSales: 1000 },
      { date: "2026-11-07", sales: 6298, cogs: 1000, labor: 1170, unlinkedSales: 3000 },
    ];
    expect(storyNotes({ cur: fig({ sales: 9404 }), prev: null, year: null, days, forecast: null }).some((n) => n.kind === "lossDays")).toBe(false);
  });

  it("says nothing without sales", () => {
    expect(storyNotes({ cur: fig({ sales: 0 }), prev: null, year: null, days: [], forecast: null })).toEqual([]);
  });
});

describe("pointsChange", () => {
  it("is the difference in ratio points", () => {
    expect(pointsChange(0.33, 0.3)).toBeCloseTo(0.03);
    expect(pointsChange(null, 0.3)).toBeNull();
  });
});
