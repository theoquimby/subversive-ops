/**
 * Menu costs, said plainly: which dishes cost the most to plate against what
 * they sell for, whether any is over its food-cost target, and what to do.
 * Pure: plain data in, plain words out.
 */

export interface DishCost {
  name: string;
  /** Plate cost ÷ menu price; null without a price or a cost. */
  foodCostPct: number | null;
  target: number;
  price: number | null;
  cost: number | null;
}

export interface MenuStory {
  tone: "good" | "warn" | "bad" | "neutral" | "unknown";
  headline: string;
  line: string;
  action: string | null;
  /** Dishes the headline names. */
  named: string[];
  over: number;
  /** Priced dishes, highest food cost first. */
  ranked: DishCost[];
  average: number | null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
/** "Burger" and "Soft pretzel" read as "Burger and soft pretzel" mid-sentence. */
const mid = (names: string[]) => names.map((n, i) => (i === 0 ? n : n.charAt(0).toLowerCase() + n.slice(1)));

export function menuStory(dishes: readonly DishCost[], opts: { needWork: number }): MenuStory {
  const ranked = dishes.filter((d) => d.foodCostPct != null).sort((a, b) => b.foodCostPct! - a.foodCostPct!);
  const average = ranked.length ? ranked.reduce((s, d) => s + d.foodCostPct!, 0) / ranked.length : null;
  const overs = ranked.filter((d) => d.foodCostPct! > d.target);
  const unpriced = dishes.length - ranked.length;
  const work = opts.needWork > 0 ? ` ${opts.needWork} ${opts.needWork === 1 ? "recipe needs" : "recipes need"} ingredients or prices before ${opts.needWork === 1 ? "its" : "their"} cost is right.` : "";

  if (!ranked.length) {
    return { tone: "unknown", headline: "No plate costs yet", line: `Add ingredients and a menu price to a recipe and its food cost shows here.${work}`, action: null, named: [], over: 0, ranked, average };
  }
  if (overs.length) {
    const named = overs.slice(0, 3).map((d) => d.name);
    const worst = overs[0];
    const toHit = worst.cost != null && worst.target > 0 ? worst.cost / worst.target : null;
    return {
      tone: overs.some((d) => d.foodCostPct! > d.target + 0.02) ? "bad" : "warn",
      headline: overs.length === 1 ? `${worst.name} costs more to plate than its target` : `${overs.length} dishes cost more to plate than their target`,
      line: `${list(mid(named))}${overs.length > 3 ? ` and ${overs.length - 3} more` : ""} ${overs.length === 1 ? "runs" : "run"} over. ${worst.name} is at ${pct(worst.foodCostPct!)} against a ${pct(worst.target)} target.${work}`,
      action: toHit != null ? `Raise ${worst.name} to about $${Math.ceil(toHit - 1e-6)} or trim its portion to bring it back to target.` : `Trim ${worst.name}'s portion or raise its price.`,
      named,
      over: overs.length,
      ranked,
      average,
    };
  }
  const top = ranked.slice(0, 2);
  const named = top.map((d) => d.name);
  return {
    tone: "good",
    headline: `${list(mid(named))} cost${named.length === 1 ? "s" : ""} the most to plate`,
    line: `Every dish is within its target. ${top.map((d) => `${d.name} at ${pct(d.foodCostPct!)}`).join(", ")}, against an average of ${pct(average!)} across ${ranked.length} priced ${ranked.length === 1 ? "dish" : "dishes"}.${unpriced ? ` ${unpriced} without a price ${unpriced === 1 ? "isn't" : "aren't"} counted.` : ""}${work}`,
    action: `Watch ${list(mid(named))} when supplier prices move; they have the least room.`,
    named,
    over: 0,
    ranked,
    average,
  };
}
