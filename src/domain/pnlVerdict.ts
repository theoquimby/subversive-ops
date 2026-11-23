/**
 * The P&L's verdict: what a period kept of every sales dollar, why, and the
 * one thing to do about it. Words for the top of /pnl, from the bridge and the
 * targets. Pure.
 */

import { addDays, weekday, type ISODate } from "./dates";
import type { PeriodKind } from "./pnl";

export type VerdictTone = "good" | "warn" | "bad" | "neutral" | "unknown";

export interface PnlVerdictInput {
  sales: number;
  /** Food & drink, counted plus estimated. */
  goods: number;
  labor: number;
  fees: number;
  profit: number;
  /** The comparison period, when there is one with sales. */
  prev: { margin: number | null; label: string } | null;
  /** Labor % target from the budget, if set. */
  laborTarget: number | null;
  foodPct: number | null;
  foodTarget: number | null;
  /** Finished days in the period whose sales haven't come in yet (domain/dayState). */
  notIn: number;
  /** Days in the period that lost money once food, drink, labor and fees were paid. */
  lossDays: number;
}

export interface PnlVerdict {
  tone: VerdictTone;
  /** A label for the badge when the tone needs one ("2 days not in yet"). */
  badge: string | null;
  title: string;
  line: string;
  action: string | null;
}

const cents = (share: number) => `${Math.round(share * 100)}¢`;
const pct0 = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function pnlVerdict(i: PnlVerdictInput): PnlVerdict {
  const margin = i.sales > 0 ? i.profit / i.sales : 0;
  const laborIn = i.labor > 0;
  const laborPct = i.sales > 0 && laborIn ? i.labor / i.sales : null;
  const soFar = i.notIn > 0 ? "So far, you" : "You";

  let title: string;
  if (margin > 0) {
    const prevM = i.prev?.margin ?? null;
    const moved = prevM != null && Math.abs(margin - prevM) >= 0.01 && i.notIn === 0;
    title = `${soFar} kept ${cents(margin)} of every sales dollar${moved ? `, ${margin > prevM! ? "up" : "down"} from ${cents(prevM!)} ${i.prev!.label}` : ""}`;
  } else {
    title = `${i.notIn > 0 ? "So far, costs" : "Costs"} ran ${pct0(-margin)} over sales`;
  }

  const took = [`food and drink took ${cents(i.goods / i.sales)}`, laborIn ? `wages ${cents(i.labor / i.sales)}` : null, i.fees > 0 ? `card fees ${cents(i.fees / i.sales)}` : null].filter(Boolean) as string[];
  const tookLine = `${took.length > 1 ? `${took.slice(0, -1).join(", ")} and ${took.at(-1)}` : took[0]}.`;
  const line = laborIn ? tookLine[0].toUpperCase() + tookLine.slice(1) : `${tookLine[0].toUpperCase()}${tookLine.slice(1, -1)}. Wages aren't in: there are no timecards for these days, so what's kept reads high.`;

  const laborOver = laborPct != null && i.laborTarget != null ? laborPct - i.laborTarget : null;
  const foodOver = i.foodPct != null && i.foodTarget != null ? i.foodPct - i.foodTarget : null;
  const prevDrop = i.prev?.margin != null ? i.prev.margin - margin : null;

  let tone: VerdictTone;
  let action: string | null;
  if (i.notIn > 0) {
    tone = "unknown";
    action = `${plural(i.notIn, "day")} of sales ${i.notIn === 1 ? "isn't" : "aren't"} in from Square yet. The picture fills in with the next sync; check it under Settings, Square, if it's been more than a day.`;
  } else if (!laborIn) {
    tone = "unknown";
    action = "Add these days' timecards, or connect Square Team, so wages count.";
  } else if (margin <= 0) {
    tone = "bad";
    action = i.lossDays ? `Start with the ${plural(i.lossDays, "day")} that lost money, under Day by day.` : "Look at what moved, below.";
  } else if (laborOver != null && laborOver > 0.03) {
    tone = "warn";
    action = `Wages ran ${pct0(laborPct!)} of sales against a ${pct0(i.laborTarget!)} target: trim the quietest shifts on next week's schedule.`;
  } else if (foodOver != null && foodOver > 0.02) {
    tone = "warn";
    action = `Food cost ran ${pct0(i.foodPct!)} against a ${pct0(i.foodTarget!)} target: Menu costs shows which dishes moved.`;
  } else if (prevDrop != null && prevDrop >= 0.03) {
    tone = "warn";
    action = "Less was kept than before: what moved is below.";
  } else if (i.lossDays) {
    tone = "warn";
    action = `${plural(i.lossDays, "day")} lost money: see Day by day.`;
  } else {
    tone = "good";
    action = null;
  }
  return { tone, badge: i.notIn > 0 ? `${plural(i.notIn, "day")} not in yet` : !laborIn ? "No timecards" : null, title, line, action };
}

/**
 * The period /pnl opens on: this week once it has two finished days, else last
 * week (on a Monday "This week" is nothing but blanks).
 */
export function defaultPeriod(today: ISODate): Extract<PeriodKind, "week" | "lastweek"> {
  const finished = (weekday(today) + 6) % 7; // days since Monday, all finished
  return finished >= 2 ? "week" : "lastweek";
}

/** "Nov 16 to 22", "Nov 30 to Dec 6", "Dec 28, 2026 to Jan 3, 2027": a range of dates as people say it. */
export function rangeWords(from: ISODate, toInclusive: ISODate, opts: { year?: boolean } = {}): string {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = toInclusive.split("-").map(Number);
  if (from === toInclusive) return `${M[fm - 1]} ${fd}${opts.year ? `, ${fy}` : ""}`;
  const crossYear = fy !== ty;
  const left = `${M[fm - 1]} ${fd}${crossYear || opts.year ? (crossYear ? `, ${fy}` : "") : ""}`;
  const right = `${fm === tm && !crossYear ? "" : `${M[tm - 1]} `}${td}${crossYear || opts.year ? `, ${ty}` : ""}`;
  return `${left} to ${right}`;
}

/** The day before `date`, for inclusive ends of exclusive ranges. */
export const lastDayOf = (toExclusive: ISODate) => addDays(toExclusive, -1);
