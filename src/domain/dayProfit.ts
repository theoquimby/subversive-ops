/**
 * Profit by open day: what a typical Monday, Wednesday… leaves once food,
 * drink, wages and card fees are paid, whether opening it is worth it, and
 * which hours of it earn their wages. Pure: no I/O and no formatting beyond
 * the sentences of the summary.
 *
 * Rent and other fixed costs are deliberately left out of "what a day leaves":
 * they're owed whether the door opens or not, so a day is worth opening as
 * soon as it leaves more than nothing. They come back as a yardstick ("its
 * share of the rent") and nothing more.
 */

import { daysBetween, ISODate, parseISODate, weekday } from "./dates";

/** Bump when the method changes, so a kept copy is worked out again. */
export const DAY_PROFIT_RULES = 1;

/** A weekday needs this many open days in the year to be shown, and this many to be compared and advised on. */
const SHOWN_DAYS = 8;
const REGULAR_DAYS = 26;
/** A weekday in one season needs this many open days before its average means anything. */
const SEASON_DAYS = 5;
/** "Only just": the day loses money one time in three, or keeps under this share of its sales. */
const THIN_LOSS_SHARE = 1 / 3;
const THIN_MARGIN = 0.08;
/** An hour counts as trading when it brings at least this share of the day's sales. */
const TRADING_SHARE = 0.03;
/** Closing early is only suggested for the last hour or two, and only when they lose at least this much a day. */
const LATE_HOURS = 2;
const LATE_MIN_LOSS = 10;

export const SEASONS = ["Winter", "Spring", "Summer", "Autumn"] as const;
/** Dec to Feb is winter (0), then spring, summer, autumn. */
export const seasonOf = (date: ISODate): number => Math.floor(((parseISODate(date).getUTCMonth() + 1) % 12) / 3);

export interface ProfitDayInput {
  date: ISODate;
  sales: number;
  /** Food and drink cost: counted from recipes, plus the estimate for sales with no recipe behind them. */
  goods: number;
  /** Wages on the clock that day, with employer taxes. */
  labor: number;
  /** Card fees; null when Square hasn't given them for the day (they're then estimated at the usual rate). */
  fees: number | null;
}

export interface OpenDay {
  date: ISODate;
  wd: number;
  sales: number;
  goods: number;
  labor: number;
  fees: number;
  /** Sales less food, drink, wages and card fees. */
  left: number;
}

export type DayVerdict = "pays" | "thin" | "loses";

export interface WeekdayProfit {
  /** 0 = Sunday. */
  wd: number;
  openDays: number;
  /** Open most weeks: enough days to compare and advise on. */
  regular: boolean;
  /** A typical open day. */
  sales: number;
  goods: number;
  labor: number;
  fees: number;
  left: number;
  /** Days that left less than nothing. */
  lostDays: number;
  laborPct: number | null;
  /** Everything this weekday left over the period. */
  yearLeft: number;
  /** The sales a day needs to cover its crew, at this weekday's own food and drink cost. */
  breakEven: number | null;
  /**
   * How much of the day's sales would have to turn up on other days instead for closing it to pay.
   * 0 when the day already loses money; null with no sales.
   */
  moveShare: number | null;
  verdict: DayVerdict;
  /** Leaves at least its share of rent and fixed costs; null when those aren't set. */
  coversFixed: boolean | null;
}

export interface SeasonCell {
  wd: number;
  season: number;
  openDays: number;
  /** A typical open day's left-over; null with too few days to say. */
  left: number | null;
}

export interface DayProfit {
  from: ISODate | null;
  to: ISODate | null;
  /** Every open day, oldest first. */
  days: OpenDay[];
  /** Monday first; only weekdays open often enough to show. */
  weekdays: WeekdayProfit[];
  /** Regular weekdays by season. */
  seasons: SeasonCell[];
  /** A typical open day, any weekday. */
  typical: { openDays: number; sales: number; goods: number; labor: number; fees: number; left: number } | null;
  /** Card fees as a share of sales on the days Square gave them; null when it gave none. */
  feeRate: number | null;
  /** Open days whose card fees are an estimate. */
  feesEstimated: number;
  /** Wages on days the place wasn't open (prep, cleaning, brewing): in no weekday's figures. */
  closedLabor: { days: number; total: number };
  fixedMonthly: number | null;
  /** Rent and fixed costs spread over the days the place opens in a year. */
  fixedPerOpenDay: number | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

export function dayProfit(i: { days: readonly ProfitDayInput[]; open: ReadonlySet<ISODate>; fixedMonthly?: number | null }): DayProfit {
  const input = [...i.days].sort((a, b) => a.date.localeCompare(b.date));
  const known = input.filter((d) => i.open.has(d.date) && d.fees != null && d.sales > 0);
  const feeRate = known.length ? sum(known.map((d) => d.fees!)) / sum(known.map((d) => d.sales)) : null;

  const days: OpenDay[] = [];
  let feesEstimated = 0;
  const closedLabor = { days: 0, total: 0 };
  for (const d of input) {
    if (!i.open.has(d.date)) {
      if (d.labor > 0) {
        closedLabor.days++;
        closedLabor.total += d.labor;
      }
      continue;
    }
    if (d.fees == null) feesEstimated++;
    const fees = d.fees ?? d.sales * (feeRate ?? 0);
    days.push({ date: d.date, wd: weekday(d.date), sales: d.sales, goods: d.goods, labor: d.labor, fees, left: d.sales - d.goods - d.labor - fees });
  }

  const span = input.length ? daysBetween(input[0].date, input[input.length - 1].date) + 1 : 0;
  const fixedMonthly = i.fixedMonthly != null && i.fixedMonthly > 0 ? i.fixedMonthly : null;
  const openPerYear = span > 0 ? (days.length * 365) / span : 0;
  const fixedPerOpenDay = fixedMonthly != null && openPerYear > 0 ? (fixedMonthly * 12) / openPerYear : null;

  const weekdays: WeekdayProfit[] = [];
  const seasons: SeasonCell[] = [];
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
    const ds = days.filter((d) => d.wd === wd);
    if (ds.length < SHOWN_DAYS) continue;
    const sales = avg(ds.map((d) => d.sales));
    const goods = avg(ds.map((d) => d.goods));
    const labor = avg(ds.map((d) => d.labor));
    const fees = avg(ds.map((d) => d.fees));
    const left = sales - goods - labor - fees;
    const lostDays = ds.filter((d) => d.left < 0).length;
    const keepRate = sales > 0 ? 1 - (goods + fees) / sales : 0;
    const regular = ds.length >= REGULAR_DAYS;
    weekdays.push({
      wd,
      openDays: ds.length,
      regular,
      sales,
      goods,
      labor,
      fees,
      left,
      lostDays,
      laborPct: sales > 0 ? labor / sales : null,
      yearLeft: sum(ds.map((d) => d.left)),
      breakEven: keepRate > 0 ? labor / keepRate : null,
      moveShare: sales <= 0 ? null : left <= 0 ? 0 : left / (left + labor),
      verdict: left < 0 ? "loses" : lostDays / ds.length >= THIN_LOSS_SHARE || left < THIN_MARGIN * sales ? "thin" : "pays",
      coversFixed: fixedPerOpenDay == null ? null : left >= fixedPerOpenDay,
    });
    if (regular) {
      for (let season = 0; season < 4; season++) {
        const ss = ds.filter((d) => seasonOf(d.date) === season);
        seasons.push({ wd, season, openDays: ss.length, left: ss.length >= SEASON_DAYS ? avg(ss.map((d) => d.left)) : null });
      }
    }
  }

  return {
    from: input[0]?.date ?? null,
    to: input[input.length - 1]?.date ?? null,
    days,
    weekdays,
    seasons,
    typical: days.length
      ? { openDays: days.length, sales: avg(days.map((d) => d.sales)), goods: avg(days.map((d) => d.goods)), labor: avg(days.map((d) => d.labor)), fees: avg(days.map((d) => d.fees)), left: avg(days.map((d) => d.left)) }
      : null,
    feeRate,
    feesEstimated,
    closedLabor,
    fixedMonthly,
    fixedPerOpenDay,
  };
}

// ---- Hour by hour ------------------------------------------------------------------------------

export interface HourInput {
  date: ISODate;
  /** Business-local hour, 0 to 23. */
  hour: number;
  sales: number;
  labor: number;
}

export interface HourCell {
  hour: number;
  /** A typical open day's sales in this hour, what's left of them after food, drink and card fees, and the wages on the clock. */
  sales: number;
  kept: number;
  labor: number;
  left: number;
  /** The hour brings a real share of the day's sales (not setting up or closing down). */
  trading: boolean;
}

export interface WeekdayHours {
  wd: number;
  hours: HourCell[];
  /** The closing hour or two, when they cost more in wages than their sales leave. */
  late: { from: number; hours: number; sales: number; labor: number; left: number; yearLeft: number } | null;
}

/** Each regular weekday hour by hour, over its open days. */
export function hourProfit(rows: readonly HourInput[], p: DayProfit): WeekdayHours[] {
  const wdOf = new Map(p.days.map((d) => [d.date, d.wd]));
  const out: WeekdayHours[] = [];
  for (const w of p.weekdays.filter((x) => x.regular)) {
    const keepRate = w.sales > 0 ? 1 - (w.goods + w.fees) / w.sales : 0;
    const sales = new Array<number>(24).fill(0);
    const labor = new Array<number>(24).fill(0);
    for (const r of rows) {
      if (wdOf.get(r.date) !== w.wd || r.hour < 0 || r.hour > 23) continue;
      sales[r.hour] += r.sales;
      labor[r.hour] += r.labor;
    }
    const cells: HourCell[] = sales.map((s, hour) => {
      const perDay = s / w.openDays;
      const kept = perDay * keepRate;
      const wages = labor[hour] / w.openDays;
      return { hour, sales: perDay, kept, labor: wages, left: kept - wages, trading: w.sales > 0 && perDay >= w.sales * TRADING_SHARE };
    });
    const busy = cells.filter((c) => c.sales >= 1 || c.labor >= 1);
    if (!busy.length || !cells.some((c) => c.trading)) continue;
    const hours = cells.slice(busy[0].hour, busy[busy.length - 1].hour + 1);
    // Walk back from the last trading hour while the hours lose money.
    const trading = hours.filter((c) => c.trading);
    const tail: HourCell[] = [];
    for (let k = trading.length - 1; k >= 0 && tail.length < LATE_HOURS && trading[k].left < 0; k--) tail.unshift(trading[k]);
    const lost = -sum(tail.map((c) => c.left));
    const late =
      tail.length && tail.length < trading.length && lost >= LATE_MIN_LOSS
        ? { from: tail[0].hour, hours: tail.length, sales: sum(tail.map((c) => c.sales)), labor: sum(tail.map((c) => c.labor)), left: -lost, yearLeft: -lost * w.openDays }
        : null;
    out.push({ wd: w.wd, hours, late });
  }
  return out;
}

// ---- What it says ------------------------------------------------------------------------------

export interface ProfitPoint {
  key: "weakest" | "season" | "hours" | "labor" | "rent" | "closed";
  tone: "good" | "warn" | "bad" | "neutral";
  title: string;
  detail: string;
  action: string | null;
}

export interface ProfitStory {
  level: "good" | "warn" | "bad";
  headline: string;
  line: string;
  points: ProfitPoint[];
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const pc = (x: number) => `${Math.round(x * 100)}%`;
/** Dollars as an owner would say them: to the nearest ten under a thousand, nearest hundred above. */
export const about = (x: number) => {
  const a = Math.abs(x);
  const r = a >= 10_000 ? Math.round(a / 1000) * 1000 : a >= 1000 ? Math.round(a / 100) * 100 : Math.round(a / 10) * 10;
  return `${x < 0 ? "−" : ""}$${r.toLocaleString("en-US")}`;
};
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

/** Enough open days to say anything. */
export const STORY_MIN_DAYS = 60;

export function dayProfitStory(p: DayProfit, hours: readonly WeekdayHours[] = []): ProfitStory | null {
  const regular = p.weekdays.filter((w) => w.regular);
  if (!p.typical || p.days.length < STORY_MIN_DAYS || regular.length < 2) return null;
  const plural = (w: WeekdayProfit) => `${DAY_NAMES[w.wd]}s`;
  const byLeft = [...regular].sort((a, b) => a.left - b.left);
  const worst = byLeft[0];
  const best = byLeft[byLeft.length - 1];
  const losing = regular.filter((w) => w.verdict === "loses");
  const thin = regular.filter((w) => w.verdict === "thin");

  const level = losing.length ? "bad" : thin.length ? "warn" : "good";
  const headline = losing.length
    ? `${listOf(losing.map(plural))} cost more to open than they bring in`
    : thin.length
      ? `Every day you open pays for itself, but ${listOf(thin.map(plural))} only just`
      : "Every day you open pays for itself";
  const line = `Over the last 12 months a typical open day took ${about(p.typical.sales)} and left ${about(p.typical.left)} once food, drink, wages and card fees were paid. A ${DAY_NAMES[best.wd]} leaves about ${about(best.left)}; a ${DAY_NAMES[worst.wd]} ${worst.left < 0 ? `loses about ${about(-worst.left)}` : `about ${about(worst.left)}`}.`;

  const points: ProfitPoint[] = [];
  const costs = worst.goods + worst.labor + worst.fees;
  points.push({
    key: "weakest",
    tone: worst.verdict === "loses" ? "bad" : worst.verdict === "thin" ? "warn" : "good",
    title: worst.left < 0 ? `A typical ${DAY_NAMES[worst.wd]} loses about ${about(-worst.left)}` : `A typical ${DAY_NAMES[worst.wd]} leaves about ${about(worst.left)}, your thinnest day`,
    detail: `It takes ${about(worst.sales)}; food, drink, wages and card fees come to ${about(costs)}. ${worst.lostDays} of the last ${worst.openDays} ${plural(worst)} lost money.`,
    action:
      worst.left < 0
        ? `Closing ${plural(worst)} would save about ${about(-worst.yearLeft)} a year even if nobody came another day instead. A shorter ${DAY_NAMES[worst.wd]} is the smaller step to try first.`
        : `Over the year ${plural(worst)} added about ${about(worst.yearLeft)} towards rent. Closing would only pay if more than ${pc(worst.moveShare ?? 0)} of ${DAY_NAMES[worst.wd]}'s sales turned up on other days instead${(worst.moveShare ?? 0) >= 0.25 ? ", which is a lot to count on" : ""}. Keep it open.`,
  });

  const cold = p.seasons.filter((c) => c.left != null && c.left < 0).sort((a, b) => a.left! - b.left!);
  if (cold.length) {
    const c = cold[0];
    const names = listOf(cold.slice(0, 3).map((x) => `${DAY_NAMES[x.wd]}s in ${SEASONS[x.season].toLowerCase()}`));
    points.push({
      key: "season",
      tone: "warn",
      title: `${names} lose money`,
      detail: `A ${SEASONS[c.season].toLowerCase()} ${DAY_NAMES[c.wd]} loses about ${about(-c.left!)} on average (${c.openDays} of them in the year). The same weekday pays its way in other seasons, so it's the season, not the day.`,
      action: `Closing or shortening just those days for the season is a smaller step than giving up the weekday all year.`,
    });
  }

  const late = [...hours].filter((h) => h.late).sort((a, b) => a.late!.yearLeft - b.late!.yearLeft)[0];
  if (late?.late) {
    const l = late.late;
    points.push({
      key: "hours",
      tone: "warn",
      title: `The last ${l.hours === 1 ? "hour" : "two hours"} of a ${DAY_NAMES[late.wd]} cost${l.hours === 1 ? "s" : ""} more in wages than ${l.hours === 1 ? "it brings" : "they bring"} in`,
      detail: `From ${hourLabel(l.from)} a typical ${DAY_NAMES[late.wd]} takes ${about(l.sales)} and has ${about(l.labor)} of wages on the clock. After food and drink that's about ${about(-l.left)} lost each time.`,
      action: `Closing at ${hourLabel(l.from)} on ${DAY_NAMES[late.wd]}s would be worth about ${about(-l.yearLeft)} a year, less whatever those guests would have spent earlier. Some of that last hour is closing-up, which moves earlier with it.`,
    });
  }

  const byLabor = regular.filter((w) => w.laborPct != null).sort((a, b) => b.laborPct! - a.laborPct!);
  if (byLabor.length >= 2) {
    const hi = byLabor[0];
    const lo = byLabor[byLabor.length - 1];
    if (hi.laborPct! - lo.laborPct! >= 0.08) {
      points.push({
        key: "labor",
        tone: hi.laborPct! >= 0.4 ? "warn" : "neutral",
        title: `Wages take ${pc(hi.laborPct!)} of sales on a ${DAY_NAMES[hi.wd]} and ${pc(lo.laborPct!)} on a ${DAY_NAMES[lo.wd]}`,
        detail: `A ${DAY_NAMES[hi.wd]} has about ${about(hi.labor)} of wages on the clock whether it's busy or not.${hi.breakEven != null ? ` It needs about ${about(hi.breakEven)} in sales to cover them; ${hi.openDays - hi.lostDays} of ${hi.openDays} got there.` : ""}`,
        action: `The crew is the one cost you set in advance. On a ${DAY_NAMES[hi.wd]} forecast under ${hi.breakEven != null ? about(hi.breakEven) : "that"}, schedule one fewer person or a later start.`,
      });
    }
  }

  if (p.fixedPerOpenDay != null && p.fixedMonthly != null) {
    const cover = regular.filter((w) => w.coversFixed);
    points.push({
      key: "rent",
      tone: "neutral",
      title: cover.length === regular.length ? "Every weekday covers its share of the rent" : cover.length ? `${listOf(cover.map(plural))} pay the rent; the other days chip in` : "No weekday covers its share of the rent on its own",
      detail: `Rent and fixed costs are ${about(p.fixedMonthly)} a month, about ${about(p.fixedPerOpenDay)} for each day you open, and they're owed whether you open or not.`,
      action: cover.length === regular.length ? null : "That's the usual shape: the weekend carries the rent. A weekday doesn't have to; it only has to leave more than nothing to be worth opening.",
    });
  }

  if (p.closedLabor.days >= 5 && p.closedLabor.total > 0) {
    points.push({
      key: "closed",
      tone: "neutral",
      title: `${about(p.closedLabor.total)} of wages fell on days you were closed`,
      detail: `${p.closedLabor.days} closed days had people on the clock: prep, cleaning, brewing, deliveries. That work serves the open days but isn't counted against any of them here.`,
      action: null,
    });
  }

  return { level, headline, line, points };
}
