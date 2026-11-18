import { describe, expect, it } from "vitest";
import type { GroupScore, Score, ScoreDay, ScoreSummary } from "../forecastScore";
import { forecastStory } from "../forecastStory";

const sc = (over: Partial<Score> = {}): Score => ({ days: 400, wape: 0.12, medianApe: 0.1, bias: 0, within15: 0.7, ...over });
const sum = (f1: Score | null, over: Partial<ScoreSummary> = {}): ScoreSummary => ({ from: "2024-01-01", to: "2026-11-16", f1, f7: f1, f14: f1, naive: sc({ wape: 0.2 }), skill: 0.2, ...over });
const g = (key: string, days: number, wape: number, lift: number | null = 0): GroupScore => ({ key, score: sc({ days, wape }), lift });
const day = (date: string, weekday: number, actual: number): ScoreDay => ({ date, weekday, actual, event: false, weather: "fair", f1: actual, f7: actual, f14: actual, naive: actual });
// 100 recent days at $2,000, a Monday every seventh at $400.
const days: ScoreDay[] = Array.from({ length: 100 }, (_, n) => day(`2026-08-${String((n % 28) + 1).padStart(2, "0")}`, n % 7, n % 7 === 1 ? 400 : 2000));
const base = { byWeekday: [] as GroupScore[], byMonth: [] as GroupScore[], byWeather: [] as GroupScore[], byEvent: [] as GroupScore[], days };

describe("forecastStory", () => {
  it("has nothing to say before any day is scored", () => {
    expect(forecastStory({ ...base, all: sum(null), recent: sum(null) })).toBeNull();
  });

  it("says plainly how far to trust it, in dollars, from the last 90 days", () => {
    const good = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80, wape: 0.1 }), { from: "2026-08-01" }) })!;
    expect(good.level).toBe("trust");
    expect(good.basis).toBe("recent");
    expect(good.headline).toMatch(/plan on the forecast/);
    // Average day (2000 × 6 + 400) ÷ 7 ≈ $1,771; 10% of that, rounded to the nearest $25.
    expect(good.missDollars).toBe(175);
    expect(good.line).toContain("$175");

    const rough = forecastStory({ ...base, all: sum(sc({ wape: 0.33 })), recent: sum(sc({ days: 77, wape: 0.41, within15: 0.27 }), { from: "2026-08-01" }) })!;
    expect(rough.level).toBe("rough");
    expect(rough.closeInTen).toBe(3);
    expect(rough.headline).toMatch(/starting point/);
    expect(rough.line).toContain("3 days in 10");
    expect(rough.line).toMatch(/rougher than usual: over all your history it's 33%/);
    expect(good.line).not.toMatch(/than usual/);
  });

  it("falls back to all history when there are too few recent days", () => {
    const s = forecastStory({ ...base, all: sum(sc({ wape: 0.2 })), recent: sum(sc({ days: 5, wape: 0.9 })) })!;
    expect(s.basis).toBe("all");
    expect(s.level).toBe("guide");
  });

  it("turns bad-weather days into one instruction, sized by the worst of them", () => {
    const s = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), byWeather: [g("fair", 1300, 0.3, 0.02), g("rain", 178, 0.45, -0.1), g("heavyRain", 104, 0.47, -0.22), g("snow", 53, 0.55, -0.24), g("cold", 122, 0.39, -0.08), g("hot", 160, 0.29, 0)] })!;
    const w = s.points.find((p) => p.key === "weather")!;
    expect(w.detail).toContain("heavy rain 22% under");
    expect(w.detail).toContain("snow 24% under");
    expect(w.action).toMatch(/snow.*24% less/);
    expect(s.points.some((p) => p.key === "hot")).toBe(false);
    expect(s.next).toMatch(/rain, snow and cold/);
  });

  it("ignores weather groups with too few days or too small an effect", () => {
    const s = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), byWeather: [g("snow", 5, 0.8, -0.5), g("rain", 200, 0.12, -0.03)] })!;
    expect(s.points.some((p) => p.key === "weather")).toBe(false);
  });

  it("names the weekdays it can't call and how small they are", () => {
    const s = forecastStory({ ...base, all: sum(sc({ wape: 0.33 })), recent: sum(sc({ days: 80, wape: 0.33 })), byWeekday: [g("1", 154, 0.77), g("2", 55, 0.72), g("5", 401, 0.31), g("6", 402, 0.27)] })!;
    const p = s.points.find((x) => x.key === "weekdays")!;
    expect(p.title).toBe("Mondays and Tuesdays are close to a guess");
    expect(p.action).toMatch(/go by what you know is booked/);
  });

  it("flags event days only when they're clearly worse than ordinary days", () => {
    const worse = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), byEvent: [g("normal", 1000, 0.1), g("event", 40, 0.35)] })!;
    expect(worse.points.find((p) => p.key === "events")!.link).toEqual({ href: "/events", label: "Events" });
    const same = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), byEvent: [g("normal", 1000, 0.1), g("event", 40, 0.11)] })!;
    expect(same.points.some((p) => p.key === "events")).toBe(false);
  });

  it("says when planning two weeks ahead costs nothing, or when it does", () => {
    const flat = forecastStory({ ...base, all: sum(sc({ wape: 0.33 }), { f14: sc({ wape: 0.34 }) }), recent: sum(sc({ days: 80, wape: 0.33 })) })!;
    expect(flat.points.find((p) => p.key === "ahead")).toMatchObject({ tone: "neutral", title: "It's no worse two weeks out than the night before" });
    const solid = forecastStory({ ...base, all: sum(sc({ wape: 0.1 }), { f14: sc({ wape: 0.105 }) }), recent: sum(sc({ days: 80, wape: 0.1 })) })!;
    expect(solid.points.find((p) => p.key === "ahead")!.tone).toBe("good");
    const worse = forecastStory({ ...base, all: sum(sc({ wape: 0.12 }), { f14: sc({ wape: 0.2 }) }), recent: sum(sc({ days: 80 })) })!;
    expect(worse.points.find((p) => p.key === "ahead")!.action).toMatch(/firm them up a week out/);
  });

  it("mentions a steady lean and keeps to five points", () => {
    const s = forecastStory({
      ...base,
      all: sum(sc({ wape: 0.33 }), { f14: sc({ wape: 0.34 }) }),
      recent: sum(sc({ days: 80, wape: 0.33, bias: 0.09 })),
      byWeather: [g("snow", 53, 0.55, -0.24), g("hot", 160, 0.3, 0.12)],
      byWeekday: [g("1", 154, 0.77)],
      byEvent: [g("normal", 1000, 0.3), g("event", 40, 0.6)],
      byMonth: [g("12", 200, 0.4, -0.15)],
    })!;
    expect(s.points).toHaveLength(5);
    expect(s.points.find((p) => p.key === "lean")!.title).toBe("Lately it runs 9% high");
  });

  it("mentions a month that runs off the forecast only when it's this month or next", () => {
    const args = { ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), byMonth: [g("12", 200, 0.4, -0.15), g("6", 200, 0.4, 0.3)] };
    expect(forecastStory({ ...args, today: "2026-11-18" })!.points.find((p) => p.key === "season")!.title).toBe("December runs 15% under the forecast");
    expect(forecastStory({ ...args, today: "2026-12-30" })!.points.find((p) => p.key === "season")!.title).toMatch(/^December/);
    expect(forecastStory({ ...args, today: "2026-08-05" })!.points.some((p) => p.key === "season")).toBe(false);
  });

  it("gives the yardstick for the same stretch as the verdict", () => {
    const s = forecastStory({ ...base, all: sum(sc(), { skill: 0.14 }), recent: sum(sc({ days: 80 }), { skill: -0.09 }) })!;
    expect(s.skill).toBe(-0.09);
    expect(s.points[0]).toMatchObject({ key: "yardstick", title: "Lately the same day last week has been the better guide" });
    const fine = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })) })!;
    expect(fine.points.some((p) => p.key === "yardstick")).toBe(false);
  });
});
