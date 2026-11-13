/**
 * Revenue classes: which part of the business a recipe's sales and cost
 * belong to. A brewery taproom is really two businesses (kitchen and bar), and
 * a blended "food cost %" hides both, so P&L, Overview and Margin gap split by
 * these. Derived from Recipe.category plus an editable mapping (a Setting), so
 * no schema change is needed. Pure.
 */

export type RevenueClass = "food" | "beer" | "otherBev" | "retail";
/** What the P&L shows side by side. Retail and unlinked sales only count toward the total. */
export type RevenueGroup = "food" | "beverage" | "other";

export const REVENUE_CLASSES: { value: RevenueClass; label: string; group: RevenueGroup }[] = [
  { value: "food", label: "Food", group: "food" },
  { value: "beer", label: "Beer", group: "beverage" },
  { value: "otherBev", label: "Other beverage", group: "beverage" },
  { value: "retail", label: "Retail", group: "other" },
];

export const classLabel = (c: RevenueClass) => REVENUE_CLASSES.find((x) => x.value === c)?.label ?? c;
export const groupOf = (c: RevenueClass): RevenueGroup => REVENUE_CLASSES.find((x) => x.value === c)?.group ?? "other";
export const isRevenueClass = (s: unknown): s is RevenueClass => REVENUE_CLASSES.some((c) => c.value === s);

/** Overrides keyed by normalized category name. */
export type ClassMap = Record<string, RevenueClass>;

export const normalizeCategory = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// Word-level guesses, checked in order. Anything unmatched is food.
const GUESSES: [RegExp, RevenueClass][] = [
  [/\b(merch|merchandise|retail|apparel|shirts?|hats?|glassware|gift)\b/, "retail"],
  [/\b(beers?|draft|draught|taps?|ales?|lagers?|ipas?|stouts?|porters?|sours?|pilsners?|flights?|growlers?|crowlers?|cans?|kegs?|brews?|seltzers?|ciders?)\b/, "beer"],
  [/\b(wines?|cocktails?|spirits?|liquor|drinks?|beverages?|bev|n\/a|na|soda|sodas|pop|coffee|tea|juice|kombucha|mocktails?)\b/, "otherBev"],
];

/** The class a recipe category belongs to: the saved mapping first, then a guess from the name. */
export function classifyCategory(category: string | null | undefined, overrides: ClassMap = {}): RevenueClass {
  const key = normalizeCategory(category ?? "");
  const saved = overrides[key];
  if (saved && isRevenueClass(saved)) return saved;
  for (const [re, cls] of GUESSES) if (re.test(key)) return cls;
  return "food";
}

export interface ClassSettings {
  map: ClassMap;
  /** Target beverage cost % (beer + other drinks); null = not set. */
  bevTarget: number | null;
}

export const DEFAULT_BEV_TARGET = 0.22;

/** Parse the stored setting, tolerating junk (a bad value shouldn't break the P&L). */
export function parseClassSettings(raw: string | null | undefined): ClassSettings {
  if (!raw) return { map: {}, bevTarget: null };
  try {
    const v = JSON.parse(raw) as { map?: Record<string, unknown>; bevTarget?: unknown };
    const map: ClassMap = {};
    for (const [k, c] of Object.entries(v.map ?? {})) if (isRevenueClass(c)) map[normalizeCategory(k)] = c;
    const t = typeof v.bevTarget === "number" && v.bevTarget > 0 && v.bevTarget < 1 ? v.bevTarget : null;
    return { map, bevTarget: t };
  } catch {
    return { map: {}, bevTarget: null };
  }
}

// ---- Splits -----------------------------------------------------------------------

export interface ClassTotals {
  sales: number;
  cogs: number;
}

export type ClassSplit = Record<RevenueClass, ClassTotals>;

export const emptySplit = (): ClassSplit => ({ food: { sales: 0, cogs: 0 }, beer: { sales: 0, cogs: 0 }, otherBev: { sales: 0, cogs: 0 }, retail: { sales: 0, cogs: 0 } });

export function addSplits(a: ClassSplit, b: ClassSplit): ClassSplit {
  const out = emptySplit();
  for (const c of REVENUE_CLASSES) out[c.value] = { sales: a[c.value].sales + b[c.value].sales, cogs: a[c.value].cogs + b[c.value].cogs };
  return out;
}

export interface SplitLine {
  sales: number;
  cogs: number;
  /** cogs ÷ sales; null with no sales. */
  pct: number | null;
  /** Share of total sales. */
  mix: number | null;
}

export interface GroupSplit {
  food: SplitLine;
  beverage: SplitLine;
  /** Beer on its own (part of beverage). */
  beer: SplitLine;
  /** Retail plus sales not linked to any recipe — counted in the total only. */
  other: SplitLine;
  total: SplitLine;
}

/**
 * Food / beverage / total from per-class item sales and costs. `totalSales`
 * is the store-level figure (order totals), which also includes items not
 * linked to a recipe; that remainder lands in `other`.
 */
export function groupSplit(split: ClassSplit, totalSales: number): GroupSplit {
  const line = (sales: number, cogs: number): SplitLine => ({ sales, cogs, pct: sales > 0 ? cogs / sales : null, mix: totalSales > 0 ? sales / totalSales : null });
  const food = split.food;
  const bevSales = split.beer.sales + split.otherBev.sales;
  const bevCogs = split.beer.cogs + split.otherBev.cogs;
  const classified = food.sales + bevSales;
  const totalCogs = food.cogs + bevCogs + split.retail.cogs;
  return {
    food: line(food.sales, food.cogs),
    beverage: line(bevSales, bevCogs),
    beer: line(split.beer.sales, split.beer.cogs),
    other: line(Math.max(0, totalSales - classified), split.retail.cogs),
    total: line(totalSales, totalCogs),
  };
}
