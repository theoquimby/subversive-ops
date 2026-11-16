/**
 * When something shows: is it scheduled for later, showing now, or ended?
 *
 * Two kinds of window share the same three states:
 *   - by business day (the website notice): `from` and `until` are
 *     "YYYY-MM-DD" days in the business timezone, both included;
 *   - by the minute (staff announcements): `startsAt` included, `endsAt` not.
 *
 * Blank start = already showing; blank end = until someone takes it down.
 * Also the plain words for each state and the checks run on save. Pure.
 */

import { addDays, businessDate, weekday, WEEKDAYS, type ISODate } from "./dates";
import { formatMinutes, localParts, zonedInstant } from "./schedule";
import { isIsoDate } from "./websiteSchema";

export type ShowState = "scheduled" | "showing" | "ended";

/** Where a day window stands on `today` (a business day). */
export function dayState(from: ISODate | null, until: ISODate | null, today: ISODate): ShowState {
  if (until && until < today) return "ended";
  if (from && from > today) return "scheduled";
  return "showing";
}

/** Where a minute window stands at `now`. */
export function instantState(startsAt: Date | null, endsAt: Date | null, now: Date): ShowState {
  if (endsAt && endsAt.getTime() <= now.getTime()) return "ended";
  if (startsAt && startsAt.getTime() > now.getTime()) return "scheduled";
  return "showing";
}

/** Where a day window stands at an instant, judged by the business day there. */
export const dayStateAt = (from: ISODate | null, until: ISODate | null, now: Date, timeZone: string): ShowState => dayState(from, until, businessDate(now, timeZone));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu Nov 20", or "Thu Nov 20, 2027" when it isn't `today`'s year. */
export function dayLabel(day: ISODate, today?: ISODate): string {
  const [y, m, d] = day.split("-").map(Number);
  const s = `${WEEKDAYS[weekday(day)]} ${MONTHS[m - 1]} ${d}`;
  return today && today.slice(0, 4) !== day.slice(0, 4) ? `${s}, ${y}` : s;
}

/**
 * The website notice in words: "Scheduled: shows from Thu Nov 20 until Wed Nov 26",
 * "Showing now · until Wed Nov 26", "Ended".
 */
export function dayWindowLabel(from: ISODate | null, until: ISODate | null, today: ISODate): { state: ShowState; label: string } {
  const state = dayState(from, until, today);
  if (state === "ended") return { state, label: "Ended" };
  if (state === "scheduled") return { state, label: `Scheduled: shows from ${dayLabel(from!, today)}${until ? ` until ${dayLabel(until, today)}` : ""}` };
  if (until === today) return { state, label: "Showing now · last day today" };
  return { state, label: until ? `Showing now · until ${dayLabel(until, today)}` : "Showing now · until you take it down" };
}

/**
 * Checks a day window before it's saved. A start on or before today means
 * "now" and comes back as null. Returns the cleaned window or a plain message.
 */
export function checkDayWindow(from: string | null, until: string | null, today: ISODate): { from: ISODate | null; until: ISODate | null } | { error: string } {
  const f = from?.trim() || null;
  const u = until?.trim() || null;
  if (f && !isIsoDate(f)) return { error: "Pick the day it starts showing." };
  if (u && !isIsoDate(u)) return { error: "Pick the last day it shows." };
  if (u && u < today) return { error: "That last day has passed. Pick today or later." };
  if (f && u && f > u) return { error: "It would start after its last day. Pick a start on or before the last day." };
  return { from: f && f > today ? f : null, until: u };
}

/**
 * Checks a minute window before it's saved. A start that has already passed
 * means "now" and comes back as null.
 */
export function checkStart(startsAt: Date | null, endsAt: Date | null, now: Date): { startsAt: Date | null } | { error: string } {
  if (startsAt && Number.isNaN(startsAt.getTime())) return { error: "Pick a day and time." };
  const s = startsAt && startsAt.getTime() > now.getTime() ? startsAt : null;
  if (endsAt && (s ?? now).getTime() >= endsAt.getTime()) return { error: "It would come down before it starts. Pick an earlier start." };
  return { startsAt: s };
}

/** A day and minutes after midnight in the business timezone → the instant. */
export const startInstant = (day: ISODate, minutes: number, timeZone: string): Date => zonedInstant(day, minutes, timeZone);

/** The other way: an instant → its business day and minutes after midnight. */
export const startParts = (instant: Date, timeZone: string): { date: ISODate; minutes: number } => localParts(instant, timeZone);

/** "Thu Nov 20 at 4:30 pm" in the business timezone; "today at 4:30 pm" / "tomorrow at 9:00 am" when close. */
export function startLabel(instant: Date, now: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  const today = businessDate(now, timeZone);
  const day = p.date === today ? "today" : p.date === addDays(today, 1) ? "tomorrow" : dayLabel(p.date, today);
  return `${day} at ${formatMinutes(p.minutes)}`;
}

