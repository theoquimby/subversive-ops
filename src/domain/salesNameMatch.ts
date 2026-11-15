/**
 * Guessing which recipe a Square item is, from names alone. Used where Square
 * items haven't been linked to recipes yet, so the prep list can still forecast
 * from sales history ("Classic Smash Burger" → Classic Burger,
 * "Wings (6) · Buffalo" → Wings (6)).
 *
 * Deliberately cautious: every meaningful word on one side must appear on the
 * other, generic words ("burger", "sandwich", "side") count for little, and a
 * tie between two recipes is no match.
 */

const STOP = new Set(["of", "the", "a", "an", "and", "with", "w", "on", "to", "or", "full", "pour"]);
/** Words that say what kind of thing it is but not which one. */
const GENERIC = new Set(["burger", "sandwich", "side", "smash", "plate", "basket", "order", "sauce", "salad"]);
/** Square lines that are an instruction, not a dish. */
const INSTRUCTION = /^(no|add|sub|extra|light|sauce on|on the side|without)\b/i;

export function nameTokens(name: string): string[] {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .filter((t) => t && !STOP.has(t));
}

const weight = (t: string) => (GENERIC.has(t) ? 0.3 : 1);

/** 0–1 similarity, or 0 when one side has a meaningful word the other lacks on both sides. */
export function nameScore(saleName: string, recipeName: string): number {
  const a = new Set(nameTokens(saleName));
  const b = new Set(nameTokens(recipeName));
  if (!a.size || !b.size) return 0;
  const strong = (s: Set<string>) => [...s].filter((t) => !GENERIC.has(t));
  const aInB = strong(a).every((t) => b.has(t));
  const bInA = strong(b).every((t) => a.has(t));
  if (!aInB && !bInA) return 0;
  // "Side of grilled chicken" is not the grilled chicken sandwich.
  if (a.has("side") && !b.has("side") && !/\bon (the )?side\b/i.test(saleName)) return 0;
  // A name made only of generic words ("Side Salad") must match exactly.
  if ((strong(a).length === 0 || strong(b).length === 0) && [...a].sort().join(" ") !== [...b].sort().join(" ")) return 0;
  let inter = 0;
  let union = 0;
  for (const t of new Set([...a, ...b])) {
    const w = weight(t);
    union += w;
    if (a.has(t) && b.has(t)) inter += w;
  }
  return union > 0 ? inter / union : 0;
}

export interface NameMatch {
  recipeId: string;
  recipeName: string;
  score: number;
}

/** Best recipe for each sale name (names with no clear winner are left out). */
export function matchSaleNames(saleNames: readonly string[], recipes: readonly { id: string; name: string }[], minScore = 0.5): Map<string, NameMatch> {
  const out = new Map<string, NameMatch>();
  for (const sale of new Set(saleNames)) {
    if (INSTRUCTION.test(sale.trim())) continue;
    let best: NameMatch | null = null;
    let tie = false;
    for (const r of recipes) {
      const score = nameScore(sale, r.name);
      if (score < minScore) continue;
      if (!best || score > best.score + 1e-9) {
        best = { recipeId: r.id, recipeName: r.name, score };
        tie = false;
      } else if (Math.abs(score - best.score) <= 1e-9 && r.id !== best.recipeId) tie = true;
    }
    if (best && !tie) out.set(sale, best);
  }
  return out;
}
