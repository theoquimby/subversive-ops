/**
 * Insights Lab: turns the models' findings into a short, deduplicated list of
 * actions Max can take one at a time — each with a plain-English story, an
 * area, an effort, a simple 1–5 rating, and a "money saved / money earned"
 * vector — plus the data-range presets, the profit what-if and the track record.
 *
 * Pure: no I/O. The Python service may send `area`, `effort`, `vector`,
 * `story`, `visual`, `group` and `lead` on a finding; when it doesn't (an older
 * service), the defaults per kind below fill them in.
 */

import { addDays, ISODate } from "./dates";
import { type FeedState, type Opportunity, rankFeed, type Ranked } from "./analytics";

// ---- Data range ---------------------------------------------------------------------------

export type RangePreset = "12m" | "2y" | "3y" | "4y" | "all";
export const RANGE_PRESETS: { id: RangePreset; label: string; short: string; days: number | null }[] = [
  { id: "12m", label: "Last 12 months", short: "1 yr", days: 365 },
  { id: "2y", label: "Last 2 years", short: "2 yrs", days: 730 },
  { id: "3y", label: "Last 3 years", short: "3 yrs", days: 1096 },
  { id: "4y", label: "Last 4 years", short: "4 yrs", days: 1461 },
  { id: "all", label: "All history", short: "All", days: null },
];
export const DEFAULT_RANGE: RangePreset = "3y";
/** "All" still stops somewhere so the payload stays small and old menus don't mislead. */
export const MAX_RANGE_DAYS = 8 * 366;

export function parseRange(raw: string | null | undefined): RangePreset {
  try {
    const v = raw ? (JSON.parse(raw) as { preset?: string }).preset : null;
    return RANGE_PRESETS.some((p) => p.id === v) ? (v as RangePreset) : DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

/** First date of the window: the preset's length back from today, never before the first sale. */
export function rangeFrom(preset: RangePreset, today: ISODate, firstSale?: ISODate | null): ISODate {
  const p = RANGE_PRESETS.find((x) => x.id === preset) ?? RANGE_PRESETS[2];
  const from = addDays(today, -(p.days ?? MAX_RANGE_DAYS));
  return firstSale && firstSale > from ? firstSale : from;
}

/**
 * The last business day whose sales are complete. A sync that ran before
 * ~3am hasn't seen the end of the previous night, so that day is left out too.
 */
export function completeThrough(today: ISODate, lastSyncBusinessDate: ISODate | null): ISODate {
  const yesterday = addDays(today, -1);
  if (!lastSyncBusinessDate) return yesterday;
  const d = addDays(lastSyncBusinessDate, -1);
  return d < yesterday ? d : yesterday;
}

// ---- Kinds → area, effort, vector ----------------------------------------------------------

export type LabArea = "staffing" | "menu" | "ordering" | "hours" | "costs";
export type Effort = "easy" | "medium" | "hard";
export type Vector = "save" | "earn" | "info";

export const AREA_LABEL: Record<LabArea, string> = { staffing: "Staffing", menu: "Menu & prices", ordering: "Ordering & waste", hours: "Hours", costs: "Costs" };
export const EFFORT_LABEL: Record<Effort, string> = { easy: "Quick change", medium: "Takes a call or two", hard: "Big decision" };

const KIND_META: [prefix: string, meta: { area: LabArea; effort: Effort; vector: Vector }][] = [
  ["lab.slot", { area: "staffing", effort: "easy", vector: "save" }],
  ["staffing", { area: "staffing", effort: "easy", vector: "save" }],
  ["anomaly.slowdays", { area: "staffing", effort: "easy", vector: "save" }],
  ["feed.overtime", { area: "staffing", effort: "easy", vector: "save" }],
  ["feed.schedule", { area: "staffing", effort: "easy", vector: "save" }],
  ["feed.weather", { area: "staffing", effort: "easy", vector: "save" }],
  ["feed.reviews", { area: "staffing", effort: "medium", vector: "earn" }],
  ["feed.hours", { area: "hours", effort: "easy", vector: "save" }],
  ["week.loss", { area: "hours", effort: "hard", vector: "save" }],
  ["menu.reprice", { area: "menu", effort: "easy", vector: "earn" }],
  ["price.test", { area: "menu", effort: "easy", vector: "earn" }],
  ["menu.promote", { area: "menu", effort: "easy", vector: "earn" }],
  ["feed.mix", { area: "menu", effort: "easy", vector: "earn" }],
  ["feed.follow.wait", { area: "menu", effort: "easy", vector: "info" }],
  ["feed.follow", { area: "menu", effort: "easy", vector: "earn" }],
  ["feed.event", { area: "menu", effort: "medium", vector: "earn" }],
  ["orders", { area: "ordering", effort: "easy", vector: "save" }],
  ["feed.leak.waste", { area: "ordering", effort: "medium", vector: "save" }],
  ["feed.cash", { area: "ordering", effort: "easy", vector: "save" }],
  ["feed.pour", { area: "ordering", effort: "medium", vector: "save" }],
  ["feed.leak.gap", { area: "ordering", effort: "medium", vector: "save" }],
  ["feed.price.creep", { area: "costs", effort: "medium", vector: "save" }],
  ["feed.price.typo", { area: "costs", effort: "easy", vector: "save" }],
  ["feed.leak.invoices", { area: "costs", effort: "easy", vector: "save" }],
];

export function kindMeta(kind: string) {
  return KIND_META.find(([p]) => kind === p || kind.startsWith(`${p}.`))?.[1] ?? { area: "costs" as LabArea, effort: "medium" as Effort, vector: "save" as Vector };
}

/** One-off findings that are worth knowing but aren't actions (they live in the Lab tiles). */
const NOT_ACTIONS = ["anomaly.labor", "feed.follow.wait"];

// ---- Stories and visuals --------------------------------------------------------------------

export interface Story {
  now: string;
  why: string;
  todo: string;
  gain: string;
}

export type Visual =
  | { type: "hours"; rows: { label: string; sales: number; people: number; need: number; flag: boolean }[] }
  | { type: "compare"; unit: "money" | "number"; rows: { label: string; value: number; tone?: "good" | "bad" }[] }
  | { type: "week"; rows: { label: string; value: number; flag?: boolean }[] };

export interface LabFinding extends Opportunity {
  area?: LabArea;
  effort?: Effort;
  vector?: Vector;
  story?: Story;
  visual?: Visual;
  group?: string;
  lead?: boolean;
}

/** The four beats, falling back to title / first "how" line / action when the model didn't write them (the gain then renders from the dollars). */
export function storyOf(o: LabFinding): Story {
  if (o.story?.now && o.story?.todo) return o.story;
  return {
    now: o.title,
    why: o.how[0] ?? "",
    todo: o.action,
    gain: "",
  };
}

/** Root cause: the model's group, or (older service) the same weekday and part of the day for hour/staffing findings. */
export function rootCause(o: LabFinding): string | null {
  if (o.group) return o.group;
  if ((o.kind === "staffing.over" || o.kind === "feed.hours") && o.subject) {
    const [wd, h] = o.subject.split(".").map(Number);
    if (Number.isFinite(wd) && Number.isFinite(h)) return `slot.${wd}.${dayPart(h)}`;
  }
  return null;
}

function dayPart(h: number) {
  return h < 11 ? "early-morning" : h < 13 ? "late-morning" : h < 16 ? "afternoon" : h < 18 ? "early-evening" : h < 21 ? "evening" : "late-night";
}

// ---- Rating -----------------------------------------------------------------------------------

export type Rating = "Worth doing" | "Maybe" | "Low";

/**
 * 1–5 stars from three things a non-statistician cares about: how much money
 * (up to 2.5 points), how sure we are (up to 1.5), and how easy (up to 1).
 */
export function stars(monthly: number, confidence: number, effort: Effort): number {
  const m = monthly >= 500 ? 2.5 : monthly >= 250 ? 2 : monthly >= 100 ? 1.5 : monthly >= 50 ? 1 : 0.5;
  const c = Math.max(0, Math.min(1, confidence)) * 1.5;
  const e = effort === "easy" ? 1 : effort === "medium" ? 0.5 : 0;
  return Math.max(1, Math.min(5, Math.round(m + c + e)));
}

export const ratingOf = (s: number): Rating => (s >= 4 ? "Worth doing" : s === 3 ? "Maybe" : "Low");
export const certaintyWord = (c: number) => (c >= 0.6 ? "Pretty sure" : c >= 0.4 ? "Fairly sure" : "A hunch");

// ---- Actions ---------------------------------------------------------------------------------

export interface LabAction extends Ranked {
  area: LabArea;
  effort: Effort;
  vector: Vector;
  story: Story;
  visual: Visual | null;
  stars: number;
  rating: Rating;
  /** The finding keys merged into this one (marking it marks them all). */
  parts: string[];
  /** Other findings that pointed at the same root cause, as one-liners. */
  alsoSeen: string[];
}

/**
 * Merge findings that share a root cause into one (the lead's words, the
 * bigger value — they're alternative fixes for the same problem, never added),
 * drop one-offs and pure information, then rank with Max's Done / Later / Not
 * for us and novelty (rankFeed), and rate.
 */
export function buildActions(findings: LabFinding[], state: FeedState, today: ISODate, opts: { novelty?: boolean } = {}): LabAction[] {
  const groups = new Map<string, LabFinding[]>();
  const singles: LabFinding[] = [];
  for (const o of findings) {
    if (NOT_ACTIONS.some((k) => o.kind === k || o.kind.startsWith(`${k}.`))) continue;
    if ((o.vector ?? kindMeta(o.kind).vector) === "info") continue;
    if (o.kind === "feed.follow" && !/−/.test(o.title)) continue; // a price change that worked is good news, not a to-do
    const g = rootCause(o);
    if (g) groups.set(g, [...(groups.get(g) ?? []), o]);
    else singles.push(o);
  }
  const merged: (LabFinding & { parts: string[]; alsoSeen: string[] })[] = singles.map((o) => ({ ...o, parts: [o.key], alsoSeen: [] }));
  for (const [g, xs] of groups) {
    const lead = xs.find((x) => x.lead) ?? [...xs].sort((a, b) => b.monthly - a.monthly)[0];
    const monthly = Math.max(...xs.map((x) => x.monthly));
    merged.push({
      ...lead,
      key: `g:${g}`,
      monthly,
      low: Math.min(...xs.map((x) => x.low)),
      high: Math.max(...xs.map((x) => x.high)),
      confidence: Math.max(...xs.map((x) => x.confidence)),
      subject: g,
      parts: xs.map((x) => x.key),
      alsoSeen: xs.filter((x) => x !== lead && !x.lead).map((x) => x.title),
    });
  }
  // Marks on any merged part (from before merging existed) still count.
  const marks = { ...state.marks };
  for (const m of merged) {
    if (marks[m.key]) continue;
    const prior = m.parts.map((p) => state.marks[p]).find((x) => x && x.status !== "snoozed");
    if (prior && m.parts.length > 1) marks[m.key] = prior;
  }
  const ranked = rankFeed(merged, { ...state, marks }, today, opts);
  const extra = new Map(merged.map((m) => [m.key, m]));
  return ranked.map((r) => {
    const src = extra.get(r.key)!;
    const meta = kindMeta(r.kind);
    const effort = src.effort ?? meta.effort;
    const s = stars(r.value, r.confidence, effort);
    const ease = effort === "easy" ? 1 : effort === "medium" ? 0.85 : 0.65;
    return {
      ...r,
      score: r.score * ease,
      area: src.area ?? meta.area,
      effort,
      vector: src.vector ?? meta.vector,
      story: storyOf(src),
      visual: src.visual ?? null,
      stars: s,
      rating: ratingOf(s),
      parts: src.parts,
      alsoSeen: src.alsoSeen,
    };
  }).sort((a, b) => b.stars - a.stars || b.score - a.score);
}

export type SortVector = "best" | "saved" | "earned" | "easiest" | "certain";
export const SORTS: { id: SortVector; label: string }[] = [
  { id: "best", label: "Best first" },
  { id: "saved", label: "Money saved" },
  { id: "earned", label: "Money earned" },
  { id: "easiest", label: "Easiest first" },
  { id: "certain", label: "Most certain" },
];

const EFFORT_RANK: Record<Effort, number> = { easy: 0, medium: 1, hard: 2 };

/** Re-order (and for saved/earned, filter) the list by what Max is looking for. */
export function sortActions<T extends Pick<LabAction, "stars" | "score" | "value" | "vector" | "effort" | "confidence" | "area">>(xs: T[], by: SortVector, area?: LabArea | null): T[] {
  let out = area ? xs.filter((x) => x.area === area) : [...xs];
  if (by === "saved") out = out.filter((x) => x.vector === "save");
  if (by === "earned") out = out.filter((x) => x.vector === "earn");
  const cmp: Record<SortVector, (a: T, b: T) => number> = {
    best: (a, b) => b.stars - a.stars || b.score - a.score,
    saved: (a, b) => b.value - a.value,
    earned: (a, b) => b.value - a.value,
    easiest: (a, b) => EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort] || b.stars - a.stars,
    certain: (a, b) => b.confidence - a.confidence || b.value - a.value,
  };
  return out.sort(cmp[by]);
}

// ---- What-if: guests → sales → costs → profit ----------------------------------------------

export interface ProfitBase {
  /** A month: sales, food & drink cost, wages, wage hours, waste, open days, orders. */
  sales: number;
  cogs: number;
  labor: number;
  laborHours: number;
  waste: number;
  openDays: number;
  guests: number;
  /** Sales-weighted price response (negative: −0.8 → +10% price, ~8% fewer sold). */
  elasticity: number;
  fixed?: number;
}

export interface WhatIfInput {
  /** +0.02 = 2% higher prices */
  pricePct: number;
  /** Labor hours a day removed (positive = fewer hours) */
  laborHoursPerDay: number;
  /** +0.05 = 5% more guests */
  guestsPct: number;
}

/**
 * Monthly profit before fixed costs, now and after the moves. Prices move
 * volume through the price response; more guests bring sales at today's
 * food cost with the same team; fewer hours save the average loaded wage.
 */
export function whatIf(b: ProfitBase, w: WhatIfInput) {
  const rate = b.laborHours > 0 ? b.labor / b.laborHours : 0;
  const costShare = b.sales > 0 ? b.cogs / b.sales : 0.3;
  const volume = (1 + w.guestsPct) * (1 + w.pricePct) ** b.elasticity;
  const sales = b.sales * volume * (1 + w.pricePct);
  const cogs = b.sales * costShare * volume;
  const labor = Math.max(0, b.labor - w.laborHoursPerDay * rate * b.openDays);
  const waste = b.waste * volume;
  const profit = (x: { sales: number; cogs: number; labor: number; waste: number }) => x.sales - x.cogs - x.labor - x.waste - (b.fixed ?? 0);
  const before = { sales: b.sales, cogs: b.cogs, labor: b.labor, waste: b.waste };
  const after = { sales, cogs, labor, waste };
  return {
    before: { ...before, profit: profit(before), guests: b.guests, laborPct: b.sales ? b.labor / b.sales : 0 },
    after: { ...after, profit: profit(after), guests: b.guests * volume, laborPct: sales ? labor / sales : 0 },
    change: profit(after) - profit(before),
  };
}

// ---- Track record ----------------------------------------------------------------------------

export interface TrackItem {
  key: string;
  title: string;
  at: ISODate;
  monthly: number;
  /** A measured result when a follow-up exists ("Since raising the burger: +$212 a month"). */
  measured: string | null;
}

/** What Max has done, newest first, with what we expected and (for price moves) what we measured since. */
export function trackRecord(state: FeedState, findings: Opportunity[]): { items: TrackItem[]; monthly: number } {
  const follows = findings.filter((f) => f.kind === "feed.follow" || f.kind === "feed.follow.wait");
  const items = Object.entries(state.marks)
    .filter(([, m]) => m.status === "done")
    .map(([key, m]) => {
      const f = m.subject ? follows.find((x) => x.subject === m.subject) : undefined;
      return { key, title: m.title, at: m.at, monthly: m.monthly ?? 0, measured: f ? f.title : null };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
  return { items, monthly: items.reduce((s, i) => s + Math.max(0, i.monthly), 0) };
}

/** Price changes Square shows you already made, and what each one did (good news included). */
export function priceResults(findings: Opportunity[]) {
  return findings.filter((f) => f.kind === "feed.follow").map((f) => ({ key: f.key, title: f.title, good: !/−/.test(f.title), monthly: f.monthly }));
}
