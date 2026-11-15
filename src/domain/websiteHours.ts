/**
 * Hours for the website: Ops keeps opening hours in whole hours (good enough for
 * the forecast and the schedule), guests need the exact minute and when the
 * kitchen stops taking orders. The website hours are the Ops week with optional
 * exact times layered on per weekday:
 *
 *   - exact open is used when it falls in the Ops opening hour (4:30pm for a 4pm open)
 *   - exact close is used when it falls in the Ops closing hour (8:30pm for a 9pm close)
 *   - kitchen close defaults to closing time; it must sit between open and close
 *
 * An exact time that no longer fits (the Ops hours moved) is ignored and reported as
 * `stale`, so changing Settings → Business never leaves the website wrong.
 * Pure; weekday 0 = Sunday like src/domain/openingHours.ts.
 */

import type { SeasonalHours, WeekHours } from "./openingHours";
import { WEEKDAYS, isHHmm, type WebDayHours, type WebWeekHours, type Weekday } from "./websiteSchema";

export interface ExactDay {
  open?: string | null;
  close?: string | null;
  kitchenClose?: string | null;
}
export type ExactHours = Partial<Record<Weekday, ExactDay>>;

/** "sun" for 0 … "sat" for 6. */
export const WEEKDAY_OF_DOW: Record<number, Weekday> = { 0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat" };
export const DOW_OF_WEEKDAY: Record<Weekday, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const pad = (n: number) => String(n).padStart(2, "0");

/** 1050 → "17:30". 1440 (midnight) → "23:59", the last minute the website can say. */
export function minutesToHHmm(m: number): string {
  const c = Math.max(0, Math.min(1439, Math.round(m)));
  return `${pad(Math.floor(c / 60))}:${pad(c % 60)}`;
}

/** "17:30" → 1050; null when it isn't HH:mm. */
export function hhmmToMinutes(s: string | null | undefined): number | null {
  if (!s || !isHHmm(s)) return null;
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}

/** "4:30pm", "16:30", "4.30 pm", "noon" → "16:30"; "" → null; anything else → undefined. */
export function parseTypedTime(raw: string): string | null | undefined {
  const v = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!v) return null;
  if (v === "noon") return "12:00";
  if (v === "midnight") return "23:59";
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/.exec(v);
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
  return `${pad(h)}:${pad(min)}`;
}

/** "16:30" → "4:30pm", "12:00" → "12pm". */
export function hhmmLabel(s: string): string {
  const m = hhmmToMinutes(s);
  if (m == null) return s;
  const h = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? `:${pad(min)}` : ""}${h < 12 ? "am" : "pm"}`;
}

export interface WebDayResult {
  hours: WebDayHours;
  /** Exact times saved for this weekday that don't fit the Ops hours any more. */
  stale: ("open" | "close" | "kitchenClose")[];
}

/** One weekday on the website from the Ops range [open, close) in whole hours and the exact times. */
export function webDay(range: [number, number] | undefined, exact: ExactDay | undefined): WebDayResult {
  const stale: WebDayResult["stale"] = [];
  if (!range) return { hours: null, stale };
  const [opsOpen, opsClose] = range;
  let open = opsOpen * 60;
  let close = opsClose * 60;
  const eo = hhmmToMinutes(exact?.open);
  if (eo != null) {
    if (Math.floor(eo / 60) === opsOpen) open = eo;
    else stale.push("open");
  }
  const ec = hhmmToMinutes(exact?.close);
  if (ec != null) {
    // A close inside the last hour: 8:30pm sits in a 9pm close (ceil); exactly 9pm is fine too.
    if (Math.ceil(ec / 60) === opsClose && ec > open) close = ec;
    else stale.push("close");
  }
  let kitchen = close;
  const ek = hhmmToMinutes(exact?.kitchenClose);
  if (ek != null) {
    if (ek > open && ek <= close) kitchen = ek;
    else stale.push("kitchenClose");
  }
  return { hours: { open: minutesToHHmm(open), close: minutesToHHmm(close), kitchenClose: minutesToHHmm(kitchen) }, stale };
}

/** The whole week for the website. */
export function webWeek(week: WeekHours, exact: ExactHours): { hours: WebWeekHours; stale: Partial<Record<Weekday, WebDayResult["stale"]>> } {
  const hours = {} as WebWeekHours;
  const stale: Partial<Record<Weekday, WebDayResult["stale"]>> = {};
  for (const d of WEEKDAYS) {
    const r = webDay(week[DOW_OF_WEEKDAY[d]], exact[d]);
    hours[d] = r.hours;
    if (r.stale.length) stale[d] = r.stale;
  }
  return { hours, stale };
}

/** Seasons as the site feed sends them: label, MM-DD window and that season's week. */
export function webSeasons(seasons: readonly SeasonalHours[], exact: ExactHours) {
  return seasons.map((s) => ({ label: s.label, from: s.from, to: s.to, hours: webWeek(s.hours, exact).hours }));
}

/** Safe read of stored exact times: keeps only real HH:mm values for known weekdays. */
export function parseExactHours(raw: unknown): ExactHours {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ExactHours = {};
  for (const d of WEEKDAYS) {
    const v = (raw as Record<string, unknown>)[d];
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const pick = (k: string) => (typeof o[k] === "string" && isHHmm(o[k] as string) ? (o[k] as string) : undefined);
    const day: ExactDay = { open: pick("open"), close: pick("close"), kitchenClose: pick("kitchenClose") };
    if (day.open || day.close || day.kitchenClose) out[d] = Object.fromEntries(Object.entries(day).filter(([, x]) => x)) as ExactDay;
  }
  return out;
}

// ---- Notice -----------------------------------------------------------------------------

export interface SiteNotice {
  text: string;
  /** Last day it shows (inclusive), "YYYY-MM-DD"; null = until removed. */
  until: string | null;
}

export const NOTICE_MAX = 280;

/** The notice to publish today: null when there's none or it has expired. */
export function liveNotice(n: SiteNotice | null | undefined, today: string): SiteNotice | null {
  if (!n || !n.text.trim()) return null;
  if (n.until && n.until < today) return null;
  return { text: n.text.trim().slice(0, NOTICE_MAX), until: n.until };
}

export function parseNotice(raw: unknown): SiteNotice | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (!text) return null;
  const until = typeof o.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.until) ? o.until : null;
  return { text: text.slice(0, NOTICE_MAX), until };
}

/** "4:30pm–8pm", or "Closed". */
export function dayRangeLabel(h: { open: string; close: string } | null | undefined): string {
  if (!h) return "Closed";
  const a = hhmmLabel(h.open);
  const b = hhmmLabel(h.close);
  // "4:30–8pm" like the printed menu: one am/pm when both ends share it.
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`;
}
