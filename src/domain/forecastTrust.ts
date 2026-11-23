/**
 * How far to trust the sales forecast: the one measure every page uses.
 *
 * The measure is the scorecard's: every past open day forecast again as it
 * would have been made the evening before, then the total miss over the total
 * sold ("off by 21% on a typical day"). It's read over the last 90 days when
 * there are enough of them, else over all history, and said the same way
 * wherever it shows (the Sales page, the scorecard).
 *
 * Pure: plain data in, plain words out.
 */

import { addDays, type ISODate } from "./dates";
import { score, type Score, type ScoreDay } from "./forecastScore";

/** The stretch the verdict is about. */
export const TRUST_WINDOW_DAYS = 90;
/** Fewer scored days than this in the window and the verdict goes by all history instead. */
export const TRUST_MIN_RECENT_DAYS = 30;

export type TrustLevel = "trust" | "guide" | "rough";
export type TrustTone = "good" | "warn" | "bad";

export const TRUST_LABEL: Record<TrustLevel, string> = { trust: "Solid", guide: "Use with a cushion", rough: "Rough guide" };
export const TRUST_TONE: Record<TrustLevel, TrustTone> = { trust: "good", guide: "warn", rough: "bad" };

/** The level a typical miss puts the forecast at: within 15% is solid, within 30% needs a cushion. */
export function trustLevel(miss: number): TrustLevel {
  return miss <= 0.15 ? "trust" : miss <= 0.3 ? "guide" : "rough";
}

const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** Round to a figure someone would say out loud: nearest $25 under $500, else nearest $50. */
export const roundMoney = (n: number) => (n < 500 ? Math.round(n / 25) * 25 : Math.round(n / 50) * 50);

export interface ForecastTrust {
  level: TrustLevel;
  tone: TrustTone;
  /** "Solid", "Use with a cushion", "Rough guide". */
  label: string;
  basis: "recent" | "all";
  /** "Over the last 90 days" or "Over your history". */
  when: string;
  /** The typical day's miss, as a share of the day and in dollars (rounded to a figure said out loud). */
  missShare: number;
  missDollars: number;
  /** How many days in ten landed within 15%. */
  closeInTen: number;
  /** The recent miss against all history's, when it differs by a fifth or more. */
  trend: "worse" | "better" | null;
  allMiss: number | null;
  headline: string;
  /** The verdict's line, trend included. */
  line: string;
  /** One line for a figure elsewhere: "A typical day is off by about $500 (21%), rougher than usual." */
  short: string;
}

export function forecastTrust(i: { recent: Score | null; all: Score | null; avgDay: { recent: number; all: number } }): ForecastTrust | null {
  const all = i.all;
  if (!all) return null;
  const useRecent = (i.recent?.days ?? 0) >= TRUST_MIN_RECENT_DAYS;
  const basis = useRecent ? i.recent! : all;
  const avgDay = useRecent ? i.avgDay.recent : i.avgDay.all;
  const missDollars = roundMoney(basis.wape * avgDay);
  const closeInTen = Math.round(basis.within15 * 10);
  const when = useRecent ? `Over the last ${TRUST_WINDOW_DAYS} days` : "Over your history";
  const level = trustLevel(basis.wape);

  const headline = level === "trust" ? "You can plan on the forecast" : level === "guide" ? "Use the forecast as a guide, and leave a cushion" : "Treat the forecast as a starting point, not a plan";
  const body =
    level === "trust"
      ? `${when} a typical day landed within about ${dollars(missDollars)} of the forecast (${pct(basis.wape)}). Orders and schedules built on it are on solid ground.`
      : level === "guide"
        ? `${when} a typical day was off by about ${dollars(missDollars)} (${pct(basis.wape)}). Build orders and schedules on it, but leave room for a day that size either way.`
        : `${when} a typical day was off by about ${dollars(missDollars)} (${pct(basis.wape)}), and only ${closeInTen} days in 10 landed close. Use it to see the shape of the week, then go by what you know.`;

  const trend = useRecent && basis.wape >= all.wape * 1.2 ? "worse" : useRecent && basis.wape <= all.wape * 0.8 ? "better" : null;
  const trendLine = trend === "worse" ? ` That's rougher than usual: over all your history it's ${pct(all.wape)}.` : trend === "better" ? ` That's better than usual: over all your history it's ${pct(all.wape)}.` : "";
  const short = `A typical day is off by about ${dollars(missDollars)} (${pct(basis.wape)})${trend === "worse" ? ", rougher than usual" : trend === "better" ? ", better than usual" : ""}.`;

  return {
    level,
    tone: TRUST_TONE[level],
    label: TRUST_LABEL[level],
    basis: useRecent ? "recent" : "all",
    when,
    missShare: basis.wape,
    missDollars,
    closeInTen,
    trend,
    allMiss: useRecent ? all.wape : null,
    headline,
    line: body + trendLine,
    short,
  };
}

// ---- Kept for the pages that can't afford the whole replay -----------------------------------

/**
 * What the nightly replay found, kept so the Sales page can say exactly what the
 * scorecard says without replaying every day again: the two scores, a typical
 * day over each stretch, and the last few weeks of day-before forecasts.
 */
export interface StoredAccuracy {
  rules: number;
  learnedOn: ISODate;
  recent: Score | null;
  all: Score | null;
  avgDay: { recent: number; all: number };
  /** The scored days of the last five weeks, oldest first. */
  days: { date: ISODate; forecast: number; actual: number }[];
}

/** Bumped whenever what's kept changes, so it's learned again at once. */
export const ACCURACY_RULES = 1;
const KEEP_DAYS = 35;

const avg = (days: readonly ScoreDay[]) => (days.length ? days.reduce((s, d) => s + d.actual, 0) / days.length : 0);

/** The scores and days to keep, from the scorecard's scored days (`recentFrom` starts the 90-day window). */
export function toStoredAccuracy(days: readonly ScoreDay[], recentFrom: ISODate, today: ISODate): StoredAccuracy {
  const scored = days.filter((d) => d.f1 != null);
  const recent = scored.filter((d) => d.date >= recentFrom);
  const pairs = (list: readonly ScoreDay[]) => list.map((d) => ({ forecast: d.f1!, actual: d.actual }));
  const from = addDays(scored.length ? scored[scored.length - 1].date : today, -(KEEP_DAYS - 1));
  return {
    rules: ACCURACY_RULES,
    learnedOn: today,
    recent: score(pairs(recent)),
    all: score(pairs(scored)),
    avgDay: { recent: avg(recent), all: avg(scored) },
    days: scored.filter((d) => d.date >= from).map((d) => ({ date: d.date, forecast: d.f1!, actual: d.actual })),
  };
}

/** A week's day-before forecasts against what sold, scored the same way. */
export interface WeekScore {
  from: ISODate;
  forecast: number;
  actual: number;
  /** The typical day's miss that week; null with nothing scored. */
  miss: number | null;
  level: TrustLevel | null;
}

/** The kept days in weeks of seven, newest week last, starting from the oldest day. */
export function weeklyScores(days: readonly { date: ISODate; forecast: number; actual: number }[], weeks = 4): WeekScore[] {
  if (!days.length) return [];
  const last = days[days.length - 1].date;
  const out: WeekScore[] = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const b = addDays(last, -7 * k);
    const a = addDays(b, -6);
    const rows = days.filter((d) => d.date >= a && d.date <= b);
    if (!rows.length) continue;
    const s = score(rows);
    out.push({ from: a, forecast: rows.reduce((t, r) => t + r.forecast, 0), actual: rows.reduce((t, r) => t + r.actual, 0), miss: s?.wape ?? null, level: s ? trustLevel(s.wape) : null });
  }
  return out;
}
