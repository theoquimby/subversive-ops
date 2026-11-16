import "server-only";
import type { CogsRecipe } from "@/domain/brewCogs";
import { historyChartable } from "@/domain/brewCogs";
import { costBrewRecipe, type PricedIngredient } from "@/domain/brewRecipes";
import { usableCostPerBase } from "@/domain/costing";
import { addDays, type ISODate } from "@/domain/dates";
import { db } from "../db";
import { costLine, pricedIngredients } from "./brewCost";
import { buildContext, loadCostingSnapshot } from "./costing";
import { beerOz, yieldInfo } from "./kegs";
import { businessToday } from "./sales";

/**
 * Brewing cost of goods: every recipe's cost per batch, barrel, keg and pint
 * from today's ingredient prices (the same prices and rule as brewCostFor and
 * the recipe pages), what a pint sells for on Square, wholesale keg prices,
 * and each recipe's cost per pint over the last year from the price history.
 */

/** Wholesale price of a full keg, typed on the costs page (no wholesale price list exists elsewhere). */
export const WHOLESALE_KEY = "brewery.wholesaleKegPrices";

export interface WholesalePrices {
  half: number | null;
  sixth: number | null;
}

export async function wholesalePrices(): Promise<WholesalePrices> {
  const s = await db.setting.findUnique({ where: { key: WHOLESALE_KEY } });
  try {
    const o = JSON.parse(s?.value ?? "{}") as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
    return { half: n(o.half), sixth: n(o.sixth) };
  } catch {
    return { half: null, sixth: null };
  }
}

export async function setWholesalePrice(which: "half" | "sixth", value: number | null): Promise<void> {
  const cur = await wholesalePrices();
  const next = { ...cur, [which]: value != null && value > 0 ? Math.round(value * 100) / 100 : null };
  await db.setting.upsert({ where: { key: WHOLESALE_KEY }, create: { key: WHOLESALE_KEY, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
}

export interface CogsRecipeView extends CogsRecipe {
  status: string;
  beer: string | null;
  style: string | null;
  /** Ingredient ids on the recipe, for "uses this" */
  uses: string[];
}

export interface CogsIngredient extends PricedIngredient {
  category: string;
  usedBy: number;
}

export interface CogsView {
  today: ISODate;
  recipes: CogsRecipeView[];
  ingredients: CogsIngredient[];
  pourYield: number;
  pourYieldMeasured: boolean;
  wholesale: WholesalePrices;
  /** Recipe id → cost per pint on the 1st of each month for a year, and today (null where a line had no price then) */
  history: Record<string, { date: ISODate; perPint: number | null }[]>;
  /** Square sales were read for pint prices */
  squarePrices: boolean;
}

/** The 1st of each of the last 12 months, then today. */
function historyDates(today: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  for (let k = 12; k >= 1; k--) {
    const d = new Date(Date.UTC(y, m - 1 - k + 1, 1));
    out.push(d.toISOString().slice(0, 10));
  }
  if (out.at(-1) !== today) out.push(today);
  return out.filter((d) => d <= today);
}

export async function cogsView(): Promise<CogsView> {
  const today = businessToday();
  const [recipes, priced, snap, wholesale, yi, square] = await Promise.all([
    db.brewRecipe.findMany({
      where: { status: { not: "archived" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, style: true, batchBbl: true, beerId: true, beer: { select: { name: true } }, lines: { orderBy: { sort: "asc" }, select: { name: true, ingredientId: true, qty: true, unit: true } } },
    }),
    pricedIngredients(),
    loadCostingSnapshot(),
    wholesalePrices(),
    yieldInfo().catch(() => null),
    beerOz(addDays(today, -120)).catch((e) => {
      console.error("costs: Square pour prices skipped", (e as Error).message);
      return null;
    }),
  ]);
  const pourYield = yi && yi.yield > 0 ? yi.yield : 1;
  const views: CogsRecipeView[] = recipes.map((r) => {
    const perOz = r.beerId ? square?.perOz.get(r.beerId) : undefined;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      style: r.style,
      beer: r.beer?.name ?? null,
      batchBbl: r.batchBbl.toNumber(),
      lines: r.lines.map(costLine),
      pintPrice: perOz != null && perOz > 0 ? perOz * 16 : null,
      halfPrice: wholesale.half,
      sixthPrice: wholesale.sixth,
      uses: [...new Set(r.lines.map((l) => l.ingredientId).filter((x): x is string => !!x))],
    };
  });
  const usedBy = new Map<string, number>();
  for (const r of views) for (const id of r.uses) usedBy.set(id, (usedBy.get(id) ?? 0) + 1);
  const category = new Map(snap.ingredients.map((i) => [i.id, i.category]));
  const ingredients: CogsIngredient[] = [...usedBy.keys()]
    .map((id) => priced.get(id))
    .filter((p): p is PricedIngredient => !!p)
    .map((p) => ({ ...p, category: category.get(p.id) ?? "Other", usedBy: usedBy.get(p.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Today's recipes at each month's prices.
  const history: CogsView["history"] = {};
  const dates = historyDates(today);
  const catalogs = dates.map((d) => {
    const ctx = buildContext(snap, d);
    const m = new Map<string, PricedIngredient>();
    for (const c of ctx.ingredients.values()) m.set(c.id, { id: c.id, name: c.name, baseUnit: c.baseUnit, costPerBase: usableCostPerBase(c), conversions: c.conversions });
    return m;
  });
  for (const r of views) {
    if (!r.lines.length) continue;
    const pts = dates.map((date, k) => {
      const c = costBrewRecipe(r.lines, catalogs[k], r.batchBbl);
      return { date, perPint: c.complete && c.total > 0 ? c.perPint : null };
    });
    if (historyChartable(pts)) history[r.id] = pts;
  }
  return { today, recipes: views, ingredients, pourYield, pourYieldMeasured: !!yi?.measured, wholesale, history, squarePrices: !!square };
}
