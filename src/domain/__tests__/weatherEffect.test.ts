import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { EFFECT_FAR_TRUST, effectFactor, learnWeatherEffects, parseStored, toStored, weatherFactor, type EffectDay } from "../weatherEffect";
import type { WeatherKind } from "../weatherHistory";

const t = (days: number, ratio: number) => ({ days, forecast: days * 1000, actual: days * 1000 * ratio });

describe("effectFactor", () => {
  it("is how sales ran on those days against fair days, pulled toward no effect when days are few", () => {
    // 15 days at 20% under: halfway there.
    expect(effectFactor(t(15, 0.8), t(200, 1))).toBeCloseTo(0.9);
    // 285 days: nearly all the way.
    expect(effectFactor(t(285, 0.8), t(200, 1))).toBeCloseTo(0.81);
  });
  it("measures against fair days, so a forecast that runs low everywhere isn't read as weather", () => {
    expect(effectFactor(t(285, 1.05), t(200, 1.05))).toBeCloseTo(1);
  });
  it("gives no effect with too few days of the kind or too few fair days", () => {
    expect(effectFactor(t(9, 0.5), t(200, 1))).toBe(1);
    expect(effectFactor(t(100, 0.5), t(29, 1))).toBe(1);
  });
  it("never moves a day by more than the clamp", () => {
    expect(effectFactor(t(1000, 0.2), t(200, 1))).toBe(0.5);
    expect(effectFactor(t(1000, 2), t(200, 1))).toBe(1.25);
  });
});

/** A year and a bit of days: forecast $1,000, a wobble, and every `every`th day the given weather at `ratio` of forecast. */
function history(kind: WeatherKind, every: number, ratio: number, n = 400): EffectDay[] {
  return Array.from({ length: n }, (_, i) => {
    const special = i % every === every - 1;
    const wobble = 1 + ((i * 7) % 11 - 5) / 100; // ±5%, the same for every kind
    return { date: addDays("2025-01-01", i), f1: 1000, weather: special ? kind : "fair", actual: 1000 * wobble * (special ? ratio : 1) };
  });
}

describe("learnWeatherEffects", () => {
  it("learns a snow effect, replays each day from the days before it, and switches it on when that's closer", () => {
    const { effects, withWeather } = learnWeatherEffects(history("snow", 5, 0.75));
    const snow = effects.kinds.find((k) => k.kind === "snow")!;
    expect(snow.days).toBe(80);
    expect(snow.factor).toBeGreaterThan(0.76);
    expect(snow.factor).toBeLessThan(0.82);
    expect(snow.used).toBe(true);
    expect(snow.missWith!).toBeLessThan(snow.missWithout! * 0.5);
    expect(effects.missWith!).toBeLessThan(effects.missWithout!);
    // The first snow days had nothing behind them, so they weren't adjusted.
    expect(snow.scored).toBeLessThan(snow.days);
    expect(withWeather.has(addDays("2025-01-01", 4))).toBe(false);
    expect(withWeather.get(addDays("2025-01-01", 399))!).toBeLessThan(850);
  });

  it("leaves a kind off when it makes no real difference", () => {
    const { effects, withWeather } = learnWeatherEffects(history("hot", 5, 1));
    const hot = effects.kinds.find((k) => k.kind === "hot")!;
    expect(hot.factor).toBeCloseTo(1, 1);
    expect(hot.used).toBe(false);
    expect(withWeather.size).toBe(0);
    expect(effects.scored).toBe(0);
    expect(effects.missWith).toBeNull();
  });

  it("leaves a kind off when the effect isn't steady enough to help", () => {
    // Rain days alternate between half and one-and-a-half times the forecast: no steady effect to learn.
    const days = history("rain", 4, 1).map((d, i) => (d.weather === "rain" ? { ...d, actual: 1000 * (Math.floor(i / 4) % 2 ? 1.5 : 0.5) } : d));
    expect(learnWeatherEffects(days).effects.kinds.find((k) => k.kind === "rain")!.used).toBe(false);
  });

  it("forecasts event days with weather but learns nothing from them", () => {
    const days = history("snow", 5, 0.75).map((d) => (d.weather === "snow" ? { ...d, event: true } : d));
    const snow = learnWeatherEffects(days).effects.kinds.find((k) => k.kind === "snow")!;
    expect(snow.days).toBe(0);
    expect(snow.factor).toBe(1);
  });

  it("copes with nothing, and with days that have no forecast or no weather", () => {
    expect(learnWeatherEffects([]).effects).toMatchObject({ fairDays: 0, scored: 0, through: null });
    const { effects } = learnWeatherEffects([{ date: "2026-01-01", actual: 900, f1: null, weather: "snow" }, { date: "2026-01-02", actual: 900, f1: 1000, weather: null }]);
    expect(effects.through).toBeNull();
  });
});

describe("weatherFactor", () => {
  const stored = toStored(learnWeatherEffects(history("snow", 5, 0.75)).effects, "2026-11-18");
  const snow = stored.kinds.find((k) => k.kind === "snow")!.factor;

  it("gives the learned factor for a switched-on kind, and 1 for anything else", () => {
    expect(weatherFactor(stored, "snow", 1)).toEqual({ factor: snow, days: 80 });
    expect(weatherFactor(stored, "rain", 1).factor).toBe(1);
    expect(weatherFactor(stored, "fair", 1).factor).toBe(1);
    expect(weatherFactor(stored, null, 1).factor).toBe(1);
    expect(weatherFactor(null, "snow", 1).factor).toBe(1);
  });
  it("scales the effect back four or more days out", () => {
    expect(weatherFactor(stored, "snow", 3).factor).toBe(snow);
    expect(weatherFactor(stored, "snow", 4).factor).toBeCloseTo(1 + (snow - 1) * EFFECT_FAR_TRUST, 3);
  });
  it("survives a round trip through storage and ignores junk", () => {
    expect(parseStored(JSON.stringify(stored))).toEqual(stored);
    expect(parseStored("nope")).toBeNull();
    expect(parseStored(null)).toBeNull();
    expect(parseStored('{"learnedOn":"2026-11-18","kinds":[{"kind":"snow","factor":"x","days":3,"used":true}]}')!.kinds).toEqual([]);
  });
});
