import { describe, expect, it } from "vitest";
import { addDays, dateRange, weekday } from "../dates";
import { groupScore, score, scoreDays, skill, summarize } from "../forecastScore";

const end = "2026-11-10";
const days = dateRange(addDays(end, -140), end);
const openDays = new Set(days.filter((d) => weekday(d) !== 2)); // closed Tuesdays
const regular = new Map(days.map((d) => [d, weekday(d) === 6 ? 2000 : 1000]));
const none = new Set<string>();

describe("score", () => {
  it("measures the typical miss against sales, the lean, and how often it lands close", () => {
    const s = score([
      { forecast: 110, actual: 100 },
      { forecast: 90, actual: 100 },
      { forecast: 140, actual: 100 },
      { forecast: 100, actual: 100 },
    ])!;
    expect(s.days).toBe(4);
    expect(s.wape).toBeCloseTo(0.15); // 60 off on 400 sold
    expect(s.bias).toBeCloseTo(0.1); // 440 forecast on 400 sold
    expect(s.within15).toBeCloseTo(0.75);
    expect(s.medianApe).toBeCloseTo(0.1);
  });
  it("is null with nothing to score", () => {
    expect(score([])).toBeNull();
    expect(score([{ forecast: 5, actual: 0 }])).toBeNull();
  });
});

describe("scoreDays", () => {
  it("replays each open day at one, seven and fourteen days ahead, with last week's same day beside it", () => {
    const rows = scoreDays({ history: regular, openDays, eventDays: none, weather: new Map(), dates: dateRange(addDays(end, -28), end) });
    expect(rows).toHaveLength(24); // 28 days less four closed Tuesdays
    for (const r of rows) {
      expect(r.f1).toBeCloseTo(r.actual, 5);
      expect(r.f7).toBeCloseTo(r.actual, 5);
      expect(r.f14).toBeCloseTo(r.actual, 5);
      expect(r.naive).toBeCloseTo(r.actual, 5);
    }
  });

  it("can't see the day itself, or anything after the day the forecast was made", () => {
    const spike = addDays(end, -3);
    const history = new Map(regular);
    history.set(spike, 5000);
    history.set(addDays(spike, -7), 3000); // last week's same day was unusual too
    const [row] = scoreDays({ history, openDays, eventDays: none, weather: new Map(), dates: [spike] });
    expect(row.actual).toBe(5000);
    expect(row.naive).toBe(3000);
    // Made 14 days ahead, the forecast knew nothing of last week's 3000.
    expect(row.f14).toBeCloseTo(regular.get(spike)!, 5);
    expect(row.f1!).toBeGreaterThan(row.f14!);
    expect(row.f1!).toBeLessThan(3000);
  });

  it("leaves out days with too little history behind them", () => {
    const rows = scoreDays({ history: regular, openDays, eventDays: none, weather: new Map(), dates: [days[3], days[10]] });
    expect(rows).toHaveLength(0);
  });

  it("flags event days, keeps them out of baselines, and applies what was known in advance", () => {
    const fest = addDays(end, -10);
    const history = new Map(regular);
    history.set(fest, regular.get(fest)! * 2);
    const after = addDays(fest, 7);
    const rows = scoreDays({ history, openDays, eventDays: new Set([fest]), adjustments: new Map([[fest, 2]]), weather: new Map(), dates: [fest, after] });
    expect(rows[0]).toMatchObject({ date: fest, event: true });
    expect(rows[0].f1).toBeCloseTo(history.get(fest)!, 5);
    // The week after isn't thrown off by the festival: its baseline skips that day (the trend may move a hair).
    expect(Math.abs(rows[1].f1! / history.get(after)! - 1)).toBeLessThan(0.03);
    expect(rows[1].naive).toBeCloseTo(history.get(after)!, 5);
  });

  it("names each day's weather", () => {
    const d = addDays(end, -2);
    const [row] = scoreDays({ history: regular, openDays, eventDays: none, weather: new Map([[d, { precipMm: 20, precipDayMm: 18, tempMaxC: 12, snowCm: 0 }]]), dates: [d] });
    expect(row.weather).toBe("heavyRain");
  });
});

describe("grouping and summary", () => {
  // Rainy days sell 20% less than the replay expects.
  const wet = new Set(dateRange(addDays(end, -28), end).filter((_, i) => i % 5 === 0));
  const history = new Map([...regular].map(([d, v]) => [d, wet.has(d) ? v * 0.8 : v]));
  const weather = new Map(dateRange(addDays(end, -28), end).map((d) => [d, { precipMm: wet.has(d) ? 9 : 0, precipDayMm: wet.has(d) ? 9 : 0, tempMaxC: 14, snowCm: 0 }]));
  const rows = scoreDays({ history, openDays, eventDays: none, weather, dates: dateRange(addDays(end, -28), end) });

  it("shows which weather the forecast misses, as sales over or under what was forecast", () => {
    const byWeather = groupScore(rows, "f1", (r) => r.weather);
    const rain = byWeather.find((g) => g.key === "rain")!;
    const fair = byWeather.find((g) => g.key === "fair")!;
    expect(rain.lift).toBeLessThan(-0.1);
    expect(Math.abs(fair.lift!)).toBeLessThan(Math.abs(rain.lift!));
    expect(rain.score!.days + fair.score!.days).toBe(rows.length);
  });

  it("sums up every model and how much closer Ops is than last week's same day", () => {
    const s = summarize(rows);
    expect(s.f1!.days).toBe(rows.length);
    expect(s.from).toBe(rows[0].date);
    expect(s.to).toBe(rows[rows.length - 1].date);
    expect(s.skill).not.toBeNull();
  });

  it("skill is the share of the naive miss that's gone", () => {
    expect(skill({ wape: 0.12 }, { wape: 0.2 })).toBeCloseTo(0.4);
    expect(skill({ wape: 0.25 }, { wape: 0.2 })).toBeCloseTo(-0.25);
    expect(skill(null, { wape: 0.2 })).toBeNull();
  });
});
