/**
 * Learned suggestions: settings the app can work out from what already
 * happened — opening hours from sales by hour (and Square's own hours),
 * delivery days and order deadlines from invoices and orders, the weather
 * location from Square, and minimums on hand from what gets bought.
 *
 * Everything here only *suggests*. A person confirms with one tap; nothing a
 * person set is ever changed silently. Pure — no DB, no I/O.
 */

import { addDays, dateRange, weekday, type ISODate } from "./dates";
import { DAY_NAMES, rangeLabel, WEEK_ORDER, type WeekHours } from "./openingHours";

const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- Opening hours from sales by hour ------------------------------------------------

export interface HourSale {
  /** Business date the sale was recorded on. */
  date: ISODate;
  /** Local hour 0–23 the tab closed. */
  hour: number;
  sales: number;
}

export type DayVerdict =
  | { status: "open"; hours: [number, number]; openDays: number; seen: number }
  | { status: "closed"; openDays: number; seen: number }
  | { status: "unsure"; openDays: number; seen: number };

export interface SalesHours {
  /** Per weekday (0 = Sunday). */
  days: Record<number, DayVerdict>;
  /** Weeks of history looked at. */
  weeks: number;
}

export const HOURS_RULES = {
  /** Tabs closed before 5am belong to the night before. */
  lateUntil: 5,
  /** An hour opens the day once it typically does this share of the busiest hour. */
  openShare: 0.05,
  /** The last open hour still does this share of the busiest hour; less than that is people settling tabs. */
  closeShare: 0.25,
  /** A day with less than this share of a typical day's sales is a closed day with a stray sale. */
  dayShare: 0.15,
  minDaySales: 50,
  /** A weekday is closed when it's open on fewer than this share of weeks. */
  closedBelow: 0.3,
  /** …and open when it's open on at least this share (in between, we don't guess). */
  openAtLeast: 0.6,
  minOpenDays: 3,
} as const;

/**
 * Opening hours per weekday from sales by hour over a window (inclusive).
 * `include` drops dates that belong to other hours (e.g. a summer season).
 *
 * - Tabs closed after midnight count toward the night before (close caps at midnight).
 * - A weekday that's rarely open is closed; a stray sale on a closed day doesn't open it.
 * - Hours use the median day, so one private party or holiday doesn't move them.
 * - The closing hour must be a real part of service (≥ 25% of the busiest hour):
 *   the trickle of tabs paid just after close doesn't push closing time later.
 */
export function inferHoursFromSales(rows: readonly HourSale[], window: { from: ISODate; to: ISODate }, include: (d: ISODate) => boolean = () => true): SalesHours {
  const R = HOURS_RULES;
  const dates = dateRange(window.from, addDays(window.to, 1)).filter(include);
  const inWindow = new Set(dates);
  const byDate = new Map<ISODate, Map<number, number>>();
  for (const r of rows) {
    const late = r.hour < R.lateUntil;
    const date = late ? addDays(r.date, -1) : r.date;
    if (!inWindow.has(date)) continue;
    const h = late ? r.hour + 24 : r.hour;
    const m = byDate.get(date) ?? new Map<number, number>();
    m.set(h, (m.get(h) ?? 0) + r.sales);
    byDate.set(date, m);
  }
  const total = (d: ISODate) => [...(byDate.get(d)?.values() ?? [])].reduce((a, b) => a + Math.max(0, b), 0);
  const typical = median(dates.map(total).filter((t) => t > 0));
  const isOpen = (d: ISODate) => {
    const t = total(d);
    return t >= R.minDaySales && t >= typical * R.dayShare;
  };

  const days: Record<number, DayVerdict> = {};
  for (let wd = 0; wd < 7; wd++) {
    const all = dates.filter((d) => weekday(d) === wd);
    const open = all.filter(isOpen);
    const seen = all.length;
    const share = seen ? open.length / seen : 0;
    if (seen < R.minOpenDays) { days[wd] = { status: "unsure", openDays: open.length, seen }; continue; }
    if (share < R.closedBelow) { days[wd] = { status: "closed", openDays: open.length, seen }; continue; }
    if (share < R.openAtLeast || open.length < R.minOpenDays) { days[wd] = { status: "unsure", openDays: open.length, seen }; continue; }
    const med = new Map<number, number>();
    for (let h = R.lateUntil; h < 24 + R.lateUntil; h++) med.set(h, median(open.map((d) => Math.max(0, byDate.get(d)?.get(h) ?? 0))));
    const peak = Math.max(...med.values());
    const hoursUp = [...med.entries()].sort((a, b) => a[0] - b[0]);
    const first = hoursUp.find(([, v]) => v > 0 && v >= peak * R.openShare)?.[0];
    const last = [...hoursUp].reverse().find(([, v]) => v > 0 && v >= peak * R.closeShare)?.[0];
    if (peak <= 0 || first == null || last == null || last < first) { days[wd] = { status: "unsure", openDays: open.length, seen }; continue; }
    days[wd] = { status: "open", hours: [first, Math.min(24, last + 1)], openDays: open.length, seen };
  }
  return { days, weeks: Math.round(dates.length / 7) };
}

/** The confident days as a week: open days with hours; closed days left out; unsure days → undefined in `known`. */
export function salesWeek(s: SalesHours): { week: WeekHours; known: number[] } {
  const week: WeekHours = {};
  const known: number[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const v = s.days[wd];
    if (!v || v.status === "unsure") continue;
    known.push(wd);
    if (v.status === "open") week[wd] = v.hours;
  }
  return { week, known };
}

// ---- Square's business hours --------------------------------------------------------

/** Square `Location.business_hours.periods[]`: day_of_week SUN…SAT, times "HH:MM:SS" local. */
export interface SquarePeriod {
  day_of_week?: string;
  start_local_time?: string;
  end_local_time?: string;
}

const SQ_DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const minutesOf = (t: string | undefined) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Square's hours as our whole-hour week (null when Square has none set). A day
 * with no period is closed. Several periods a day (lunch and dinner) become
 * first opening to last closing; 4:30pm opens at 4pm and 9:30pm closes at
 * 10pm; a period ending at or after midnight closes at midnight.
 */
export function squareWeek(periods: readonly SquarePeriod[] | null | undefined): WeekHours | null {
  if (!periods || periods.length === 0) return null;
  const week: WeekHours = {};
  for (const p of periods) {
    const wd = SQ_DAYS.indexOf((p.day_of_week ?? "").toUpperCase());
    const start = minutesOf(p.start_local_time);
    let end = minutesOf(p.end_local_time);
    if (wd < 0 || start == null || end == null) continue;
    if (end <= start) end = 24 * 60;
    const open = Math.floor(start / 60);
    const close = Math.min(24, Math.ceil(end / 60));
    const cur = week[wd];
    week[wd] = cur ? [Math.min(cur[0], open), Math.max(cur[1], close)] : [open, close];
  }
  return Object.keys(week).length ? week : null;
}

// ---- Comparing and applying hours -----------------------------------------------------

export interface DayChange {
  weekday: number;
  saved: [number, number] | null;
  sales?: [number, number] | null;
  square?: [number, number] | null;
  /** What applying the suggestion sets. */
  next: [number, number] | null;
}

const same = (a: [number, number] | null | undefined, b: [number, number] | null | undefined) => (a ?? null) === (b ?? null) || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);

/**
 * Days where what's saved differs from what Square or the sales say. Square
 * (what the owner told Square) wins over sales when it has the day; sales fill
 * days Square doesn't know. Days nobody is sure of are left alone.
 */
export function hoursChanges(saved: WeekHours, sales: SalesHours | null, square: WeekHours | null, prefer: "square" | "sales" = "square"): DayChange[] {
  const fromSales = sales ? salesWeek(sales) : null;
  const out: DayChange[] = [];
  for (const wd of WEEK_ORDER) {
    const s = fromSales?.known.includes(wd) ? fromSales.week[wd] ?? null : undefined;
    const q = square ? square[wd] ?? null : undefined;
    const pick = prefer === "square" ? (q !== undefined ? q : s) : s !== undefined ? s : q;
    if (pick === undefined) continue;
    const cur = saved[wd] ?? null;
    if (same(cur, pick)) continue;
    out.push({ weekday: wd, saved: cur, ...(s !== undefined ? { sales: s } : {}), ...(q !== undefined ? { square: q } : {}), next: pick });
  }
  return out;
}

/** The saved week with the changes applied. */
export function applyHoursChanges(saved: WeekHours, changes: readonly DayChange[]): WeekHours {
  const next: WeekHours = { ...saved };
  for (const c of changes) {
    if (c.next) next[c.weekday] = c.next;
    else delete next[c.weekday];
  }
  return next;
}

export const dayHoursLabel = (h: [number, number] | null | undefined) => (h ? rangeLabel(h) : "closed");

/** "Thu 4–9pm (saved 4–8pm)" lines for a card. */
export function describeChange(c: DayChange): string {
  return `${DAY_NAMES[c.weekday]}: ${dayHoursLabel(c.next)}, saved ${dayHoursLabel(c.saved)}`;
}

// ---- Delivery days from invoices and orders --------------------------------------------

export interface DeliveryObservation {
  date: ISODate;
  source: "invoice" | "order";
}

export type Confidence = "high" | "medium" | "low";

export interface DeliveryDays {
  days: number[];
  /** Distinct delivery dates looked at. */
  n: number;
  /** Share of those dates that fall on `days`. */
  coverage: number;
  confidence: Confidence;
  counts: number[];
}

export const DELIVERY_RULES = {
  /** A weekday is a delivery day when at least this share of deliveries land on it… */
  dayShare: 0.2,
  /** …and at least this many. */
  dayMin: 2,
  minObservations: 4,
} as const;

/**
 * The weekdays a supplier usually delivers, from the dates invoices are dated
 * and orders were received (one observation per date). Odd one-off days are
 * noise: a weekday needs a fifth of the deliveries and at least two. Confidence
 * is high with 8+ dates and 85% on the chosen days, medium with 4+ and 70%.
 */
export function inferDeliveryDays(obs: readonly DeliveryObservation[]): DeliveryDays {
  const dates = [...new Set(obs.map((o) => o.date))];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dates) counts[weekday(d)]++;
  const n = dates.length;
  const need = Math.max(DELIVERY_RULES.dayMin, n * DELIVERY_RULES.dayShare);
  const days = counts.map((c, wd) => ({ c, wd })).filter((x) => x.c >= need).map((x) => x.wd).sort((a, b) => a - b);
  const covered = days.reduce((a, wd) => a + counts[wd], 0);
  const coverage = n ? covered / n : 0;
  const confidence: Confidence = n >= 8 && coverage >= 0.85 ? "high" : n >= DELIVERY_RULES.minObservations && coverage >= 0.7 && days.length > 0 ? "medium" : "low";
  return { days, n, coverage, confidence, counts };
}

/** "Tue, Fri" (Monday first). */
export const weekdaysLabel = (days: readonly number[]) => (days.length ? WEEK_ORDER.filter((d) => days.includes(d)).map((d) => SHORT[d]).join(", ") : "none");

/** "94% of 16 deliveries" */
export const coverageLabel = (d: Pick<DeliveryDays, "coverage" | "n">) => `${Math.round(d.coverage * 100)}% of ${d.n} deliveries`;

// ---- Order deadlines and lead time from sent orders -----------------------------------

export interface SentOrder {
  /** Business date and local time ("HH:MM") the order went out. */
  sentDate: ISODate;
  sentTime: string;
  deliveryDate: ISODate;
}

export interface DeadlineInference {
  /** Most common days between sending and delivery. */
  leadDays: number | null;
  /** Per delivery weekday: the day orders typically go out and the latest time one did (to the half hour). */
  perDay: Record<number, { day: number; time: string; n: number }>;
  n: number;
}

const mode = (xs: readonly number[]) => {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  // Ties → the larger number (ordering earlier is the safe side).
  return [...c.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
};

/**
 * When orders actually go out for each delivery day. The suggested deadline
 * is the usual sending day and the latest time an order went out that day:
 * every one of those still arrived, so it's never later than what's worked.
 * Needs two orders for a delivery day (and three overall for the lead time).
 */
export function inferDeadlines(orders: readonly SentOrder[]): DeadlineInference {
  const ok = orders.filter((o) => /^\d{2}:\d{2}/.test(o.sentTime) && o.sentDate <= o.deliveryDate);
  const gap = (o: SentOrder) => Math.round((Date.parse(o.deliveryDate) - Date.parse(o.sentDate)) / 86_400_000);
  const perDay: DeadlineInference["perDay"] = {};
  for (let wd = 0; wd < 7; wd++) {
    const these = ok.filter((o) => weekday(o.deliveryDate) === wd && gap(o) <= 7);
    if (these.length < 2) continue;
    const before = mode(these.map(gap))!;
    const onDay = these.filter((o) => gap(o) === before);
    const latest = Math.max(...onDay.map((o) => minutesOf(o.sentTime) ?? 0));
    const half = Math.floor(latest / 30) * 30;
    perDay[wd] = { day: (wd - before + 70) % 7, time: `${String(Math.floor(half / 60)).padStart(2, "0")}:${String(half % 60).padStart(2, "0")}`, n: these.length };
  }
  return { leadDays: ok.length >= 3 ? mode(ok.map(gap).filter((g) => g <= 7)) : null, perDay, n: ok.length };
}

// ---- Weather location ----------------------------------------------------------------

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Weather barely changes within a few km, so closer than this isn't worth asking about. */
export const WEATHER_NEAR_KM = 3;

/** "Catskill, NY" from a street address like "1 Main St, Catskill, NY 12414". */
export function townFromAddress(address: string): string | null {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const state = /^([A-Za-z]{2})\b/.exec(last)?.[1];
  if (state && parts.length >= 3) return `${parts[parts.length - 2]}, ${state.toUpperCase()}`;
  if (state) return null;
  return parts[parts.length - 1].replace(/\d{5}(-\d{4})?/, "").trim() || null;
}

// ---- Minimum on hand and order buffer ------------------------------------------------

/** Longest wait between deliveries, in days (7 for weekly or unknown). */
export function longestGap(deliveryDays: readonly number[]): number {
  const d = [...new Set(deliveryDays)].sort((a, b) => a - b);
  if (d.length <= 1) return 7;
  let gap = 0;
  for (let i = 0; i < d.length; i++) gap = Math.max(gap, ((d[(i + 1) % d.length] - d[i] + 7) % 7) || 7);
  return gap;
}

/**
 * Minimum on hand for something no recipe uses (napkins, gloves, sanitizer):
 * enough to last the longest wait between deliveries at the rate it's been
 * bought, rounded up to whole packs. Needs three purchases.
 */
export function suggestPar(args: { purchases: readonly { date: ISODate; qtyBase: number }[]; windowDays: number; deliveryDays: readonly number[]; packBase: number | null }): { qtyBase: number; perDay: number; n: number } | null {
  const buys = args.purchases.filter((p) => p.qtyBase > 0);
  if (buys.length < 3 || args.windowDays <= 0) return null;
  const perDay = buys.reduce((a, p) => a + p.qtyBase, 0) / args.windowDays;
  const raw = perDay * longestGap(args.deliveryDays);
  if (!(raw > 0)) return null;
  const qtyBase = args.packBase && args.packBase > 0 ? Math.max(1, Math.ceil(raw / args.packBase - 1e-6)) * args.packBase : raw;
  return { qtyBase, perDay, n: buys.length };
}

/**
 * The order buffer the order-size model (newsvendor) lands on: stock it picks
 * for the cover window over forecast use, minus one, to the nearest 5%,
 * between 0% and 100%.
 */
export function bufferFromPlan(p: { onHand: number; best: number; pack: number; mean: number }): number | null {
  if (!(p.mean > 0) || !(p.pack > 0)) return null;
  const ratio = (Math.max(0, p.onHand) + p.best * p.pack) / p.mean - 1;
  return Math.min(1, Math.max(0, Math.round(ratio * 20) / 20));
}

// ---- Dismissals ----------------------------------------------------------------------

/** Stable text for a suggested value, so "Not now" hides this suggestion but a different one later still shows. */
export function fingerprint(value: unknown): string {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(norm(value));
}

export const isDismissed = (dismissed: Record<string, string>, key: string, value: unknown) => dismissed[key] === fingerprint(value);
