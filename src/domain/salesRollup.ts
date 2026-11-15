/**
 * Folding item sales that the database has already summed per business date
 * and recipe. Item rows (one per Square variation/modifier per day) are summed
 * in SQL, so pages read a few hundred rows instead of every item line for the
 * range; these folds turn the sums into the shapes the forecaster and the
 * KPIs use. Results match folding the raw item rows (sums are linear).
 */

import type { ISODate } from "./dates";
import type { SoldLine } from "./pnl";

/** Item sales summed per date and linked recipe (null: not linked to a recipe, or ignored). */
export interface RecipeDaySum {
  date: ISODate;
  recipeId: string | null;
  qty: number;
  /** Some item line in the group sold more than zero (the business was open). */
  anySold: boolean;
}

/** Servings per recipe per day, plus the days anything sold (ignored items count as open days too). */
export function foldRecipeSales(rows: readonly RecipeDaySum[]): { byRecipe: Map<string, Map<ISODate, number>>; openDays: Set<ISODate> } {
  const byRecipe = new Map<string, Map<ISODate, number>>();
  const openDays = new Set<ISODate>();
  for (const r of rows) {
    if (r.anySold) openDays.add(r.date);
    if (!r.recipeId) continue;
    const series = byRecipe.get(r.recipeId) ?? new Map<ISODate, number>();
    series.set(r.date, (series.get(r.date) ?? 0) + r.qty);
    byRecipe.set(r.recipeId, series);
  }
  return { byRecipe, openDays };
}

/** Non-ignored item sales summed per date and recipe (null: no recipe linked). */
export interface ItemDaySum {
  date: ISODate;
  recipeId: string | null;
  qty: number;
  sales: number;
}

/** Sold lines for theoretical cost (linked recipes only) and each day's item-sales total. */
export function foldItemSales(rows: readonly ItemDaySum[]): { sold: SoldLine[]; itemTotal: Map<ISODate, number> } {
  const sold: SoldLine[] = [];
  const itemTotal = new Map<ISODate, number>();
  for (const r of rows) {
    itemTotal.set(r.date, (itemTotal.get(r.date) ?? 0) + r.sales);
    if (r.recipeId) sold.push({ date: r.date, recipeId: r.recipeId, qty: r.qty, sales: r.sales });
  }
  return { sold, itemTotal };
}
