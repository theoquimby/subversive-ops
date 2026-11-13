/**
 * Events that move demand: games, festivals, live music, buyouts, closures,
 * holidays. Pure helpers for holiday dates, clean event data, and learning
 * how much each kind of event actually moved sales.
 */

import { addDays, ISODate, parseISODate, toISODate, weekday } from "./dates";
import { forecastSeries } from "./forecast";

export const EVENT_KINDS = ["GAME", "FESTIVAL", "MUSIC", "PRIVATE", "CLOSURE", "HOLIDAY", "OTHER"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  GAME: "Game",
  FESTIVAL: "Festival",
  MUSIC: "Live music",
  PRIVATE: "Private event",
  CLOSURE: "Closed",
  HOLIDAY: "Holiday",
  OTHER: "Other",
};

export const isEventKind = (k: string): k is EventKind => (EVENT_KINDS as readonly string[]).includes(k);

// ---- Calendar maths --------------------------------------------------------------

const iso = (y: number, m: number, d: number): ISODate => toISODate(new Date(Date.UTC(y, m - 1, d)));

/** The nth (1-based) given weekday (0=Sun) of a month. */
export function nthWeekday(year: number, month: number, dow: number, n: number): ISODate {
  const first = iso(year, month, 1);
  const offset = (dow - weekday(first) + 7) % 7;
  return addDays(first, offset + 7 * (n - 1));
}

/** The last given weekday (0=Sun) of a month. */
export function lastWeekday(year: number, month: number, dow: number): ISODate {
  const last = addDays(iso(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1), -1);
  return addDays(last, -((weekday(last) - dow + 7) % 7));
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
export function easterSunday(year: number): ISODate {
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
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

export interface EventDraft {
  date: ISODate;
  title: string;
  kind: EventKind;
  impact: number; // demand multiplier, 1 = no change
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
}

/**
 * The days that matter to a bar in upstate New York, with a sensible starting
 * impact. Impacts are guesses until a year of history teaches better ones.
 */
export function nyHolidays(year: number): EventDraft[] {
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const list: EventDraft[] = [
    { date: iso(year, 1, 1), title: "New Year's Day", kind: "HOLIDAY", impact: 0.85 },
    { date: nthWeekday(year, 2, 0, 2), title: "Super Bowl Sunday", kind: "GAME", impact: 1.3, startTime: "18:30" },
    { date: iso(year, 2, 14), title: "Valentine's Day", kind: "HOLIDAY", impact: 1.1 },
    { date: iso(year, 3, 17), title: "St. Patrick's Day", kind: "HOLIDAY", impact: 1.3 },
    { date: easterSunday(year), title: "Easter Sunday", kind: "HOLIDAY", impact: 0.85 },
    { date: nthWeekday(year, 5, 0, 2), title: "Mother's Day", kind: "HOLIDAY", impact: 1.1 },
    { date: lastWeekday(year, 5, 1), title: "Memorial Day", kind: "HOLIDAY", impact: 1.15 },
    { date: nthWeekday(year, 6, 0, 3), title: "Father's Day", kind: "HOLIDAY", impact: 1.15 },
    { date: iso(year, 7, 4), title: "Independence Day", kind: "HOLIDAY", impact: 1.2 },
    { date: nthWeekday(year, 9, 1, 1), title: "Labor Day", kind: "HOLIDAY", impact: 1.15 },
    { date: iso(year, 10, 31), title: "Halloween", kind: "HOLIDAY", impact: 1.1 },
    { date: addDays(thanksgiving, -1), title: "Thanksgiving Eve", kind: "HOLIDAY", impact: 1.3 },
    { date: thanksgiving, title: "Thanksgiving", kind: "HOLIDAY", impact: 0.5, notes: "Change the kind to Closed if we close." },
    { date: iso(year, 12, 24), title: "Christmas Eve", kind: "HOLIDAY", impact: 0.7 },
    { date: iso(year, 12, 25), title: "Christmas Day", kind: "CLOSURE", impact: 0 },
    { date: iso(year, 12, 31), title: "New Year's Eve", kind: "HOLIDAY", impact: 1.4, startTime: "20:00" },
  ];
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Every `everyDays` days from `start` up to and including `until`. */
export function repeatDates(start: ISODate, until: ISODate, everyDays = 7, max = 60): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= until && out.length < max; d = addDays(d, everyDays)) out.push(d);
  return out;
}

// ---- Clean data ---------------------------------------------------------------------

/** "7:30pm", "7pm", "19:30", "1930" → "19:30". Empty → null. Invalid → undefined. */
export function parseClockTime(raw: string): string | null | undefined {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, "");
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.[0];
  if (min > 59) return undefined;
  if (ap) {
    if (h < 1 || h > 12) return undefined;
    if (ap === "p" && h !== 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
  } else if (h > 23) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "19:30" → "7:30pm" for display. */
export function displayTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

/** Tidy a title for the public website: trimmed, single spaces. */
export const cleanTitle = (raw: string) => raw.replace(/\s+/g, " ").trim();

/**
 * Impact as people type it: "+30", "30%", "-20" → multiplier 1.3 / 0.8.
 * Empty → 1. Invalid or below −100% → null.
 */
export function parseImpactPct(raw: string): number | null {
  const s = raw.replace(/[%\s+]/g, "").replace("−", "-");
  if (s === "") return 1;
  const n = Number(s);
  if (!Number.isFinite(n) || n < -100 || n > 500) return null;
  return Math.round((1 + n / 100) * 1000) / 1000;
}

/**
 * Groups events that recur: "Knicks vs Celtics" and "Knicks @ Heat" are both
 * "GAME:knicks"; "Live music: Dave" is "MUSIC:live music".
 */
export function eventSeries(kind: string, title: string): string {
  const head = title
    .toLowerCase()
    .split(/\s+(?:vs\.?|v\.?|@|at|against|versus|with|ft\.?|feat\.?)\s+|\s*[:–—|(]\s*|\s+-\s+/)[0]
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${kind}:${head || title.toLowerCase().trim()}`;
}

// ---- Learning ------------------------------------------------------------------------

export interface PastEvent {
  id: string;
  date: ISODate;
  title: string;
  kind: string;
}

export interface EventLift {
  id: string;
  date: ISODate;
  series: string;
  actual: number;
  /** What the day would have done without the event (same-weekday history, no other events). */
  baseline: number;
  lift: number | null;
}

/**
 * Actual sales ÷ the forecast the day would have had without any event, for
 * each past event. Other event days are left out of the baseline so one
 * festival doesn't inflate the next comparison.
 */
export function eventLifts(history: ReadonlyMap<ISODate, number>, openDays: ReadonlySet<ISODate>, events: PastEvent[]): EventLift[] {
  const eventDays = new Set(events.map((e) => e.date));
  const clean = new Set([...openDays].filter((d) => !eventDays.has(d)));
  const cache = new Map<ISODate, { baseline: number; samples: number }>();
  return events.map((e) => {
    if (!cache.has(e.date)) {
      const [f] = forecastSeries({ history, openDays: clean, asOf: e.date, dates: [e.date] });
      cache.set(e.date, { baseline: f.qty, samples: f.samples });
    }
    const { baseline, samples } = cache.get(e.date)!;
    const actual = history.get(e.date) ?? 0;
    const usable = e.kind !== "CLOSURE" && samples >= 3 && baseline > 0;
    return { id: e.id, date: e.date, series: eventSeries(e.kind, e.title), actual, baseline, lift: usable ? actual / baseline : null };
  });
}

export interface LearnedImpact {
  series: string;
  samples: number;
  impact: number;
}

/** Average lift per series, clamped to a sane range and rounded to whole percents. */
export function learnedImpacts(lifts: EventLift[]): Map<string, LearnedImpact> {
  const by = new Map<string, number[]>();
  for (const l of lifts) {
    if (l.lift == null) continue;
    by.set(l.series, [...(by.get(l.series) ?? []), l.lift]);
  }
  const out = new Map<string, LearnedImpact>();
  for (const [series, xs] of by) {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    out.set(series, { series, samples: xs.length, impact: Math.round(Math.min(3, Math.max(0.3, mean)) * 100) / 100 });
  }
  return out;
}

/** Year of a business date. */
export const yearOf = (d: ISODate) => parseISODate(d).getUTCFullYear();
