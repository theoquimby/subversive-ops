/**
 * Live P&L: period ranges, prime-cost metrics, budget comparison, and the
 * hourly sales shape used to spread a day's total over service hours. Pure.
 */

import { addDays, ISODate, parseISODate, weekday } from "./dates";

/** Same values as the UI Badge tones. */
export type Tone = "good" | "warn" | "bad" | "neutral";

export type PeriodKind = "today" | "week" | "lastweek" | "month" | "custom";

export const PERIODS: { kind: PeriodKind; label: string }[] = [
  { kind: "today", label: "Today" },
  { kind: "week", label: "This week" },
  { kind: "lastweek", label: "Last week" },
  { kind: "month", label: "This month" },
  { kind: "custom", label: "Custom" },
];

/** Monday of the week containing `date` (weeks run Mon–Sun, like Budget). */
export const mondayOf = (date: ISODate): ISODate => addDays(date, -((weekday(date) + 6) % 7));

/** Inclusive start, exclusive end. Custom ranges are given inclusive and clamped to sane order. */
export function periodRange(kind: PeriodKind, today: ISODate, custom?: { from?: string; to?: string }): { from: ISODate; toExclusive: ISODate } {
  switch (kind) {
    case "today":
      return { from: today, toExclusive: addDays(today, 1) };
    case "week":
      return { from: mondayOf(today), toExclusive: addDays(mondayOf(today), 7) };
    case "lastweek":
      return { from: addDays(mondayOf(today), -7), toExclusive: mondayOf(today) };
    case "month": {
      const from = `${today.slice(0, 7)}-01`;
      const d = parseISODate(from);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return { from, toExclusive: d.toISOString().slice(0, 10) };
    }
    case "custom": {
      const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
      let a = valid(custom?.from) ?? addDays(today, -6);
      let b = valid(custom?.to) ?? today;
      if (b < a) [a, b] = [b, a];
      // Keep custom ranges to a year so a typo can't load a decade of timecards.
      if (parseISODate(b).getTime() - parseISODate(a).getTime() > 366 * 86_400_000) a = addDays(b, -366);
      return { from: a, toExclusive: addDays(b, 1) };
    }
  }
}

export interface PnlInput {
  sales: number;
  cogs: number;
  labor: number;
  laborHours: number;
  orders: number | null;
}

export interface PnlSummary extends PnlInput {
  primeCost: number;
  profit: number; // before overhead
  foodPct: number | null;
  laborPct: number | null;
  primePct: number | null;
  salesPerLaborHour: number | null;
  ordersPerLaborHour: number | null;
}

export function summarize(i: PnlInput): PnlSummary {
  const primeCost = i.cogs + i.labor;
  const ratio = (n: number) => (i.sales > 0 ? n / i.sales : null);
  return {
    ...i,
    primeCost,
    profit: i.sales - primeCost,
    foodPct: ratio(i.cogs),
    laborPct: ratio(i.labor),
    primePct: ratio(primeCost),
    salesPerLaborHour: i.laborHours > 0 ? i.sales / i.laborHours : null,
    ordersPerLaborHour: i.laborHours > 0 && i.orders != null ? i.orders / i.laborHours : null,
  };
}

export function addInputs(rows: PnlInput[]): PnlInput {
  const anyOrders = rows.some((r) => r.orders != null);
  return rows.reduce<PnlInput>(
    (a, r) => ({ sales: a.sales + r.sales, cogs: a.cogs + r.cogs, labor: a.labor + r.labor, laborHours: a.laborHours + r.laborHours, orders: anyOrders ? (a.orders ?? 0) + (r.orders ?? 0) : null }),
    { sales: 0, cogs: 0, labor: 0, laborHours: 0, orders: anyOrders ? 0 : null },
  );
}

/** Cost % against a target: at or under = good, up to 2 points over = warn, beyond = bad. */
export function costTone(actual: number | null, target: number | null): Tone {
  if (actual == null || target == null) return "neutral";
  if (actual <= target) return "good";
  return actual <= target + 0.02 ? "warn" : "bad";
}

/** Sales against a target: on/over = good, within 10% under = warn, beyond = bad. */
export function salesTone(actual: number, target: number | null): Tone {
  if (target == null || target <= 0) return "neutral";
  if (actual >= target) return "good";
  return actual >= target * 0.9 ? "warn" : "bad";
}

/**
 * Budget sales for part of a week: the weekly figure × the share of the
 * week's expected sales that falls on the days in range. `weights` are the
 * typical share per weekday (0=Sun); defaults to equal days.
 */
export function proratedBudget(weekly: number, days: ISODate[], weights?: number[]): number {
  const w = weights ?? [1, 1, 1, 1, 1, 1, 1];
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return (weekly * days.reduce((s, d) => s + w[weekday(d)], 0)) / total;
}

/**
 * Typical share of a day's sales in each hour (index = local hour), for a
 * taproom open [open, close): a modest lunch bump when open by noon and a
 * dinner peak around 6–7pm. Sums to 1.
 */
export function hourlyShape(open: number, close: number): number[] {
  const w = new Array<number>(24).fill(0);
  for (let h = open; h < close && h < 24; h++) {
    const dinner = Math.exp(-((h + 0.5 - 18.75) ** 2) / (2 * 1.6 ** 2));
    const lunch = open <= 12 ? 0.45 * Math.exp(-((h + 0.5 - 13) ** 2) / (2 * 1.1 ** 2)) : 0;
    w[h] = 0.12 + dinner + lunch;
  }
  const sum = w.reduce((a, b) => a + b, 0);
  return sum > 0 ? w.map((x) => x / sum) : w;
}

/** Split an amount by weights into cents that add back up exactly. */
export function splitCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const cents = Math.round(total * 100);
  const raw = weights.map((x) => (x / sum) * cents);
  const out = raw.map(Math.floor);
  let left = cents - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const o of order) {
    if (left <= 0) break;
    out[o.i]++;
    left--;
  }
  return out.map((c) => c / 100);
}

// ---- CSV ---------------------------------------------------------------------

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
