import { describe, expect, it } from "vitest";
import { defaultPeriod, pnlVerdict, rangeWords, type PnlVerdictInput } from "../pnlVerdict";

const base: PnlVerdictInput = { sales: 10000, goods: 2800, labor: 2900, fees: 300, profit: 4000, prev: null, laborTarget: 0.3, foodPct: 0.29, foodTarget: 0.3, notIn: 0, lossDays: 0 };

describe("pnlVerdict", () => {
  it("leads with what was kept of every dollar and where the rest went", () => {
    const v = pnlVerdict(base);
    expect(v.title).toBe("You kept 40¢ of every sales dollar");
    expect(v.line).toBe("Food and drink took 28¢, wages 29¢ and card fees 3¢.");
    expect(v.tone).toBe("good");
    expect(v.action).toBeNull();
  });
  it("says how it moved against the period before", () => {
    expect(pnlVerdict({ ...base, prev: { margin: 0.45, label: "the week before" } }).title).toBe("You kept 40¢ of every sales dollar, down from 45¢ the week before");
  });
  it("points at wages when they ran over target", () => {
    const v = pnlVerdict({ ...base, labor: 3600, profit: 3300 });
    expect(v.tone).toBe("warn");
    expect(v.action).toBe("Wages ran 36% of sales against a 30% target: trim the quietest shifts on next week's schedule.");
  });
  it("a loss is bad and starts with the days that lost money", () => {
    const v = pnlVerdict({ ...base, profit: -500, lossDays: 2 });
    expect(v.title).toBe("Costs ran 5% over sales");
    expect(v.tone).toBe("bad");
    expect(v.action).toBe("Start with the 2 days that lost money, under Day by day.");
  });
  it("never calls a period with days not in yet good or bad", () => {
    const v = pnlVerdict({ ...base, notIn: 5, prev: { margin: 0.8, label: "the week before" } });
    expect(v.tone).toBe("unknown");
    expect(v.badge).toBe("5 days not in yet");
    expect(v.title).toBe("So far, you kept 40¢ of every sales dollar");
  });
  it("with no timecards, says wages aren't in rather than counting them as zero", () => {
    const v = pnlVerdict({ ...base, labor: 0, profit: 6900 });
    expect(v.tone).toBe("unknown");
    expect(v.badge).toBe("No timecards");
    expect(v.line).toBe("Food and drink took 28¢ and card fees 3¢. Wages aren't in: there are no timecards for these days, so what's kept reads high.");
  });
});

describe("defaultPeriod", () => {
  it("opens on last week until this week has two finished days", () => {
    expect(defaultPeriod("2026-11-23")).toBe("lastweek"); // Monday
    expect(defaultPeriod("2026-11-24")).toBe("lastweek"); // Tuesday: only Monday is finished
    expect(defaultPeriod("2026-11-25")).toBe("week"); // Wednesday
    expect(defaultPeriod("2026-11-29")).toBe("week"); // Sunday
  });
});

describe("rangeWords", () => {
  it("says a range the way people do", () => {
    expect(rangeWords("2026-11-16", "2026-11-22")).toBe("Nov 16 to 22");
    expect(rangeWords("2026-11-30", "2026-12-06")).toBe("Nov 30 to Dec 6");
    expect(rangeWords("2025-11-24", "2026-11-22")).toBe("Nov 24, 2025 to Nov 22, 2026");
    expect(rangeWords("2026-01-05", "2026-11-22", { year: true })).toBe("Jan 5 to Nov 22, 2026");
    expect(rangeWords("2026-11-16", "2026-11-16")).toBe("Nov 16");
  });
});
