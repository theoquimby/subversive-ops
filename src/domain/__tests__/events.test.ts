import { describe, expect, it } from "vitest";
import { addDays, dateRange, weekday } from "../dates";
import { easterSunday, eventLifts, eventSeries, lastWeekday, learnedImpacts, nthWeekday, nyHolidays, parseClockTime, parseImpactPct, repeatDates, displayTime } from "../events";

describe("holiday dates", () => {
  it("computes floating holidays", () => {
    expect(nthWeekday(2026, 11, 4, 4)).toBe("2026-11-26"); // Thanksgiving
    expect(nthWeekday(2027, 11, 4, 4)).toBe("2027-11-25");
    expect(lastWeekday(2026, 5, 1)).toBe("2026-05-25"); // Memorial Day
    expect(lastWeekday(2026, 12, 4)).toBe("2026-12-31");
    expect(nthWeekday(2026, 9, 1, 1)).toBe("2026-09-07"); // Labor Day
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2024)).toBe("2024-03-31");
  });
  it("lists NY holidays for a year in order", () => {
    const h = nyHolidays(2026);
    const by = new Map(h.map((x) => [x.title, x]));
    expect(by.get("Super Bowl Sunday")?.date).toBe("2026-02-08");
    expect(by.get("Thanksgiving")?.date).toBe("2026-11-26");
    expect(by.get("Thanksgiving Eve")?.date).toBe("2026-11-25");
    expect(by.get("Independence Day")?.date).toBe("2026-07-04");
    expect(by.get("Christmas Day")?.kind).toBe("CLOSURE");
    expect(by.get("New Year's Eve")?.date).toBe("2026-12-31");
    expect(nyHolidays(2027).find((x) => x.title === "Super Bowl Sunday")?.date).toBe("2027-02-14");
    expect([...h].sort((a, b) => a.date.localeCompare(b.date))).toEqual(h);
  });
  it("repeats weekly up to an end date", () => {
    expect(repeatDates("2026-11-13", "2026-12-04")).toEqual(["2026-11-13", "2026-11-20", "2026-11-27", "2026-12-04"]);
    expect(repeatDates("2026-11-13", "2026-11-12")).toEqual([]);
  });
});

describe("clean input", () => {
  it("parses times people type", () => {
    expect(parseClockTime("7:30pm")).toBe("19:30");
    expect(parseClockTime("7 PM")).toBe("19:00");
    expect(parseClockTime("12am")).toBe("00:00");
    expect(parseClockTime("12pm")).toBe("12:00");
    expect(parseClockTime("1930")).toBe("19:30");
    expect(parseClockTime("19:30")).toBe("19:30");
    expect(parseClockTime("")).toBeNull();
    expect(parseClockTime("25:00")).toBeUndefined();
    expect(parseClockTime("soon")).toBeUndefined();
    expect(displayTime("19:30")).toBe("7:30pm");
    expect(displayTime("12:00")).toBe("12pm");
  });
  it("parses impact percents", () => {
    expect(parseImpactPct("+30")).toBe(1.3);
    expect(parseImpactPct("30%")).toBe(1.3);
    expect(parseImpactPct("-20")).toBe(0.8);
    expect(parseImpactPct("")).toBe(1);
    expect(parseImpactPct("abc")).toBeNull();
    expect(parseImpactPct("-150")).toBeNull();
  });
  it("groups recurring events into a series", () => {
    expect(eventSeries("GAME", "Knicks vs Celtics")).toBe("GAME:knicks");
    expect(eventSeries("GAME", "Knicks @ Heat")).toBe("GAME:knicks");
    expect(eventSeries("GAME", "Knicks v. Nets")).toBe("GAME:knicks");
    expect(eventSeries("MUSIC", "Live music: The Felice Brothers")).toBe("MUSIC:live music");
    expect(eventSeries("FESTIVAL", "Oktoberfest 2026")).toBe("FESTIVAL:oktoberfest");
  });
});

describe("learning event impact", () => {
  const asOf = "2026-11-10";
  const days = dateRange(addDays(asOf, -70), asOf);
  const openDays = new Set(days.filter((d) => weekday(d) !== 2));
  it("compares event days with a baseline that ignores other events", () => {
    // Every Saturday does 1000; two game Saturdays did 1500.
    const games = days.filter((d) => weekday(d) === 6).slice(-2);
    const history = new Map(days.map((d) => [d, games.includes(d) ? 1500 : weekday(d) === 6 ? 1000 : 500]));
    const lifts = eventLifts(history, openDays, games.map((d, i) => ({ id: `g${i}`, date: d, title: i ? "Knicks vs Heat" : "Knicks vs Nets", kind: "GAME" })));
    expect(lifts[0].lift).toBeCloseTo(1.5, 1);
    expect(lifts[1].lift).toBeCloseTo(1.5, 1); // the earlier game didn't inflate the baseline
    const learned = learnedImpacts(lifts).get("GAME:knicks");
    expect(learned?.samples).toBe(2);
    expect(learned?.impact).toBeCloseTo(1.5, 1);
  });
  it("skips closures and days without enough history", () => {
    const history = new Map(days.map((d) => [d, 500]));
    const lifts = eventLifts(history, openDays, [
      { id: "c", date: days[60], title: "Closed for repairs", kind: "CLOSURE" },
      { id: "e", date: days[3], title: "Early", kind: "OTHER" },
    ]);
    expect(lifts.every((l) => l.lift == null)).toBe(true);
    expect(learnedImpacts(lifts).size).toBe(0);
  });
});
