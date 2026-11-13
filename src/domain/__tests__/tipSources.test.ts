import { describe, expect, it } from "vitest";
import { cardTipRows, cashTipRows, manualCount, mergeTipInputs, planTips, poolWarnings, setOverride, squareTipsFor, TipInputs, UNLINKED } from "../tipSources";

const dateOf = (iso: string) => iso.slice(0, 10);
const days = ["2026-11-02", "2026-11-03"];

describe("cardTipRows", () => {
  const payments = [
    { id: "p1", createdAt: "2026-11-02T20:00:00Z", status: "COMPLETED", tipCents: 500, teamMemberId: "tmA" },
    { id: "p2", createdAt: "2026-11-02T21:00:00Z", status: "COMPLETED", tipCents: 250, teamMemberId: "tmA" },
    { id: "p3", createdAt: "2026-11-02T22:00:00Z", status: "COMPLETED", tipCents: 300, teamMemberId: null },
    { id: "p4", createdAt: "2026-11-03T22:00:00Z", status: "APPROVED", tipCents: 999, teamMemberId: "tmB" },
    { id: "p5", createdAt: "2026-11-03T23:00:00Z", status: "COMPLETED", tipCents: 0, teamMemberId: "tmB" },
    { id: "p6", createdAt: "2026-11-05T23:00:00Z", status: "COMPLETED", tipCents: 700, teamMemberId: "tmB" },
  ];

  it("sums tips per day and team member, keeps unlinked tips apart and marks every synced day", () => {
    expect(cardTipRows(payments, days, dateOf)).toEqual([
      { date: "2026-11-02", kind: "CARD", teamMemberId: UNLINKED, amount: 3, count: 1 },
      { date: "2026-11-02", kind: "CARD", teamMemberId: "tmA", amount: 7.5, count: 2 },
      { date: "2026-11-03", kind: "CARD", teamMemberId: UNLINKED, amount: 0, count: 0 },
    ]);
  });

  it("is idempotent: a repeated payment (overlapping pages) and a re-sync give the same rows", () => {
    const once = cardTipRows(payments, days, dateOf);
    expect(cardTipRows([...payments, payments[0]], days, dateOf)).toEqual(once);
    expect(cardTipRows(payments, days, dateOf)).toEqual(once);
  });
});

describe("cashTipRows", () => {
  it("uses the day the timecard started and skips cards without a declaration", () => {
    const rows = cashTipRows(
      [
        { timecardId: "t1", startAt: "2026-11-03T16:00:00Z", teamMemberId: "tmA", cashCents: 4000 },
        { timecardId: "t2", startAt: "2026-11-03T17:00:00Z", teamMemberId: "tmA", cashCents: 1250 },
        { timecardId: "t3", startAt: "2026-11-03T17:00:00Z", teamMemberId: "tmB", cashCents: 0 },
      ],
      days,
      dateOf,
    );
    expect(rows.filter((r) => r.amount)).toEqual([{ date: "2026-11-03", kind: "CASH", teamMemberId: "tmA", amount: 52.5, count: 2 }]);
    expect(rows.filter((r) => r.teamMemberId === UNLINKED)).toHaveLength(2);
  });
});

describe("squareTipsFor", () => {
  const employeeOf = (tm: string) => ({ tmA: "a", tmB: "b" })[tm] ?? null;
  const rows = [
    { date: "2026-11-02", kind: "CARD", teamMemberId: "", amount: 3 },
    { date: "2026-11-02", kind: "CARD", teamMemberId: "tmA", amount: 7.5 },
    { date: "2026-11-02", kind: "CARD", teamMemberId: "tmGone", amount: 2 },
    { date: "2026-11-02", kind: "CASH", teamMemberId: "", amount: 0 },
    { date: "2026-11-02", kind: "CASH", teamMemberId: "tmB", amount: 20 },
    { date: "2026-10-01", kind: "CARD", teamMemberId: "tmA", amount: 99 },
  ];

  it("maps team members to employees and pools the rest", () => {
    const s = squareTipsFor(rows, new Map(), days, employeeOf);
    expect(Object.fromEntries(s.card)).toEqual({ a: 7.5 });
    expect(Object.fromEntries(s.cash)).toEqual({ b: 20 });
    expect(s.pooledCard).toBe(5);
    expect(s.cardDays).toBe(1);
    expect(s.cashDays).toBe(1);
  });

  it("falls back to the daily card-tip total for days synced before per-person tips", () => {
    const s = squareTipsFor(rows, new Map([["2026-11-02", 50], ["2026-11-03", 40]]), days, employeeOf);
    expect(s.pooledCard).toBe(45); // 5 unlinked on the 2nd + the 3rd's daily total; the 2nd's daily total is not double counted
    expect(s.fallbackDays).toBe(1);
  });
});

describe("mergeTipInputs / setOverride", () => {
  const square = { card: new Map([["a", 100]]), cash: new Map([["b", 40]]), pooledCard: 10, pooledCash: 0 };

  it("fills from Square and lists everyone in the pool", () => {
    const m = mergeTipInputs(square, null, ["a", "c"]);
    expect(m.lines.map((l) => [l.employeeId, l.card.value, l.cash.value, l.card.manual])).toEqual([
      ["a", 100, 0, false],
      ["c", 0, 0, false],
      ["b", 0, 40, false],
    ]);
    expect(m.pooledCard).toEqual({ value: 10, square: 10, manual: false });
  });

  it("keeps manual values when Square changes on a re-sync", () => {
    let o = setOverride(null, { kind: "CASH", employeeId: "a" }, 25);
    o = setOverride(o, { kind: "CARD", employeeId: null }, 0);
    const resynced = { card: new Map([["a", 130]]), cash: new Map([["a", 60], ["b", 40]]), pooledCard: 12, pooledCash: 0 };
    const m = mergeTipInputs(resynced, o, []);
    const a = m.lines.find((l) => l.employeeId === "a")!;
    expect(a.cash).toEqual({ value: 25, square: 60, manual: true });
    expect(a.card).toEqual({ value: 130, square: 130, manual: false });
    expect(m.pooledCard).toEqual({ value: 0, square: 12, manual: true });
    expect(manualCount(o)).toBe(2);
  });

  it("clearing a manual value goes back to Square's", () => {
    const o = setOverride(setOverride(null, { kind: "CARD", employeeId: "a" }, 1), { kind: "CARD", employeeId: "a" }, null);
    expect(o.card).toEqual({});
    expect(mergeTipInputs(square, o, []).lines[0].card).toEqual({ value: 100, square: 100, manual: false });
  });
});

describe("planTips", () => {
  const inputs: TipInputs = {
    lines: [
      { employeeId: "a", card: { value: 100, square: 100, manual: false }, cash: { value: 20, square: 20, manual: false } },
      { employeeId: "b", card: { value: 50, square: 50, manual: false }, cash: { value: 0, square: 0, manual: false } },
      { employeeId: "owner", card: { value: 30, square: 30, manual: false }, cash: { value: 0, square: 0, manual: false } },
    ],
    pooledCard: { value: 20, square: 20, manual: false },
    pooledCash: { value: 10, square: 10, manual: false },
  };
  const shares = [
    { employeeId: "a", hours: 10, points: 1 },
    { employeeId: "b", hours: 30, points: 1 },
  ];

  it("pools everything by hours, card and cash apart, and every cent lands", () => {
    const p = planTips(inputs, shares, "HOURS", "POOL", "POOL");
    expect(p.cardTotal).toBe(200);
    expect(p.cashTotal).toBe(30);
    expect(p.people.find((x) => x.employeeId === "a")).toMatchObject({ hours: 10, card: 50, cash: 7.5, amount: 57.5 });
    expect(p.people.find((x) => x.employeeId === "b")).toMatchObject({ hours: 30, card: 150, cash: 22.5, amount: 172.5 });
    expect(p.people.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(p.total);
    expect(p.movedToPool).toEqual([{ employeeId: "owner", card: 30, cash: 0 }]);
    expect(p.unshared).toBe(0);
  });

  it("KEEP lets people in the pool keep their own; tips of people outside the pool are pooled", () => {
    const p = planTips(inputs, shares, "HOURS", "KEEP", "KEEP");
    // card pool = 20 unlinked + 30 owner; cash pool = 10 unlinked
    expect(p.cardPool).toBe(50);
    expect(p.cashPool).toBe(10);
    expect(p.people.find((x) => x.employeeId === "a")).toMatchObject({ card: 112.5, cash: 22.5 });
    expect(p.people.find((x) => x.employeeId === "b")).toMatchObject({ card: 87.5, cash: 7.5 });
    expect(p.people.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(230);
  });

  it("splits odd cents exactly and reports tips nobody can receive", () => {
    const p = planTips({ ...inputs, lines: [], pooledCard: { value: 100.01, square: 100.01, manual: false } }, [...shares, { employeeId: "c", hours: 20, points: 1 }], "HOURS", "POOL", "POOL");
    expect(p.people.reduce((s, x) => s + x.card, 0)).toBeCloseTo(100.01);
    expect(planTips(inputs, [], "HOURS", "POOL", "POOL").unshared).toBe(230);
  });

  it("never splits a negative pool (refund days)", () => {
    const p = planTips({ lines: [], pooledCard: { value: -80, square: -80, manual: false }, pooledCash: { value: 0, square: 0, manual: false } }, shares, "HOURS", "POOL", "POOL");
    expect(p.people.every((x) => x.amount === 0)).toBe(true);
  });
});

describe("poolWarnings", () => {
  it("flags managerial and back-of-house roles by name", () => {
    expect(poolWarnings(["Bartender", "Owner", "Line Cook", "Administrator", "Server", "Dishwasher", "Owner"])).toEqual([
      { kind: "managerial", positions: ["Administrator", "Owner"] },
      { kind: "no-guest-service", positions: ["Dishwasher", "Line Cook"] },
    ]);
    expect(poolWarnings(["Bartender", "Server", "Raw Bar Barista"])).toEqual([]);
  });
});
