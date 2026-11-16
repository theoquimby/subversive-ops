/**
 * Which ordering reminders fire when. A scheduled job runs through the day
 * and asks, for each supplier: given the time now, its next order cutoff,
 * whether an order is placed, whether it should nag at all (cadence, stock,
 * alert setting) and its reminder settings, what's due that hasn't been sent?
 *
 *  - first: the early heads-up (a day before, 4 hours before, or the morning of)
 *  - lastCall: "you haven't placed it", a set time before the cutoff
 *  - missed: the cutoff passed with nothing ordered (Needs you, the brief, one push)
 *
 * Nothing is ever ordered or sent to a supplier from here. Pure: no DB.
 */

import { dueLabel } from "./attention";
import { addDays, WEEKDAYS, weekday, type ISODate } from "./dates";
import { deadlineFor, hoursUntil, type CutoffRule } from "./ordering";
import type { FirstReminder } from "./supplierPrefs";

export interface Deadline {
  deliveryDate: ISODate;
  cutoffDate: ISODate;
  cutoffTime: string; // "HH:MM"
}

export interface LocalNow {
  date: ISODate;
  time: string; // "HH:MM"
}

/** Where the order for the next delivery stands. A draft isn't placed. */
export type Placed = "none" | "draft" | "sent";

export interface ReminderInput {
  supplierId: string;
  supplierName: string;
  now: LocalNow;
  next: Deadline | null;
  placed: Placed;
  /** Whether a missing order should raise an alert at all (see shouldNag). */
  nag: boolean;
  prefs: { first: FirstReminder; lastCallMins: number | null };
  /** Business-local hour the morning brief goes out ("the morning of"). */
  morningHour: number;
  /** Keys of reminders already sent. */
  sent: ReadonlySet<string>;
}

export type ReminderKind = "first" | "lastCall";

export interface Reminder {
  key: string;
  kind: ReminderKind;
  supplierId: string;
  supplierName: string;
  deadline: Deadline;
  title: string;
  body: string;
}

const deadlineKey = (d: Deadline) => `${d.cutoffDate}T${d.cutoffTime}`;
const minsLeft = (now: LocalNow, d: Deadline) => Math.round(hoursUntil(now.date, now.time, d.cutoffDate, d.cutoffTime) * 60);
const dayWord = (today: ISODate, d: ISODate) => (d === today ? "today" : d === addDays(today, 1) ? "tomorrow" : WEEKDAYS[weekday(d)]);

/** Minutes before the cutoff the first reminder goes out; null when there's none. */
export function firstReminderMins(first: FirstReminder, d: Deadline, morningHour: number): number | null {
  if (first === "none") return null;
  if (first === "24h") return 24 * 60;
  if (first === "4h") return 4 * 60;
  const hh = String(Math.min(23, Math.max(0, Math.floor(morningHour)))).padStart(2, "0");
  const fromMorning = minsLeft({ date: d.cutoffDate, time: `${hh}:00` }, d);
  // A cutoff before the morning hour: remind the evening before instead.
  return fromMorning > 0 ? fromMorning : 12 * 60;
}

export function dueReminders(i: ReminderInput): Reminder[] {
  const d = i.next;
  if (!d || !i.nag || i.placed === "sent") return [];
  const left = minsLeft(i.now, d);
  if (left <= 0) return [];
  const due = `due ${dueLabel(i.now.date, d.cutoffDate, d.cutoffTime)}`;
  const w = dayWord(i.now.date, d.deliveryDate);
  const delivery = w === "today" || w === "tomorrow" ? `for ${w}'s delivery` : `for the ${w} delivery`;
  const base = { supplierId: i.supplierId, supplierName: i.supplierName, deadline: d };
  const last = i.prefs.lastCallMins;
  if (last != null && left <= last) {
    const key = `${i.supplierId}|${deadlineKey(d)}|last`;
    if (i.sent.has(key)) return [];
    const time = left < 60 ? `${left} min` : `About ${Math.round(left / 60)} h`;
    return [{ ...base, key, kind: "lastCall", title: `${i.supplierName} order not placed`, body: `${time} left · ${due}${i.placed === "draft" ? ". The draft is saved but not sent" : ""}.` }];
  }
  const first = firstReminderMins(i.prefs.first, d, i.morningHour);
  if (first == null || left > first) return [];
  const key = `${i.supplierId}|${deadlineKey(d)}|first`;
  if (i.sent.has(key)) return [];
  return [{ ...base, key, kind: "first", title: `Order from ${i.supplierName}`, body: `${i.placed === "draft" ? "The draft is saved but not sent" : "Nothing placed yet"} · ${due}, ${delivery}.` }];
}

// ---- Missed cutoffs ----------------------------------------------------------------------

/**
 * The most recent order cutoff that has already passed, for a delivery today
 * or later (so it can still be missed). Null when none has.
 */
export function lastPassedCutoff(deliveryDays: readonly number[], rule: CutoffRule, nowDate: ISODate, nowTime: string): Deadline | null {
  let best: Deadline | null = null;
  for (let i = 0; i <= 14 && deliveryDays.length; i++) {
    const day = addDays(nowDate, i);
    const wd = weekday(day);
    if (!deliveryDays.includes(wd)) continue;
    const { daysBefore, time } = deadlineFor(rule, wd);
    const cutoffDate = addDays(day, -daysBefore);
    const passed = cutoffDate < nowDate || (cutoffDate === nowDate && nowTime >= time);
    if (!passed) continue;
    const d = { deliveryDate: day, cutoffDate, cutoffTime: time };
    if (!best || deadlineKey(d) > deadlineKey(best)) best = d;
  }
  return best;
}

export interface Missed {
  key: string;
  supplierId: string;
  supplierName: string;
  deadline: Deadline;
  nextChance: Deadline | null;
  title: string;
  detail: string;
}

export function missedOrder(a: { supplierId: string; supplierName: string; passed: Deadline | null; hasOrder: boolean; nag: boolean; next: Deadline | null; today: ISODate }): Missed | null {
  const p = a.passed;
  if (!p || a.hasOrder || !a.nag || p.deliveryDate < a.today) return null;
  const n = a.next;
  return {
    key: `${a.supplierId}|${p.deliveryDate}|missed`,
    supplierId: a.supplierId,
    supplierName: a.supplierName,
    deadline: p,
    nextChance: n,
    title: `Missed: ${a.supplierName} cutoff passed with no order`,
    detail: n ? `Next chance ${dueLabel(a.today, n.cutoffDate, n.cutoffTime)}, for the ${WEEKDAYS[weekday(n.deliveryDate)]} delivery` : "No other deadline is set. Call them, or buy locally.",
  };
}

/** Push a missed cutoff once, within `withinHours` (12) of it passing — never days later. */
export function missedPushDue(passed: Deadline, now: LocalNow, sent: ReadonlySet<string>, key: string, withinHours = 12): boolean {
  const since = -hoursUntil(now.date, now.time, passed.cutoffDate, passed.cutoffTime);
  return since >= 0 && since <= withinHours && !sent.has(key);
}

/** Keep the sent-reminder log short: keys dated in the last two weeks. */
export function pruneSentKeys(keys: readonly string[], today: ISODate, days = 14): string[] {
  const from = addDays(today, -days);
  return keys.filter((k) => {
    const m = k.match(/\|(\d{4}-\d{2}-\d{2})/);
    return m != null && m[1] >= from;
  });
}
