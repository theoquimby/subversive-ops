import { describe, expect, it } from "vitest";
import { weekday } from "../dates";
import { easter, HOLIDAY_KINDS, HOLIDAY_LABEL, holidayKind, holidaysOf, nthWeekday } from "../holidays";

describe("nthWeekday", () => {
  it("finds the nth weekday of a month, and the last", () => {
    expect(nthWeekday(2026, 11, 4, 4)).toBe("2026-11-26"); // Thanksgiving
    expect(nthWeekday(2026, 9, 1, 1)).toBe("2026-09-07"); // Labor Day
    expect(nthWeekday(2026, 5, 1, -1)).toBe("2026-05-25"); // Memorial Day
    expect(nthWeekday(2027, 5, 1, -1)).toBe("2027-05-31");
    expect(nthWeekday(2026, 12, 0, -1)).toBe("2026-12-27");
  });
});

describe("easter", () => {
  it("matches the known dates", () => {
    expect([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027].map(easter)).toEqual(["2019-04-21", "2020-04-12", "2021-04-04", "2022-04-17", "2023-04-09", "2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28"]);
  });
});

describe("holidayKind", () => {
  it("names the fixed and floating days of 2026", () => {
    const expected: Record<string, string> = {
      "2026-01-01": "newYearsDay",
      "2026-01-19": "mondayWinter", // MLK
      "2026-01-17": "weekendWinter",
      "2026-02-08": "superBowl",
      "2026-02-16": "mondayWinter", // Presidents' Day
      "2026-02-17": "februaryBreak",
      "2026-02-20": "februaryBreak",
      "2026-03-17": "stPatricks",
      "2026-04-03": "springBreak", // Good Friday
      "2026-04-05": "easter",
      "2026-04-10": "springBreak",
      "2026-05-10": "mothersDay",
      "2026-05-23": "weekendWarm",
      "2026-05-25": "mondayWarm", // Memorial Day
      "2026-06-19": "juneteenth",
      "2026-06-21": "fathersDay",
      "2026-07-04": "july4",
      "2026-09-07": "mondayWarm", // Labor Day
      "2026-10-11": "weekendWarm",
      "2026-10-12": "mondayWarm", // Columbus Day
      "2026-10-31": "halloween",
      "2026-11-11": "veteransDay",
      "2026-11-25": "thanksgivingEve",
      "2026-11-26": "thanksgiving",
      "2026-11-27": "blackFriday",
      "2026-11-28": "thanksgivingWeekend",
      "2026-11-29": "thanksgivingWeekend",
      "2026-12-24": "christmasEve",
      "2026-12-25": "christmas",
      "2026-12-28": "christmasWeek",
      "2026-12-31": "newYearsEve",
    };
    for (const [d, k] of Object.entries(expected)) expect([d, holidayKind(d)]).toEqual([d, k]);
  });

  it("leaves ordinary days alone", () => {
    for (const d of ["2026-11-18", "2026-08-12", "2026-03-03", "2026-02-21", "2026-04-11", "2026-11-30"]) expect([d, holidayKind(d)]).toEqual([d, null]);
  });

  it("lets a named day win over the stretch it falls in", () => {
    // Valentine's Day 2026 is the Saturday of Presidents' weekend.
    expect(holidayKind("2026-02-14")).toBe("valentines");
    expect(holidayKind("2026-02-15")).toBe("weekendWinter");
    // Father's Day 2022 fell on Juneteenth: the Sunday is Father's Day.
    expect(holidayKind("2022-06-19")).toBe("fathersDay");
  });

  it("knows the Super Bowl moved a week in 2022, and Juneteenth began in 2021", () => {
    expect(holidayKind("2021-02-07")).toBe("superBowl");
    expect(holidayKind("2022-02-13")).toBe("superBowl");
    expect(holidayKind("2020-06-19")).toBeNull();
    expect(holidayKind("2021-06-19")).toBe("juneteenth");
  });

  it("puts every pooled day on the right weekday, every year", () => {
    for (let y = 2019; y <= 2030; y++) {
      for (const [d, k] of holidaysOf(y)) {
        if (k === "mondayWinter" || k === "mondayWarm") expect([d, weekday(d)]).toEqual([d, 1]);
        if (k === "weekendWinter" || k === "weekendWarm" || k === "thanksgivingWeekend") expect([0, 6]).toContain(weekday(d));
        if (k === "februaryBreak" || k === "springBreak") expect([1, 2, 3, 4, 5]).toContain(weekday(d));
        if (k === "thanksgiving") expect(weekday(d)).toBe(4);
        if (k === "easter" || k === "mothersDay" || k === "fathersDay" || k === "superBowl") expect([d, weekday(d)]).toEqual([d, 0]);
      }
    }
  });

  it("has a label for every kind", () => {
    for (const k of HOLIDAY_KINDS) expect(HOLIDAY_LABEL[k]).toBeTruthy();
  });
});
