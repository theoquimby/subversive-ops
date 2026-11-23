/**
 * The Margin gap, said plainly: how much stock went missing between two counts
 * (or turned up), where most of it went, and the one thing to do about it.
 * Pure: plain data in, plain words out.
 */

import { gapTone, type Tone } from "./pnl";
import type { VarianceCause } from "./variance";

export interface GapRow {
  name: string;
  /** Unexplained cost: + more went out than sales and waste explain, − less. */
  cost: number;
  cause: VarianceCause | null;
  /** The item that uses most of it. */
  dish: string | null;
  group: "food" | "beverage";
}

export interface GapStory {
  tone: Tone;
  headline: string;
  line: string;
  action: string;
  /** The ingredient the headline names, if one stands out. */
  lead: GapRow | null;
}

/** Less than this either way is too little to chase. */
export const GAP_MIN = 20;

const dollars = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString("en-US")}%`;

/** "half of it", "most of it": how much of the total one ingredient carries, in words. */
function shareWords(share: number): string | null {
  if (share >= 0.65) return "most of it";
  if (share >= 0.42) return "about half of it";
  if (share >= 0.3) return "a third of it";
  return null;
}

export function gapStory(i: { sales: number; theoreticalCost: number; actualCost: number; wasteCost: number; unexplainedCost: number; rows: readonly GapRow[]; salesWord?: string }): GapStory {
  const u = i.unexplainedCost;
  const theoPct = i.sales > 0 ? i.theoreticalCost / i.sales : null;
  const actPct = i.sales > 0 ? i.actualCost / i.sales : null;
  const tone = gapTone(actPct, theoPct);
  const word = i.salesWord ?? "sales";

  const line =
    theoPct != null && actPct != null
      ? `By the recipes, ${dollars(i.sales)} of ${word} should have used ${dollars(i.theoreticalCost)} of stock (${pct(theoPct)}). ${dollars(i.actualCost)} went out (${pct(actPct)}), ${i.wasteCost > 0 ? `and ${dollars(i.wasteCost)} of it was logged as waste` : "and none was logged as waste"}.`
      : `${dollars(i.actualCost)} of stock went out, and no linked sales to compare it with.`;

  if (u >= GAP_MIN) {
    const over = i.rows.filter((r) => r.cost > 0).sort((a, b) => b.cost - a.cost);
    const top = over[0] ?? null;
    const words = top ? shareWords(top.cost / u) : null;
    const lead = words ? top : null;
    const headline = `${dollars(u)} of stock went missing${lead ? `, ${words} ${lead.name}` : ""}`;
    const t = top;
    const action = !t
      ? "Weigh a few portions and log waste as it happens."
      : t.cause === "unsold"
        ? `${t.name} went out but nothing sold uses it: link the Square item that does to its recipe.`
        : t.group === "beverage"
          ? `Check pour sizes${t.dish ? ` on ${t.dish}` : ""}, and ring in comps and staff drinks.`
          : `Weigh a few portions${t.dish ? ` of ${t.dish}` : ""} and log waste as it happens.`;
    return { tone, headline, line, action, lead };
  }
  if (u <= -GAP_MIN) {
    const under = i.rows.filter((r) => r.cost < 0).sort((a, b) => a.cost - b.cost);
    const top = under[0] ?? null;
    const words = top ? shareWords(top.cost / u) : null;
    const lead = words ? top : null;
    return {
      tone,
      headline: `${dollars(u)} less went out than the recipes say${lead ? `, ${words} ${lead.name}` : ""}`,
      line,
      action: top ? `Check every delivery of ${top.name} was received on Ordering, then recount it.` : "Check deliveries were received on Ordering, and recount the biggest gaps.",
      lead,
    };
  }
  return { tone, headline: "Stock matches the recipes", line, action: "Nothing to chase. Count again next week to keep it that way.", lead: null };
}

/** How old a count is, for the line that asks for a new one. */
export function countAge(days: number): { words: string; stale: boolean } {
  const words = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return { words, stale: days >= 7 };
}
