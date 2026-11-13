import { describe, expect, it } from "vitest";
import { forecastBeer, monthProfile, planBeer, runOutFinding, seasonalIndex, weekOf, weekOfYear, weeklyTotals } from "../beerDemand";
import { addDays, dateRange, type ISODate } from "../dates";
import { kegOz } from "../kegs";

/** Daily oz with a summer bump (Jun–Aug ×1.5), closed Mondays. */
function history(from: ISODate, to: ISODate, perDay: number, summer = 1.5) {
  const m = new Map<ISODate, number>();
  for (const d of dateRange(from, to)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 1) continue;
    const month = Number(d.slice(5, 7));
    m.set(d, perDay * (month >= 6 && month <= 8 ? summer : 1));
  }
  return m;
}

describe("weeks", () => {
  it("starts weeks on Monday", () => {
    expect(weekOf("2026-11-13")).toBe("2026-11-09");
    expect(weekOf("2026-11-09")).toBe("2026-11-09");
    expect(weekOf("2026-11-15")).toBe("2026-11-09");
  });
  it("numbers weeks of the year", () => {
    expect(weekOfYear("2026-01-05")).toBe(1);
    expect(weekOfYear("2026-12-28")).toBe(52);
  });
  it("totals by week", () => {
    const w = weeklyTotals(new Map([["2026-11-09", 10], ["2026-11-15", 5], ["2026-11-16", 1]]));
    expect(w.get("2026-11-09")).toBe(15);
    expect(w.get("2026-11-16")).toBe(1);
  });
});

describe("season", () => {
  it("needs about a year", () => {
    expect(seasonalIndex(history("2026-06-01", "2026-11-01", 100))).toBeNull();
  });
  it("finds the summer bump", () => {
    const idx = seasonalIndex(history("2023-01-02", "2026-11-09", 100))!;
    expect(idx).toHaveLength(52);
    const july = idx[weekOfYear("2025-07-14") - 1], nov = idx[weekOfYear("2025-11-10") - 1];
    expect(july / nov).toBeGreaterThan(1.3);
    expect(july / nov).toBeLessThan(1.7);
  });
});

describe("forecast per beer", () => {
  it("follows the recent pace with a range", () => {
    const daily = history("2026-08-31", "2026-11-13", 160, 1); // 160 oz = 10 pints, 6 days a week
    const f = forecastBeer(daily, "2026-11-13", null, 4);
    expect(f.weeks).toHaveLength(4);
    expect(f.weeks[0].week).toBe("2026-11-09");
    expect(f.weeks[0].mid).toBeCloseTo(60, 0);
    expect(f.weeks[0].low).toBeLessThan(f.weeks[0].mid);
    expect(f.weeks[0].high).toBeGreaterThan(f.weeks[0].mid);
    expect(f.basisWeeks).toBe(4);
  });
  it("scales into a slower season", () => {
    const all = history("2023-01-02", "2026-11-13", 160);
    const season = seasonalIndex(all);
    const aug = forecastBeer(all, "2026-08-05", season, 4);
    // Forecasting from August: the early-September weeks drop back toward 1×.
    const sep = forecastBeer(all, "2026-09-02", season, 4);
    expect(aug.seasonal).toBe(true);
    expect(sep.weeks[3].mid).toBeLessThan(aug.weeks[0].mid);
  });
  it("is zero for a beer that isn't pouring", () => {
    const f = forecastBeer(new Map(), "2026-11-13", null);
    expect(f.weeks[0].mid).toBe(0);
  });
});

describe("on hand vs needed", () => {
  const f = forecastBeer(history("2026-08-31", "2026-11-13", 160, 1), "2026-11-13", null, 4);
  const half = kegOz("half");
  it("says when it runs out and what to fill", () => {
    const p = planBeer("Golden Lager", f, { fullKegOz: [], onTapOz: 600 }, half, 0.9, "2026-11-13");
    expect(p.runOutDays).toBeGreaterThan(3);
    expect(p.runOutDays).toBeLessThan(6);
    expect(p.toFill).toBeGreaterThanOrEqual(1);
    expect(p.tone).toBe("bad");
    expect(p.sentence).toMatch(/^Golden Lager: about \d+–\d+ pints a week\. 0 full kegs in cold storage; runs out in ~\d days\. Fill \d kegs? to cover the next two weeks\.$/);
  });
  it("is covered with kegs in the walk-in", () => {
    const p = planBeer("Golden Lager", f, { fullKegOz: [half, half], onTapOz: 900 }, half, 0.9, "2026-11-13");
    expect(p.toFill).toBe(0);
    expect(p.tone).toBe("good");
    expect(p.onHandKegs).toBeGreaterThan(2);
  });
  it("makes an insight only when nothing full is behind it", () => {
    const p = planBeer("Golden Lager", f, { fullKegOz: [], onTapOz: 600 }, half, 0.9, "2026-11-13");
    const o = runOutFinding({ beerId: "b1", name: "Golden Lager", plan: p, forecast: f, fullKegs: 0, dollarsPerOz: 0.45 })!;
    expect(o.title).toMatch(/^Golden Lager runs out in ~\d days?; 0 full kegs in the walk-in$/);
    expect(o.kind).toBe("kegs.runout");
    expect(o.oneOff).toBeGreaterThan(0);
    expect(o.monthly).toBe(0);
    expect(runOutFinding({ beerId: "b1", name: "Golden Lager", plan: p, forecast: f, fullKegs: 1, dollarsPerOz: 0.45 })).toBeNull();
  });
});

describe("month profile", () => {
  it("averages pints per month", () => {
    const prof = monthProfile(history("2025-01-01", "2027-01-01", 16, 2));
    expect(prof[6]! / prof[10]!).toBeCloseTo(2 * (31 / 30), 0);
    expect(monthProfile(new Map([[addDays("2026-03-01", 0), 32]]))[2]).toBe(2);
  });
});
