import { describe, expect, it } from "vitest";
import { allocateTips, applyRuleSettings, assignShifts, checkCompliance, curveToBlocks, defaultBreakMinutes, NY_DEFAULT_RULES as R, payForWeek, staffingCurve } from "../labor";

const at = (day: number, h: number) => new Date(Date.UTC(2026, 10, day, h));
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

describe("payForWeek", () => {
  it("pays overtime past 40h and spread-of-hours", () => {
    const blocks = [1, 2, 3, 4, 5].map((d) => ({ employeeId: "a", start: at(d, 10), end: at(d, 19), breakMinutes: 0, rate: 20 })); // 45h
    blocks.push({ employeeId: "a", start: at(6, 9), end: at(6, 21), breakMinutes: 60, rate: 20 }); // 11h, 12h span
    const [p] = payForWeek(blocks, R, dayKey);
    expect(p.regularHours).toBe(40);
    expect(p.overtimeHours).toBe(16);
    expect(p.spreadHours).toBe(1);
    expect(p.wages).toBeCloseTo(40 * 20 + 16 * 30 + R.minimumWage);
  });
});

describe("checkCompliance", () => {
  const emps = [{ id: "a", name: "Ann", isMinor: false, maxHoursWeek: null }, { id: "k", name: "Kid", isMinor: true, maxHoursWeek: 12 }];
  const v = checkCompliance(
    [
      { id: "1", employeeId: "a", start: at(1, 16), end: at(1, 23), breakMinutes: 0 },
      { id: "2", employeeId: "a", start: at(2, 6), end: at(2, 9), breakMinutes: 0 }, // clopen + short
      { id: "3", employeeId: "k", start: at(1, 14), end: at(1, 23), breakMinutes: 0 }, // minor 9h, late
      { id: "4", employeeId: "a", start: at(2, 8), end: at(2, 12), breakMinutes: 0 }, // overlap
    ],
    emps, R, (d) => d.getUTCHours(),
  );
  const rules = v.map((x) => `${x.shiftId}:${x.rule}`);
  it("flags call-in, rest, minors and overlaps", () => {
    expect(rules).toContain("2:call-in");
    expect(rules).toContain("2:rest");
    expect(rules).toContain("3:minor-hours");
    expect(rules).toContain("3:minor-late");
    expect(rules).toContain("4:overlap");
  });
});

describe("scheduling", () => {
  const open = Array.from({ length: 24 }, (_, h) => h >= 16 && h < 21);
  const sales = Array.from({ length: 24 }, (_, h) => (h === 18 || h === 19 ? 900 : h >= 16 && h < 21 ? 300 : 0));
  const rule = { id: "srv", name: "Server", salesPerHour: 400, minStaff: 1, maxStaff: 4 };
  it("turns forecast into a staffing curve", () => {
    expect(staffingCurve(sales, rule, open).slice(16, 21)).toEqual([1, 1, 3, 3, 1]);
    expect(staffingCurve(sales, rule, open, 1.5).slice(16, 21)).toEqual([1, 1, 2, 2, 1]);
  });
  it("layers the curve into shifts of at least the minimum length", () => {
    const blocks = curveToBlocks(staffingCurve(sales, rule, open), 4);
    // Short peak shifts stretch to 4h but never past closing, so they start earlier instead.
    expect(blocks).toEqual([{ startHour: 16, endHour: 21 }, { startHour: 17, endHour: 21 }, { startHour: 17, endHour: 21 }]);
  });
  it("assigns fairly, respecting availability and time off", () => {
    const people = [
      { id: "a", name: "Ann", rate: 18, positionIds: ["srv"], isMinor: false, maxHoursWeek: null },
      { id: "b", name: "Bo", rate: 17, positionIds: ["srv"], isMinor: false, maxHoursWeek: null, availability: { 5: [[17, 23]] as [number, number][] } },
      { id: "c", name: "Cy", rate: 16, positionIds: ["srv"], isMinor: false, maxHoursWeek: null },
    ];
    const blocks = curveToBlocks(staffingCurve(sales, rule, open), 4).map((b) => ({ ...b, positionId: "srv", day: "2026-11-13", weekday: 5 }));
    const out = assignShifts(blocks, people, [{ employeeId: "c", day: "2026-11-13" }]);
    expect(out.map((s) => s.employeeId)).toEqual(["a", "b", null]); // c is off; third slot open
  });
});

describe("allocateTips", () => {
  it("splits by points × hours and keeps every cent", () => {
    const r = allocateTips(100, [{ employeeId: "a", hours: 10, points: 1 }, { employeeId: "b", hours: 10, points: 1 }, { employeeId: "c", hours: 10, points: 0.5 }], "POINTS");
    expect(r.map((x) => x.amount)).toEqual([40, 40, 20]);
    const odd = allocateTips(10, [{ employeeId: "a", hours: 1, points: 1 }, { employeeId: "b", hours: 1, points: 1 }, { employeeId: "c", hours: 1, points: 1 }], "HOURS");
    expect(odd.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(10);
  });
});

describe("meal breaks, minimum wage and rule settings", () => {
  const emps = [{ id: "a", name: "Ann", isMinor: false, maxHoursWeek: null }];
  const shifts = [
    { id: "1", employeeId: "a", start: at(1, 14), end: at(1, 22), breakMinutes: 0, rate: 10.7, tipped: true }, // 8h, no break, tipped wage ok
    { id: "2", employeeId: "a", start: at(3, 14), end: at(3, 22), breakMinutes: 30, rate: 12, tipped: false }, // break ok, under min wage
  ];
  it("flags a missing meal break and pay under the right minimum", () => {
    const v = checkCompliance(shifts, emps, R, (d) => d.getUTCHours()).map((x) => `${x.shiftId}:${x.rule}`);
    expect(v).toContain("1:meal-break");
    expect(v).not.toContain("2:meal-break");
    expect(v).not.toContain("1:min-wage");
    expect(v).toContain("2:min-wage");
  });
  it("honours per-rule on/off and block/warn", () => {
    const rules = { ...R, ruleSettings: { "meal-break": { on: false }, "min-wage": { level: "block" as const } } };
    const v = checkCompliance(shifts, emps, rules, (d) => d.getUTCHours());
    expect(v.some((x) => x.rule === "meal-break")).toBe(false);
    expect(v.find((x) => x.rule === "min-wage")?.level).toBe("block");
    expect(applyRuleSettings([{ rule: "overlap", level: "block" as const }], { ruleSettings: { overlap: { level: "warn" } } })[0].level).toBe("warn");
  });
  it("suggests a default break for long shifts", () => {
    expect(defaultBreakMinutes(6, R)).toBe(0);
    expect(defaultBreakMinutes(7, R)).toBe(30);
    expect(defaultBreakMinutes(7, { ...R, ruleSettings: { "meal-break": { on: false } } })).toBe(0);
  });
  it("costs call-in pay for short planned shifts only when asked", () => {
    const blocks = [{ employeeId: "a", start: at(1, 16), end: at(1, 18), breakMinutes: 0, rate: 20 }];
    expect(payForWeek(blocks, R, dayKey)[0].wages).toBe(40);
    const [p] = payForWeek(blocks, R, dayKey, { callIn: true });
    expect(p.callInHours).toBe(2);
    expect(p.wages).toBe(40 + 2 * R.minimumWage);
  });
});
