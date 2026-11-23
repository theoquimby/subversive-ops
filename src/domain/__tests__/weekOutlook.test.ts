import { describe, expect, it } from "vitest";
import { tintStep, usualByWeekday, weekOutlook, type OutlookDay } from "../weekOutlook";

// Mon Nov 23 2026 to Sun Nov 29: Thanksgiving week.
const week = (over: Record<number, Partial<OutlookDay>> = {}): OutlookDay[] =>
  Array.from({ length: 7 }, (_, n) => ({ date: `2026-11-${23 + n}`, forecast: 2000, usual: 2000, closed: false, why: null, ...over[n] }));

describe("weekOutlook", () => {
  it("calls a usual week usual and names the big day", () => {
    const o = weekOutlook(week({ 5: { forecast: 4000, usual: 4000 } }));
    expect(o.direction).toBe("usual");
    expect(o.headline).toBe("The coming week looks like a usual one");
    expect(o.line).toBe("About $16,000 forecast over the next 7 days, against $16,000 in a usual week.");
    expect(o.action).toBe("Order and staff as usual; Saturday is the big day at about $4,000.");
  });

  it("says why a week is quieter: a closed holiday, a holiday weekend", () => {
    const o = weekOutlook(week({ 3: { forecast: 0, closed: true, why: "Thanksgiving" }, 5: { forecast: 1500, why: "Thanksgiving weekend" } }));
    expect(o.direction).toBe("quieter");
    expect(o.change).toBeCloseTo(-2500 / 14000);
    expect(o.headline).toBe("The coming week looks 18% quieter than usual");
    expect(o.line).toContain("Closed Thursday for Thanksgiving and Thanksgiving weekend takes about 25% off Saturday.");
    expect(o.action).toMatch(/^Trim orders and hours to match/);
  });

  it("says why a week is busier, and what to do", () => {
    const o = weekOutlook(week({ 2: { forecast: 5000, why: "Thanksgiving Eve" } }));
    expect(o.direction).toBe("busier");
    expect(o.line).toContain("Thanksgiving Eve lifts Wednesday by about 150%.");
    expect(o.action).toBe("Order and staff up for it: Wednesday is the big day at about $5,000.");
    expect(o.busiest?.date).toBe("2026-11-25");
  });

  it("doesn't compare with a usual week it doesn't have", () => {
    const o = weekOutlook(week(Object.fromEntries(Array.from({ length: 7 }, (_, n) => [n, { usual: 0 }]))));
    expect(o.change).toBeNull();
    expect(o.direction).toBeNull();
    expect(o.line).not.toContain("usual week");
  });
});

describe("tintStep", () => {
  it("shades against a usual day of the weekday, lightest the quietest", () => {
    expect(tintStep(700, 1000)).toBe(0);
    expect(tintStep(900, 1000)).toBe(1);
    expect(tintStep(1000, 1000)).toBe(2);
    expect(tintStep(1200, 1000)).toBe(3);
    expect(tintStep(2000, 1000)).toBe(4);
  });

  it("doesn't shade what it can't compare: no usual day, closed, or missing", () => {
    expect(tintStep(1000, 0)).toBeNull();
    expect(tintStep(0, 1000)).toBeNull();
    expect(tintStep(null, 1000)).toBeNull();
  });
});

describe("usualByWeekday", () => {
  it("takes the first usual day it finds for each weekday", () => {
    const m = usualByWeekday([{ date: "2026-11-23", usual: 0 }, { date: "2026-11-24", usual: 900 }, { date: "2026-11-30", usual: 1100 }]);
    expect(m.get(2)).toBe(900);
    expect(m.get(1)).toBe(1100);
  });
});
