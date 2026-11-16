import "server-only";
import { addDays } from "@/domain/dates";
import { COUNT_EVERY_RULES, suggestCountEvery } from "@/domain/countEverySuggest";
import { businessDateOf } from "@/lib/format";
import { db } from "../db";
import { buildContext, loadCostingSnapshot } from "./costing";
import { businessToday } from "./sales";
import { parseISODate } from "@/domain/dates";

export interface CountEveryRow {
  /** Count item key (the ingredient id). */
  key: string;
  name: string;
  every: "changes" | "monthly";
  why: string;
}

/** Items counted every time whose history says they needn't be. Never throws. */
export async function countEverySuggestions(): Promise<CountEveryRow[]> {
  try {
    const today = businessToday();
    const since = parseISODate(addDays(today, -COUNT_EVERY_RULES.lookbackDays));
    const [ingredients, lines, snap] = await Promise.all([
      db.ingredient.findMany({ where: { active: true, countEvery: "every" }, select: { id: true, name: true } }),
      db.stockCountLine.findMany({ where: { count: { completed: true, takenAt: { gte: since } } }, select: { ingredientId: true, qtyBase: true, count: { select: { takenAt: true } } } }),
      loadCostingSnapshot(),
    ]);
    const ctx = buildContext(snap, today);
    const byIng = new Map<string, { date: string; qty: number }[]>();
    for (const l of lines) {
      const list = byIng.get(l.ingredientId) ?? [];
      list.push({ date: businessDateOf(l.count.takenAt), qty: l.qtyBase.toNumber() });
      byIng.set(l.ingredientId, list);
    }
    const out: CountEveryRow[] = [];
    for (const i of ingredients) {
      const s = suggestCountEvery(byIng.get(i.id) ?? [], ctx.ingredients.get(i.id)?.costPerBase ?? null, today);
      if (s) out.push({ key: i.id, name: i.name, ...s });
    }
    return out.sort((a, b) => a.every.localeCompare(b.every) || a.name.localeCompare(b.name));
  } catch (e) {
    console.error("count suggestions failed", e);
    return [];
  }
}
