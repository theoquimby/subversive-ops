import { describe, expect, it } from "vitest";
import { NY_DEFAULT_RULES as R } from "../labor";
import { leaveHours, leaveHoursIn, sickAccrued, sickBalance } from "../sickLeave";

describe("NY paid sick leave", () => {
  it("accrues 1h per 30h worked, capped per year", () => {
    expect(sickAccrued(29, R)).toBe(0.96);
    expect(sickAccrued(300, R)).toBe(10);
    expect(sickAccrued(2000, R)).toBe(40);
    expect(sickAccrued(2000, { ...R, sickAnnualCapHours: 56 })).toBe(56);
  });
  it("subtracts approved sick time and never goes negative", () => {
    expect(sickBalance(300, 4, R)).toEqual({ workedHours: 300, accrued: 10, used: 4, available: 6 });
    expect(sickBalance(60, 8, R).available).toBe(0);
    // Use is capped too: 40h accrued, 38 used → only 2 left even if more accrues.
    expect(sickBalance(3000, 38, R).available).toBe(2);
  });
  it("uses scheduled hours when a request doesn't say", () => {
    const sched = new Map([["2026-11-13", 6], ["2026-11-14", 7.5]]);
    expect(leaveHours({ startDate: "2026-11-13", endDate: "2026-11-15", hours: null }, (d) => sched.get(d) ?? 0)).toBe(13.5);
    expect(leaveHours({ startDate: "2026-11-13", endDate: "2026-11-13", hours: 4 }, () => 8)).toBe(4);
  });
  it("prorates a request across pay periods", () => {
    const r = { startDate: "2026-11-14", endDate: "2026-11-17", hours: 24 };
    expect(leaveHoursIn(r, "2026-11-09", "2026-11-15")).toBe(12);
    expect(leaveHoursIn(r, "2026-11-16", "2026-11-22")).toBe(12);
    expect(leaveHoursIn(r, "2026-11-23", "2026-11-29")).toBe(0);
  });
});
