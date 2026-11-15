import { weekday, type ISODate } from "./dates";

/**
 * Does website activity go with sales? Careful by design, in the same spirit
 * as the Insights models: a finding only "counts" when it survives the
 * controls, and it's always worded as going together, never as cause.
 *
 * Controls: weekday (Saturdays are busy for both), a straight-line trend
 * (both grow in summer), and event days are left out (an event drives clicks
 * and sales at once). Model: log(sales) ~ weekday + trend + actions, with
 * heteroskedasticity-robust (HC1) standard errors. It counts only when the
 * 90% range for the actions effect is clear of zero, with at least 8 weeks
 * of open days and enough day-to-day variation in the actions.
 */

export interface LinkDay {
  date: ISODate;
  /** Net sales (Square), 0 or null when closed */
  sales: number | null;
  /** Website actions that day (e.g. direction clicks) */
  actions: number;
  /** An event, holiday or closure that day */
  event?: boolean;
}

export type LinkVerdict = "real" | "unclear" | "thin";

export interface SalesLink {
  verdict: LinkVerdict;
  /** Open, non-event days used */
  n: number;
  /** Effect on sales of one more action (fraction, e.g. 0.004 = +0.4%) */
  perAction: number | null;
  /** Typical gap in actions between a busier-than-usual day and a quieter one (same weekday) */
  gap: number | null;
  /** Sales difference for that gap, and its 90% range (fractions) */
  effect: { mid: number; low: number; high: number } | null;
  /** Plain-English sentence, never overclaiming */
  sentence: string;
  /** Why it's not shown as a finding (thin/unclear) */
  why: string | null;
}

export const MIN_LINK_DAYS = 56;
const Z90 = 1.645;

// ---- Small linear algebra ----------------------------------------------------------------

function invert(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-10) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 2 * n; k++) a[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (!f) continue;
      for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((r) => r.slice(n));
}

/** OLS with HC1 robust standard errors. Returns null when the design is singular. */
export function ols(X: number[][], y: number[]): { beta: number[]; se: number[] } | null {
  const n = X.length;
  const k = X[0]?.length ?? 0;
  if (n <= k || k === 0) return null;
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const inv = invert(xtx);
  if (!inv) return null;
  const xty = Array.from({ length: k }, (_, i) => X.reduce((s, r, t) => s + r[i] * y[t], 0));
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));
  const resid = X.map((r, t) => y[t] - r.reduce((s, v, j) => s + v * beta[j], 0));
  // meat = Σ e² x xᵀ, scaled n/(n−k)
  const meat = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r, t) => s + resid[t] ** 2 * r[i] * r[j], 0)));
  const scale = n / (n - k);
  // Sandwich: inv · meat · inv (k is small, clarity over speed).
  const cov = Array.from({ length: k }, () => Array.from({ length: k }, () => 0));
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) s += inv[i][a] * meat[a][b] * inv[b][j];
      cov[i][j] = s * scale;
    }
  return { beta, se: cov.map((r, i) => Math.sqrt(Math.max(0, r[i]))) };
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const sd = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1));
};

const pctText = (f: number) => `${Math.round(Math.abs(f) * 100)}%`;

/**
 * Website actions vs sales by day. `what` names the actions in the sentence
 * ("direction clicks").
 */
export function salesLink(days: LinkDay[], what = "website actions"): SalesLink {
  const use = days.filter((d) => !d.event && d.sales != null && d.sales > 0).sort((a, b) => a.date.localeCompare(b.date));
  const n = use.length;
  const base = { n, perAction: null, gap: null, effect: null };
  if (n < MIN_LINK_DAYS) {
    return { ...base, verdict: "thin", sentence: `Not enough history yet to tell whether ${what} go with sales.`, why: `Needs ${MIN_LINK_DAYS} open days without events that have both website and Square numbers; there are ${n}.` };
  }
  const acts = use.map((d) => d.actions);
  if (sd(acts) < 1 || mean(acts) < 1) {
    return { ...base, verdict: "thin", sentence: `There are too few ${what} a day to compare busy and quiet days.`, why: `About ${mean(acts).toFixed(1)} a day; it needs at least one a day on average and real day-to-day variation.` };
  }

  // Within-weekday deviations of actions, for the "busier than usual" gap.
  const byWd = new Map<number, number[]>();
  for (const d of use) byWd.set(weekday(d.date), [...(byWd.get(weekday(d.date)) ?? []), d.actions]);
  const wdMean = new Map([...byWd].map(([k, v]) => [k, mean(v)]));
  const dev = use.map((d) => d.actions - wdMean.get(weekday(d.date))!);
  const hi = dev.filter((x) => x > 0);
  const lo = dev.filter((x) => x <= 0);
  const gap = hi.length && lo.length ? mean(hi) - mean(lo) : 0;

  // Design: intercept, weekday dummies (present weekdays only, first dropped), trend (in 30-day units), actions.
  const wds = [...byWd.keys()].sort();
  const t0 = Date.parse(use[0].date);
  const X = use.map((d) => {
    const wd = weekday(d.date);
    return [1, ...wds.slice(1).map((w) => (w === wd ? 1 : 0)), (Date.parse(d.date) - t0) / (30 * 86_400_000), d.actions];
  });
  const y = use.map((d) => Math.log(d.sales!));
  const fit = ols(X, y);
  if (!fit) return { ...base, verdict: "thin", sentence: `Couldn't compare ${what} with sales yet.`, why: "The days available don't vary enough to separate the weekday pattern from the website." };
  const k = fit.beta.length - 1;
  const b = fit.beta[k];
  const se = fit.se[k];
  const lo90 = b - Z90 * se;
  const hi90 = b + Z90 * se;
  const effect = { mid: Math.exp(b * gap) - 1, low: Math.exp(lo90 * gap) - 1, high: Math.exp(hi90 * gap) - 1 };
  const gapText = gap >= 10 ? Math.round(gap) : Math.round(gap * 10) / 10;
  if (lo90 > 0 || hi90 < 0) {
    const up = b > 0;
    return {
      verdict: "real",
      n,
      perAction: Math.exp(b) - 1,
      gap,
      effect,
      sentence: `Days with more ${what} than usual for that weekday (about ${gapText} more) had about ${pctText(effect.mid)} ${up ? "more" : "lower"} sales (likely ${pctText(up ? effect.low : effect.high)}–${pctText(up ? effect.high : effect.low)}). They go together; a busy day brings both, so this isn't proof the website caused the sales.`,
      why: null,
    };
  }
  return {
    verdict: "unclear",
    n,
    perAction: Math.exp(b) - 1,
    gap,
    effect,
    sentence: `No clear link yet between ${what} and sales once weekday and the season are allowed for.`,
    why: `Over ${n} open days, a busier-than-usual day for ${what} came with anywhere from ${effect.low >= 0 ? "+" : "−"}${pctText(effect.low)} to ${effect.high >= 0 ? "+" : "−"}${pctText(effect.high)} in sales: too wide to call.`,
  };
}
