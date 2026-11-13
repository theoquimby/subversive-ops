import { describe, expect, it } from "vitest";
import { blockCost, blockHours, formatWindows, laborByHour, localMinutes, parseClock, parseWindows, zonedTime } from "../timecards";

const TZ = "America/New_York";

describe("zonedTime / localMinutes", () => {
  it("converts local wall time to UTC and back, across DST", () => {
    expect(zonedTime("2026-11-13", 16 * 60, TZ).toISOString()).toBe("2026-11-13T21:00:00.000Z"); // EST
    expect(zonedTime("2026-07-01", 16 * 60, TZ).toISOString()).toBe("2026-07-01T20:00:00.000Z"); // EDT
    expect(zonedTime("2026-11-01", 12 * 60, TZ).toISOString()).toBe("2026-11-01T17:00:00.000Z"); // DST ends that morning
    expect(localMinutes(new Date("2026-11-13T21:30:00Z"), TZ)).toBe(16 * 60 + 30);
  });
});

describe("parseClock", () => {
  it("reads the ways people type times", () => {
    expect(parseClock("16:30")).toBe(990);
    expect(parseClock("1630")).toBe(990);
    expect(parseClock("4:30pm")).toBe(990);
    expect(parseClock("4p")).toBe(960);
    expect(parseClock("12am")).toBe(0);
    expect(parseClock("12pm")).toBe(720);
    expect(parseClock("noon")).toBe(720);
    expect(parseClock("10")).toBe(600);
    expect(parseClock("5")).toBe(17 * 60); // bare 1–6 means afternoon
    expect(parseClock("5am")).toBe(300);
    expect(parseClock("25")).toBeNull();
    expect(parseClock("4:75")).toBeNull();
    expect(parseClock("soon")).toBeNull();
  });
});

describe("parseWindows", () => {
  it("parses, sorts and merges ranges", () => {
    expect(parseWindows("4-10")).toEqual([["16:00", "22:00"]]);
    expect(parseWindows("4p-10p, 11-2")).toEqual([["11:00", "14:00"], ["16:00", "22:00"]]);
    expect(parseWindows("11-3, 2-6")).toEqual([["11:00", "18:00"]]);
    expect(parseWindows("6-10am")).toEqual([["06:00", "10:00"]]);
    expect(parseWindows("all day")).toEqual([["00:00", "24:00"]]);
    expect(parseWindows("")).toEqual([]);
    expect(parseWindows("whenever")).toHaveProperty("error");
  });
  it("formats back to something readable", () => {
    expect(formatWindows([["11:00", "14:00"], ["16:30", "22:00"]])).toBe("11am–2pm, 4:30pm–10pm");
    expect(formatWindows([["00:00", "24:00"]])).toBe("All day");
    expect(formatWindows([])).toBe("");
  });
});

describe("labor cost", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 13, h, m));
  it("counts open timecards up to now, only subtracting a break that fits", () => {
    const open = { start: at(16), end: null, breakMinutes: 30, rate: 20 };
    expect(blockHours(open, at(18))).toBeCloseTo(1.5);
    expect(blockHours(open, at(16, 20))).toBeCloseTo(1 / 6);
    expect(blockCost({ start: at(16), end: at(22), breakMinutes: 30, rate: 20 }, 0.1, at(23))).toBeCloseTo(5.5 * 20 * 1.1);
  });
  it("spreads hours and cost over hour slots with breaks pro rata", () => {
    const { hours, cost } = laborByHour(
      [
        { start: at(16, 30), end: at(19), breakMinutes: 0, rate: 20 },
        { start: at(17), end: at(23), breakMinutes: 60, rate: 10 },
      ],
      at(0),
      0,
      at(23, 59),
    );
    expect(hours[16]).toBeCloseTo(0.5);
    expect(hours[17]).toBeCloseTo(1 + 5 / 6);
    expect(cost[17]).toBeCloseTo(20 + (5 / 6) * 10);
    expect(hours.reduce((a, b) => a + b, 0)).toBeCloseTo(2.5 + 5);
    expect(hours[23]).toBe(0);
  });
});
