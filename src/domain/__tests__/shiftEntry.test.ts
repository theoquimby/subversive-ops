import { describe, expect, it } from "vitest";
import { lastShiftDefaults, parseShiftTime, planWeekCopy } from "../shiftEntry";

describe("parseShiftTime", () => {
  it("reads typed starts", () => {
    expect(parseShiftTime("4p")).toBe(16 * 60);
    expect(parseShiftTime("4:30pm")).toBe(16 * 60 + 30);
    expect(parseShiftTime("16:30")).toBe(16 * 60 + 30);
    expect(parseShiftTime("11a")).toBe(11 * 60);
    expect(parseShiftTime("")).toBeNull();
    expect(parseShiftTime("soon")).toBeNull();
  });

  it("reads open and close from the day's hours", () => {
    expect(parseShiftTime("close", { closeMin: 23 * 60 })).toBe(23 * 60);
    expect(parseShiftTime("Close", { closeMin: 25 * 60 })).toBe(25 * 60);
    expect(parseShiftTime("open", { openMin: 12 * 60 })).toBe(12 * 60);
    expect(parseShiftTime("close")).toBeNull();
  });

  it("runs an end past midnight when it would end before the start", () => {
    expect(parseShiftTime("1a", { after: 18 * 60 })).toBe(25 * 60);
    expect(parseShiftTime("12a", { after: 18 * 60 })).toBe(24 * 60);
    expect(parseShiftTime("midnight", { after: 18 * 60 })).toBe(24 * 60);
  });

  it("reads a bare evening end as pm", () => {
    expect(parseShiftTime("10", { after: 16 * 60 })).toBe(22 * 60);
    expect(parseShiftTime("10:30", { after: 16 * 60 })).toBe(22 * 60 + 30);
    expect(parseShiftTime("10p", { after: 16 * 60 })).toBe(22 * 60);
  });

  it("leaves an end that can't follow the start as typed", () => {
    // 10am after a 4pm start would be an 18-hour shift.
    expect(parseShiftTime("10a", { after: 16 * 60 })).toBe(10 * 60);
  });
});

describe("planWeekCopy", () => {
  const src = [
    { id: "a", employeeId: "e1", positionId: "bar", date: "2026-11-09", startMin: 960 },
    { id: "b", employeeId: "e1", positionId: "bar", date: "2026-11-10", startMin: 960 },
    { id: "c", employeeId: null, positionId: "bar", date: "2026-11-11", startMin: 1020 },
    { id: "d", employeeId: null, positionId: "bar", date: "2026-11-11", startMin: 1020 },
  ];

  it("moves every shift by the gap between weeks", () => {
    const r = planWeekCopy(src, [], 7);
    expect(r.create.map((s) => s.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-18"]);
    expect(r.skipped).toBe(0);
  });

  it("skips shifts that are already in the target week", () => {
    const existing = [{ employeeId: "e1", positionId: "bar", date: "2026-11-16", startMin: 960 }];
    const r = planWeekCopy(src, existing, 7);
    expect(r.create.map((s) => s.id)).toEqual(["b", "c", "d"]);
    expect(r.skipped).toBe(1);
  });

  it("can't double a week when run twice", () => {
    const first = planWeekCopy(src, [], 7).create;
    const second = planWeekCopy(src, first, 7);
    expect(second.create).toEqual([]);
    expect(second.skipped).toBe(4);
  });

  it("matches identical open shifts one for one", () => {
    const existing = [{ employeeId: null, positionId: "bar", date: "2026-11-18", startMin: 1020 }];
    const r = planWeekCopy(src, existing, 7);
    expect(r.create.map((s) => s.id)).toEqual(["a", "b", "d"]);
  });

  it("copies from further back", () => {
    expect(planWeekCopy(src.slice(0, 1), [], 14).create[0].date).toBe("2026-11-23");
  });
});

describe("lastShiftDefaults", () => {
  it("takes the latest shift per person", () => {
    const shifts = [
      { employeeId: "e1", positionId: "bar", date: "2026-11-01", startMin: 900, endMin: 1200, breakMinutes: 0 },
      { employeeId: "e1", positionId: "floor", date: "2026-11-05", startMin: 960, endMin: 1320, breakMinutes: 30 },
      { employeeId: null, positionId: "bar", date: "2026-11-06", startMin: 960, endMin: 1320, breakMinutes: 0 },
      { employeeId: "e2", positionId: "kitchen", date: "2026-11-02", startMin: 660, endMin: 1020, breakMinutes: 30 },
    ];
    expect(lastShiftDefaults(shifts)).toEqual({
      e1: { positionId: "floor", startMin: 960, endMin: 1320, breakMinutes: 30 },
      e2: { positionId: "kitchen", startMin: 660, endMin: 1020, breakMinutes: 30 },
    });
  });
});
