import { describe, expect, it } from "vitest";
import { addDays, dateRange, weekday } from "../dates";
import { computeTrend, forecastSeries } from "../forecast";

// 10 weeks of history ending 2026-11-09 (Mon), closed Tuesdays.
const asOf = "2026-11-10";
const days = dateRange(addDays(asOf, -70), asOf);
const openDays = new Set(days.filter((d) => weekday(d) !== 2));

describe("forecastSeries", () => {
  it("uses the same weekday and ignores closed days", () => {
    const history = new Map(days.map((d) => [d, weekday(d) === 6 ? 40 : 10]));
    const [sat, tue] = forecastSeries({ history, openDays, asOf, dates: ["2026-11-14", "2026-11-17"] });
    expect(sat.qty).toBeCloseTo(40);
    expect(tue.samples).toBe(0);
    expect(tue.qty).toBe(0);
  });
  it("weights recent weeks more heavily", () => {
    // Saturdays: 20 for older weeks, 60 for the most recent one.
    const sats = days.filter((d) => weekday(d) === 6);
    const history = new Map(sats.map((d, i) => [d, i === sats.length - 1 ? 60 : 20]));
    const [sat] = forecastSeries({ history, openDays, asOf, dates: ["2026-11-14"] }, { trendDampening: 0 });
    expect(sat.qty).toBeGreaterThan(25);
    expect(sat.qty).toBeLessThan(60);
  });
  it("applies manual adjustments", () => {
    const history = new Map(days.map((d) => [d, 10]));
    const [d] = forecastSeries({ history, openDays, asOf, dates: ["2026-11-14"], adjustments: new Map([["2026-11-14", 1.5]]) });
    expect(d.qty).toBeCloseTo(15);
  });
});

describe("computeTrend", () => {
  it("is clamped and dampened", () => {
    const history = new Map(days.map((d) => [d, d >= addDays(asOf, -28) ? 30 : 10]));
    expect(computeTrend(history, openDays, asOf)).toBe(1.25);
    const flat = new Map(days.map((d) => [d, 10]));
    expect(computeTrend(flat, openDays, asOf)).toBe(1);
  });
});

import { businessDate, zonedMidnightUTC } from "../dates";
describe("timezone helpers", () => {
  it("finds local midnight across DST", () => {
    expect(zonedMidnightUTC("2026-07-01", "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(zonedMidnightUTC("2026-12-01", "America/New_York").toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });
  it("maps a late-night sale to the local business date", () => {
    expect(businessDate("2026-11-14T03:30:00Z", "America/New_York")).toBe("2026-11-13");
  });
});

import { hourlyShares, learnRainFactor } from "../forecast";
describe("hourlyShares", () => {
  it("averages each weekday's hourly shape", () => {
    const rows = ["2026-11-07", "2026-10-31"].flatMap((d) => [{ date: d, hour: 12, netSales: 100 }, { date: d, hour: 18, netSales: 300 }]);
    const s = hourlyShares(rows, 6, "2026-11-10");
    expect(s[12]).toBeCloseTo(0.25);
    expect(s[18]).toBeCloseTo(0.75);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});
describe("learnRainFactor", () => {
  it("learns that rainy days are slower", () => {
    const days = dateRange("2026-08-01", "2026-11-01");
    const wet = new Set(days.filter((_, i) => i % 6 === 0));
    const sales = new Map(days.map((d) => [d, wet.has(d) ? 700 : 1000]));
    const weather = new Map(days.map((d) => [d, { date: d, precipMm: wet.has(d) ? 12 : 0, tempMaxC: 20 }]));
    const { factor } = learnRainFactor(sales, weather, new Set(days));
    expect(factor).toBeGreaterThan(0.65);
    expect(factor).toBeLessThan(0.8);
  });
});
