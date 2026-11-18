import { describe, expect, it } from "vitest";
import { backfillSpans, parseOpenMeteo, weatherKind } from "../weatherHistory";

const hours = (date: string) => Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, "0")}:00`);

describe("parseOpenMeteo", () => {
  const body = {
    daily: {
      time: ["2026-10-01", "2026-10-02", "2026-10-03"],
      temperature_2m_max: [18.2, 12, null],
      temperature_2m_min: [7.1, 3, null],
      apparent_temperature_max: [17, 9.5, null],
      precipitation_sum: [0, 12.4, null],
      snowfall_sum: [0, 0, null],
      wind_speed_10m_max: [14.4, 31, null],
      weather_code: [1, 63, null],
    },
    hourly: {
      time: [...hours("2026-10-01"), ...hours("2026-10-02"), ...hours("2026-10-03")],
      // Oct 2: 1 mm an hour from 4am to 1pm, so 11am and noon and 1pm fall in the 11am–9pm window = 3 mm.
      precipitation: [...new Array(24).fill(0), ...Array.from({ length: 24 }, (_, h) => (h >= 4 && h <= 13 ? 1 : 0)), ...new Array(24).fill(null)],
    },
  };

  it("reads each day with its detail, and rain in the 11am–9pm window", () => {
    const rows = parseOpenMeteo(body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ date: "2026-10-01", tempMaxC: 18.2, tempMinC: 7.1, precipMm: 0, code: 1, apparentMaxC: 17, snowCm: 0, windMaxKph: 14.4, precipDayMm: 0 });
    expect(rows[1]).toMatchObject({ date: "2026-10-02", precipMm: 12.4, precipDayMm: 3, windMaxKph: 31 });
  });

  it("skips days the service has no temperature for yet, so good rows aren't overwritten with blanks", () => {
    expect(parseOpenMeteo(body).some((r) => r.date === "2026-10-03")).toBe(false);
  });

  it("copes with no hourly block and with junk", () => {
    const rows = parseOpenMeteo({ daily: { time: ["2026-10-01"], temperature_2m_max: [10], temperature_2m_min: [2], precipitation_sum: [1], weather_code: [3] } });
    expect(rows[0]).toMatchObject({ date: "2026-10-01", precipDayMm: null, snowCm: null, apparentMaxC: null, windMaxKph: null });
    expect(parseOpenMeteo(null)).toEqual([]);
    expect(parseOpenMeteo({ daily: { time: "x" } })).toEqual([]);
  });
});

describe("backfillSpans", () => {
  const have = new Set(["2026-01-03", "2026-01-04"]);
  it("asks for everything from the first sale to five days ago that isn't on file with detail", () => {
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
  it("falls back to the weather code for snow on older rows", () => {
    expect(weatherKind({ ...base, snowCm: null, precipDayMm: null, precipMm: 4, code: 73 })).toBe("snow");
  });
});
