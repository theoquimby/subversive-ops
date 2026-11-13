import { describe, expect, it } from "vitest";
import { busiestDays, copyTargets, parseMoney, parsePct, rag, weekStartOf, weekStarts, weekStatus } from "../budgets";

describe("weeks", () => {
  it("snaps to Monday", () => {
    expect(weekStartOf("2026-11-13")).toBe("2026-11-09"); // Fri
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09"); // Mon
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09"); // Sun
  });
  it("lists consecutive weeks", () => {
    expect(weekStarts("2026-11-13", 3)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"]);
  });
});

describe("copyTargets", () => {
  const src = { weekStart: "2026-11-09", sales: 20000, foodCostPct: 0.28, laborPct: 0.3 };
  it("fills empty weeks and keeps what's set", () => {
    const existing = new Map([["2026-11-23", { weekStart: "2026-11-23", sales: 25000, foodCostPct: null, laborPct: null }]]);
    const out = copyTargets(src, ["2026-11-09", "2026-11-16", "2026-11-23"], existing);
    expect(out).toEqual([
      { weekStart: "2026-11-16", sales: 20000, foodCostPct: 0.28, laborPct: 0.3 },
      { weekStart: "2026-11-23", sales: 25000, foodCostPct: 0.28, laborPct: 0.3 },
    ]);
  });
  it("overwrites when asked and skips unchanged weeks", () => {
    const existing = new Map([["2026-11-16", { ...src, weekStart: "2026-11-16" }]]);
    expect(copyTargets(src, ["2026-11-16"], existing, true)).toEqual([]);
    expect(copyTargets(undefined, ["2026-11-16"], existing)).toEqual([]);
  });
});

describe("rag", () => {
  it("rates sales against a pro-rated target", () => {
    expect(rag("sales", 10000, 10000)).toBe("good");
    expect(rag("sales", 10000, 9400)).toBe("warn");
    expect(rag("sales", 10000, 8000)).toBe("bad");
    expect(rag("sales", 10000, 5000, 0.5)).toBe("good");
  });
  it("rates cost % with lower being better", () => {
    expect(rag("foodCostPct", 0.28, 0.27)).toBe("good");
    expect(rag("foodCostPct", 0.28, 0.295)).toBe("warn");
    expect(rag("laborPct", 0.3, 0.35)).toBe("bad");
  });
  it("is 'none' without both numbers", () => {
    expect(rag("sales", null, 100)).toBe("none");
    expect(rag("laborPct", 0.3, null)).toBe("none");
  });
});

describe("weekStatus", () => {
  it("derives percentages and the worst status", () => {
    const s = weekStatus({ weekStart: "2026-11-09", sales: 20000, foodCostPct: 0.28, laborPct: 0.3 }, { sales: 21000, foodCost: 3000, foodSales: 10000, laborCost: 6000 });
    expect(s.actualFoodCostPct).toBeCloseTo(0.3);
    expect(s.actualLaborPct).toBeCloseTo(6000 / 21000);
    expect(s).toMatchObject({ sales: "good", foodCostPct: "warn", laborPct: "good", overall: "warn" });
  });
  it("is 'none' with no targets", () => {
    expect(weekStatus({ weekStart: "x", sales: null, foodCostPct: null, laborPct: null }, { sales: 1, foodCost: null, foodSales: null, laborCost: null }).overall).toBe("none");
  });
});

describe("parsing", () => {
  it("reads percentages", () => {
    expect(parsePct("28")).toBe(0.28);
    expect(parsePct("28.5%")).toBeCloseTo(0.285);
    expect(parsePct("0.3")).toBe(0.3);
    expect(parsePct("")).toBeNull();
    expect(parsePct("abc")).toBe("invalid");
    expect(parsePct("150")).toBe("invalid");
  });
  it("reads money", () => {
    expect(parseMoney("$12,500")).toBe(12500);
    expect(parseMoney("12.5k")).toBe(12500);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("-4")).toBe("invalid");
  });
});

describe("busiestDays", () => {
  it("picks the top days in date order", () => {
    const days = [
      { date: "2026-11-16", qty: 900 },
      { date: "2026-11-20", qty: 2500 },
      { date: "2026-11-21", qty: 3100 },
      { date: "2026-11-17", qty: 0 },
    ];
    expect(busiestDays(days, 2).map((d) => d.date)).toEqual(["2026-11-20", "2026-11-21"]);
  });
});
