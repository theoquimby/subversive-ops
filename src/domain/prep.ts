/**
 * The daily prep list: how much of each prep recipe (sauces, pickles, croutons…)
 * to make today.
 *
 *   need  = forecast use over the cover window (the next N service days)
 *           — capped at what gets used within its shelf life
 *           — raised to the par level when one is set
 *   make  = need − on hand, rounded up to whole / half batches
 *
 * Forecast use comes from the menu items (and add-ons) that use each prep
 * recipe; a prep recipe inside another (roasted garlic in aioli) is needed for
 * the batches of its parent being made today. Pure: no I/O.
 */

import { CostingContext, CostRecipe, recipeYieldInBase } from "./costing";
import { addDays, ISODate, weekday, WEEKDAYS } from "./dates";
import { BaseUnit, normalizeUnit, standardUnit, toBase, UnitError } from "./units";

export type PrepRounding = "batch" | "half" | "exact";
export const PREP_ROUNDINGS: PrepRounding[] = ["batch", "half", "exact"];

/** What the kitchen counts and makes a prep item in. */
export interface PrepUnit {
  name: string;
  /** Base units (ml, g or each) in one. */
  baseQty: number;
  /** A container ("cambro") rather than a measure ("qt"). */
  container?: boolean;
}

export interface PrepItemSettings {
  onList: boolean;
  parBase: number | null;
  shelfLifeDays: number | null;
  rounding: PrepRounding;
  station: string | null;
  unit: PrepUnit | null;
}

export const DEFAULT_PREP_SETTINGS: PrepItemSettings = { onList: true, parBase: null, shelfLifeDays: null, rounding: "batch", station: null, unit: null };

// ---- Units ---------------------------------------------------------------------

const std = (unit: string, base: BaseUnit): PrepUnit => ({ name: unit, baseQty: toBase(1, unit, base) });

/** The unit a prep item is shown in when none is set: quarts, pounds or each. */
export function defaultPrepUnit(r: Pick<CostRecipe, "yieldQty" | "yieldUnit" | "yieldBase">): PrepUnit {
  let batch = 0;
  try {
    batch = recipeYieldInBase(r as CostRecipe);
  } catch {
    batch = 0;
  }
  if (r.yieldBase === "ml") return batch >= toBase(1, "qt", "ml") || batch === 0 ? std("qt", "ml") : std("cup", "ml");
  if (r.yieldBase === "g") return batch >= toBase(2, "lb", "g") || batch === 0 ? std("lb", "g") : std("oz", "g");
  return { name: "each", baseQty: 1 };
}

/**
 * Read what someone typed as a count unit: a standard unit ("qt", "lb"), or a
 * container with its size ("cambro = 6 qt", "bottle 24 fl oz", "6 qt cambro").
 */
export function parsePrepUnit(text: string, base: BaseUnit): PrepUnit | { error: string } {
  const raw = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return { error: "Type a unit, like qt or cambro = 6 qt." };
  const plain = standardUnit(raw);
  if (plain) {
    try {
      return std(normalizeUnit(raw), base);
    } catch (e) {
      return { error: e instanceof UnitError ? `${raw} doesn't work for this item.` : String(e) };
    }
  }
  // name = qty unit | name qty unit | qty unit name
  const m = raw.match(/^([a-z][a-z \-/]*?)\s*(?:=|:|\s)\s*(\d+(?:\.\d+)?)\s*([a-z][a-z .]*)$/i) ?? null;
  const n = m ? null : raw.match(/^(\d+(?:\.\d+)?)\s*([a-z][a-z .]*?)\s+([a-z][a-z \-/]*)$/i);
  let name: string;
  let qty: number;
  let unit: string;
  if (m) [name, qty, unit] = [m[1], Number(m[2]), m[3]];
  else if (n) [qty, unit, name] = [Number(n[1]), n[2], n[3]];
  else if (/^[a-z][a-z \-/]*$/i.test(raw)) return { error: `How big is one ${raw}? Type it like ${raw} = 6 qt.` };
  else return { error: "Type it like cambro = 6 qt." };
  name = name.trim().toLowerCase();
  if (!(qty > 0)) return { error: "The size has to be more than zero." };
  try {
    return { name, baseQty: toBase(qty, unit.trim(), base), container: true };
  } catch {
    return { error: `${unit.trim()} doesn't work for this item.` };
  }
}

/** "cambro = 6 qt" — how a unit is written back in the setup table. */
export function prepUnitLabel(u: PrepUnit, base: BaseUnit): string {
  if (!u.container) return u.name;
  const ref = base === "ml" ? std("qt", "ml") : base === "g" ? std("lb", "g") : { name: "each", baseQty: 1 };
  return `${u.name} = ${round(u.baseQty / ref.baseQty, 2)} ${ref.name}`;
}

const round = (v: number, d = 1) => Number(v.toFixed(d));

/** "4.2 qt", "3 cambros", "30 each". */
export function formatPrepQty(qtyBase: number, u: PrepUnit): string {
  const v = qtyBase / u.baseQty;
  const each = u.name === "each";
  const shown = each ? Math.round(v) : Math.abs(v) >= 10 ? Math.round(v) : round(v, 1);
  const name = u.container && v > 1.001 && !u.name.endsWith("s") ? `${u.name}s` : u.name;
  // Quarters read as a cook says them: 2¼ qt, ½ cambro.
  const q = Math.round(v * 4);
  if (!each && Math.abs(v) < 10 && Math.abs(v * 4 - q) < 0.02 && q % 4 !== 0) {
    const whole = Math.floor(q / 4);
    return `${whole || ""}${["", "¼", "½", "¾"][q % 4]} ${name}`;
  }
  return `${shown.toLocaleString("en-US")} ${name}`;
}

/** "2 batches", "½ batch", "1½ batches". */
export function formatBatches(b: number): string {
  const halves = Math.round(b * 2);
  if (Math.abs(b * 2 - halves) > 0.02) {
    const r = round(b, 1);
    return `${r} batch${r === 1 ? "" : "es"}`;
  }
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  const text = `${whole || ""}${half ? "½" : ""}` || "0";
  return `${text} batch${halves > 2 ? "es" : ""}`;
}

// ---- Rounding ------------------------------------------------------------------

/** The step amounts are rounded to (and the ± buttons move by). */
export function prepStep(rounding: PrepRounding, batchBase: number, unit: PrepUnit): number {
  if (rounding === "batch" && batchBase > 0) return batchBase;
  if (rounding === "half" && batchBase > 0) return batchBase / 2;
  if (unit.name === "each" || unit.container) return unit.baseQty;
  return unit.baseQty / 4; // quarter quart / quarter pound
}

/** Round an amount up to the step, ignoring float noise. */
export function roundUpTo(qty: number, step: number): number {
  if (!(qty > 0)) return 0;
  if (!(step > 0)) return qty;
  return Math.ceil(qty / step - 1e-6) * step;
}

// ---- Usage per serving -----------------------------------------------------------

export interface PrepUsage {
  /** Sold recipe id → prep recipe id → base units used by one serving. */
  perServing: Map<string, Map<string, number>>;
  /** Prep recipe id → prep recipe id inside it → base units per batch of the parent. */
  perBatch: Map<string, Map<string, number>>;
  problems: string[];
}

function walk(ctx: CostingContext, recipeId: string, mult: number, prepIds: ReadonlySet<string>, out: Map<string, number>, problems: string[], stack: string[]) {
  const r = ctx.recipes.get(recipeId);
  if (!r || stack.includes(recipeId)) return;
  for (const line of r.lines) {
    if (!line.subRecipeId) continue;
    const sub = ctx.recipes.get(line.subRecipeId);
    if (!sub) continue;
    try {
      const base = toBase(line.qty, line.unit, sub.yieldBase) * mult;
      if (prepIds.has(sub.id)) out.set(sub.id, (out.get(sub.id) ?? 0) + base);
      else walk(ctx, sub.id, base / recipeYieldInBase(sub), prepIds, out, problems, [...stack, recipeId]);
    } catch (e) {
      problems.push(`${r.name} → ${sub.name}: ${(e as Error).message}`);
    }
  }
}

/**
 * How much of each prep recipe one serving of each sold recipe uses, and how
 * much of a prep recipe one batch of another uses. A plated item inside another
 * (a side inside a combo) is walked through.
 */
export function prepUsage(ctx: CostingContext, prepIds: ReadonlySet<string>): PrepUsage {
  const perServing = new Map<string, Map<string, number>>();
  const perBatch = new Map<string, Map<string, number>>();
  const problems: string[] = [];
  for (const r of ctx.recipes.values()) {
    const out = new Map<string, number>();
    if (prepIds.has(r.id)) {
      walk(ctx, r.id, 1, prepIds, out, problems, []);
      out.delete(r.id);
      if (out.size) perBatch.set(r.id, out);
    } else {
      walk(ctx, r.id, 1, prepIds, out, problems, []);
      if (out.size) perServing.set(r.id, out);
    }
  }
  return { perServing, perBatch, problems: [...new Set(problems)] };
}

/** Parents before children, so a parent's batches are known before its sub-prep is planned. */
export function prepOrder(ids: readonly string[], perBatch: ReadonlyMap<string, ReadonlyMap<string, number>>): string[] {
  const set = new Set(ids);
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const [p, kids] of perBatch) if (set.has(p)) for (const k of kids.keys()) if (set.has(k)) indeg.set(k, (indeg.get(k) ?? 0) + 1);
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const k of perBatch.get(id)?.keys() ?? []) {
      if (!set.has(k)) continue;
      const n = (indeg.get(k) ?? 0) - 1;
      indeg.set(k, n);
      if (n === 0) queue.push(k);
    }
  }
  // A loop (shouldn't happen — costing refuses it) keeps the rest in the given order.
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

// ---- On hand -----------------------------------------------------------------------

/** Share of a day's service still to come at a local time (hours, e.g. 10.5), given opening hours. */
export function serviceShareAfter(hour: number, open: [number, number] | null | undefined): number {
  if (!open) return hour < 12 ? 1 : 0;
  const [o, c] = open;
  const close = c <= o ? c + 24 : c;
  if (hour <= o) return 1;
  if (hour >= close) return 0;
  return (close - hour) / (close - o);
}

/** Last count + made since − used since − thrown out since, never below zero. */
export function estimatePrepOnHand(x: { countBase: number | null; madeSince: number; usedSince: number; wastedSince: number }): { qty: number; known: boolean } {
  if (x.countBase == null) return { qty: Math.max(0, x.madeSince - x.usedSince - x.wastedSince), known: false };
  return { qty: Math.max(0, x.countBase + x.madeSince - x.usedSince - x.wastedSince), known: true };
}

// ---- The plan --------------------------------------------------------------------------

export interface PrepDay {
  date: ISODate;
  /** Forecast servings per sold recipe id (walk-in trade). */
  servings: ReadonlyMap<string, number>;
  /** Booked private events that day, with their menu as portions per recipe id. */
  events?: readonly PrepDayEvent[];
}

export interface PrepDayEvent {
  /** "Rotary party 40 guests" — shown as "+ Rotary party 40 guests" in the why line. */
  label: string;
  portions: ReadonlyMap<string, number>;
}

/** "Rotary party 40 guests" from a booking's title and headcount. */
export function prepEventLabel(title: string, headcount: number): string {
  const t = title.replace(/^private event:\s*/i, "").trim() || "Private event";
  return headcount > 0 ? `${t} ${headcount} guests` : t;
}

export interface PrepPlanItem {
  recipe: CostRecipe;
  settings: PrepItemSettings;
  onHandBase: number;
  onHandKnown: boolean;
  /** Made on the prep date already (the line shows as done). */
  done: { qtyBase: number; by: string | null; at: string } | null;
}

export interface PrepPlanInput {
  /** The day being prepped for. */
  prepDate: ISODate;
  /** The real business today, for "Today" / "Tomorrow" labels. */
  today: ISODate;
  /** prepDate onward, consecutive, long enough for the cover window and shelf lives. */
  days: PrepDay[];
  /** Service days the prep should last (closed days in between don't count). */
  coverDays: number;
  items: PrepPlanItem[];
  usage: PrepUsage;
  /** Names of sold recipes, for "why". */
  names: ReadonlyMap<string, string>;
}

export interface PrepDriver {
  label: string;
  servings: number | null;
  usageBase: number;
  /** A booked private event rather than walk-in sales. */
  event?: boolean;
}

export type PrepStatus = "make" | "enough" | "nodata";

export interface PrepLine {
  recipeId: string;
  name: string;
  station: string | null;
  base: BaseUnit;
  unit: PrepUnit;
  batchBase: number;
  rounding: PrepRounding;
  stepBase: number;
  status: PrepStatus;
  onHandBase: number;
  onHandKnown: boolean;
  /** Forecast use over the cover window. */
  usageBase: number;
  /** Use within shelf life (null = no shelf life set). */
  shelfCapBase: number | null;
  shelfLifeDays: number | null;
  parBase: number | null;
  targetBase: number;
  needBase: number;
  makeBase: number;
  batches: number;
  /** Days (from the start of the prep date) until what's on hand runs out; null = lasts the whole horizon. */
  runsOutIn: number | null;
  /** The rounded amount is more than gets used before it expires. */
  overShelf: boolean;
  drivers: PrepDriver[];
  why: string;
  done: PrepPlanItem["done"];
  /** "2 batches · 7 qt" */
  amountText: string;
}

/** The dates of the cover window: from the prep date until `coverDays` service days are in. */
export function coverWindow(days: readonly PrepDay[], coverDays: number): ISODate[] {
  const out: ISODate[] = [];
  let open = 0;
  for (const d of days) {
    out.push(d.date);
    const any = [...d.servings.values()].some((v) => v > 0) || (d.events ?? []).some((e) => [...e.portions.values()].some((v) => v > 0));
    if (any) open++;
    if (open >= Math.max(1, coverDays)) break;
  }
  return out;
}

/** "Today", "Today + Mon", "Tue–Thu". */
export function windowLabel(dates: readonly ISODate[], today: ISODate): string {
  if (!dates.length) return "";
  const name = (d: ISODate) => (d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : WEEKDAYS[weekday(d)]);
  if (dates.length === 1) return name(dates[0]);
  if (dates.length === 2) return `${name(dates[0])} + ${dates[1] === addDays(today, 1) ? "tomorrow" : WEEKDAYS[weekday(dates[1])]}`;
  return `${name(dates[0])}–${WEEKDAYS[weekday(dates[dates.length - 1])]}`;
}

/** Turn what's on hand and daily use into "runs out in x days" (fractional, from the start of day 0). */
export function runsOut(onHand: number, daily: readonly number[]): number | null {
  let left = onHand;
  for (let i = 0; i < daily.length; i++) {
    const u = daily[i];
    if (u > left + 1e-9) return i + (u > 0 ? left / u : 0);
    left -= u;
  }
  return null;
}

export function planPrep(input: PrepPlanInput): PrepLine[] {
  const { usage, days } = input;
  const window = coverWindow(days, input.coverDays);
  const wlabel = windowLabel(window, input.today);
  const byId = new Map(input.items.map((i) => [i.recipe.id, i]));
  const order = prepOrder(input.items.map((i) => i.recipe.id), usage.perBatch);

  // Direct daily use from sold items, with the biggest drivers over the window.
  const daily = new Map<string, number[]>();
  const drivers = new Map<string, Map<string, PrepDriver>>();
  for (const id of byId.keys()) {
    daily.set(id, days.map(() => 0));
    drivers.set(id, new Map());
  }
  days.forEach((d, i) => {
    for (const [sold, n] of d.servings) {
      if (!(n > 0)) continue;
      const per = usage.perServing.get(sold);
      if (!per) continue;
      for (const [prepId, q] of per) {
        const arr = daily.get(prepId);
        if (!arr) continue;
        arr[i] += n * q;
        if (i < window.length) {
          const m = drivers.get(prepId)!;
          const label = input.names.get(sold) ?? "Other items";
          const dr = m.get(label) ?? { label, servings: 0, usageBase: 0 };
          dr.servings = (dr.servings ?? 0) + n;
          dr.usageBase += n * q;
          m.set(label, dr);
        }
      }
    }
    // Private events: their menu portions on top of the walk-in forecast.
    for (const ev of d.events ?? []) {
      for (const [sold, n] of ev.portions) {
        if (!(n > 0)) continue;
        const per = usage.perServing.get(sold);
        if (!per) continue;
        for (const [prepId, q] of per) {
          const arr = daily.get(prepId);
          if (!arr) continue;
          arr[i] += n * q;
          if (i < window.length) {
            const m = drivers.get(prepId)!;
            const key = `event:${ev.label}`;
            const dr = m.get(key) ?? { label: ev.label, servings: null, usageBase: 0, event: true };
            dr.usageBase += n * q;
            m.set(key, dr);
          }
        }
      }
    }
  });

  const lines: PrepLine[] = [];
  for (const id of order) {
    const item = byId.get(id)!;
    const r = item.recipe;
    const s = item.settings;
    let batchBase = 0;
    try {
      batchBase = recipeYieldInBase(r);
    } catch {
      batchBase = 0;
    }
    const unit = s.unit ?? defaultPrepUnit(r);
    const step = prepStep(s.rounding, batchBase, unit);
    const use = daily.get(id)!;
    const usageBase = use.slice(0, window.length).reduce((a, b) => a + b, 0);
    const shelfCapBase = s.shelfLifeDays != null && s.shelfLifeDays > 0 ? use.slice(0, s.shelfLifeDays).reduce((a, b) => a + b, 0) : null;
    let target = shelfCapBase != null ? Math.min(usageBase, shelfCapBase) : usageBase;
    if (s.parBase != null && s.parBase > target) target = s.parBase;
    const need = Math.max(0, target - item.onHandBase);
    const noise = Math.max(step * 0.02, 1e-6);
    const hasData = usageBase > 0 || (s.parBase ?? 0) > 0;
    const status: PrepStatus = !hasData ? "nodata" : need > noise ? "make" : "enough";
    const makeBase = status === "make" ? roundUpTo(need, step) : 0;
    const batches = batchBase > 0 ? makeBase / batchBase : 0;
    const keepable = Math.max(shelfCapBase ?? Infinity, s.parBase ?? 0);
    const overShelf = status === "make" && shelfCapBase != null && item.onHandBase + makeBase - keepable > Math.max(step * 0.25, (shelfCapBase ?? 0) * 0.25, noise);

    // Sub-prep needed for today's batches of this one.
    if (batches > 0) {
      for (const [kid, perB] of usage.perBatch.get(id) ?? []) {
        const arr = daily.get(kid);
        if (!arr) continue;
        const q = perB * batches;
        arr[0] += q;
        const label = `${formatBatches(batches)} ${r.name}`;
        drivers.get(kid)!.set(label, { label, servings: null, usageBase: q });
      }
    }

    const drv = [...drivers.get(id)!.values()].sort((a, b) => b.usageBase - a.usageBase);
    const ro = item.onHandBase <= 0 && (usageBase > 0 || (s.parBase ?? 0) > 0) ? 0 : runsOut(item.onHandBase, use);
    const line: PrepLine = {
      recipeId: id,
      name: r.name,
      station: s.station,
      base: r.yieldBase,
      unit,
      batchBase,
      rounding: s.rounding,
      stepBase: step,
      status,
      onHandBase: item.onHandBase,
      onHandKnown: item.onHandKnown,
      usageBase,
      shelfCapBase,
      shelfLifeDays: s.shelfLifeDays,
      parBase: s.parBase,
      targetBase: target,
      needBase: need,
      makeBase,
      batches,
      runsOutIn: ro,
      overShelf,
      drivers: drv,
      why: "",
      done: item.done,
      amountText: amountText(makeBase, batchBase, unit),
    };
    line.why = whyText(line, wlabel, s.shelfLifeDays);
    lines.push(line);
  }
  return sortPrep(lines);
}

export function amountText(makeBase: number, batchBase: number, unit: PrepUnit): string {
  const q = formatPrepQty(makeBase, unit);
  // A "batch" of one portion isn't worth saying.
  if (!(batchBase > 0) || !(makeBase > 0) || batchBase <= unit.baseQty * 1.001) return q;
  const b = makeBase / batchBase;
  // Only say batches when it's a tidy number of them.
  return Math.abs(b * 2 - Math.round(b * 2)) < 0.02 ? `${formatBatches(b)} · ${q}` : q;
}

const servingsText = (n: number) => (n >= 3 ? `~${Math.round(n)}` : `~${round(n, 1)}`);

/** "Today + tomorrow ~98 Classic Burger, ~40 Wings (10) → 4.2 qt · on hand 1 qt". */
export function whyText(l: PrepLine, window: string, shelfLifeDays: number | null): string {
  const parts: string[] = [];
  if (l.usageBase > 0) {
    const walkIn = l.drivers.filter((d) => !d.event);
    const events = l.drivers.filter((d) => d.event);
    const top = walkIn.slice(0, 2).map((d) => (d.servings != null ? `${servingsText(d.servings)} ${d.label}` : `for ${d.label}`));
    const more = walkIn.length > 2 ? ` +${walkIn.length - 2} more` : "";
    const head = top.length ? `${window} ${top.join(", ")}${more}` : window;
    const evText = events.map((d) => ` + ${d.label}`).join("");
    parts.push(`${head}${evText} → ${formatPrepQty(l.usageBase, l.unit)}`);
  }
  if (l.shelfCapBase != null && l.shelfCapBase < l.usageBase - 1e-6) parts.push(`keeps ${shelfLifeDays} day${shelfLifeDays === 1 ? "" : "s"}: ${formatPrepQty(l.shelfCapBase, l.unit)}`);
  if (l.parBase != null && l.parBase > 0 && l.parBase >= Math.min(l.usageBase, l.shelfCapBase ?? Infinity) - 1e-6) parts.push(`par ${formatPrepQty(l.parBase, l.unit)}`);
  parts.push(l.onHandKnown ? `on hand ${formatPrepQty(l.onHandBase, l.unit)}` : "not counted yet");
  return parts.join(" · ");
}

/** Make first (runs out soonest first), then enough, then no data; names break ties. */
export function sortPrep(lines: PrepLine[]): PrepLine[] {
  const rank = { make: 0, enough: 1, nodata: 2 } as const;
  const parShare = (l: PrepLine) => (l.parBase ? l.onHandBase / l.parBase : 1);
  return [...lines].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.runsOutIn ?? 99) - (b.runsOutIn ?? 99) ||
      parShare(a) - parShare(b) ||
      a.name.localeCompare(b.name),
  );
}

export interface PrepGroup {
  station: string;
  lines: PrepLine[];
}

/** Lines grouped by station, stations ordered by their most urgent line (lines keep their order). */
export function groupByStation(lines: readonly PrepLine[], fallback = "Prep"): PrepGroup[] {
  const groups = new Map<string, PrepLine[]>();
  for (const l of lines) {
    const k = l.station?.trim() || fallback;
    const g = groups.get(k) ?? [];
    g.push(l);
    groups.set(k, g);
  }
  return [...groups].map(([station, ls]) => ({ station, lines: ls }));
}

// ---- Scaled recipe -------------------------------------------------------------------

const ML_LADDER = ["tsp", "tbsp", "cup", "qt", "gal"] as const;

/**
 * A recipe line scaled for the kitchen: 96 fl oz → 3 qt, 40 oz → 2.5 lb,
 * 3 tbsp stays 3 tbsp. Units it doesn't know (clove, bun) are kept.
 */
export function friendlyAmount(qty: number, unit: string): { qty: number; unit: string } {
  const u = normalizeUnit(unit);
  const s = standardUnit(u);
  if (!s) return { qty: round(qty, qty >= 10 ? 0 : 2), unit };
  if (s.base === "ml") {
    if (u === "ml" || u === "l") {
      const ml = qty * s.factor;
      return ml >= 1000 ? { qty: round(ml / 1000, 2), unit: "l" } : { qty: round(ml, 0), unit: "ml" };
    }
    const ml = qty * s.factor;
    let best: string = ML_LADDER[0];
    for (const x of ML_LADDER) if (ml / toBase(1, x, "ml") >= (x === "qt" || x === "gal" ? 1 : 0.999)) best = x;
    // Under a quarter cup reads better in tablespoons.
    if (best === "cup" && ml / toBase(1, "cup", "ml") < 0.25) best = "tbsp";
    return { qty: round(ml / toBase(1, best, "ml"), 2), unit: best };
  }
  if (s.base === "g") {
    const g = qty * s.factor;
    if (u === "g" || u === "kg") return g >= 1000 ? { qty: round(g / 1000, 2), unit: "kg" } : { qty: round(g, 0), unit: "g" };
    return g >= toBase(1, "lb", "g") ? { qty: round(g / toBase(1, "lb", "g"), 2), unit: "lb" } : { qty: round(g / toBase(1, "oz", "g"), 1), unit: "oz" };
  }
  return { qty: round(qty, qty >= 10 ? 0 : 2), unit };
}

/** Recipe lines multiplied for `makeBase` of the recipe. */
export function scaleRecipe(r: CostRecipe, makeBase: number): { factor: number; lines: { index: number; qty: number; unit: string }[] } {
  const yieldBase = recipeYieldInBase(r);
  const factor = yieldBase > 0 ? makeBase / yieldBase : 1;
  return { factor, lines: r.lines.map((l, index) => ({ index, ...friendlyAmount(l.qty * factor, l.unit) })) };
}
