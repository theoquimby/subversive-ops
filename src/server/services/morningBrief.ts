import "server-only";
import { recentAutoLinks } from "./linking";
import { existsSync } from "node:fs";
import path from "node:path";
import { addDays, ISODate, weekday } from "@/domain/dates";
import { busyWindow, crewCheck, isMondayEdition, parseMorningHour, weekWrap, yesterdaySummary, type CrewCheck } from "@/domain/morningBrief";
import { todayItems, type TodayItem } from "@/domain/orderingBoard";
import { mondayOf } from "@/domain/pnl";
import { bridge } from "@/domain/pnlStory";
import { nightTotals } from "@/domain/shiftNotes";
import { MANAGER_NAV } from "@/lib/areas";
import { db } from "../db";
import { dayStates } from "./dayState";
import { settingValue } from "./setting-read";
import { attentionList } from "./attention";
import { forecastRangeFor } from "./analytics";
import { hourlySalesForecast, weatherLabel } from "./forecasting";
import { periodKpis } from "./kpis";
import { orderingBoard } from "./orderingBoard";
import { pnlReport } from "./pnl";
import { prepSummary, type PrepSummary } from "./prep";
import { eventsForPrepBetween, type PrepEvent } from "./privateEvents";
import { businessToday } from "./sales";
import { loadWeek } from "./scheduling";
import { lastNight, notesOn, type ShiftNoteView } from "./shiftNotes";
import { tapList, type TapListRow } from "./taps";

/**
 * The daily morning brief: yesterday in one line, today (forecast, busy hours,
 * weather, events, crew vs what's needed), what to get done before tonight
 * (order deadlines, drafts, check-ins, invoices, kegs and the rest of the
 * Overview's "Needs you", less anything long-standing with nothing new today),
 * last night's shift notes and, on Mondays, a short wrap of last week. Every
 * part fails on its own (logged, left out), so one broken source never blanks
 * the brief.
 */

export const MORNING_HOUR_KEY = "brief.morning.hour";
export const MORNING_SENT_KEY = "brief.morning.sent";

export async function getMorningHour(): Promise<number> {
  return parseMorningHour(await settingValue(MORNING_HOUR_KEY));
}

export async function saveMorningHour(hour: number) {
  const value = String(parseMorningHour(String(hour)));
  await db.setting.upsert({ where: { key: MORNING_HOUR_KEY }, create: { key: MORNING_HOUR_KEY, value }, update: { value } });
}

/**
 * Whether a prep list page exists in this build (another part of the app).
 * Checked at runtime (the nav, or the page file in dev) so the brief never
 * depends on its code.
 */
export function prepAvailable(): boolean {
  if (MANAGER_NAV.some((g) => g.items.some((i) => i.href === "/prep"))) return true;
  try {
    return existsSync(path.join(process.cwd(), "src", "app", "(app)", "prep", "page.tsx"));
  } catch {
    return false;
  }
}

export interface TonightItem {
  key: string;
  kind: "deadline" | "draft" | "checkin" | "invoices" | "kegs" | "brewery" | "requests" | "schedule" | "certs" | "reviews" | "other";
  title: string;
  detail: string;
  href: string;
  tone: "bad" | "warn" | "neutral";
  /** As on the Overview, when known: urgent lines show whatever someone looks after (domain/focus). */
  urgency?: number;
}

const clock = (hhmm: string) => {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "am" : "pm"}`;
};
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function orderItem(t: TodayItem, today: ISODate): TonightItem | null {
  const when = (d: ISODate) => (d === today ? "today" : d === addDays(today, 1) ? "tomorrow" : DAY[weekday(d)]);
  if (t.kind === "deadline" && t.deadline) {
    return { key: t.key, kind: "deadline", title: `Order from ${t.supplierName}`, detail: `Due ${when(t.deadline.cutoffDate)} ${clock(t.deadline.cutoffTime)} · delivers ${when(t.deliveryDate)}`, href: `/ordering/${t.supplierId}`, tone: (t.hoursToCutoff ?? 99) <= 6 ? "bad" : "warn", ...(t.hoursToCutoff != null ? { urgency: 100 - t.hoursToCutoff } : {}) };
  }
  if (t.kind === "draft") {
    return { key: t.key, kind: "draft", title: `Send the ${t.supplierName} order`, detail: `Draft saved${t.deadline ? ` · due ${when(t.deadline.cutoffDate)} ${clock(t.deadline.cutoffTime)}` : ""} · delivers ${when(t.deliveryDate)}`, href: `/ordering/po/${t.orderId}`, tone: t.hoursToCutoff != null && t.hoursToCutoff <= 24 ? "warn" : "neutral" };
  }
  if (t.kind === "checkin") {
    return { key: t.key, kind: "checkin", title: `Check in ${t.supplierName}`, detail: t.late ? `Was due ${when(t.deliveryDate)} · still not checked in` : "Arriving today · check it against the order", href: `/ordering/po/${t.orderId}`, tone: t.late ? "warn" : "neutral" };
  }
  return null;
}

const KINDS = new Set(["invoices", "kegs", "requests", "schedule", "certs", "reviews"]);

async function soft<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    console.error(`morning brief: ${label} failed`, e);
    return fallback;
  }
}

const cToF = (c: number) => Math.round((c * 9) / 5 + 32);

export async function morningBrief(now = new Date()) {
  const today = businessToday();
  const yesterday = addDays(today, -1);
  const monday = isMondayEdition(today);

  const hasPrep = prepAvailable();
  const [yReport, forecast, range, week, board, attention, yNotes, notes, sendHour, wrap, prep, parties, taps] = await Promise.all([
    soft("yesterday", pnlReport(yesterday, today, now), null),
    soft("forecast", hourlySalesForecast([today]).then((f) => f[0] ?? null), null),
    soft("range", forecastRangeFor(today), null),
    soft("crew", loadWeek(mondayOf(today)), null),
    soft("ordering", orderingBoard(now), null),
    soft("attention", attentionList(now), []),
    soft("notes yesterday", notesOn([yesterday]), [] as ShiftNoteView[]),
    soft("last night", lastNight(today), [] as ShiftNoteView[]),
    soft("hour", getMorningHour(), 9),
    monday ? soft("wrap", lastWeekWrap(today, now), null) : Promise.resolve(null),
    hasPrep ? soft("prep", prepSummary(today, 3), null as PrepSummary | null) : Promise.resolve(null),
    soft("private events", eventsForPrepBetween(today, addDays(today, 1)), [] as PrepEvent[]),
    soft("taps", tapList().then((t) => t.rows), [] as TapListRow[]),
  ]);

  // ---- Yesterday ------------------------------------------------------------------------
  // A day Square hasn't synced yet reads as "not in yet", not "closed".
  const yDay = yReport?.days.find((d) => d.date === yesterday && d.salesSynced) ?? null;
  const yBridge = yDay ? bridge(yDay) : null;
  const y = yDay
    ? {
        date: yesterday,
        sales: yDay.sales,
        forecast: yDay.forecast,
        labor: yDay.labor,
        profit: yBridge && yDay.sales > 0 ? yBridge.profit : null,
        orders: yDay.orders ?? null,
        laborTarget: yReport?.budget?.laborPct ?? null,
        ...yesterdaySummary({
          sales: yDay.sales,
          forecast: yDay.forecast,
          labor: yDay.labor,
          laborTarget: yReport?.budget?.laborPct ?? null,
          profit: yBridge && yDay.sales > 0 ? yBridge.profit : null,
          notes: yNotes.length ? nightTotals(yNotes) : undefined,
        }),
      }
    : null;

  // ---- Today ----------------------------------------------------------------------------
  const drivers = forecast?.drivers ?? null;
  const closed = forecast != null && (drivers?.eventFactor === 0 || forecast.qty < 1);
  const busy = forecast && !closed ? busyWindow(forecast.hours) : null;
  const w = drivers?.weather ?? null;
  const weather = w
    ? { ...weatherLabel(w.code), hiF: cToF(w.tempMaxC), loF: cToF(w.tempMinC), precipMm: w.precipMm, wet: w.precipMm >= 5, factor: drivers!.weatherFactor }
    : null;
  // Booked parties are listed on their own (with headcount), so drop their calendar copies here.
  const partyCalendarIds = new Set(parties.map((p) => p.calendarEventId).filter(Boolean));
  const events = (drivers?.events ?? []).filter((e) => !partyCalendarIds.has(e.id)).map((e) => ({ title: e.title, kind: e.kind, startTime: e.startTime }));
  const party = (p: PrepEvent) => ({ id: p.id, title: p.title, headcount: p.headcount, startTime: p.startTime, space: p.space, confirmed: p.stage !== "DEPOSIT" });

  let crew: { people: number; shifts: number; drafts: number; open: number; check: CrewCheck; names: string[]; demand: { hour: number; need: number; have: number }[] } | null = null;
  if (week) {
    const mine = week.shifts.filter((s) => s.date === today);
    const names = new Map(week.employees.map((e) => [e.id, e.name]));
    const people = new Set(mine.map((s) => s.employeeId).filter((x): x is string => !!x));
    const demand = week.demand[today] ?? [];
    crew = {
      people: people.size,
      shifts: mine.length,
      drafts: mine.filter((s) => !s.published).length,
      open: mine.filter((s) => !s.employeeId).length,
      check: crewCheck(demand),
      names: [...people].map((id) => names.get(id) ?? "").filter(Boolean).slice(0, 12),
      demand,
    };
  }

  // ---- Before tonight -------------------------------------------------------------------
  const tonight: TonightItem[] = [];
  if (board) {
    const items = todayItems({ today, suppliers: board.suppliers, orders: board.orders, windowHours: 30, checkinDays: 7 });
    for (const t of items) {
      // Drafts only matter today when their deadline is close or they deliver within two days.
      if (t.kind === "draft" && !((t.hoursToCutoff != null && t.hoursToCutoff <= 30) || t.deliveryDate <= addDays(today, 2))) continue;
      const it = orderItem(t, today);
      if (it) tonight.push(it);
    }
  }
  for (const a of attention) {
    if (a.key.startsWith("order")) continue; // covered above, per supplier
    if (a.standing) continue; // long-standing with nothing new today (the keg fleet's lists): Mondays only
    // A missed order cutoff ("Missed: … next chance …") sits with today's deadlines.
    tonight.push({ key: a.key, kind: (KINDS.has(a.key) ? a.key : a.key.startsWith("missed.") ? "deadline" : a.key.startsWith("kegs.") ? "kegs" : a.key.startsWith("brewery.") ? "brewery" : "other") as TonightItem["kind"], title: a.title, detail: a.detail, href: a.href, tone: a.tone, urgency: a.urgency });
  }
  // Kegs nearly out on tap: change them before service, and say when nothing full is behind.
  const kegAlerts = attention.filter((a) => a.key === "kegs").map((a) => a.title);
  for (const t of taps) {
    if (t.badge !== "almost") continue;
    // "No full keg behind it" from the Overview already covers an empty line with nothing to follow.
    if (t.backups === 0 && kegAlerts.some((title) => title.includes(t.beer))) continue;
    const left = t.pctLeft != null ? `${Math.max(0, Math.round(t.pctLeft * 100))}% left` : "nearly out";
    tonight.push({
      key: `tap-${t.line}`,
      kind: "kegs",
      title: `${t.beer} is almost gone`,
      detail: `Line ${t.line} · ${left} · ${t.backups > 0 ? `${t.backups} full behind it` : "nothing full behind it"}`,
      href: "/kegs/taps",
      tone: t.backups > 0 ? "neutral" : "warn",
    });
  }
  // Sales items Ops linked to recipes overnight: worth a glance, and one tap to undo.
  const auto = (await recentAutoLinks(1).catch(() => [])).flatMap((r) => r.items);
  if (auto.length) {
    const names = auto.slice(0, 3).map((i) => i.name.split(" · ")[0]);
    tonight.push({ key: "linking.auto", kind: "other", title: `Ops linked ${auto.length} sales item${auto.length === 1 ? "" : "s"} to recipes`, detail: `${[...new Set(names)].join(", ")}${auto.length > 3 ? " and more" : ""} · check or undo on Link your sales`, href: "/sales/link#auto", tone: "neutral" });
  }
  const toneRank = { bad: 0, warn: 1, neutral: 2 } as const;
  const kindRank: Record<TonightItem["kind"], number> = { deadline: 0, draft: 1, checkin: 2, invoices: 3, kegs: 4, brewery: 4, schedule: 5, requests: 6, certs: 7, reviews: 8, other: 9 };
  tonight.sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || kindRank[a.kind] - kindRank[b.kind]);

  return {
    today,
    yesterday,
    weekdayName: FULL_DAY[weekday(today)],
    monday,
    sendHour,
    y,
    day: {
      closed,
      forecast: forecast?.qty ?? null,
      orders: forecast?.orders ?? null,
      range: range ? { low: range.low, high: range.high } : null,
      hours: forecast?.hours ?? [],
      busy,
      weather,
      events,
      reason: drivers?.reason ?? null,
    },
    /** Booked private events (deposit paid or confirmed) today and tomorrow. */
    parties: {
      today: parties.filter((p) => p.date === today).map(party),
      tomorrow: parties.filter((p) => p.date !== today).map(party),
    },
    crew,
    tonight,
    notes,
    prep: hasPrep,
    /** Today's prep in a few numbers (null when the prep list isn't available or failed). */
    prepToday: prep,
    wrap,
  };
}

export type MorningBrief = Awaited<ReturnType<typeof morningBrief>>;

/** Monday: last Mon–Sun in a few lines. */
async function lastWeekWrap(today: ISODate, now: Date) {
  const from = addDays(mondayOf(today), -7);
  const to = addDays(from, 7);
  const [r, prev] = await Promise.all([pnlReport(from, to, now), periodKpis(addDays(from, -7), from).catch(() => null)]);
  const finished = r.days.filter((d) => d.date < today);
  const days = finished.map((d) => ({ date: d.date, sales: d.sales, forecast: d.forecast, profit: d.sales > 0 ? bridge(d).profit : null }));
  const states = await dayStates(finished);
  const notIn = [...states.values()].filter((s) => s === "notIn").length;
  return weekWrap({ from, days, labor: r.total.labor, budget: r.budget?.sales ?? null, prevSales: prev?.total.sales ?? null, notIn });
}
