import { describe, expect, it } from "vitest";
import { dateRange } from "../dates";
import { holidayFactor, holidayPlan, learnHolidayEffects, parseStoredHolidays, toStoredHolidays, upcomingHolidays, usuallyClosed, type HolidayDay } from "../holidayEffect";
import { holidayKind, type HolidayKind } from "../holidays";

const t = (days: number, ratio: number) => ({ days, forecast: days * 1000, actual: days * 1000 * ratio });

describe("holidayFactor", () => {
  it("is how sales ran on the holiday against ordinary days, pulled toward no effect when it has come round few times", () => {
    // Two New Year's Eves at 80% over: halfway there.
    expect(holidayFactor(t(2, 1.8), t(300, 1))).toBeCloseTo(1.4);
    expect(holidayFactor(t(6, 1.8), t(300, 1))).toBeCloseTo(1.6);
    expect(holidayFactor(t(6, 1.8 * 1.1), t(300, 1.1))).toBeCloseTo(1.6);
  });
  it("needs two occurrences and a month of ordinary days, and stays inside the clamp", () => {
    expect(holidayFactor(t(1, 2), t(300, 1))).toBe(1);
    expect(holidayFactor(t(6, 2), t(20, 1))).toBe(1);
    expect(holidayFactor(t(40, 9), t(300, 1))).toBe(3);
    expect(holidayFactor(t(40, 0.05), t(300, 1))).toBe(0.3);
  });
});

/** Seven years of days at a $1,000 forecast with a small wobble; `ratio` gives a holiday's sales as a share of forecast. */
function history(ratio: Partial<Record<HolidayKind, number>>, opts: { closed?: HolidayKind[]; event?: HolidayKind[] } = {}): HolidayDay[] {
  return dateRange("2019-06-01", "2026-06-01").flatMap((date, i) => {
    const k = holidayKind(date);
    if (k && opts.closed?.includes(k)) return [];
    const wobble = 1 + (((i * 7) % 11) - 5) / 100;
    return [{ date, forecast: 1000, actual: 1000 * wobble * ((k && ratio[k]) || 1), event: !!k && !!opts.event?.includes(k) }];
  });
}

describe("learnHolidayEffects", () => {
  it("learns a busy New Year's Eve and a quiet Christmas Eve, replays them, and switches them on", () => {
    const { effects, withHolidays } = learnHolidayEffects(history({ newYearsEve: 1.8, christmasEve: 0.5 }));
    const nye = effects.kinds.find((k) => k.kind === "newYearsEve")!;
    expect(nye.days).toBe(7);
    expect(nye.factor).toBeGreaterThan(1.55);
    expect(nye.factor).toBeLessThan(1.7);
    expect(nye.used).toBe(true);
    // The first two had nothing behind them.
    expect(nye.scored).toBe(5);
    expect(nye.missWith!).toBeLessThan(nye.missWithout! * 0.5);
    const eve = effects.kinds.find((k) => k.kind === "christmasEve")!;
    expect(eve.factor).toBeLessThan(0.65);
    expect(eve.used).toBe(true);
    expect(withHolidays.get("2025-12-31")!).toBeGreaterThan(1500);
    expect(withHolidays.has("2019-12-31")).toBe(false);
    expect(effects.missWith!).toBeLessThan(effects.missWithout!);
  });

  it("leaves a holiday off when it's just an ordinary day here", () => {
    const { effects, withHolidays } = learnHolidayEffects(history({}));
    expect(effects.kinds.length).toBeGreaterThan(20);
    expect(effects.kinds.every((k) => !k.used)).toBe(true);
    expect(withHolidays.size).toBe(0);
    expect(effects.scored).toBe(0);
  });

  it("leaves a small effect off even when it replays a little closer: with so many holidays, one would pass by luck", () => {
    const { effects } = learnHolidayEffects(history({ springBreak: 0.93 }));
    const k = effects.kinds.find((x) => x.kind === "springBreak")!;
    expect(k.factor).toBeGreaterThan(0.9);
    expect(k.missWith!).toBeLessThan(k.missWithout!);
    expect(k.used).toBe(false);
  });

  it("pools the long weekends, so they have plenty of days behind them", () => {
    const { effects } = learnHolidayEffects(history({ mondayWarm: 2.2, weekendWarm: 1.3 }));
    const mon = effects.kinds.find((k) => k.kind === "mondayWarm")!;
    expect(mon.days).toBe(21);
    expect(mon.factor).toBeGreaterThan(2);
    expect(mon.used).toBe(true);
    expect(effects.kinds.find((k) => k.kind === "weekendWarm")!.days).toBe(42);
    expect(effects.kinds.find((k) => k.kind === "mondayWinter")!.used).toBe(false);
  });

  it("leaves days the owner planned for alone: not adjusted, not learned from", () => {
    const { effects, withHolidays } = learnHolidayEffects(history({ halloween: 1.9 }, { event: ["halloween"] }));
    expect(effects.kinds.some((k) => k.kind === "halloween")).toBe(false);
    expect(withHolidays.size).toBe(0);
  });

  it("copes with nothing", () => {
    expect(learnHolidayEffects([]).effects).toMatchObject({ kinds: [], ordinaryDays: 0, scored: 0, missWith: null });
  });
});

describe("usuallyClosed", () => {
  const open = (closed: HolidayKind[], except: string[] = []) => new Set(history({}, { closed }).map((d) => d.date).concat(except));
  it("spots a holiday closed at each of its last three occurrences", () => {
    expect(usuallyClosed({ openDays: open(["thanksgiving", "christmas"]), from: "2019-06-01", today: "2026-06-01" })).toEqual(["thanksgiving", "christmas"]);
  });
  it("doesn't if it was open on one of the last three, or hasn't come round three times", () => {
    expect(usuallyClosed({ openDays: open(["christmas"], ["2024-12-25"]), from: "2019-06-01", today: "2026-06-01" })).toEqual([]);
    expect(usuallyClosed({ openDays: open(["christmas"]), from: "2024-06-01", today: "2026-06-01" })).toEqual([]);
  });
  it("ignores a holiday that fell in a long shutdown", () => {
    // Shut for all of December 2025: that Christmas says nothing either way, so the three before it decide.
    const days = new Set([...open(["christmas"])].filter((d) => !(d >= "2025-12-10" && d <= "2026-01-10")));
    expect(usuallyClosed({ openDays: days, from: "2019-06-01", today: "2026-06-01" })).toContain("christmas");
    expect(usuallyClosed({ openDays: days, from: "2019-06-01", today: "2026-06-01" })).not.toContain("newYearsEve");
  });
});

describe("holidayPlan and upcomingHolidays", () => {
  const learned = learnHolidayEffects(history({ thanksgivingEve: 1.6, christmasWeek: 1.3 })).effects;
  const stored = toStoredHolidays(learned, ["thanksgiving"], "2026-11-18");

  it("says what the forecast does on a holiday, and nothing on an ordinary day", () => {
    expect(holidayPlan(stored, "2026-11-18")).toBeNull();
    expect(holidayPlan(stored, "2026-11-25")).toMatchObject({ kind: "thanksgivingEve", used: true, closed: false, days: 7 });
    expect(holidayPlan(stored, "2026-11-25")!.factor).toBeGreaterThan(1.4);
    expect(holidayPlan(stored, "2026-11-26")).toMatchObject({ kind: "thanksgiving", factor: 0, closed: true });
    // Black Friday isn't switched on: the day is named, the forecast is untouched.
    expect(holidayPlan(stored, "2026-11-27")).toMatchObject({ kind: "blackFriday", factor: 1, used: false });
    expect(holidayPlan(null, "2026-11-25")).toMatchObject({ kind: "thanksgivingEve", factor: 1, used: false });
  });

  it("lists what's coming, a stretch as one entry", () => {
    const up = upcomingHolidays(stored, "2026-11-18", 45);
    expect(up.map((u) => [u.kind, u.from, u.to])).toEqual([
      ["thanksgivingEve", "2026-11-25", "2026-11-25"],
      ["thanksgiving", "2026-11-26", "2026-11-26"],
      ["blackFriday", "2026-11-27", "2026-11-27"],
      ["thanksgivingWeekend", "2026-11-28", "2026-11-29"],
      ["christmasEve", "2026-12-24", "2026-12-24"],
      ["christmas", "2026-12-25", "2026-12-25"],
      ["christmasWeek", "2026-12-26", "2026-12-30"],
      ["newYearsEve", "2026-12-31", "2026-12-31"],
      ["newYearsDay", "2027-01-01", "2027-01-01"],
    ]);
  });

  it("survives a round trip through storage, and drops what older rules stored", () => {
    expect(parseStoredHolidays(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredHolidays(JSON.stringify({ ...stored, rules: 0 }))).toBeNull();
    expect(parseStoredHolidays("junk")).toBeNull();
  });
});
