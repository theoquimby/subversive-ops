import { describe, expect, it } from "vitest";
import { NY_DEFAULT_RULES as R } from "../labor";
import {
  buildPayrollRows, callInOwed, ExceptionCard, ExceptionShift, openingPeriod, payPeriodFor, payrollCsv, payrollExceptions, payrollTotals, periodWeeks, signedAdjustment, tipsForPeriod,
} from "../payroll";

const at = (day: number, h: number) => new Date(Date.UTC(2026, 10, day, h));
const d = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;

describe("pay periods", () => {
  it("is Monday to Sunday when weekly", () => {
    expect(payPeriodFor("2026-11-13", R)).toEqual({ start: "2026-11-09", end: "2026-11-15" });
  });
  it("counts bi-weekly periods from the anchor, in both directions", () => {
    const rules = { payPeriod: "BIWEEKLY" as const, payPeriodAnchor: "2026-11-02" };
    expect(payPeriodFor("2026-11-13", rules)).toEqual({ start: "2026-11-02", end: "2026-11-15" });
    expect(payPeriodFor("2026-11-16", rules)).toEqual({ start: "2026-11-16", end: "2026-11-29" });
    expect(payPeriodFor("2026-10-25", rules)).toEqual({ start: "2026-10-19", end: "2026-11-01" });
    expect(periodWeeks({ start: "2026-11-02", end: "2026-11-15" })).toEqual(["2026-11-02", "2026-11-09"]);
  });
});

describe("openingPeriod", () => {
  const p = (start: number, extra: { approved?: boolean; cards?: number; shifts?: number } = {}) => ({ start: d(start), end: d(start + 6), approved: false, cards: 0, shifts: 0, ...extra });
  it("opens on the oldest unapproved period with hours, back to the last approved one", () => {
    const recent = [p(23, { shifts: 60 }), p(16, { shifts: 55 }), p(9, { cards: 37 }), p(2, { cards: 39 }), { start: "2026-10-26", end: "2026-11-01", approved: true, cards: 40, shifts: 0 }];
    const r = openingPeriod(recent, d(23));
    expect(r.open).toBe(d(2));
    // Ended periods still waiting after it, oldest first; the week in progress isn't one.
    expect(r.waiting.map((w) => w.start)).toEqual([d(9), d(16)]);
    expect(r.pending.map((w) => w.start)).toEqual([d(2), d(9), d(16)]);
  });
  it("opens on an ended week with shifts but no clock-ins when nothing has hours", () => {
    const r = openingPeriod([p(23, { shifts: 60 }), p(16, { shifts: 55 }), p(9, { approved: true, cards: 30 })], d(23));
    expect(r.open).toBe(d(16));
    expect(r.waiting).toEqual([]);
  });
  it("opens on the current period when everything before it is approved", () => {
    expect(openingPeriod([p(23, { cards: 3 }), p(16, { approved: true, cards: 30 })], d(24)).open).toBe(d(23));
    expect(openingPeriod([p(23)], d(24))).toEqual({ open: d(23), waiting: [], pending: [] });
  });
});

describe("tipsForPeriod", () => {
  it("adds whole pools and prorates partial ones by days", () => {
    const pools = [
      { start: d(9), end: d(15), allocations: [{ employeeId: "a", amount: 70 }, { employeeId: "b", amount: 35 }] },
      { start: d(16), end: d(22), allocations: [{ employeeId: "a", amount: 70 }] },
    ];
    const r = tipsForPeriod(pools, { start: d(9), end: d(18) });
    expect(r.byEmployee.get("a")).toBe(70 + 30);
    expect(r.byEmployee.get("b")).toBe(35);
    expect(r.prorated).toBe(true);
    expect(r.uncovered).toEqual([]);
    expect(tipsForPeriod(pools.slice(0, 1), { start: d(9), end: d(18) }).uncovered).toEqual([d(16), d(17), d(18)]);
  });
});

describe("payrollExceptions", () => {
  const people = new Map([
    ["a", { name: "Ann", squareTeamMemberId: "sq-a" }],
    ["b", { name: "Bo", squareTeamMemberId: null }],
    ["c", { name: "Cy", squareTeamMemberId: "sq-c" }],
  ]);
  const card = (id: string, employeeId: string, day: number, inH: number, outH: number | null, extra: Partial<ExceptionCard> = {}): ExceptionCard => ({
    id, employeeId, date: d(day), clockIn: at(day, inH), clockOut: outH == null ? null : at(day, outH), breakMinutes: 0, rate: 20, tipped: false, ...extra,
  });
  const shift = (id: string, employeeId: string, day: number, s: number, e: number): ExceptionShift => ({ id, employeeId, date: d(day), start: at(day, s), end: at(day, e), breakMinutes: 0, label: `${s}–${e}` });
  const cards = [
    card("1", "a", 9, 16, null), // forgot to clock out
    card("2", "b", 9, 16, 18), // left after 2h of a 6h shift → call-in
    card("3", "c", 10, 10, 23, { rate: null }), // 13h, no break, no rate, unscheduled
  ];
  const shifts = [shift("s1", "a", 9, 16, 22), shift("s2", "b", 9, 16, 22), shift("s3", "c", 11, 16, 22)];
  const ex = payrollExceptions({ cards, shifts, people, lines: [{ employeeId: "a", overtimeHours: 2, spreadHours: 0 }], rules: R, today: d(12), now: at(12, 12), squareInUse: true, tipsUncovered: [d(9)] });
  const kinds = ex.map((e) => `${e.kind}:${e.employeeId ?? "-"}`);

  it("finds every kind of problem", () => {
    expect(kinds).toEqual(expect.arrayContaining([
      "missing-clock-out:a", "missing-rate:c", "call-in:b", "long-punch:c", "meal-break:c", "unscheduled:c", "no-show:c", "missing-square-id:b", "overtime:a", "tips-missing:-",
    ]));
  });
  it("says once that no timecards came in, instead of a no-show per shift", () => {
    const none = payrollExceptions({ cards: [], shifts, people, lines: [], rules: R, today: d(12), now: at(12, 12), squareInUse: true });
    expect(none.map((e) => e.kind)).toEqual(["no-timecards"]);
    expect(none[0].level).toBe("block");
    expect(none[0].message).toContain("3 scheduled shifts");
    // Shifts still to come aren't counted, and with nothing over there is nothing to say.
    expect(payrollExceptions({ cards: [], shifts, people, lines: [], rules: R, today: d(9), now: at(9, 12), squareInUse: true })).toEqual([]);
    // With some cards in, missing ones are real no-shows again.
    expect(kinds).toContain("no-show:c");
    expect(kinds).not.toContain("no-timecards:-");
  });
  it("ranks blocking problems first", () => {
    expect(ex[0].level).toBe("block");
    expect(ex.findIndex((e) => e.level === "info")).toBeGreaterThan(ex.findLastIndex((e) => e.level === "warn"));
    expect(ex.slice(0, 2).map((e) => e.kind)).toEqual(["missing-clock-out", "missing-rate"]);
  });
  it("works out call-in hours owed", () => {
    expect(callInOwed(cards, shifts, R).get("2")).toBe(2); // owed min(4, 6) − 2
    expect(callInOwed(cards, shifts, { ...R, ruleSettings: { "call-in": { on: false } } }).size).toBe(0);
  });
});

describe("payroll rows", () => {
  it("adds call-in, sick, PTO and adjustments to gross; tips separate", () => {
    const rows = buildPayrollRows({
      lines: [{ employeeId: "a", name: "Ann", squareTeamMemberId: "sq", regularHours: 30, overtimeHours: 0, spreadHours: 1, wages: 600 + R.minimumWage, missingRate: false, openCards: 0 }],
      rates: new Map([["a", 20], ["b", 18]]),
      info: new Map([["b", { name: "Bo", squareTeamMemberId: null }]]),
      callInHours: new Map([["a", 1.5]]),
      sickHours: new Map([["b", 8]]),
      ptoHours: new Map(),
      tips: new Map([["a", 120.5]]),
      adjustments: [
        { employeeId: "a", kind: "BONUS", amount: 50, note: "Holiday" },
        { employeeId: "a", kind: "DEDUCTION", amount: -10, note: null },
        { employeeId: "a", kind: "REIMBURSEMENT", amount: 12.5, note: "Ice" },
      ],
      sickBalance: new Map([["a", 3], ["b", 0]]),
      rules: R,
    });
    expect(rows.map((r) => r.name)).toEqual(["Ann", "Bo"]);
    const [a, b] = rows;
    expect(a.callInPay).toBeCloseTo(1.5 * R.minimumWage);
    expect(a.adjustments).toBe(40);
    expect(a.reimbursements).toBe(12.5);
    expect(a.gross).toBeCloseTo(600 + R.minimumWage + 1.5 * R.minimumWage + 40);
    expect(a.tips).toBe(120.5);
    expect(b.sickPay).toBe(144);
    expect(b.gross).toBe(144);
    expect(payrollTotals(rows).tips).toBe(120.5);
    const csv = payrollCsv(rows, { start: d(9), end: d(15), status: "DRAFT" });
    expect(csv.split("\n")[1]).toContain("DRAFT");
    expect(csv).toContain("Bonus $50.00 (Holiday); Deduction -$10.00; Reimbursement $12.50 (Ice)");
  });
  it("signs adjustments by kind", () => {
    expect(signedAdjustment("DEDUCTION", 25)).toBe(-25);
    expect(signedAdjustment("BONUS", -25)).toBe(25);
    expect(signedAdjustment("CORRECTION", -12.5)).toBe(-12.5);
  });
});
