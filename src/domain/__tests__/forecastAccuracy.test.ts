import { describe, expect, it } from "vitest";
import { addDays, dateRange, weekday } from "../dates";
import { defaultHourlyShape } from "../forecast";
import { backtest, bias, mape } from "../forecastAccuracy";

const end = "2026-11-10";
const days = dateRange(addDays(end, -84), end);
const openDays = new Set(days.filter((d) => weekday(d) !== 2));

describe("backtest", () => {
  it("is perfect on perfectly regular history", () => {
    const history = new Map(days.map((d) => [d, weekday(d) === 6 ? 2000 : 1000]));
    const rows = backtest({ history, openDays, dates: dateRange(addDays(end, -28), end) });
    expect(rows).toHaveLength(28);
    expect(mape(rows)).toBeCloseTo(0, 5);
    expect(bias(rows)).toBeCloseTo(0, 5);
    expect(rows.filter((r) => !r.open).every((r) => r.error == null)).toBe(true);
  });
  it("only uses history before each day", () => {
    // A one-off spike on the last day can't be seen by its own forecast.
    const last = addDays(end, -1);
    const history = new Map(days.map((d) => [d, d === last ? 3000 : 1000]));
    const [row] = backtest({ history, openDays, dates: [last] });
    expect(row.forecast).toBeCloseTo(1000);
    expect(row.error).toBeCloseTo(-2 / 3);
  });
  it("applies adjustments known in advance", () => {
    const history = new Map(days.map((d) => [d, 1000]));
    const d = addDays(end, -3);
    const [row] = backtest({ history, openDays, dates: [d], adjustments: new Map([[d, 1.5]]) });
    expect(row.forecast).toBeCloseTo(1500);
  });
});

describe("mape", () => {
  it("averages absolute errors and skips closed days", () => {
    expect(mape([{ error: 0.1 }, { error: -0.3 }, { error: null }])).toBeCloseTo(0.2);
    expect(mape([{ error: null }])).toBeNull();
  });
});

describe("defaultHourlyShape", () => {
  it("only fills opening hours and sums to 1", () => {
    const s = defaultHourlyShape(16, 21);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(s[15]).toBe(0);
    expect(s[21]).toBe(0);
    expect(s[19]).toBeGreaterThan(s[16]);
  });
});

describe("backtest excluding event days", () => {
  it("keeps a past event's spike out of later baselines but still scores it", () => {
    const sats = days.filter((d) => weekday(d) === 6);
    const spike = sats.at(-2)!;
    const target = sats.at(-1)!;
    const history = new Map(days.map((d) => [d, d === spike ? 5000 : 1000]));
    const [a, b] = backtest({ history, openDays, dates: [spike, target], excludeFromBaseline: new Set([spike]) }, { trendDampening: 0 });
    expect(a.open).toBe(true);
    expect(a.error).toBeCloseTo(-0.8);
    expect(b.forecast).toBeCloseTo(1000);
  });
});
