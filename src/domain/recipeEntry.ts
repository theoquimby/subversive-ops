/**
 * Small rules for typing in recipes: which lines a save leaves out, what a
 * copy is called, and the batch size a quick prep recipe starts with.
 */
import { standardUnit, type BaseUnit } from "./units";

export interface EntryLine {
  ingredientId: string | null;
  subRecipeId: string | null;
  qty: number;
}

/** Lines a save would leave out: no item picked, or no amount (blank or 0). */
export function linesLeftOut<T extends EntryLine>(lines: readonly T[]): { blank: T[]; noAmount: T[] } {
  const blank = lines.filter((l) => !l.ingredientId && !l.subRecipeId);
  const noAmount = lines.filter((l) => (l.ingredientId || l.subRecipeId) && !(l.qty > 0));
  return { blank, noAmount };
}

const and = (names: readonly string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const lines = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

/** "2 lines will be left out when you save: …", or null when every line counts. `names` are the no-amount lines' items. */
export function leftOutText(out: { blank: readonly unknown[]; noAmount: readonly unknown[] }, names: readonly string[]): string | null {
  const b = out.blank.length;
  const z = out.noAmount.length;
  if (!b && !z) return null;
  const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  if (!z) return `${lines(b)} with no item picked will be left out when you save.`;
  if (!b) return `${lines(z)} with no amount will be left out when you save: ${and(shown)}.`;
  return `${lines(b + z)} will be left out when you save: ${b} with no item picked, and ${and(shown)} with no amount.`;
}

/** "Burger (copy)", then "Burger (copy 2)"… A copy of a copy counts up rather than stacking. */
export function copyName(name: string, taken: (name: string) => boolean): string {
  const stem = name.replace(/\s*\(copy(?: \d+)?\)\s*$/i, "").trim() || name.trim();
  let candidate = `${stem} (copy)`;
  for (let n = 2; taken(candidate); n++) candidate = `${stem} (copy ${n})`;
  return candidate;
}

/**
 * A prep recipe made on the spot from a recipe line starts as one batch, measured
 * the way the line was typed (2 tbsp aioli → by volume, a quart a batch), so the
 * line costs as soon as the prep recipe has ingredients. The batch size is fixed later.
 */
export function prepStubYield(typedUnit: string | null | undefined): { yieldQty: number; yieldUnit: string; yieldBase: BaseUnit } {
  const base = typedUnit ? standardUnit(typedUnit)?.base : undefined;
  if (base === "ml") return { yieldQty: 1, yieldUnit: "qt", yieldBase: "ml" };
  if (base === "g") return { yieldQty: 1, yieldUnit: "lb", yieldBase: "g" };
  return { yieldQty: 1, yieldUnit: "each", yieldBase: "each" };
}
