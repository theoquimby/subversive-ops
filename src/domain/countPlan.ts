/**
 * What's due on a count, how far along it is, and what the shelves are worth.
 *
 * Items are ingredients or prep recipes (house-made sauces, portioned
 * proteins). A prep item's key is "p_<recipeId>" so both fit one list.
 */

import { daysBetween, type ISODate } from "./dates";

export type CountEvery = "every" | "monthly" | "changes";
export const COUNT_EVERY: { value: CountEvery; label: string; hint: string }[] = [
  { value: "every", label: "Every count", hint: "On the sheet every time" },
  { value: "monthly", label: "Monthly", hint: "Due 30 days after it was last counted" },
  { value: "changes", label: "Only when it changes", hint: "Off the sheet; its last count carries forward" },
];
export const MONTHLY_DAYS = 30;

export const asCountEvery = (v: string | null | undefined): CountEvery => (v === "monthly" || v === "changes" ? v : "every");

export type ItemKind = "ingredient" | "prep";
export const prepKey = (recipeId: string) => `p_${recipeId}`;
export function parseItemKey(key: string): { kind: ItemKind; id: string } {
  return key.startsWith("p_") ? { kind: "prep", id: key.slice(2) } : { kind: "ingredient", id: key };
}

/** Is an item due on this count? Never-counted items are always due, so everything gets a first count. */
export function isDue(every: CountEvery, lastCounted: ISODate | null, today: ISODate): boolean {
  if (every === "every" || lastCounted == null) return true;
  if (every === "monthly") return daysBetween(lastCounted, today) >= MONTHLY_DAYS;
  return false;
}

/** "34 of 52 counted" and what's left, area by area in walking order. */
export function countProgress(items: readonly { id: string; area: string }[], counted: ReadonlySet<string>) {
  const left: { area: string; left: number; firstId: string }[] = [];
  for (const i of items) {
    if (counted.has(i.id)) continue;
    const a = left.find((x) => x.area === i.area);
    if (a) a.left++;
    else left.push({ area: i.area, left: 1, firstId: i.id });
  }
  const remaining = left.reduce((s, a) => s + a.left, 0);
  return { total: items.length, done: items.length - remaining, remaining, left };
}

/**
 * Ingredients and prep items used on the menu: everything reachable from an
 * active menu item (or modifier) through its recipe and sub-recipes.
 */
export function usedOnMenu(recipes: readonly { id: string; kind: string; active: boolean; lines: readonly { ingredientId: string | null; subRecipeId: string | null }[] }[]): { ingredients: Set<string>; preps: Set<string> } {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const ingredients = new Set<string>();
  const preps = new Set<string>();
  const walk = (id: string) => {
    const r = byId.get(id);
    if (!r || !r.active) return;
    for (const l of r.lines) {
      if (l.ingredientId) ingredients.add(l.ingredientId);
      if (l.subRecipeId && !preps.has(l.subRecipeId)) {
        preps.add(l.subRecipeId);
        walk(l.subRecipeId);
      }
    }
  };
  for (const r of recipes) if (r.active && (r.kind === "MENU" || r.kind === "MODIFIER")) walk(r.id);
  return { ingredients, preps };
}

/** Packaging, cleaning and paper goods: never on a menu, so left out of "not on the menu". */
export const isSupplyCategory = (category: string) => /\b(packag\w*|clean\w*|chemicals?|paper|disposables?|supplies|smallwares?|to-?go|janitorial)\b/i.test(category);

export interface ValuedLine {
  key: string;
  name: string;
  area: string;
  category: string;
  value: number;
  /** Counted on an earlier count and carried into this one. */
  carriedFrom: ISODate | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Totals by area and by category, biggest first. */
export function valueBreakdown(lines: readonly ValuedLine[]) {
  const sum = (by: (l: ValuedLine) => string) => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(by(l), (m.get(by(l)) ?? 0) + l.value);
    return [...m].map(([name, value]) => ({ name, value: r2(value) })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  };
  const carried = lines.filter((l) => l.carriedFrom != null);
  return {
    total: r2(lines.reduce((s, l) => s + l.value, 0)),
    byArea: sum((l) => l.area),
    byCategory: sum((l) => l.category),
    carriedValue: r2(carried.reduce((s, l) => s + l.value, 0)),
    carriedCount: carried.length,
  };
}

/** Change against the previous count: +$120 (+4%). Null without a previous value. */
export function valueChange(now: number, prev: number | null): { amount: number; pct: number | null } | null {
  if (prev == null) return null;
  return { amount: r2(now - prev), pct: prev > 0 ? (now - prev) / prev : null };
}

/**
 * Change against the previous count on the same items only. The value carries each item's last count
 * forward, so a smaller count doesn't lower it; but an item counted for the first time raises it without
 * any stock arriving. Those are taken out of the change and reported apart, so a first full count isn't
 * read as a delivery (and a partial first count isn't read as a loss later).
 * `now` and `prev` are value by item key. Null without a previous count.
 */
export function likeForLike(now: ReadonlyMap<string, number>, prev: ReadonlyMap<string, number> | null): { amount: number; pct: number | null; added: number; addedValue: number } | null {
  if (!prev) return null;
  let nowSame = 0;
  let added = 0;
  let addedValue = 0;
  for (const [k, v] of now) {
    if (prev.has(k)) nowSame += v;
    else if (v > 0) {
      added++;
      addedValue += v;
    }
  }
  const before = [...prev.values()].reduce((s, v) => s + v, 0);
  return { amount: r2(nowSame - before), pct: before > 0 ? (nowSame - before) / before : null, added, addedValue: r2(addedValue) };
}

// ---- Counting one item in several places ------------------------------------------------------

/** Where an item is listed on counts: its storage area first, then any extra home areas. */
export function homeAreas(primary: string, extra: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const a of [primary, ...extra]) if (a && !out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a);
  return out;
}

export interface AreaPart { area?: string; qty: number; unit: string }

/** Replace what was counted in one area, keeping the other areas: the line's parts after saving "Walk-in: 1½ gal". */
export function mergeAreaParts(existing: readonly AreaPart[], area: string, parts: readonly { qty: number; unit: string }[], fallbackArea: string): AreaPart[] {
  const keep = existing.map((p) => ({ ...p, area: p.area ?? fallbackArea })).filter((p) => p.area.toLowerCase() !== area.toLowerCase());
  return [...keep, ...parts.map((p) => ({ area, qty: p.qty, unit: p.unit }))];
}

/** Places an item was counted in, in order: [{ area, parts }]. */
export function partsByArea(parts: readonly AreaPart[], fallbackArea: string): { area: string; parts: { qty: number; unit: string }[] }[] {
  const out: { area: string; parts: { qty: number; unit: string }[] }[] = [];
  for (const p of parts) {
    const area = p.area ?? fallbackArea;
    const cur = out.find((x) => x.area === area);
    if (cur) cur.parts.push({ qty: p.qty, unit: p.unit });
    else out.push({ area, parts: [{ qty: p.qty, unit: p.unit }] });
  }
  return out;
}

/**
 * The before-you-send check for one item. Compares the total with what we
 * expected (last count + deliveries − forecast use, or the last count) and
 * warns when an item counted in several places looks counted twice.
 */
export function totalCheck(x: { total: number; places: number; expected: number | null; last: number | null; minGap?: number }): { kind: "double" | "high" | "low"; ratio: number } | null {
  const ref = x.expected != null && x.expected > 0 ? x.expected : x.last != null && x.last > 0 ? x.last : null;
  if (ref == null) return null;
  const ratio = x.total / ref;
  if (Math.abs(x.total - ref) <= (x.minGap ?? 0)) return null;
  if (x.places >= 2 && ratio >= 1.8) return { kind: "double", ratio };
  if (ratio > 4) return { kind: "high", ratio };
  if (x.total > 0 && ratio < 0.25) return { kind: "low", ratio };
  return null;
}
