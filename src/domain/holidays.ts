/**
 * The holidays and school breaks that move a taproom's day, for any year,
 * worked out from the calendar (no list to keep up to date). Each date gets
 * at most one kind; a named day wins over the stretch it falls in.
 *
 * Long weekends are pooled, because one Labor Day a year teaches little:
 * the winter ones (MLK, Presidents' Day) together, and the warm ones
 * (Memorial Day, Labor Day, Columbus Day) together.
 *
 * Pure: dates in, kinds out.
 */

import { addDays, weekday, type ISODate } from "./dates";

export const HOLIDAY_KINDS = [
  "newYearsDay",
  "weekendWinter",
  "mondayWinter",
  "superBowl",
  "valentines",
  "februaryBreak",
  "stPatricks",
  "springBreak",
  "easter",
  "mothersDay",
  "weekendWarm",
  "mondayWarm",
  "fathersDay",
  "juneteenth",
  "july4",
  "halloween",
  "veteransDay",
  "thanksgivingEve",
  "thanksgiving",
  "blackFriday",
  "thanksgivingWeekend",
  "christmasEve",
  "christmas",
  "christmasWeek",
  "newYearsEve",
] as const;
export type HolidayKind = (typeof HOLIDAY_KINDS)[number];

export const HOLIDAY_LABEL: Record<HolidayKind, string> = {
  newYearsDay: "New Year's Day",
  weekendWinter: "Winter long weekends",
  mondayWinter: "Winter holiday Mondays",
  superBowl: "Super Bowl Sunday",
  valentines: "Valentine's Day",
  februaryBreak: "February school break",
  stPatricks: "St. Patrick's Day",
  springBreak: "Spring break weeks",
  easter: "Easter Sunday",
  mothersDay: "Mother's Day",
  weekendWarm: "Warm-weather long weekends",
  mondayWarm: "Warm-weather holiday Mondays",
  fathersDay: "Father's Day",
  juneteenth: "Juneteenth",
  july4: "July 4th",
  halloween: "Halloween",
  veteransDay: "Veterans Day",
  thanksgivingEve: "Thanksgiving Eve",
  thanksgiving: "Thanksgiving",
  blackFriday: "Black Friday",
  thanksgivingWeekend: "Thanksgiving weekend",
  christmasEve: "Christmas Eve",
  christmas: "Christmas Day",
  christmasWeek: "Christmas to New Year",
  newYearsEve: "New Year's Eve",
};

/** What the pooled kinds cover; the single days need no explaining. */
export const HOLIDAY_HINT: Partial<Record<HolidayKind, string>> = {
  weekendWinter: "Saturday and Sunday before MLK Day and Presidents' Day",
  mondayWinter: "MLK Day and Presidents' Day",
  februaryBreak: "Tuesday to Friday after Presidents' Day",
  springBreak: "Weekdays in the weeks before and after Easter",
  weekendWarm: "Saturday and Sunday before Memorial Day, Labor Day and Columbus Day",
  mondayWarm: "Memorial Day, Labor Day and Columbus Day",
  thanksgivingWeekend: "Saturday and Sunday after Thanksgiving",
  christmasWeek: "December 26 to 30",
};

/** Kinds that are one day a year, so "closed every year" can be read off them. */
export const SINGLE_DAY_HOLIDAYS: ReadonlySet<HolidayKind> = new Set<HolidayKind>([
  "newYearsDay", "superBowl", "valentines", "stPatricks", "easter", "mothersDay", "fathersDay", "juneteenth", "july4",
  "halloween", "veteransDay", "thanksgivingEve", "thanksgiving", "blackFriday", "christmasEve", "christmas", "newYearsEve",
]);

const iso = (y: number, m: number, d: number): ISODate => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The nth (1-based) given weekday of a month, or the last one when n is −1. */
export function nthWeekday(year: number, month: number, wd: number, n: number): ISODate {
  if (n > 0) {
    const first = iso(year, month, 1);
    return addDays(first, ((wd - weekday(first) + 7) % 7) + 7 * (n - 1));
  }
  const last = addDays(month === 12 ? iso(year + 1, 1, 1) : iso(year, month + 1, 1), -1);
  return addDays(last, -((weekday(last) - wd + 7) % 7));
}

/** Easter Sunday (Western), by the standard calendar arithmetic. */
export function easter(year: number): ISODate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return iso(year, Math.floor(n / 31), (n % 31) + 1);
}

const cache = new Map<number, Map<ISODate, HolidayKind>>();

/** Every holiday date of a year. Stretches go in first, so a named day inside one replaces it. */
export function holidaysOf(year: number): ReadonlyMap<ISODate, HolidayKind> {
  const hit = cache.get(year);
  if (hit) return hit;
  const out = new Map<ISODate, HolidayKind>();
  const set = (d: ISODate, k: HolidayKind) => out.set(d, k);
  const span = (from: ISODate, days: number, k: HolidayKind) => {
    for (let i = 0; i < days; i++) set(addDays(from, i), k);
  };

  // Stretches.
  const e = easter(year);
  span(addDays(e, -6), 5, "springBreak"); // Monday to Good Friday
  span(addDays(e, 1), 5, "springBreak"); // Monday to Friday after
  const presidents = nthWeekday(year, 2, 1, 3);
  span(addDays(presidents, 1), 4, "februaryBreak");
  span(iso(year, 12, 26), 5, "christmasWeek");
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  span(addDays(thanksgiving, 2), 2, "thanksgivingWeekend");

  // Long weekends.
  for (const monday of [nthWeekday(year, 1, 1, 3), presidents]) {
    span(addDays(monday, -2), 2, "weekendWinter");
    set(monday, "mondayWinter");
  }
  for (const monday of [nthWeekday(year, 5, 1, -1), nthWeekday(year, 9, 1, 1), nthWeekday(year, 10, 1, 2)]) {
    span(addDays(monday, -2), 2, "weekendWarm");
    set(monday, "mondayWarm");
  }

  // Named days, which win over anything above.
  // The Super Bowl moved from the first Sunday of February to the second in 2022.
  set(nthWeekday(year, 2, 0, year >= 2022 ? 2 : 1), "superBowl");
  set(iso(year, 2, 14), "valentines");
  set(iso(year, 3, 17), "stPatricks");
  set(e, "easter");
  set(nthWeekday(year, 5, 0, 2), "mothersDay");
  if (year >= 2021) set(iso(year, 6, 19), "juneteenth");
  set(nthWeekday(year, 6, 0, 3), "fathersDay");
  set(iso(year, 7, 4), "july4");
  set(iso(year, 10, 31), "halloween");
  set(iso(year, 11, 11), "veteransDay");
  set(addDays(thanksgiving, -1), "thanksgivingEve");
  set(thanksgiving, "thanksgiving");
  set(addDays(thanksgiving, 1), "blackFriday");
  set(iso(year, 12, 24), "christmasEve");
  set(iso(year, 12, 25), "christmas");
  set(iso(year, 12, 31), "newYearsEve");
  set(iso(year, 1, 1), "newYearsDay");

  cache.set(year, out);
  return out;
}

/** The holiday or school break a date falls on, if any. */
export function holidayKind(date: ISODate): HolidayKind | null {
  return holidaysOf(Number(date.slice(0, 4))).get(date) ?? null;
}
