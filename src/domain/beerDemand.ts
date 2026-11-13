/**
 * Demand per beer: pints a week from Square history, a 2–4 week forecast with
 * a range, and "kegs on hand vs kegs needed" so the brewer knows what to fill
 * next. Small and explainable on purpose:
 *
 *   forecast week = recent pace × (season that week ÷ season lately)
 *
 * The recent pace is the last four weeks the beer was pouring; the season is
 * how busy draft beer as a whole runs each week of the year (from every year
 * of history), so a beer that's only been on since spring still knows that
 * December is slow. The range comes from how far the same method was off in
 * this beer's past weeks. Pure: no I/O.
 */

import { addDays, daysBetween, type ISODate, parseISODate } from "./dates";

export const OZ_PER_PINT = 16;

/** Share of a dry beer's sales that's really lost (the rest switch to another beer). */
export const SUBSTITUTE_LOSS = 1 / 3;

/** Monday of the week a date falls in. */
export function weekOf(date: ISODate): ISODate {
  const wd = parseISODate(date).getUTCDay();
  return addDays(date, -((wd + 6) % 7));
}

/** ISO-ish week of year 1..52 (week 53 folds into 52) for seasonal lookups. */
export function weekOfYear(date: ISODate): number {
  const d = parseISODate(weekOf(date));
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.min(52, Math.floor((d.getTime() - jan1) / (7 * 86_400_000)) + 1);
}

/** Weekly totals (Monday → oz) from daily oz. */
export function weeklyTotals(daily: Map<ISODate, number>): Map<ISODate, number> {
  const out = new Map<ISODate, number>();
  for (const [d, oz] of daily) out.set(weekOf(d), (out.get(weekOf(d)) ?? 0) + oz);
  return out;
}

/**
 * How busy each week of the year is for draft beer overall (1 = an average
 * week), averaged over every year with data and smoothed over neighbouring
 * weeks. Null with less than ~a year of history.
 */
export function seasonalIndex(totalDaily: Map<ISODate, number>): number[] | null {
  const weeks = [...weeklyTotals(totalDaily).entries()].sort(([a], [b]) => a.localeCompare(b));
  if (weeks.length < 48) return null;
  // Each week against the 52-week average around it, so growth over the years doesn't look like a season.
  const vals = weeks.map(([, v]) => v);
  const sums = Array.from({ length: 52 }, () => 0);
  const counts = Array.from({ length: 52 }, () => 0);
  for (let i = 0; i < weeks.length; i++) {
    const lo = Math.max(0, i - 26), hi = Math.min(weeks.length, i + 26);
    const win = vals.slice(lo, hi);
    if (win.length < 40) continue;
    const mean = win.reduce((s, x) => s + x, 0) / win.length;
    if (mean <= 0) continue;
    const w = weekOfYear(weeks[i][0]) - 1;
    sums[w] += vals[i] / mean;
    counts[w]++;
  }
  if (counts.filter((c) => c > 0).length < 40) return null;
  const raw = sums.map((s, i) => (counts[i] ? s / counts[i] : NaN));
  // Fill gaps with neighbours, then smooth ±1 week.
  const filled = raw.map((v, i) => (Number.isFinite(v) ? v : (raw[(i + 51) % 52] + raw[(i + 1) % 52]) / 2 || 1));
  const smooth = filled.map((_, i) => (filled[(i + 51) % 52] + 2 * filled[i] + filled[(i + 1) % 52]) / 4);
  const avg = smooth.reduce((s, x) => s + x, 0) / 52;
  return smooth.map((x) => Math.max(0.4, Math.min(2.5, x / avg)));
}

const seasonAt = (idx: number[] | null, week: ISODate) => (idx ? idx[weekOfYear(week) - 1] : 1);

function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const p = (s.length - 1) * q;
  const lo = Math.floor(p), hi = Math.ceil(p);
  return s[lo] + (s[hi] - s[lo]) * (p - lo);
}

export interface WeekForecast {
  week: ISODate;
  /** Pints. */
  low: number;
  mid: number;
  high: number;
}

export interface BeerForecast {
  /** Recent pace, oz a day (open or not), over the weeks it was pouring. */
  ozPerDay: number;
  weeks: WeekForecast[];
  /** Multipliers on `mid` for the range (from back-testing, or ±30% without enough history). */
  band: [number, number];
  /** Weeks the pace is based on. */
  basisWeeks: number;
  seasonal: boolean;
  /** How the band was set, for "how we worked this out". */
  backtested: number;
}

/**
 * Forecast `horizon` weeks starting with the week of `today` (that week whole).
 * `daily` is this beer's oz per day; `season` from `seasonalIndex` of all beer.
 * Only weeks before this one count as history.
 */
export function forecastBeer(daily: Map<ISODate, number>, today: ISODate, season: number[] | null, horizon = 4): BeerForecast {
  const thisWeek = weekOf(today);
  const weekly = [...weeklyTotals(daily).entries()].filter(([w]) => w < thisWeek).sort(([a], [b]) => a.localeCompare(b));
  // Pace: the last 4 weeks it actually poured (a week with nothing sold means it wasn't on).
  const poured = weekly.filter(([, v]) => v > 0);
  const recent = poured.slice(-4);
  const pace = (rows: [ISODate, number][]) => {
    if (!rows.length) return 0;
    // De-season each week so a run of busy summer weeks doesn't inflate November.
    const level = rows.reduce((s, [w, v]) => s + v / seasonAt(season, w), 0) / rows.length;
    return level;
  };
  const level = pace(recent);
  const recentSeason = recent.length ? recent.reduce((s, [w]) => s + seasonAt(season, w), 0) / recent.length : 1;

  // Back-test: predict each past poured week from the 4 poured weeks before it.
  const ratios: number[] = [];
  for (let i = 4; i < poured.length; i++) {
    const [w, actual] = poured[i];
    if (daysBetween(w, thisWeek) > 7 * 78) continue;
    const pred = pace(poured.slice(i - 4, i)) * seasonAt(season, w);
    if (pred > 0) ratios.push(actual / pred);
  }
  const band: [number, number] = ratios.length >= 8
    ? [Math.max(0.35, Math.min(0.95, quantile(ratios, 0.1))), Math.min(2.2, Math.max(1.05, quantile(ratios, 0.9)))]
    : [0.7, 1.3];

  const weeks: WeekForecast[] = [];
  for (let k = 0; k < horizon; k++) {
    const w = addDays(thisWeek, 7 * k);
    const ozMid = level * seasonAt(season, w);
    const mid = ozMid / OZ_PER_PINT;
    weeks.push({ week: w, mid, low: mid * band[0], high: mid * band[1] });
  }
  return {
    ozPerDay: (level * (season ? recentSeason : 1)) / 7,
    weeks,
    band,
    basisWeeks: recent.length,
    seasonal: !!season,
    backtested: ratios.length,
  };
}

export interface OnHand {
  /** Full kegs (filled or in cold storage), each in fl oz. */
  fullKegOz: number[];
  /** What's left in kegs of this beer on tap, fl oz (after yield). */
  onTapOz: number;
}

export interface BeerPlan {
  /** Kegs needed over the next 2 and 4 weeks, low–high. */
  need2: { low: number; mid: number; high: number };
  need4: { low: number; mid: number; high: number };
  /** Full kegs + what's on tap, in kegs of the usual size. */
  onHandKegs: number;
  /** Days until it runs out at the forecast pace (null if it isn't selling). */
  runOutDays: number | null;
  /** Kegs to fill so the next two weeks are covered at the high end, rounded up. */
  toFill: number;
  tone: "good" | "warn" | "bad";
  sentence: string;
}

/**
 * On hand vs needed. `kegOz` is the usual keg for this beer and `yieldPct`
 * what you really pour from one (calibrated by kicks).
 */
export function planBeer(name: string, f: BeerForecast, onHand: OnHand, kegOz: number, yieldPct: number, today: ISODate): BeerPlan {
  const usable = kegOz * yieldPct;
  // Day by day from today, each day a seventh of its week's forecast (the last week repeats past the horizon).
  const daysOz = (n: number, which: "low" | "mid" | "high") => {
    if (!f.weeks.length) return 0;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.min(f.weeks.length - 1, Math.floor(daysBetween(f.weeks[0].week, addDays(today, i)) / 7));
      s += (f.weeks[k][which] * OZ_PER_PINT) / 7;
    }
    return s;
  };
  const need = (n: number) => ({ low: daysOz(n, "low") / usable, mid: daysOz(n, "mid") / usable, high: daysOz(n, "high") / usable });
  const need2 = need(14), need4 = need(28);
  const onHandOz = onHand.fullKegOz.reduce((s, x) => s + x * yieldPct, 0) + onHand.onTapOz;
  const onHandKegs = onHandOz / usable;
  const daily = f.weeks[0] ? (f.weeks[0].mid * OZ_PER_PINT) / 7 : f.ozPerDay;
  const runOutDays = daily > 0.5 ? onHandOz / daily : null;
  const toFill = Math.max(0, Math.ceil(need2.high - onHandKegs - 0.15));
  const fullCount = onHand.fullKegOz.length;
  const tone: BeerPlan["tone"] = runOutDays != null && runOutDays < 7 && fullCount === 0 ? "bad" : toFill > 0 ? "warn" : "good";
  const pints = (n: number) => Math.round(n);
  const w = f.weeks[0];
  const pace = w ? `about ${pints(w.low)}–${pints(w.high)} pints a week` : "not selling lately";
  const run = runOutDays == null ? "" : runOutDays < 1 ? "runs out today" : `runs out in ~${Math.round(runOutDays)} day${Math.round(runOutDays) === 1 ? "" : "s"}`;
  const full = `${fullCount} full keg${fullCount === 1 ? "" : "s"} in cold storage`;
  const fill = toFill > 0 ? `Fill ${toFill} keg${toFill === 1 ? "" : "s"} to cover the next two weeks.` : "Covered for the next two weeks.";
  const sentence = `${name}: ${pace}. ${full}${run ? `; ${run}` : ""}. ${fill}`;
  return { need2, need4, onHandKegs, runOutDays, toFill, tone, sentence };
}

/** Average pints per calendar month (Jan..Dec) over every year it sold — the beer's own season. */
export function monthProfile(daily: Map<ISODate, number>): (number | null)[] {
  const byYm = new Map<string, number>();
  for (const [d, oz] of daily) byYm.set(d.slice(0, 7), (byYm.get(d.slice(0, 7)) ?? 0) + oz);
  const sums = Array.from({ length: 12 }, () => 0), counts = Array.from({ length: 12 }, () => 0);
  for (const [ym, oz] of byYm) {
    if (oz <= 0) continue;
    const m = Number(ym.slice(5, 7)) - 1;
    sums[m] += oz / OZ_PER_PINT;
    counts[m]++;
  }
  return sums.map((s, i) => (counts[i] ? s / counts[i] : null));
}

// ---- Insight finding --------------------------------------------------------------------------

export interface RunOutFinding {
  key: string;
  kind: string;
  model: string;
  title: string;
  action: string;
  monthly: number;
  oneOff: number;
  low: number;
  high: number;
  confidence: number;
  how: string[];
  inputs: { label: string; value: string }[];
  href: string;
  subject: string;
  story: { now: string; why: string; todo: string; gain: string };
}

/**
 * "Golden Lager runs out in ~5 days; 0 full kegs in the walk-in" — for the
 * Insights feed. Only when it runs out within ~10 days with nothing full
 * behind it. The dollars are the sales at risk while it's off: the days it
 * would be dry before a new fill is ready (`fillDays`, default a week).
 */
export function runOutFinding(p: { beerId: string; name: string; plan: BeerPlan; forecast: BeerForecast; fullKegs: number; dollarsPerOz: number | null; fillDays?: number }): RunOutFinding | null {
  const { plan, forecast } = p;
  if (plan.runOutDays == null || plan.runOutDays > 10 || p.fullKegs > 0) return null;
  const days = Math.max(1, Math.round(plan.runOutDays));
  const dry = Math.max(1, (p.fillDays ?? 7) - plan.runOutDays);
  const perDay = forecast.weeks[0] ? (forecast.weeks[0].mid * OZ_PER_PINT) / 7 : forecast.ozPerDay;
  // Most guests order another beer when one's off, so count about a third of its sales as lost.
  const atRisk = (p.dollarsPerOz ?? 0.4) * perDay * dry * SUBSTITUTE_LOSS;
  const conf = Math.min(0.8, 0.35 + forecast.basisWeeks * 0.08 + (forecast.backtested >= 8 ? 0.15 : 0));
  return {
    key: `kegs.runout.${p.beerId}`,
    kind: "kegs.runout",
    model: "kegs",
    title: `${p.name} runs out in ~${days} day${days === 1 ? "" : "s"}; 0 full kegs in the walk-in`,
    action: `Fill ${Math.max(1, plan.toFill)} keg${Math.max(1, plan.toFill) === 1 ? "" : "s"} of ${p.name}, or plan what goes on that line.`,
    monthly: 0,
    oneOff: Math.round(atRisk),
    low: Math.round(atRisk * forecast.band[0]),
    high: Math.round(atRisk * forecast.band[1]),
    confidence: conf,
    how: [
      `It's pouring about ${Math.round((perDay * 7) / OZ_PER_PINT)} pints a week (last ${forecast.basisWeeks} weeks${forecast.seasonal ? ", adjusted for the time of year" : ""}).`,
      `What's left on tap lasts about ${days} day${days === 1 ? "" : "s"} at that pace, and there's no full keg behind it.`,
      `The dollars are a third of its Square sales for the ~${Math.round(dry)} day${Math.round(dry) === 1 ? "" : "s"} it could be dry (most guests pick another beer instead).`,
    ],
    inputs: [
      { label: "Pints a week", value: `${Math.round(forecast.weeks[0]?.low ?? 0)}–${Math.round(forecast.weeks[0]?.high ?? 0)}` },
      { label: "Full kegs", value: "0" },
      { label: "Runs out", value: `~${days} days` },
    ],
    href: "/kegs/demand",
    subject: p.beerId,
    story: {
      now: `${p.name} runs out in about ${days} day${days === 1 ? "" : "s"}, and there's no full keg of it in the walk-in.`,
      why: `It's pouring about ${Math.round((perDay * 7) / OZ_PER_PINT)} pints a week lately.`,
      todo: `Fill ${Math.max(1, plan.toFill)} keg${Math.max(1, plan.toFill) === 1 ? "" : "s"} now, or decide what replaces it on the line.`,
      gain: `About $${Math.round(atRisk).toLocaleString("en-US")} of sales you'd otherwise miss while it's dry.`,
    },
  };
}
