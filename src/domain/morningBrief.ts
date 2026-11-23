/**
 * The morning brief: yesterday in one line, today's busy hours and crew,
 * when to send it, and Monday's weekly wrap. Pure: no I/O and no money
 * formatting beyond whole dollars in the one-liners (the page and the email
 * share these words).
 */

import { addDays, ISODate, weekday } from "./dates";
import type { HourDemand } from "./schedule";

// ---- Words ------------------------------------------------------------------------------

const whole = (n: number) => `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const pts = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** 17 → "5pm", 0 → "12am", 12 → "12pm". */
export function hourLabel(h: number): string {
  const x = ((h % 24) + 24) % 24;
  return `${x % 12 === 0 ? 12 : x % 12}${x < 12 ? "am" : "pm"}`;
}

/** [17, 20) → "5–8pm"; [11, 14) → "11am–2pm". */
export function hourRange(from: number, toExclusive: number): string {
  const a = hourLabel(from);
  const b = hourLabel(toExclusive);
  const sameHalf = (from < 12) === (toExclusive % 24 < 12) && toExclusive % 24 !== 0;
  return sameHalf ? `${a.replace(/[ap]m$/, "")}–${b}` : `${a}–${b}`;
}

// ---- Yesterday --------------------------------------------------------------------------

export interface YesterdayInput {
  sales: number;
  /** Forecast for the day as it stood the evening before. */
  forecast: number | null;
  labor: number;
  laborTarget: number | null;
  /** Sales − cost of goods − labor (estimate, before fixed costs). */
  profit: number | null;
  /** Shift notes from that night. */
  notes?: { eightySixed: number; compsAmount: number; cashOverShort: number | null; issues: number; maintenance: number };
  /** The biggest hour compared with the forecast's shape, if it stood out. */
  peak?: { hour: number; sales: number } | null;
}

export type Tone = "good" | "warn" | "bad" | "neutral";

export interface YesterdayFlag {
  key: string;
  text: string;
  tone: Tone;
}

export interface YesterdaySummary {
  closed: boolean;
  /** One sentence: "$4,210 in sales, 8% over forecast. Labor 24%, about $1,380 profit." */
  line: string;
  vsForecast: number | null;
  laborPct: number | null;
  tone: Tone;
  /** Anything unusual, most important first (at most 4). */
  flags: YesterdayFlag[];
}

/** How far off the forecast counts as worth a mention, and labor over target. */
export const UNUSUAL = { forecast: 0.15, laborPts: 0.03, cashShort: 5 } as const;

export function yesterdaySummary(y: YesterdayInput): YesterdaySummary {
  if (y.sales <= 0) {
    return { closed: true, line: "Closed, or no sales came through from Square.", vsForecast: null, laborPct: null, tone: "neutral", flags: [] };
  }
  const vs = y.forecast && y.forecast > 0 ? y.sales / y.forecast - 1 : null;
  const laborPct = y.labor > 0 ? y.labor / y.sales : null;
  const parts: string[] = [];
  let first = `${whole(y.sales)} in sales`;
  if (vs != null) first += Math.abs(vs) < 0.03 ? ", right on forecast" : `, ${pts(Math.abs(vs))} ${vs > 0 ? "over" : "under"} forecast`;
  parts.push(`${first}.`);
  const second: string[] = [];
  if (laborPct != null) second.push(`Labor ${pts(laborPct)}${y.laborTarget != null ? ` (target ${pts(y.laborTarget)})` : ""}`);
  if (y.profit != null) second.push(y.profit >= 0 ? `about ${whole(y.profit)} profit` : `about ${whole(-y.profit)} lost after food and labor`);
  if (second.length) {
    const t = second.join(", ");
    parts.push(`${t[0].toUpperCase()}${t.slice(1)}.`);
  }

  const flags: YesterdayFlag[] = [];
  if (vs != null && Math.abs(vs) >= UNUSUAL.forecast) flags.push({ key: "forecast", text: vs > 0 ? `Busier than expected: ${whole(y.sales - y.forecast!)} over forecast` : `Quieter than expected: ${whole(y.forecast! - y.sales)} under forecast`, tone: vs > 0 ? "good" : "warn" });
  if (laborPct != null && y.laborTarget != null && laborPct - y.laborTarget >= UNUSUAL.laborPts) flags.push({ key: "labor", text: `Labor ran ${Math.round((laborPct - y.laborTarget) * 100)} points over target`, tone: "warn" });
  if (y.profit != null && y.profit < 0) flags.push({ key: "loss", text: "Lost money once food and labor were paid", tone: "bad" });
  const n = y.notes;
  if (n) {
    if (n.cashOverShort != null && n.cashOverShort <= -UNUSUAL.cashShort) flags.push({ key: "cash", text: `Drawer ${whole(-n.cashOverShort)} short`, tone: "bad" });
    if (n.eightySixed > 0) flags.push({ key: "86", text: `${plural(n.eightySixed, "item")} 86'd`, tone: "warn" });
    if (n.compsAmount > 0) flags.push({ key: "comps", text: `${whole(n.compsAmount)} in comps`, tone: "neutral" });
    if (n.maintenance > 0) flags.push({ key: "maintenance", text: `${plural(n.maintenance, "maintenance note")}`, tone: "warn" });
  }
  const rank: Record<Tone, number> = { bad: 0, warn: 1, good: 2, neutral: 3 };
  flags.sort((a, b) => rank[a.tone] - rank[b.tone]);
  const tone: Tone = flags.some((f) => f.tone === "bad") ? "bad" : flags.some((f) => f.tone === "warn") ? "warn" : vs != null && vs >= 0.03 ? "good" : "neutral";
  return { closed: false, line: parts.join(" "), vsForecast: vs, laborPct, tone, flags: flags.slice(0, 4) };
}

// ---- Today ------------------------------------------------------------------------------

export interface BusyWindow {
  from: number;
  toExclusive: number;
  /** Share of the day's forecast in the window. */
  share: number;
  peak: number;
  label: string;
}

/**
 * The busiest stretch of the day: the `width`-hour window (default 3) with the
 * most forecast sales. Null when nothing is forecast.
 */
export function busyWindow(hours: readonly number[], width = 3): BusyWindow | null {
  const total = hours.reduce((s, x) => s + Math.max(0, x), 0);
  if (total <= 0) return null;
  const w = Math.max(1, Math.min(width, hours.length));
  let best = -1;
  let bestFrom = 0;
  for (let h = 0; h + w <= hours.length; h++) {
    let s = 0;
    for (let k = h; k < h + w; k++) s += Math.max(0, hours[k]);
    if (s > best) {
      best = s;
      bestFrom = h;
    }
  }
  let peak = bestFrom;
  for (let k = bestFrom; k < bestFrom + w; k++) if (hours[k] > hours[peak]) peak = k;
  return { from: bestFrom, toExclusive: bestFrom + w, share: best / total, peak, label: hourRange(bestFrom, bestFrom + w) };
}

/** The first and last hours with any forecast or anyone on (for the strip). */
export function activeSpan(hours: readonly number[], also: readonly number[] = []): [number, number] | null {
  const on = (h: number) => (hours[h] ?? 0) > 0 || (also[h] ?? 0) > 0;
  let a = -1;
  let b = -1;
  for (let h = 0; h < 24; h++) if (on(h)) {
    if (a < 0) a = h;
    b = h;
  }
  return a < 0 ? null : [a, b + 1];
}

export interface CrewGap {
  from: number;
  toExclusive: number;
  /** Most people short (positive) or over (negative) in the stretch. */
  diff: number;
}

export interface CrewCheck {
  /** Most people needed at once / most on at once. */
  needPeak: number;
  havePeak: number;
  short: CrewGap[];
  over: CrewGap[];
  tone: Tone;
  line: string;
}

/**
 * Scheduled crew against what the forecast needs, hour by hour (the schedule
 * page's demand strip). Stretches short by a whole person or more, or two or
 * more over, are called out.
 */
export function crewCheck(demand: readonly HourDemand[]): CrewCheck {
  const needPeak = Math.max(0, ...demand.map((d) => Math.ceil(d.need - 1e-9)));
  const havePeak = Math.max(0, ...demand.map((d) => d.have));
  const runs = (pred: (gap: number) => boolean): CrewGap[] => {
    const out: CrewGap[] = [];
    let cur: CrewGap | null = null;
    for (const d of demand) {
      const gap = Math.ceil(d.need - 1e-9) - d.have;
      if (pred(gap)) {
        if (cur && cur.toExclusive === d.hour) {
          cur.toExclusive = d.hour + 1;
          cur.diff = Math.abs(gap) > Math.abs(cur.diff) ? gap : cur.diff;
        } else {
          cur = { from: d.hour, toExclusive: d.hour + 1, diff: gap };
          out.push(cur);
        }
      } else cur = null;
    }
    return out;
  };
  const short = runs((g) => g >= 1);
  const over = runs((g) => g <= -2);
  let line: string;
  let tone: Tone = "good";
  if (demand.length === 0 || (needPeak === 0 && havePeak === 0)) {
    line = "No shifts on the schedule for today.";
    tone = "neutral";
  } else if (havePeak === 0) {
    line = `Nobody is scheduled yet. The forecast needs up to ${plural(needPeak, "person", "people")} at once.`;
    tone = "bad";
  } else if (short.length) {
    const worst = short.reduce((a, b) => (b.diff > a.diff ? b : a));
    line = `Short ${worst.diff === 1 ? "one person" : `${worst.diff} people`} ${hourRange(worst.from, worst.toExclusive)}${short.length > 1 ? ` and ${plural(short.length - 1, "other stretch", "other stretches")}` : ""}.`;
    tone = "warn";
  } else if (over.length) {
    const worst = over.reduce((a, b) => (b.diff < a.diff ? b : a));
    line = `Covered, with ${-worst.diff} more than the forecast needs ${hourRange(worst.from, worst.toExclusive)}.`;
    tone = "neutral";
  } else line = "The crew matches what the forecast needs.";
  return { needPeak, havePeak, short, over, tone, line };
}

// ---- When to send -----------------------------------------------------------------------

/** Local hours Max can pick for the morning brief (the crons cover these in summer and winter time). */
export const MORNING_HOURS = [7, 8, 9, 10, 11] as const;
export const DEFAULT_MORNING_HOUR = 9;
/** A run that was missed (deploy, outage) still goes out up to this many hours late. */
export const CATCH_UP_HOURS = 2;

export function parseMorningHour(raw: string | null | undefined): number {
  const n = Number(raw);
  return (MORNING_HOURS as readonly number[]).includes(n) ? n : DEFAULT_MORNING_HOUR;
}

/**
 * Whether the scheduled job should send today's brief now: at or after the
 * chosen local hour (within the catch-up window) and not already sent today.
 */
export function morningDue(a: { today: ISODate; localHour: number; sendHour: number; lastSent: ISODate | null }): boolean {
  if (a.lastSent === a.today) return false;
  return a.localHour >= a.sendHour && a.localHour <= a.sendHour + CATCH_UP_HOURS;
}

// ---- Monday: the week that was ------------------------------------------------------------

export interface WrapDay {
  date: ISODate;
  sales: number;
  forecast: number | null;
  profit: number | null;
}

export interface WeekWrap {
  from: ISODate;
  to: ISODate;
  sales: number;
  profit: number | null;
  laborPct: number | null;
  budget: number | null;
  vsBudget: number | null;
  vsPrev: number | null;
  best: { date: ISODate; sales: number } | null;
  /** Finished days whose sales haven't come in yet (domain/dayState); the comparisons wait for them. */
  notIn: number;
  lines: string[];
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Monday's short wrap of the week before (Mon–Sun). */
export function weekWrap(i: { from: ISODate; days: WrapDay[]; labor: number; budget: number | null; prevSales: number | null; notIn?: number }): WeekWrap {
  const notIn = i.notIn ?? 0;
  const open = i.days.filter((d) => d.sales > 0);
  const sales = open.reduce((s, d) => s + d.sales, 0);
  const profits = open.filter((d) => d.profit != null);
  const profit = profits.length ? profits.reduce((s, d) => s + d.profit!, 0) : null;
  const laborPct = sales > 0 && i.labor > 0 ? i.labor / sales : null;
  // A part-week against a whole-week budget isn't a finding: hold the comparisons until every day is in.
  const vsBudget = !notIn && i.budget && i.budget > 0 && sales > 0 ? sales / i.budget - 1 : null;
  const vsPrev = !notIn && i.prevSales && i.prevSales > 0 && sales > 0 ? sales / i.prevSales - 1 : null;
  const best = open.length ? open.reduce((a, b) => (b.sales > a.sales ? b : a)) : null;
  const lines: string[] = [];
  if (sales <= 0) lines.push(notIn ? "Last week's sales aren't in yet." : "No sales came through for last week.");
  else if (notIn) {
    lines.push(`${whole(sales)} in sales so far, with ${notIn === 1 ? "one day" : `${notIn} days`} not in yet. The comparison with budget waits for the rest.`);
  } else {
    const vs = vsBudget != null ? `, ${pts(Math.abs(vsBudget))} ${vsBudget >= 0 ? "over" : "under"} budget` : vsPrev != null ? `, ${pts(Math.abs(vsPrev))} ${vsPrev >= 0 ? "up on" : "down on"} the week before` : "";
    lines.push(`${whole(sales)} in sales${vs}.`);
    const second: string[] = [];
    if (laborPct != null) second.push(`labor ${pts(laborPct)}`);
    if (profit != null) second.push(profit >= 0 ? `about ${whole(profit)} profit before fixed costs` : `about ${whole(-profit)} lost before fixed costs`);
    if (second.length) lines.push(`${second[0][0].toUpperCase()}${second.join(", ").slice(1)}.`);
    if (best && open.length >= 3) lines.push(`Best day: ${DAY[weekday(best.date)]}, ${whole(best.sales)}.`);
  }
  return { from: i.from, to: addDays(i.from, 6), sales, profit, laborPct, budget: i.budget, vsBudget, vsPrev, best: best ? { date: best.date, sales: best.sales } : null, notIn, lines };
}

/** The Monday edition carries the weekly wrap. */
export const isMondayEdition = (today: ISODate) => weekday(today) === 1;

// ---- Push ---------------------------------------------------------------------------------

/** The phone notification: a headline and one line under it (≤ 180 chars). */
export function morningPush(b: { weekdayName: string; forecast: number | null; busy: string | null; tonight: number; yesterday: string | null; closed: boolean }): { title: string; body: string } {
  const title = b.closed ? `${b.weekdayName}: closed today` : b.forecast && b.forecast > 0 ? `${b.weekdayName}: ${whole(b.forecast)} forecast${b.busy ? `, busiest ${b.busy}` : ""}` : `Your ${b.weekdayName} brief`;
  const bits = [b.yesterday ? `Yesterday ${b.yesterday}` : "", b.tonight ? `${plural(b.tonight, "thing")} before tonight` : "Nothing urgent before tonight"].filter(Boolean);
  const body = bits.join(" · ");
  return { title, body: body.length > 180 ? `${body.slice(0, 177)}…` : body };
}

// ---- The short list ---------------------------------------------------------------------

/** How many "before tonight" lines the brief lists; the rest wait on the Overview. */
export const TONIGHT_MAX = 5;

const SMALL = new Set(["&", "of", "and", "the", "de"]);
const MONTHS = new Set(
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december"],
);

/**
 * What a line is about, as a name: the last two words of its longest run of
 * capitalised words ("Brew Golden Lager as soon as you can" and "Golden Lager
 * runs out" are both "golden lager"). Null when the line names nothing.
 */
export function subjectOf(title: string): string | null {
  const words = title.replace(/[:;,.!?()]/g, " ").split(/\s+/).filter(Boolean);
  let best: string[] = [];
  let run: string[] = [];
  const flush = () => {
    while (run.length && SMALL.has(run.at(-1)!.toLowerCase())) run.pop();
    if (run.length > best.length) best = run;
    run = [];
  };
  for (const w of words) {
    const named = /^[A-Z][a-z'’]/.test(w) && !/\d/.test(w) && !MONTHS.has(w.toLowerCase());
    if (named || (run.length > 0 && SMALL.has(w.toLowerCase()))) run.push(w);
    else flush();
  }
  flush();
  if (best.length < 2) return null;
  return best.slice(-2).join(" ").toLowerCase().replace(/['’]s$/, "");
}

/** The first line per subject, in order; lines that name nothing are all kept. `seen` holds subjects already on the page. */
export function dedupeBySubject<T extends { title: string }>(items: readonly T[], seen: Set<string> = new Set()): T[] {
  const out: T[] = [];
  for (const it of items) {
    const s = subjectOf(it.title);
    if (s && seen.has(s)) continue;
    if (s) seen.add(s);
    out.push(it);
  }
  return out;
}
