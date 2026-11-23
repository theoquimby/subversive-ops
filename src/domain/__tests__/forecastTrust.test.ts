import { describe, expect, it } from "vitest";
import type { Score, ScoreDay } from "../forecastScore";
import { forecastTrust, toStoredAccuracy, trustLevel, weeklyScores } from "../forecastTrust";

const sc = (over: Partial<Score> = {}): Score => ({ days: 400, wape: 0.12, medianApe: 0.1, bias: 0, within15: 0.7, ...over });

describe("forecastTrust", () => {
  it("has nothing to say before any day is scored", () => {
    expect(forecastTrust({ recent: null, all: null, avgDay: { recent: 0, all: 0 } })).toBeNull();
  });

  it("goes by the last 90 days and says when that's rougher than usual", () => {
    // The live case behind the fix: an 88%-accuracy tile on Sales against "off by 21%" on the scorecard.
    const t = forecastTrust({ recent: sc({ days: 70, wape: 0.21, within15: 0.6 }), all: sc({ wape: 0.1 }), avgDay: { recent: 2400, all: 2000 } })!;
    expect(t.basis).toBe("recent");
    expect(t.level).toBe("guide");
    expect(t.tone).toBe("warn");
    expect(t.label).toBe("Use with a cushion");
    expect(t.missShare).toBe(0.21);
    expect(t.missDollars).toBe(500);
    expect(t.trend).toBe("worse");
    expect(t.line).toMatch(/off by about \$500 \(21%\).*rougher than usual: over all your history it's 10%/);
    expect(t.short).toBe("A typical day is off by about $500 (21%), rougher than usual.");
  });

  it("falls back to all history with too few recent days, and then says nothing about a trend", () => {
    const t = forecastTrust({ recent: sc({ days: 12, wape: 0.6 }), all: sc({ wape: 0.12 }), avgDay: { recent: 900, all: 2000 } })!;
    expect(t.basis).toBe("all");
    expect(t.level).toBe("trust");
    expect(t.tone).toBe("good");
    expect(t.trend).toBeNull();
    expect(t.when).toBe("Over your history");
  });

  it("puts the levels at 15% and 30%", () => {
    expect(trustLevel(0.15)).toBe("trust");
    expect(trustLevel(0.16)).toBe("guide");
    expect(trustLevel(0.3)).toBe("guide");
    expect(trustLevel(0.31)).toBe("rough");
  });
});

const day = (date: string, actual: number, f1: number | null): ScoreDay => ({ date, weekday: 0, actual, event: false, weather: null, f1, f7: null, f14: null, naive: null });

describe("toStoredAccuracy", () => {
  it("keeps the same scores the scorecard reads, and the last five weeks of days", () => {
    const days = Array.from({ length: 60 }, (_, n) => day(`2026-09-${String((n % 30) + 1).padStart(2, "0")}`.replace("2026-09", n < 30 ? "2026-09" : "2026-10"), 1000, n < 50 ? 1100 : 900));
    const s = toStoredAccuracy(days, "2026-10-01", "2026-11-01");
    expect(s.all!.days).toBe(60);
    expect(s.recent!.days).toBe(30);
    expect(s.recent!.wape).toBeCloseTo(((20 * 100) + (10 * 100)) / 30000);
    expect(s.avgDay).toEqual({ recent: 1000, all: 1000 });
    expect(s.days[0].date).toBe("2026-09-26");
    expect(s.days.at(-1)!.date).toBe("2026-10-30");
  });

  it("leaves out days with no forecast", () => {
    const s = toStoredAccuracy([day("2026-10-01", 1000, null), day("2026-10-02", 1000, 1000)], "2026-09-01", "2026-10-03");
    expect(s.all!.days).toBe(1);
  });
});

describe("weeklyScores", () => {
  it("scores each week the same way, newest last", () => {
    const days = Array.from({ length: 14 }, (_, n) => ({ date: `2026-11-${String(n + 1).padStart(2, "0")}`, forecast: n < 7 ? 1000 : 1500, actual: 1000 }));
    const w = weeklyScores(days, 4);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ from: "2026-11-01", miss: 0, level: "trust" });
    expect(w[1]).toMatchObject({ from: "2026-11-08", forecast: 10500, actual: 7000, level: "rough" });
    expect(w[1].miss).toBeCloseTo(0.5);
  });
});
