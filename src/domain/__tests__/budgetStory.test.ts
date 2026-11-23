import { describe, expect, it } from "vitest";
import { budgetVerdict, weekWord, type WeekForWords } from "../budgetStory";

const wk = (o: Partial<Omit<WeekForWords, "status">> & { status?: Partial<WeekForWords["status"]> }): WeekForWords => ({
  weekStart: "2026-11-02",
  when: "past",
  sales: 10000,
  sales_actual: 10000,
  notIn: 0,
  daysIn: 7,
  ...o,
  status: { sales: "good", laborPct: "good", foodCostPct: "good", overall: "good", ...o.status },
});

describe("weekWord", () => {
  it("finished weeks hit or miss; they're never 'on track'", () => {
    expect(weekWord(wk({}))).toEqual({ word: "Hit", tone: "good" });
    expect(weekWord(wk({ status: { overall: "bad" } }))).toEqual({ word: "Missed", tone: "bad" });
    expect(weekWord(wk({ status: { overall: "warn" } }))).toEqual({ word: "Just missed", tone: "warn" });
  });
  it("a week with days not in can't be judged", () => {
    expect(weekWord(wk({ notIn: 5, status: { overall: "bad" } }))).toEqual({ word: "Not all in", tone: "unknown" });
  });
  it("the week in progress is on track or not, and says nothing on its first day", () => {
    expect(weekWord(wk({ when: "current", daysIn: 3 }))).toEqual({ word: "On track", tone: "good" });
    expect(weekWord(wk({ when: "current", daysIn: 0, status: { overall: "bad" } }))).toEqual({ word: "Just started", tone: "neutral" });
    expect(weekWord(wk({ when: "future", sales: null }))).toEqual({ word: "Not set", tone: "neutral" });
  });
});

describe("budgetVerdict", () => {
  it("counts the last four finished weeks against their sales targets", () => {
    const rows = [
      wk({ weekStart: "2026-10-12", sales_actual: 11000 }),
      wk({ weekStart: "2026-10-19", sales_actual: 9000, status: { sales: "bad", overall: "bad" } }),
      wk({ weekStart: "2026-10-26", sales_actual: 10500 }),
      wk({ weekStart: "2026-11-02", sales_actual: 9500, status: { sales: "warn", overall: "warn", laborPct: "bad" } }),
      wk({ weekStart: "2026-11-09", sales_actual: 2940, notIn: 6, status: { sales: "bad", overall: "bad" } }),
    ];
    const v = budgetVerdict(rows);
    expect(v.title).toBe("Sales hit the target in 2 of the last 4 weeks");
    expect(v.line).toBe("Together $40,000 against $40,000 of targets, right on. Labor ran over its target in 1 of them. One more week isn't all in yet.");
    expect(v.tone).toBe("neutral");
  });
  it("with no targets, says how to start", () => {
    const v = budgetVerdict([wk({ sales: null })]);
    expect(v.title).toBe("No finished week has a sales target yet");
    expect(v.action).not.toBeNull();
  });
});
