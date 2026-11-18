import { describe, expect, it } from "vitest";
import { backfillSpans, parseNceiDaily, parseNwsGrid, parseValidTime, weatherKind } from "../weatherHistory";

const TZ = "America/New_York";
const v = (validTime: string, value: number) => ({ validTime, value });

describe("parseValidTime", () => {
  it("reads the start and the length in hours", () => {
    expect(parseValidTime("2026-11-18T12:00:00+00:00/PT6H")).toEqual({ start: Date.parse("2026-11-18T12:00:00Z"), hours: 6 });
    expect(parseValidTime("2026-11-18T12:00:00+00:00/P3DT18H")!.hours).toBe(90);
    expect(parseValidTime("2026-11-18T12:00:00+00:00/P1D")!.hours).toBe(24);
    expect(parseValidTime("nonsense")).toBeNull();
    expect(parseValidTime(null)).toBeNull();
  });
});

describe("parseNwsGrid", () => {
  // Eastern Standard Time is UTC−5: 12:00Z is 7am, 16:00Z is 11am, 02:00Z is 9pm the day before.
  const grid = (over: Record<string, unknown> = {}) => ({
    properties: {
      maxTemperature: { values: [v("2026-11-19T12:00:00+00:00/PT13H", 10), v("2026-11-20T12:00:00+00:00/PT13H", 4), v("2026-11-24T12:00:00+00:00/PT13H", 0.5)] },
      minTemperature: { values: [v("2026-11-19T00:00:00+00:00/PT14H", -1), v("2026-11-20T01:00:00+00:00/PT13H", 2), v("2026-11-24T01:00:00+00:00/PT13H", -6)] },
      // Nov 19: 12 mm from 1am to 7am local (06Z–12Z), then 6 mm from 1pm to 7pm (18Z–24Z).
      quantitativePrecipitation: { values: [v("2026-11-19T05:00:00+00:00/PT1H", 0), v("2026-11-19T06:00:00+00:00/PT6H", 12), v("2026-11-19T12:00:00+00:00/PT6H", 0), v("2026-11-19T18:00:00+00:00/PT6H", 6), v("2026-11-20T00:00:00+00:00/PT6H", 0), v("2026-11-20T06:00:00+00:00/PT24H", 0)] },
      snowfallAmount: { values: [v("2026-11-19T05:00:00+00:00/PT49H", 0)] },
      windSpeed: { values: [v("2026-11-19T12:00:00+00:00/PT6H", 12), v("2026-11-19T18:00:00+00:00/PT6H", 28)] },
      apparentTemperature: { values: [v("2026-11-19T12:00:00+00:00/PT4H", 3), v("2026-11-19T16:00:00+00:00/PT6H", 8)] },
      skyCover: { values: [v("2026-11-20T12:00:00+00:00/PT13H", 90), v("2026-11-24T12:00:00+00:00/PT13H", 100)] },
      probabilityOfPrecipitation: { values: [v("2026-11-24T16:00:00+00:00/PT6H", 70)] },
      ...over,
    },
  });

  it("gives each day its high and low, rain shared out by the hour, and the 11am–9pm share", () => {
    const { rows } = parseNwsGrid(grid(), TZ);
    const d19 = rows.find((r) => r.date === "2026-11-19")!;
    expect(d19).toMatchObject({ tempMaxC: 10, tempMinC: -1, precipMm: 18, precipDayMm: 6, snowCm: 0, windMaxKph: 28, apparentMaxC: 8, code: 63 });
    const d20 = rows.find((r) => r.date === "2026-11-20")!;
    expect(d20).toMatchObject({ tempMaxC: 4, tempMinC: 2, precipMm: 0, precipDayMm: 0, code: 3 });
  });

  it("past where amounts reach, a 60% chance during the day counts as rain, or snow when it's freezing", () => {
    const { rows, partial } = parseNwsGrid(grid(), TZ);
    const d24 = rows.find((r) => r.date === "2026-11-24")!;
    expect(d24.precipDayMm).toBeGreaterThanOrEqual(5);
    expect(d24.snowCm).toBeNull();
    expect(d24.code).toBe(73);
    expect(weatherKind(d24)).toBe("snow");
    expect(partial).not.toContain("2026-11-24");
  });

  it("flags today when hours of its day are already gone, so the caller doesn't lower what's on file", () => {
    // Fetched at 3pm on the 19th: amounts start at 20:00Z (3pm local).
    const late = grid({ quantitativePrecipitation: { values: [v("2026-11-19T20:00:00+00:00/PT4H", 2), v("2026-11-20T00:00:00+00:00/PT30H", 0)] } });
    const { rows, partial } = parseNwsGrid(late, TZ);
    expect(partial).toEqual(["2026-11-19"]);
    expect(rows.find((r) => r.date === "2026-11-19")!.precipDayMm).toBe(2);
  });

  it("skips days with no high or low, and copes with junk", () => {
    expect(parseNwsGrid(grid(), TZ).rows.map((r) => r.date)).toEqual(["2026-11-19", "2026-11-20", "2026-11-24"]);
    expect(parseNwsGrid(null, TZ)).toEqual({ rows: [], partial: [] });
    expect(parseNwsGrid({ properties: { maxTemperature: { values: "x" } } }, TZ).rows).toEqual([]);
  });
});

describe("parseNceiDaily", () => {
  it("reads NOAA's daily rows: °C, mm, and wind from m/s to km/h", () => {
    const rows = parseNceiDaily([
      { DATE: "2026-11-05", STATION: "USW00014735", TMAX: "20.0", TMIN: "14.4", PRCP: "8.1", SNOW: "0.0", AWND: "4.8", WSF2: "7.6" },
      { DATE: "2026-01-12", TMAX: "-3.0", TMIN: "-9.4", PRCP: "6.0", SNOW: "80.0", AWND: "3.0" },
    ]);
    expect(rows[0]).toEqual({ date: "2026-11-05", tempMaxC: 20, tempMinC: 14.4, precipMm: 8.1, code: 63, apparentMaxC: null, snowCm: 0, windMaxKph: 27.4, precipDayMm: null });
    expect(rows[1]).toMatchObject({ snowCm: 8, code: 73, windMaxKph: 10.8 });
    expect(weatherKind(rows[1])).toBe("snow");
  });
  it("skips days with no temperature, treats missing rain as none, and missing snow as unknown only when it's cold", () => {
    const rows = parseNceiDaily([{ DATE: "2026-07-01", TMAX: "28", TMIN: "17" }, { DATE: "2026-02-01", TMAX: "1", TMIN: "-4" }, { DATE: "2026-02-02", PRCP: "3" }]);
    expect(rows.map((r) => [r.date, r.precipMm, r.snowCm])).toEqual([["2026-07-01", 0, 0], ["2026-02-01", 0, null]]);
    expect(parseNceiDaily("oops")).toEqual([]);
  });
});

describe("backfillSpans", () => {
  const have = new Set(["2026-01-03", "2026-01-04"]);
  it("asks for everything from the first sale to five days ago that isn't loaded", () => {
    expect(backfillSpans({ firstSale: "2026-01-01", today: "2026-01-12", have })).toEqual([{ from: "2026-01-01", to: "2026-01-07" }]);
  });
  it("asks for nothing when it's all there, or there are no sales yet", () => {
    expect(backfillSpans({ firstSale: "2026-01-03", today: "2026-01-09", have })).toEqual([]);
    expect(backfillSpans({ firstSale: null, today: "2026-01-09", have })).toEqual([]);
  });
  it("splits a long history into year-sized requests, oldest first, and stops at the cap", () => {
    const spans = backfillSpans({ firstSale: "2022-01-01", today: "2026-01-06", have: new Set(), maxSpans: 3 });
    expect(spans).toHaveLength(3);
    expect(spans[0]).toEqual({ from: "2022-01-01", to: "2023-01-01" });
    expect(spans[1].from).toBe("2023-01-02");
  });
});

describe("weatherKind", () => {
  const base = { precipMm: 0, tempMaxC: 15, snowCm: 0, precipDayMm: 0, code: 1 };
  it("names the day by what would keep people home, worst first", () => {
    expect(weatherKind(base)).toBe("fair");
    expect(weatherKind({ ...base, snowCm: 6, precipMm: 8, tempMaxC: -2 })).toBe("snow");
    expect(weatherKind({ ...base, precipMm: 22, precipDayMm: 18 })).toBe("heavyRain");
    expect(weatherKind({ ...base, precipMm: 7, precipDayMm: 6 })).toBe("rain");
    expect(weatherKind({ ...base, tempMaxC: 31 })).toBe("hot");
    expect(weatherKind({ ...base, tempMaxC: -1 })).toBe("cold");
  });
  it("goes by rain during the day when it's known: an overnight soaking is a fair day", () => {
    expect(weatherKind({ ...base, precipMm: 20, precipDayMm: 0.4 })).toBe("fair");
    expect(weatherKind({ ...base, precipMm: 20, precipDayMm: null })).toBe("heavyRain");
  });
  it("falls back to the weather code for snow when there's no snow figure", () => {
    expect(weatherKind({ ...base, snowCm: null, precipDayMm: null, precipMm: 4, code: 73 })).toBe("snow");
  });
});
