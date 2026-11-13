import { describe, expect, it } from "vitest";
import { DEFAULT_WEEK_HOURS, describeWeek, hourLabel, hoursOn, inSeason, monthDayLabel, parseSeasons, parseWeek, rangeLabel, seasonOn, seasonProblem, summarizeWeek, validMonthDay, weekProblem, type SeasonalHours } from "../openingHours";

describe("opening hours labels", () => {
  it("formats hours and ranges", () => {
    expect(hourLabel(0)).toBe("12am");
    expect(hourLabel(12)).toBe("12pm");
    expect(hourLabel(16)).toBe("4pm");
    expect(hourLabel(24)).toBe("midnight");
    expect(rangeLabel([16, 20])).toBe("4–8pm");
    expect(rangeLabel([12, 19])).toBe("12–7pm");
    expect(rangeLabel([11, 14])).toBe("11am–2pm");
    expect(rangeLabel([17, 24])).toBe("5pm–midnight");
  });

  it("describes Subversive's default week, Monday first, runs of equal days merged", () => {
    expect(describeWeek(DEFAULT_WEEK_HOURS)).toBe("Mon 4–8pm · Tue closed · Wed–Thu 4–8pm · Fri 4–9pm · Sat 12–9pm · Sun 12–7pm");
    expect(describeWeek({})).toBe("Closed every day");
    expect(summarizeWeek(DEFAULT_WEEK_HOURS)).toBe("Open 6 days · closed Tue");
    expect(summarizeWeek({ 0: [9, 17], 1: [9, 17], 2: [9, 17], 3: [9, 17], 4: [9, 17], 5: [9, 17], 6: [9, 17] })).toBe("Open 7 days");
  });
});

describe("validation", () => {
  it("rejects a day that closes before it opens, in plain English", () => {
    expect(weekProblem(DEFAULT_WEEK_HOURS)).toBeNull();
    expect(weekProblem({ 2: [20, 16] })).toBe("Tuesday closes before it opens");
    expect(weekProblem({ 5: [16, 25] })).toMatch(/within the day/);
  });

  it("parses stored weeks and drops bad data", () => {
    expect(parseWeek({ "1": [16, 20] })).toEqual({ 1: [16, 20] });
    expect(parseWeek({ "1": [20, 16] })).toBeNull();
    expect(parseWeek("nope")).toBeNull();
    expect(parseWeek({})).toEqual({});
  });

  it("knows real month-days", () => {
    expect(validMonthDay("02-29")).toBe(true);
    expect(validMonthDay("04-31")).toBe(false);
    expect(validMonthDay("13-01")).toBe(false);
    expect(monthDayLabel("06-01")).toBe("Jun 1");
  });
});

describe("seasons", () => {
  const summer: SeasonalHours = { id: "s", label: "Summer", from: "06-01", to: "09-07", hours: { ...DEFAULT_WEEK_HOURS, 2: [16, 20] } };
  const winter: SeasonalHours = { id: "w", label: "Winter", from: "12-15", to: "03-15", hours: { 5: [16, 21], 6: [12, 21] } };

  it("checks dates inside a season, including ones that wrap the new year", () => {
    expect(inSeason("2026-06-01", "06-01", "09-07")).toBe(true);
    expect(inSeason("2026-09-07", "06-01", "09-07")).toBe(true);
    expect(inSeason("2026-09-08", "06-01", "09-07")).toBe(false);
    expect(inSeason("2027-01-10", "12-15", "03-15")).toBe(true);
    expect(inSeason("2026-12-14", "12-15", "03-15")).toBe(false);
  });

  it("uses the season's hours inside it and the regular week outside", () => {
    expect(hoursOn("2026-07-14", DEFAULT_WEEK_HOURS, [summer])[2]).toEqual([16, 20]);
    expect(hoursOn("2026-11-13", DEFAULT_WEEK_HOURS, [summer])).toBe(DEFAULT_WEEK_HOURS);
    expect(hoursOn("2026-11-13", DEFAULT_WEEK_HOURS, [])).toBe(DEFAULT_WEEK_HOURS);
    expect(seasonOn("2027-02-01", [summer, winter])?.id).toBe("w");
  });

  it("explains what's wrong with a season", () => {
    expect(seasonProblem(summer)).toBeNull();
    expect(seasonProblem({ ...summer, label: " " })).toMatch(/name/);
    expect(seasonProblem({ ...summer, to: "02-30" })).toMatch(/ends/);
    expect(seasonProblem({ ...summer, to: summer.from })).toMatch(/Events/);
  });

  it("parses stored seasons, skipping broken ones", () => {
    expect(parseSeasons([summer, { id: "x", label: "Bad", from: "06-01", to: "09-07", hours: { 1: [20, 10] } }, null])).toEqual([summer]);
    expect(parseSeasons("x")).toEqual([]);
  });
});
