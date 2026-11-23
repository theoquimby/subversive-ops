import { money } from "@/lib/format";
import { addDays, weekday, type ISODate } from "./dates";
import { HOLIDAY_LABEL, holidayKind } from "./holidays";

/**
 * The one line that reconciles a week on the schedule: labor %, hours against
 * what the forecast needs, and the open shifts, which used to sit side by side
 * and disagree (a green labor % next to 70 hours over need and 12 shifts to
 * fill). Also the per-day flags the day columns carry: a holiday, a closed day
 * that still has a forecast, a staffed day with no forecast.
 */

export interface StoryDay {
  date: ISODate;
  /** Forecast sales. */
  sales: number;
  /** Scheduled labor cost, wages plus employer taxes. */
  cost: number;
  hours: number;
  requiredHours: number;
  /** Open in the opening hours. */
  open: boolean;
  /** Unassigned shifts still to come on this day. */
  openShifts: number;
}

export type DayFlagKind = "holiday" | "closed-forecast" | "closed-staffed" | "no-forecast";
export interface DayFlag {
  kind: DayFlagKind;
  label: string;
  detail: string;
}

export interface WeekStory {
  tone: "good" | "warn" | "neutral";
  title: string;
  line: string;
  /** Labor on forecast days against the forecast of open days. Null with no forecast. */
  laborPct: number | null;
  /** Forecast sales of the days that are open. */
  sales: number;
  /** Labor on days with no forecast, left out of the labor %. */
  unforecastCost: number;
  overHours: number;
  shortHours: number;
  flags: Partial<Record<ISODate, DayFlag[]>>;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const h = (x: number) => `${Number(x.toFixed(1))}h`;
const p0 = (x: number) => `${Math.round(x * 100)}%`;
const whole = (x: number) => money(x, { whole: true });
const and = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "Fri to Sun", "Fri and Sat", "Mon, Wed and Fri". */
export function dayList(dates: ISODate[]): string {
  const sorted = [...dates].sort();
  const runs: ISODate[][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && addDays(last[last.length - 1], 1) === d) last.push(d);
    else runs.push([d]);
  }
  const name = (d: ISODate) => DOW[weekday(d)];
  return and(runs.flatMap((r) => (r.length >= 3 ? [`${name(r[0])} to ${name(r[r.length - 1])}`] : r.map(name))));
}

/** A day this far past what it needs (or short of it) is worth naming. */
const notable = (gap: number, required: number) => gap >= Math.max(4, required * 0.15);

export function weekStory({ days, laborTarget, today }: { days: StoryDay[]; laborTarget: number | null; today: ISODate }): WeekStory {
  const flags: Partial<Record<ISODate, DayFlag[]>> = {};
  const flag = (d: ISODate, f: DayFlag) => (flags[d] = [...(flags[d] ?? []), f]);
  for (const d of days) {
    const kind = holidayKind(d.date);
    const holiday = kind ? HOLIDAY_LABEL[kind] : null;
    if (holiday) flag(d.date, { kind: "holiday", label: holiday, detail: `${holiday}: check the forecast and the crew against last year.` });
    if (!d.open && d.hours > 0) flag(d.date, { kind: "closed-staffed", label: "Shifts on a closed day", detail: `Closed in your opening hours, but ${h(d.hours)} of shifts are on it.` });
    else if (!d.open && d.sales > 0) flag(d.date, { kind: "closed-forecast", label: "Forecast left out", detail: `Closed in your opening hours, so its ${whole(d.sales)} forecast is left out of the week.` });
    if (d.open && d.sales <= 0 && d.hours > 0) {
      flag(d.date, { kind: "no-forecast", label: "No forecast", detail: `${whole(d.cost)} of labor with no forecast to set it against${holiday ? `. Check you're open on ${holiday}, then nudge its forecast` : ""}.` });
    }
  }

  const counted = days.filter((d) => d.open && d.sales > 0);
  const sales = counted.reduce((a, d) => a + d.sales, 0);
  const costIn = counted.reduce((a, d) => a + d.cost, 0);
  const unforecastCost = days.filter((d) => !(d.open && d.sales > 0)).reduce((a, d) => a + d.cost, 0);
  const laborPct = sales > 0 ? costIn / sales : null;

  const hours = days.reduce((a, d) => a + d.hours, 0);
  const required = days.reduce((a, d) => a + d.requiredHours, 0);
  const overHours = days.reduce((a, d) => a + Math.max(0, d.hours - d.requiredHours), 0);
  const shortHours = days.reduce((a, d) => a + Math.max(0, d.requiredHours - d.hours), 0);
  const overDays = days.filter((d) => notable(d.hours - d.requiredHours, d.requiredHours)).map((d) => d.date);
  const shortDays = days.filter((d) => notable(d.requiredHours - d.hours, d.requiredHours)).map((d) => d.date);
  const upcoming = days.filter((d) => d.date >= today);
  const openShifts = upcoming.reduce((a, d) => a + d.openShifts, 0);
  const openOnOver = upcoming.filter((d) => overDays.includes(d.date)).reduce((a, d) => a + d.openShifts, 0);
  const openElsewhere = upcoming.filter((d) => d.openShifts > 0 && !overDays.includes(d.date)).map((d) => d.date);
  const highLine = (() => {
    const limit = (laborTarget ?? 0.3) + 0.05;
    const high = counted.filter((d) => d.cost / d.sales > limit);
    if (!high.length) return "";
    return ` ${dayList(high.map((d) => d.date))} run${high.length === 1 ? "s" : ""} at ${and(high.map((d) => p0(d.cost / d.sales)))} labor.`;
  })();
  const noForecast = days.filter((d) => d.open && d.sales <= 0 && d.hours > 0);
  const unforecastLine = noForecast.length ? ` ${dayList(noForecast.map((d) => d.date))} ${noForecast.length === 1 ? "has" : "have"} no forecast, so ${whole(unforecastCost)} of labor isn't in the labor %.` : "";
  const shifts = (n: number) => `${n} open shift${n === 1 ? "" : "s"}`;

  const base = { laborPct, sales, unforecastCost, overHours, shortHours, flags };
  if (hours <= 0) return { ...base, tone: "neutral", title: "No shifts on the schedule yet", line: "Generate a draft from the forecast, or copy a week that worked." };

  if (overDays.length && overHours >= required * 0.1) {
    const on = dayList(overDays);
    const action = openOnOver
      ? `${openOnOver === openShifts ? `The ${shifts(openShifts)} are` : `${openOnOver} of the ${shifts(openShifts)} are`} on those days: delete them rather than fill them${shortDays.length ? `, or move people to ${dayList(shortDays)}` : ""}.`
      : openShifts
        ? `Fill the ${shifts(openShifts)} on ${dayList(openElsewhere)} from the people over need on ${on}.`
        : `Trim shifts on ${on}${shortDays.length ? `, or move people to ${dayList(shortDays)}` : ""}.`;
    return { ...base, tone: "warn", title: `${h(overHours)} more than the forecast needs, on ${on}`, line: `${action}${highLine}${unforecastLine}` };
  }
  if (shortDays.length && shortHours >= required * 0.1) {
    const action = openShifts ? `Fill the ${shifts(openShifts)} first.` : "Add shifts, or generate a draft for those days.";
    return { ...base, tone: "warn", title: `${h(shortHours)} short of what the forecast needs, on ${dayList(shortDays)}`, line: `${action}${highLine}${unforecastLine}` };
  }
  if (highLine) {
    return { ...base, tone: "warn", title: "Some days cost more in labor than they should", line: `${highLine.trim()} The week as a whole is ${laborPct == null ? "not forecast" : p0(laborPct)}.${unforecastLine}` };
  }
  if (openShifts) {
    return { ...base, tone: "warn", title: `${shifts(openShifts)} still to fill`, line: `The hours fit the forecast once they're filled.${unforecastLine}` };
  }
  const budget = laborTarget != null ? ` against a ${p0(laborTarget)} budget` : "";
  return { ...base, tone: "good", title: "The crew fits the forecast", line: `${laborPct == null ? "No forecast to judge labor by" : `${p0(laborPct)} labor${budget}`}, ${h(hours)} scheduled for ${h(required)} needed.${unforecastLine}` };
}
