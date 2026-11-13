/**
 * Insights: shapes returned by the analytics service (analytics/subops, Python)
 * and the pure logic the app runs on them — ranking the feed (value ×
 * confidence × novelty × what Max finds useful), remembering Done / Not
 * useful / Snooze, the price slider's what-if, and break-even.
 */

import { addDays, daysBetween, ISODate } from "./dates";

export type ModelId = "menu" | "price" | "forecast" | "orders" | "anomalies" | "drivers" | "staffing" | "seasons" | "week";
export const MODEL_IDS: ModelId[] = ["menu", "price", "forecast", "orders", "anomalies", "drivers", "staffing", "seasons", "week"];

export interface Confidence {
  level: "low" | "medium" | "high";
  /** 0..1 */
  score: number;
  /** "Based on 9 weeks — rough" */
  note: string;
}

export interface InputRow {
  label: string;
  value: string;
}

// ---- Evidence: what a finding compared, in plain English ("Show me how") ---------------------

/** One line of the evidence table: before → after with the change, or a single value. */
export interface EvidenceRow {
  label: string;
  before?: string;
  after?: string;
  /** "−10%" */
  change?: string;
  /** −0.1, for colour */
  changePct?: number;
  value?: string;
  note?: string;
  strong?: boolean;
}

export type EvidenceChart =
  | { type: "series"; unit: "per100" | "money" | "count"; label: string; refLabel?: string | null; marker?: ISODate | null; markerLabel?: string; points: { x: ISODate; y: number; ref?: number }[] }
  | { type: "compare"; unit: "money" | "number" | "hours" | "people"; rows: { label: string; value: number; tone?: "good" | "bad" | null }[] };

/**
 * Sent by analytics service 2.1+ on every finding. verdict: "real" (it counts), "unclear" (not
 * distinguishable from normal ups and downs once traffic, weekday, season and events are allowed
 * for — on the watch list), "good" (a change that worked), "info".
 */
export interface Evidence {
  verdict: "real" | "unclear" | "good" | "info";
  summary: string;
  rows: EvidenceRow[];
  steps: string[];
  excluded: string[];
  method: string;
  /** "Fairly sure: …" */
  sure: string;
  /** The effect and its likely range, as fractions (−0.04 = −4%). */
  effect?: { mid: number; low: number; high: number; label?: string };
  chart?: EvidenceChart | null;
  /** What would make a watched finding count. */
  watch?: string | null;
}

export interface Opportunity {
  /** Stable per subject, e.g. "menu.reprice.<recipeId>" — novelty and Done/Snooze hang off it. */
  key: string;
  /** Family, e.g. "menu.reprice" — Max's "Not useful" down-ranks the whole family. */
  kind: string;
  model: string;
  title: string;
  action: string;
  /** $/month at stake (positive = money to gain or stop losing). */
  monthly: number;
  low: number;
  high: number;
  /** 0..1 */
  confidence: number;
  how: string[];
  inputs: InputRow[];
  href: string;
  subject?: string | null;
  /** One-time amount (cash freed, a single bad day); ranked at a twelfth a month. */
  oneOff?: number;
  /** What was compared (service 2.1+). */
  evidence?: Evidence | null;
  /** "watching": didn't survive the controls — shown on the watch list, never as an action. */
  status?: "watching" | null;
  /** What would make a watched finding count. */
  watch?: string | null;
}

export type Chart =
  | { type: "quadrant"; points: { label: string; x: number; y: number; cls: string }[] }
  | { type: "bars"; unit: "money"; rows: { label: string; value: number; low?: number; high?: number }[] }
  | { type: "band"; rows: { date: ISODate; mid: number; low: number; high: number; closed: boolean }[]; history: { date: ISODate; actual: number; forecast: number }[] }
  | { type: "heatmap"; rows: string[]; cols: string[]; cells: { r: number; c: number; splh: number; sales: number; people: number; flag: "over" | "under" | null }[]; splh: number }
  | { type: "list"; rows: { date: ISODate; metric: string; z: number; text: string }[] }
  | { type: "seasons"; months: string[]; index: (number | null)[]; years: { year: number; values: (number | null)[] }[] }
  | { type: "week"; rows: { label: string; value: number; sales?: number; labor?: number; cogs?: number; flag?: boolean }[] };

export interface Insight {
  id: ModelId;
  title: string;
  status: "ok" | "thin" | "none" | "error";
  headline: string;
  action: string;
  monthly: number | null;
  range: [number, number] | null;
  confidence: Confidence;
  how: string[];
  inputs: InputRow[];
  chart: Chart | null;
  details: Record<string, unknown>;
  opportunities: Opportunity[];
  /** The evidence behind the headline (service 2.1+). */
  evidence?: Evidence | null;
  /** Findings that didn't survive the controls (service 2.1+). */
  watching?: Opportunity[];
}

export interface FeedResult {
  items: Opportunity[];
  errors: string[];
  finders: string[];
  /** Findings that didn't survive the controls (service 2.1+). */
  watching?: Opportunity[];
}

export interface AnalyticsRun {
  version: string;
  computedAt: string;
  results: Partial<Record<ModelId, Insight>> & { feed?: FeedResult };
  timings: Record<string, number>;
  /** Where it ran: the Vercel Python service or python3 on this machine. */
  source: "service" | "local";
  seconds: number | null;
  /** The history it used (Insights Lab range) — absent on runs from before the Lab. */
  window?: { preset: string; from: ISODate; through: ISODate; firstSale: ISODate | null };
  /** What the models saw after cleaning: open days, stray days dropped, closed weekdays. */
  data?: { from: ISODate | null; to: ISODate | null; openDays: number; spanDays: number; strayDays: number; closedWeekdays: number[] } | null;
}

// ---- Price what-if (the slider) -----------------------------------------------------

export interface PriceFit {
  id: string;
  name: string;
  price: number;
  unitCost: number | null;
  qtyMonth: number;
  elasticity: number;
  sd: number;
  source: "measured" | "typical";
}

/** Monthly profit change from moving a price by `delta`, constant elasticity — the same formula the model uses. */
export function priceWhatIf(fit: Pick<PriceFit, "price" | "unitCost" | "qtyMonth" | "elasticity" | "sd">, delta: number) {
  const at = (e: number) => {
    const p1 = fit.price + delta;
    if (fit.price <= 0 || p1 <= 0) return { qty: fit.qtyMonth, profit: 0 };
    const q1 = fit.qtyMonth * (p1 / fit.price) ** e;
    const c = fit.unitCost ?? 0;
    return { qty: q1, profit: q1 * (p1 - c) - fit.qtyMonth * (fit.price - c) };
  };
  const mid = at(fit.elasticity);
  const a = at(fit.elasticity - 1.28 * fit.sd);
  const b = at(Math.min(-0.01, fit.elasticity + 1.28 * fit.sd));
  return { qty: mid.qty, profit: mid.profit, low: Math.min(a.profit, b.profit), high: Math.max(a.profit, b.profit), qtyChange: fit.qtyMonth ? mid.qty / fit.qtyMonth - 1 : 0 };
}

// ---- Break-even (recomputed instantly when fixed costs change) ------------------------

export interface FixedCosts {
  rent: number | null;
  utilities: number | null;
  insurance: number | null;
  other: number | null;
}

export const fixedTotal = (f: FixedCosts | null | undefined) => (f ? (f.rent ?? 0) + (f.utilities ?? 0) + (f.insurance ?? 0) + (f.other ?? 0) : 0);

/**
 * Break-even sales a day: (fixed costs + fixed labor) ÷ the share of each sales
 * dollar left after food cost, waste and variable labor.
 */
export function breakEven(args: { fixedMonthly: number; laborFixedDaily: number; laborVariable: number; cogsPct: number; wastePct: number; openDaysPerMonth: number }) {
  const margin = 1 - args.cogsPct - args.wastePct - args.laborVariable;
  if (margin <= 0.05 || args.openDaysPerMonth <= 0) return null;
  const monthly = (args.fixedMonthly + args.laborFixedDaily * args.openDaysPerMonth) / margin;
  return { monthly, daily: monthly / args.openDaysPerMonth, margin };
}

// ---- Feed state: Done / Not useful / Snooze, and what's been shown ------------------------

export type FeedVerdict = "done" | "dismissed" | "snoozed";

export interface FeedMark {
  status: FeedVerdict;
  at: ISODate;
  /** Snoozed until (exclusive). */
  until?: ISODate;
  kind: string;
  title: string;
  subject?: string | null;
  monthly?: number;
}

export interface FeedState {
  marks: Record<string, FeedMark>;
  /** key → when it was first and last shown, how many weeks, and its value then. */
  seen: Record<string, { first: ISODate; last: ISODate; weeks: number; monthly: number }>;
  /** kind → learned weight (1 = neutral). "Not useful" pushes a kind down, "Done" nudges it up. */
  weights: Record<string, number>;
}

export const emptyFeedState = (): FeedState => ({ marks: {}, seen: {}, weights: {} });

export function parseFeedState(raw: string | null | undefined): FeedState {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<FeedState>) : {};
    return { marks: v.marks ?? {}, seen: v.seen ?? {}, weights: v.weights ?? {} };
  } catch {
    return emptyFeedState();
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Record Max's verdict on a finding and learn from it. Pure: returns a new state. */
export function markFeed(state: FeedState, item: Pick<Opportunity, "key" | "kind" | "title" | "subject" | "monthly">, verdict: FeedVerdict | "undo", today: ISODate, snoozeDays = 14): FeedState {
  const marks = { ...state.marks };
  const weights = { ...state.weights };
  const prev = marks[item.key];
  // Undo reverses the learning that verdict caused.
  if (prev?.status === "dismissed") weights[item.kind] = clamp((weights[item.kind] ?? 1) / 0.6, 0.2, 1.5);
  if (prev?.status === "done") weights[item.kind] = clamp((weights[item.kind] ?? 1) / 1.1, 0.2, 1.5);
  if (verdict === "undo") {
    delete marks[item.key];
    return { ...state, marks, weights };
  }
  marks[item.key] = { status: verdict, at: today, kind: item.kind, title: item.title, subject: item.subject ?? null, monthly: item.monthly, ...(verdict === "snoozed" ? { until: addDays(today, snoozeDays) } : {}) };
  if (verdict === "dismissed") weights[item.kind] = clamp((weights[item.kind] ?? 1) * 0.6, 0.2, 1.5);
  if (verdict === "done") weights[item.kind] = clamp((weights[item.kind] ?? 1) * 1.1, 0.2, 1.5);
  return { ...state, marks, weights };
}

/** Remember what was shown this week (once per 7 days per key), so the same finding fades. */
export function markSeen(state: FeedState, shown: Pick<Opportunity, "key" | "monthly">[], today: ISODate): FeedState {
  const seen = { ...state.seen };
  for (const o of shown) {
    const s = seen[o.key];
    if (!s) seen[o.key] = { first: today, last: today, weeks: 1, monthly: o.monthly };
    else if (daysBetween(s.last, today) >= 7) seen[o.key] = { ...s, last: today, weeks: s.weeks + 1, monthly: o.monthly };
  }
  // Forget anything not shown for 90 days.
  for (const [k, s] of Object.entries(seen)) if (daysBetween(s.last, today) > 90) delete seen[k];
  return { ...state, seen };
}

export interface Ranked extends Opportunity {
  score: number;
  /** Monthly value used for ranking (monthly + oneOff/12, floored). */
  value: number;
  novelty: number;
  weight: number;
  isNew: boolean;
}

/**
 * Rank findings: value ($/month, one-offs at a twelfth) × confidence × novelty ×
 * learned kind weight. Done and Not useful are hidden; snoozed until their date.
 * A finding shown for weeks fades (×0.75 a week, floor 0.3) unless its value moved 30%+.
 * Findings about the same subject (e.g. "reprice the burger" from two models) keep only the best.
 */
export function rankFeed(items: Opportunity[], state: FeedState, today: ISODate, opts: { novelty?: boolean } = {}): Ranked[] {
  const useNovelty = opts.novelty ?? true;
  const ranked: Ranked[] = [];
  for (const o of items) {
    const m = state.marks[o.key];
    if (m && (m.status === "done" || m.status === "dismissed")) continue;
    if (m?.status === "snoozed" && m.until && today < m.until) continue;
    const value = Math.max(20, (o.monthly || 0) + (o.oneOff ?? 0) / 12);
    const s = state.seen[o.key];
    let novelty = 1;
    if (useNovelty && s) {
      const moved = s.monthly > 0 ? Math.abs(o.monthly - s.monthly) / s.monthly : 1;
      novelty = moved >= 0.3 ? 1 : Math.max(0.3, 0.75 ** Math.max(0, s.weeks - (daysBetween(s.last, today) < 7 ? 1 : 0)));
    }
    const weight = state.weights[o.kind] ?? 1;
    const conf = clamp(o.confidence, 0.05, 1);
    ranked.push({ ...o, value, novelty, weight, isNew: !s, score: value * conf * novelty * weight });
  }
  ranked.sort((a, b) => b.score - a.score || b.value - a.value);
  const bySubject = new Set<string>();
  return ranked.filter((r) => {
    if (!r.subject) return true;
    const family = r.kind.split(".").slice(0, 2).join(".");
    const k = `${family.startsWith("menu.reprice") || family.startsWith("price.test") ? "price" : family}|${r.subject}`;
    if (bySubject.has(k)) return false;
    bySubject.add(k);
    return true;
  });
}

/** Every finding the run produced: model opportunities plus the feed. */
export function allFindings(run: AnalyticsRun | null): Opportunity[] {
  if (!run) return [];
  const out: Opportunity[] = [];
  for (const id of MODEL_IDS) out.push(...(run.results[id]?.opportunities ?? []));
  out.push(...(run.results.feed?.items ?? []));
  const seen = new Set<string>();
  return out.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true)));
}

/** A finding that didn't survive the controls: it belongs on the watch list, not in the actions. */
export const isWatching = (o: Pick<Opportunity, "status" | "evidence">) => o.status === "watching" || o.evidence?.verdict === "unclear";

/** Everything the models are watching (not yet distinguishable from normal ups and downs), biggest effect first. */
export function allWatching(run: AnalyticsRun | null): Opportunity[] {
  if (!run) return [];
  const out: Opportunity[] = [];
  for (const id of MODEL_IDS) out.push(...(run.results[id]?.watching ?? []));
  out.push(...(run.results.feed?.watching ?? []));
  // An older service may still put an unclear finding among the actions.
  out.push(...allFindings(run).filter(isWatching));
  const seen = new Set<string>();
  return out
    .filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true)))
    .sort((a, b) => Math.abs(b.evidence?.effect?.mid ?? 0) - Math.abs(a.evidence?.effect?.mid ?? 0));
}

const certainty = (c: number) => (c >= 0.6 ? "Pretty sure" : c >= 0.4 ? "Fairly sure" : "A hunch");

/**
 * The evidence for a finding: the model's own (service 2.1+), or — for an older service and for
 * findings worked out in the app (kegs) — one built from its "how" and inputs, so every card can
 * show what's behind it.
 */
export function evidenceOf(o: Pick<Opportunity, "evidence" | "how" | "inputs" | "confidence" | "title">): Evidence {
  if (o.evidence && Array.isArray(o.evidence.rows)) return { ...o.evidence, steps: o.evidence.steps ?? [], excluded: o.evidence.excluded ?? [] };
  const how = (o.how ?? []).filter(Boolean);
  const c = o.confidence ?? 0;
  const why = c >= 0.6 ? "the pattern is steady across the weeks we looked at." : c >= 0.4 ? "the pattern shows up most weeks, but the dollars could be off by a fair bit." : "it's based on a short stretch or a few examples — treat it as a hunch to check.";
  return {
    verdict: "real",
    summary: how[0] ?? o.title,
    rows: (o.inputs ?? []).map((i) => ({ label: i.label, value: i.value })),
    steps: how.slice(1),
    excluded: [],
    method: "",
    sure: `${certainty(c)}: ${why}`,
  };
}

/** "2 hours ago" style age, and whether the run is stale (older than ~36h). */
export function runAge(computedAt: string | null | undefined, now = new Date()) {
  if (!computedAt) return { hours: null, stale: true };
  const hours = (now.getTime() - new Date(computedAt).getTime()) / 3_600_000;
  return { hours, stale: hours > 36 };
}

/** Forecast range for one date from a run (for /sales, the schedule and ordering). */
export function forecastRange(run: AnalyticsRun | null, date: ISODate): { low: number; mid: number; high: number } | null {
  const days = (run?.results.forecast?.details?.days ?? []) as { date: ISODate; closed: boolean; low: number; mid: number; high: number }[];
  const d = days.find((x) => x.date === date);
  return d && !d.closed ? { low: d.low, mid: d.mid, high: d.high } : null;
}
