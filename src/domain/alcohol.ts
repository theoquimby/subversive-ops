/**
 * Hard or not: "cider" is not "hard cider", "ginger beer" isn't spiked, and a
 * non-alcoholic beer isn't the real thing. Ingredient matching (quick add,
 * recipe drafts) uses this so it never swaps one for the other on a shared
 * word: a Cider and Bourbon's only alcohol is the bourbon.
 */

const HARD = /\b(hard|spiked|boozy|alcoholic)\b/i;
const NOT_HARD = /\b(non[\s-]?alcoholic|alcohol[\s-]?free|zero[\s-]?proof|virgin|n\/a|na beer|mocktails?)\b/i;

/** "hard" when the words say it's alcoholic, "none" when they say it isn't, else null (doesn't say). */
export function alcoholWord(text: string): "hard" | "none" | null {
  if (NOT_HARD.test(text)) return "none";
  if (HARD.test(text)) return "hard";
  return null;
}

/**
 * The two disagree about alcohol: one says hard (or non-alcoholic) and the
 * other doesn't say the same. "cider" vs "Hard cider" clash; "hard cider" vs
 * "Indian Ladder Hard Cider" don't; "bourbon" vs "Bourbon" don't.
 */
export function alcoholClash(typed: string, itemName: string): boolean {
  return alcoholWord(typed) !== alcoholWord(itemName);
}
