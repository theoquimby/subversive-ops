import { describe, expect, it } from "vitest";
import { NY_DEFAULT_RULES as R } from "../labor";
import {
  availabilityConflicts, availabilityLabel, clipAvailability, coverage, dayRequirement, formatMinutes, hourlySalesOrFallback, inclusiveDates, intensityFromSlider, localParts,
  parseAvailability, parseHHMM, shiftLabel, splitLongBlocks, staffedHours, summarizeSchedule, timeOptions, weekDates, weekStartOf, zonedInstant,
  coverageShort, fitSliderToTarget, sliderFromIntensity, staffVsDemand,
} from "../schedule";

const NY = "America/New_York";

describe("weeks", () => {
  it("finds the Monday of the week", () => {
    expect(weekStartOf("2026-11-13")).toBe("2026-11-09"); // Fri
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09"); // Mon
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09"); // Sun belongs to the week before
    expect(weekDates("2026-11-09")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(inclusiveDates("2026-11-09", "2026-11-11")).toHaveLength(3);
    expect(inclusiveDates("2026-11-11", "2026-11-09")).toEqual([]);
  });
});

describe("times", () => {
  it("parses and formats wall-clock times", () => {
    expect(parseHHMM("16:30")).toBe(990);
    expect(parseHHMM("24:00")).toBe(1440);
    expect(parseHHMM("25:00")).toBeNull();
    expect(parseHHMM("4pm")).toBeNull();
    expect(formatMinutes(990)).toBe("4:30 pm");
    expect(formatMinutes(0)).toBe("12:00 am");
    expect(formatMinutes(1500)).toBe("1:00 am");
    expect(shiftLabel(960, 1320)).toBe("4p–10p");
    expect(shiftLabel(690, 1020)).toBe("11:30a–5p");
    expect(timeOptions(960, 1020, 30).map((o) => o.value)).toEqual(["960", "990", "1020"]);
  });
  it("converts between local times and instants across DST", () => {
    expect(zonedInstant("2026-11-13", 16 * 60, NY).toISOString()).toBe("2026-11-13T21:00:00.000Z"); // EST
    expect(zonedInstant("2026-07-10", 16 * 60, NY).toISOString()).toBe("2026-07-10T20:00:00.000Z"); // EDT
    expect(zonedInstant("2026-11-13", 25 * 60, NY).toISOString()).toBe("2026-11-14T06:00:00.000Z"); // 1am next day
    expect(zonedInstant("2026-11-01", 12 * 60, NY).toISOString()).toBe("2026-11-01T17:00:00.000Z"); // DST ends that night
    expect(localParts(new Date("2026-11-13T21:30:00Z"), NY)).toEqual({ date: "2026-11-13", minutes: 990 });
    expect(localParts(new Date("2026-11-14T04:00:00Z"), NY)).toEqual({ date: "2026-11-13", minutes: 1380 });
  });
});

describe("availability", () => {
  it("parses windows and treats missing days as off", () => {
    const a = parseAvailability({ "5": [["16:00", "22:00"]], "6": [["11:30", "23:00"], ["bad"]], "0": [] });
    expect(a).toEqual({ 5: [[16, 22]], 6: [[11.5, 23]], 0: [] });
    expect(availabilityLabel(a, 5)).toBe("4p–10p");
    expect(availabilityLabel(a, 1)).toBe("Off");
    expect(availabilityLabel(undefined, 1)).toBe("Any time");
    expect(parseAvailability(null)).toBeUndefined();
    expect(parseAvailability({})).toBeUndefined();
    expect(parseAvailability({ "1": [["18:00", "01:00"]] })).toEqual({ 1: [[18, 25]] });
  });
  it("clips minors to the latest hour", () => {
    expect(clipAvailability({ 5: [[16, 23]] }, 22)[5]).toEqual([[16, 22]]);
    expect(clipAvailability(undefined, 22)[2]).toEqual([[0, 22]]);
  });
});

describe("requirement", () => {
  it("maps the slider to intensity", () => {
    expect(intensityFromSlider(50)).toBe(1);
    expect(intensityFromSlider(0)).toBeGreaterThan(1);
    expect(intensityFromSlider(100)).toBeLessThan(1);
  });
  it("pads opening hours for setup and close", () => {
    const h = staffedHours([16, 20]);
    expect(h.findIndex(Boolean)).toBe(15);
    expect(h.lastIndexOf(true)).toBe(20);
    expect(staffedHours(undefined).some(Boolean)).toBe(false);
  });
  it("spreads a daily forecast when there's no hourly history", () => {
    const hrs = hourlySalesOrFallback(new Array(24).fill(0), 2000, [16, 21]);
    expect(hrs.reduce((a, b) => a + b, 0)).toBeCloseTo(2000);
    expect(hrs[15]).toBe(0);
    expect(hrs[18]).toBeGreaterThan(hrs[16]);
    const real = new Array(24).fill(0);
    real[17] = 100;
    expect(hourlySalesOrFallback(real, 2000, [16, 21])).toEqual(real);
  });
  it("builds per-position curves", () => {
    const sales = new Array(24).fill(0);
    sales[18] = 900;
    const req = dayRequirement(sales, [{ id: "srv", name: "Server", salesPerHour: 400, minStaff: 1, maxStaff: 4 }], [16, 20]);
    const c = req.get("srv")!;
    expect(c[15]).toBe(1); // setup hour at min staff
    expect(c[18]).toBe(3);
    expect(c[21]).toBe(0);
  });
});

describe("splitLongBlocks", () => {
  it("splits long days into handover shifts", () => {
    expect(splitLongBlocks([{ startHour: 11, endHour: 22 }])).toEqual([{ startHour: 11, endHour: 17 }, { startHour: 17, endHour: 22 }]);
    expect(splitLongBlocks([{ startHour: 15, endHour: 21 }])).toEqual([{ startHour: 15, endHour: 21 }]);
    expect(splitLongBlocks([{ startHour: 0, endHour: 24 }])).toHaveLength(3);
  });
});

describe("coverage and conflicts", () => {
  it("counts people per hour", () => {
    const c = coverage([{ startMin: 960, endMin: 1200 }, { startMin: 1050, endMin: 1140 }]);
    expect(c.slice(15, 21)).toEqual([0, 1, 2, 2, 1, 0]);
  });
  it("flags time off and availability", () => {
    const people = new Map([
      ["a", { name: "Ann", availability: { 5: [[16, 22]] as [number, number][] }, timeOff: new Set<string>() }],
      ["b", { name: "Bo", timeOff: new Set(["2026-11-13"]) }],
    ]);
    const c = availabilityConflicts(
      [
        { id: "1", employeeId: "a", date: "2026-11-13", startMin: 960, endMin: 1320 }, // ok
        { id: "2", employeeId: "a", date: "2026-11-13", startMin: 900, endMin: 1320 }, // starts early
        { id: "3", employeeId: "a", date: "2026-11-12", startMin: 960, endMin: 1320 }, // Thu: off
        { id: "4", employeeId: "b", date: "2026-11-13", startMin: 960, endMin: 1320 }, // time off
        { id: "5", employeeId: null, date: "2026-11-13", startMin: 960, endMin: 1320 },
      ],
      people,
    );
    expect(c.map((x) => `${x.shiftId}:${x.rule}:${x.level}`)).toEqual(["2:availability:warn", "3:availability:warn", "4:time-off:block"]);
  });
});

describe("summarizeSchedule", () => {
  it("costs hours with burden, overtime and open shifts", () => {
    const dates = ["2026-11-09", "2026-11-10"];
    const shifts = [
      { employeeId: "a", positionId: "p", date: dates[0], startMin: 960, endMin: 1320, breakMinutes: 0, rate: 20 }, // 6h
      { employeeId: null, positionId: "p", date: dates[1], startMin: 960, endMin: 1200, breakMinutes: 0, rate: 18 }, // 4h open
    ];
    const s = summarizeSchedule(shifts, dates, new Map([[dates[0], 1000], [dates[1], 500]]), new Map([[dates[0], 8]]), R);
    expect(s.hours).toBe(10);
    expect(s.wages).toBeCloseTo(6 * 20 + 4 * 18);
    expect(s.cost).toBeCloseTo((6 * 20 + 4 * 18) * (1 + R.employerBurdenPct));
    expect(s.days[0].cost).toBeCloseTo(120 * (1 + R.employerBurdenPct));
    expect(s.days[0].laborPct).toBeCloseTo((120 * 1.12) / 1000);
    expect(s.openShifts).toBe(1);
    expect(s.openHours).toBe(4);
    expect(s.requiredHours).toBe(8);
    expect(s.days.reduce((a, d) => a + d.cost, 0)).toBeCloseTo(s.cost);
  });
  it("includes overtime premium in the total", () => {
    const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
    const shifts = dates.map((d) => ({ employeeId: "a", positionId: "p", date: d, startMin: 600, endMin: 1140, breakMinutes: 0, rate: 20 })); // 9h × 5 = 45h
    const s = summarizeSchedule(shifts, dates, new Map(), new Map(), R);
    expect(s.overtimeHours).toBe(5);
    expect(s.wages).toBeCloseTo(40 * 20 + 5 * 30);
    expect(s.laborPct).toBeNull();
  });
});

describe("labor budget, call-in cost and hourly demand", () => {
  it("costs short shifts up to the call-in minimum", () => {
    const dates = ["2026-11-09"];
    const s = summarizeSchedule([{ employeeId: "a", positionId: "p", date: dates[0], startMin: 960, endMin: 1080, breakMinutes: 0, rate: 20 }], dates, new Map(), new Map(), R);
    expect(s.callInHours).toBe(2);
    expect(s.wages).toBeCloseTo(40 + 2 * R.minimumWage);
  });
  it("fits the slider to a labor % target", () => {
    const pctAt = (v: number) => 0.2 + v / 1000; // 20% lean … 30% generous
    expect(fitSliderToTarget(pctAt, 0.25)).toEqual({ slider: 50, reachable: true });
    expect(fitSliderToTarget(pctAt, 0.5)).toEqual({ slider: 100, reachable: true });
    expect(fitSliderToTarget(pctAt, 0.1)).toEqual({ slider: 0, reachable: false });
    expect(sliderFromIntensity(intensityFromSlider(37))).toBe(37);
  });
  it("compares people needed and scheduled per hour", () => {
    const need = [Array.from({ length: 24 }, (_, h) => (h >= 16 && h < 20 ? 2 : 0)), Array.from({ length: 24 }, (_, h) => (h === 18 ? 1 : 0))];
    const rows = staffVsDemand(need, [{ startMin: 960, endMin: 1260 }]);
    expect(rows.map((r) => r.hour)).toEqual([16, 17, 18, 19, 20]);
    expect(rows.find((r) => r.hour === 18)).toEqual({ hour: 18, need: 3, have: 1 });
    expect(staffVsDemand([], [])).toEqual([]);
  });
  it("says when time off leaves a day short", () => {
    const day = { date: "2026-11-13", off: [], asking: [], scheduledHours: 40, neededHours: 40, theirHours: 8 };
    expect(coverageShort(day)).toBe(true);
    expect(coverageShort({ ...day, theirHours: 0 })).toBe(false);
    expect(coverageShort({ ...day, scheduledHours: 0, theirHours: 0 })).toBe(false); // not built yet
  });
});
