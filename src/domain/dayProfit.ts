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
export const DAY_PROFIT_RULES = 4;

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
/**
 * A one-off: a day that took more than this many times what's usual for its weekday at that time of
 * year (the middle of the same weekday's open days within the window either side). A holiday, a
 * private event, a deposit rung through the till: real money, but not a typical Monday.
 */
export const ONE_OFF_TIMES = 2;
const ONE_OFF_WINDOW = 56;
const ONE_OFF_NEIGHBOURS = 4;
/** "Lately" is a weekday's last few open days: about two months of it. */
export const RECENT_DAYS = 8;
/** Lately counts as thinner when it leaves under this share of the year's average. */
const SLIPPING = 0.6;

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
  /** Far above what's usual for its weekday: left out of the typical-day figures, kept in the year's totals. */
  oneOff: boolean;
}

export type DayVerdict = "pays" | "thin" | "loses";

export interface WeekdayProfit {
  /** 0 = Sunday. */
  wd: number;
  /** The ordinary open days the typical day is worked out from, and the one-offs left out of it. */
  openDays: number;
  oneOffs: number;
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
  /** Everything this weekday left over the period, one-offs included. */
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
  /** Its last few open days: how many, what a typical one left, and how many lost money. */
  recent: { days: number; left: number; lost: number };
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
  /** A typical open day, any weekday (one-offs left out). */
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
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0;
};

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
    days.push({ date: d.date, wd: weekday(d.date), sales: d.sales, goods: d.goods, labor: d.labor, fees, left: d.sales - d.goods - d.labor - fees, oneOff: false });
  }
  // A day far above what's usual for its weekday at that time of year isn't a typical one.
  for (const wd of [0, 1, 2, 3, 4, 5, 6]) {
    const ds = days.filter((d) => d.wd === wd);
    for (const d of ds) {
      const near = ds.filter((x) => x !== d && Math.abs(daysBetween(x.date, d.date)) <= ONE_OFF_WINDOW).map((x) => x.sales);
      d.oneOff = near.length >= ONE_OFF_NEIGHBOURS && d.sales > median(near) * ONE_OFF_TIMES;
    }
  }

  const span = input.length ? daysBetween(input[0].date, input[input.length - 1].date) + 1 : 0;
  const fixedMonthly = i.fixedMonthly != null && i.fixedMonthly > 0 ? i.fixedMonthly : null;
  const openPerYear = span > 0 ? (days.length * 365) / span : 0;
  const fixedPerOpenDay = fixedMonthly != null && openPerYear > 0 ? (fixedMonthly * 12) / openPerYear : null;

  const weekdays: WeekdayProfit[] = [];
  const seasons: SeasonCell[] = [];
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
    const every = days.filter((d) => d.wd === wd);
    if (every.length < SHOWN_DAYS) continue;
    const ds = every.filter((d) => !d.oneOff);
    const sales = avg(ds.map((d) => d.sales));
    const goods = avg(ds.map((d) => d.goods));
    const labor = avg(ds.map((d) => d.labor));
    const fees = avg(ds.map((d) => d.fees));
    const left = sales - goods - labor - fees;
    const lostDays = ds.filter((d) => d.left < 0).length;
    const keepRate = sales > 0 ? 1 - (goods + fees) / sales : 0;
    const regular = every.length >= REGULAR_DAYS;
    const last = ds.slice(-RECENT_DAYS);
    weekdays.push({
      wd,
      openDays: ds.length,
      oneOffs: every.length - ds.length,
      regular,
      sales,
      goods,
      labor,
      fees,
      left,
      lostDays,
      laborPct: sales > 0 ? labor / sales : null,
      yearLeft: sum(every.map((d) => d.left)),
      breakEven: keepRate > 0 ? labor / keepRate : null,
      moveShare: sales <= 0 ? null : left <= 0 ? 0 : left / (left + labor),
      verdict: left < 0 ? "loses" : lostDays / ds.length >= THIN_LOSS_SHARE || left < THIN_MARGIN * sales ? "thin" : "pays",
      coversFixed: fixedPerOpenDay == null ? null : left >= fixedPerOpenDay,
      recent: { days: last.length, left: avg(last.map((d) => d.left)), lost: last.filter((d) => d.left < 0).length },
    });
    if (regular) {
      for (let season = 0; season < 4; season++) {
        const ss = ds.filter((d) => seasonOf(d.date) === season);
        seasons.push({ wd, season, openDays: ss.length, left: ss.length >= SEASON_DAYS ? avg(ss.map((d) => d.left)) : null });
      }
    }
  }

  const usual = days.filter((d) => !d.oneOff);
  return {
    from: input[0]?.date ?? null,
    to: input[input.length - 1]?.date ?? null,
    days,
    weekdays,
    seasons,
    typical: usual.length
      ? { openDays: usual.length, sales: avg(usual.map((d) => d.sales)), goods: avg(usual.map((d) => d.goods)), labor: avg(usual.map((d) => d.labor)), fees: avg(usual.map((d) => d.fees)), left: avg(usual.map((d) => d.left)) }
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
  const wdOf = new Map(p.days.filter((d) => !d.oneOff).map((d) => [d.date, d.wd]));
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
    // From the first person in to the last one out; a stray sale at an odd hour doesn't stretch the day.
    const busy = cells.filter((c) => c.labor >= 5 || c.sales >= w.sales * 0.01);
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

// ---- A scheduled crew against the forecast --------------------------------------------------

export interface CrewDayInput {
  date: ISODate;
  /** Forecast sales for the day. */
  sales: number;
  /** Scheduled wages for the day, with employer taxes, and the hours behind them. */
  cost: number;
  hours: number;
  /** A holiday, an event or an adjustment is in the forecast: recent ordinary days say nothing about it. */
  special?: boolean;
}

export interface CrewOutlook {
  date: ISODate;
  sales: number;
  /** The crew's cost: the shifts scheduled, or the weekday's usual wages when nothing is scheduled yet. */
  cost: number;
  usual: boolean;
  /** What the forecast leaves after food, drink and card fees. */
  kept: number;
  /** The sales the day needs for that to cover the crew. */
  needs: number;
  /** Wages over what the forecast leaves (negative when there's room to spare), and about how many scheduled hours that is. */
  over: number;
  overHours: number | null;
  /** The crew costs noticeably more than the forecast leaves. */
  short: boolean;
  /**
   * What the same weekday's last few ordinary days actually took (the middle of them); null on a
   * special day or with too few to go on. And whether, at that pace, the crew wouldn't be covered.
   */
  lately: number | null;
  latelyShort: boolean;
}
export type CrewShort = CrewOutlook;

/** A crew is flagged when it costs at least this much more than the forecast leaves. */
const CREW_MIN_OVER = 20;
/** "The recent pace" is the middle of a weekday's last few ordinary days; it needs at least this many. */
export const PACE_DAYS = 4;
const PACE_MIN_DAYS = 3;

/**
 * Each day from `from` on with a forecast: what the forecast leaves after
 * food, drink and card fees (at that weekday's own cost of goods, or the whole
 * week's when the weekday is rarely open) against the crew. With no shifts
 * scheduled the crew is that weekday's usual wages, when it has any history.
 */
export function crewOutlook(days: readonly CrewDayInput[], p: Pick<DayProfit, "weekdays" | "typical"> & Partial<Pick<DayProfit, "days">>, from?: ISODate): CrewOutlook[] {
  const rate = (x: { sales: number; goods: number; fees: number } | null | undefined) => (x && x.sales > 0 ? 1 - (x.goods + x.fees) / x.sales : null);
  const out: CrewOutlook[] = [];
  for (const d of days) {
    if ((from && d.date < from) || d.sales <= 0) continue;
    const w = p.weekdays.find((x) => x.wd === weekday(d.date));
    const keep = rate(w) ?? rate(p.typical);
    const usual = d.cost <= 0;
    const cost = usual ? (w?.labor ?? 0) : d.cost;
    if (keep == null || keep <= 0 || cost <= 0) continue;
    const kept = d.sales * keep;
    const over = cost - kept;
    const perHour = !usual && d.hours > 0 ? d.cost / d.hours : null;
    const short = over >= CREW_MIN_OVER;
    const past = d.special ? [] : (p.days ?? []).filter((x) => x.wd === weekday(d.date) && !x.oneOff && x.date < d.date).slice(-PACE_DAYS);
    const lately = past.length >= PACE_MIN_DAYS ? median(past.map((x) => x.sales)) : null;
    out.push({
      date: d.date,
      sales: d.sales,
      cost,
      usual,
      kept,
      needs: cost / keep,
      over,
      overHours: short && perHour ? Math.max(0.5, Math.round((over / perHour) * 2) / 2) : null,
      short,
      lately,
      latelyShort: lately != null && cost - lately * keep >= CREW_MIN_OVER,
    });
  }
  return out;
}

/** The scheduled days whose crew costs more than the forecast leaves: something to trim. */
export const crewShortfalls = (days: readonly CrewDayInput[], p: Pick<DayProfit, "weekdays" | "typical"> & Partial<Pick<DayProfit, "days">>, from?: ISODate): CrewShort[] =>
  crewOutlook(days, p, from).filter((o) => o.short && !o.usual);

// ---- What it says ------------------------------------------------------------------------------

export interface ProfitPoint {
  key: "ahead" | "weakest" | "recent" | "season" | "hours" | "labor" | "rent" | "closed";
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

/** What the week ahead says, when a day's forecast won't cover its crew. */
export function outlookPoint(ahead: readonly CrewOutlook[]): ProfitPoint | null {
  const short = ahead.filter((o) => o.short).sort((a, b) => b.over - a.over);
  if (!short.length) {
    // Covered at the forecast, but not if the day comes in like that weekday has lately.
    const thin = ahead.filter((o) => o.latelyShort && o.lately != null).sort((a, b) => a.lately! / a.needs - b.lately! / b.needs);
    if (!thin.length) return null;
    const t = thin[0];
    const name = DAY_NAMES[weekday(t.date)];
    return {
      key: "ahead",
      tone: "warn",
      title: thin.length === 1 ? `This ${name} only covers its crew if the forecast holds` : `${thin.length} days ahead only cover their crew if the forecast holds`,
      detail: `${thin.length === 1 ? "The" : `Take ${name}: the`} forecast is ${about(t.sales)}, but the last ${PACE_DAYS} ordinary ${name}s took about ${about(t.lately!)}. At that pace the day leaves well under the ${about(t.cost)} ${t.usual ? "a usual crew costs" : "the crew scheduled costs"}; it needs ${about(t.needs)} in sales to cover it.`,
      action: `Plan ${name} on the lower figure: start one person later, or send one home early if it's slow by the first hour. If it does come in at the forecast you've lost little.`,
    };
  }
  const o = short[0];
  const day = DAY_NAMES[weekday(o.date)];
  return {
    key: "ahead",
    tone: "warn",
    title: short.length === 1 ? `This ${day}'s forecast won't cover ${o.usual ? "a usual crew" : "the crew scheduled"}` : `${short.length} days in the week ahead won't cover their crew at the forecast`,
    detail: `${short.length === 1 ? `It` : `The widest gap is ${day}: it`} is forecast at ${about(o.sales)}, which leaves about ${about(o.kept)} after food, drink and card fees. ${o.usual ? `A usual ${day} crew costs` : "The crew scheduled costs"} ${about(o.cost)}.`,
    action: `${o.overHours != null ? `Trim about ${o.overHours} hours` : "Start one person later, or send one home early,"} on ${day}; as it stands the day needs ${about(o.needs)} in sales. The forecast is a best guess, so look again the day before.`,
  };
}

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

  // The year can look fine while the last couple of months don't.
  const slipping = regular.filter((w) => w.recent.days >= RECENT_DAYS && w.recent.left < 0 && w.left >= 0);
  const thinning = regular.filter((w) => w.recent.days >= RECENT_DAYS && w.left > 0 && w.recent.left < w.left * SLIPPING && (w.recent.left < 0 || w.recent.lost >= 3));
  const level = losing.length ? "bad" : thin.length || thinning.length ? "warn" : "good";
  const headline = losing.length
    ? `${listOf(losing.map(plural))} cost more to open than they bring in`
    : slipping.length
      ? `Every day paid for itself over the year, but lately ${listOf(slipping.map(plural))} haven't`
      : thinning.length
        ? `Every day pays for itself over the year, but ${listOf(thinning.map(plural))} have thinned out lately`
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
        ? `Closing ${plural(worst)} would save about ${about(-worst.left * worst.openDays)} a year even if nobody came another day instead. A shorter ${DAY_NAMES[worst.wd]} is the smaller step to try first.`
        : `Over the year ${plural(worst)} added about ${about(worst.yearLeft)} towards rent. Closing would only pay if more than ${pc(worst.moveShare ?? 0)} of ${DAY_NAMES[worst.wd]}'s sales turned up on other days instead${(worst.moveShare ?? 0) >= 0.25 ? ", which is a lot to count on" : ""}. Keep it open.`,
  });

  const lately = [...thinning].sort((a, b) => a.recent.left - b.recent.left)[0];
  if (lately) {
    const r = lately.recent;
    points.push({
      key: "recent",
      tone: r.left < 0 ? "bad" : "warn",
      title: r.left < 0 ? `Lately ${plural(lately)} have been losing money` : `Lately ${plural(lately)} are thinner: ${r.lost} of the last ${r.days} lost money`,
      detail: `The last ${r.days} ${plural(lately)} ${r.left < 0 ? `lost about ${about(-r.left)}` : `left about ${about(r.left)}`} each on average, against ${about(lately.left)} left over the whole year. ${r.lost} of them lost money.`,
      action: `One slow stretch isn't a reason to close. If it's still like this in a month, try a smaller crew or a shorter ${DAY_NAMES[lately.wd]} first: the crew is about ${about(lately.labor)} a day.`,
    });
  }

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
