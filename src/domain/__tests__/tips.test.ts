import { describe, expect, it } from "vitest";
import { perHour, splitPool, tipsCsv, tipShares } from "../tips";

const positions = [
  { id: "bar", tipPoints: 1, tipEligible: true },
  { id: "bus", tipPoints: 0.5, tipEligible: true },
  { id: "mgr", tipPoints: 1, tipEligible: false },
];

describe("tipShares", () => {
  it("sums hours per employee and position, skipping ineligible roles", () => {
    const shares = tipShares(
      [
        { employeeId: "a", positionId: "bar", hours: 5 },
        { employeeId: "a", positionId: "bar", hours: 3.333 },
        { employeeId: "a", positionId: "bus", hours: 2 },
        { employeeId: "m", positionId: "mgr", hours: 8 },
        { employeeId: "b", positionId: null, hours: 4 },
      ],
      positions,
      (id) => (id === "b" ? "bus" : null),
    );
    expect(shares).toEqual([
      { employeeId: "a", positionId: "bar", hours: 8.33, points: 1 },
      { employeeId: "a", positionId: "bus", hours: 2, points: 0.5 },
      { employeeId: "b", positionId: "bus", hours: 4, points: 0.5 },
    ]);
  });
});

describe("splitPool", () => {
  it("rolls up to one line per employee and keeps every cent", () => {
    const shares = [
      { employeeId: "a", hours: 10, points: 1 },
      { employeeId: "a", hours: 2, points: 0.5 },
      { employeeId: "b", hours: 10, points: 0.5 },
    ];
    const r = splitPool(100.01, shares, "POINTS");
    expect(r).toHaveLength(2);
    expect(r.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(100.01);
    expect(r[0].weightedPoints).toBe(11);
    expect(r[0].amount).toBeGreaterThan(r[1].amount);
    const h = splitPool(90, shares, "HOURS");
    expect(h.find((x) => x.employeeId === "a")!.amount).toBeCloseTo(49.09, 2);
    expect(perHour({ amount: 50, hours: 0 })).toBe(0);
  });
});

describe("tipsCsv", () => {
  it("quotes names and adds a total row", () => {
    const csv = tipsCsv([{ name: 'Sam "Jr", Bar', hours: 5, points: 5, amount: 40 }], { start: "2026-11-02", end: "2026-11-08", method: "POINTS", total: 40 });
    expect(csv.split("\n")[1]).toBe('"Sam ""Jr"", Bar",5.00,5.00,40.00,2026-11-02,2026-11-08');
    expect(csv).toContain("Total,5.00,,40.00");
  });
});
