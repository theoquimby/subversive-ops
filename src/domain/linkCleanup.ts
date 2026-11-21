/**
 * The clean-up for "Link your sales", as a short list in order: what to do,
 * how much of the last 30 days' sales each step gives a cost to, and where on
 * the page to do it. Specials nobody wants to cost yet can be skipped: they
 * count at a typical cost, and come back only once they sell most weeks again.
 */

import type { ItemKind } from "./linking";

/** A skipped item that sold on at least this many of the last 30 days is back on the menu: it returns to the list. */
export const BACK_ON_MENU_DAYS = 8;
/** A link whose names agree less than this is worth a second look. */
export const WEAK_NAME_MATCH = 0.45;

export const isBackOnMenu = (days30: number) => days30 >= BACK_ON_MENU_DAYS;

/** An item still to link (sold in the last 30 days, no cost behind it, not skipped). */
export interface CleanupItem {
  squareId: string;
  name: string;
  kind: ItemKind;
  sales30: number;
  /** A sure match is waiting for it. */
  sure: boolean;
  /** It's a pour of a beer that gets its cost from the keg. */
  beer: boolean;
}

export type StepKey = "check" | "beer" | "sure" | "each" | "notSales" | "recipes";

export interface CleanupStep {
  key: StepKey;
  title: string;
  detail: string;
  /** Last 30 days' sales this step gives a cost to (for "check": the sales behind the links to look at). */
  dollars: number;
  /** As a share of all sales that count. */
  share: number;
  items: number;
  /** Where on the page to do it. */
  href: string;
}

export interface CleanupPlan {
  steps: CleanupStep[];
  /** Linked now, linked plus skipped, and what it would be once every step but "check" is done. */
  now: number;
  withSkipped: number;
  after: number;
  /** Done: everything that sold has a cost or is skipped, and no link is waiting to be checked. */
  done: boolean;
}

const sum = (xs: readonly CleanupItem[]) => xs.reduce((s, x) => s + Math.max(0, x.sales30), 0);
const s = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
const names = (xs: readonly CleanupItem[], k = 3) => {
  const top = [...xs].sort((a, b) => b.sales30 - a.sales30).slice(0, k).map((x) => x.name.split(" · ")[0]);
  return top.length <= 1 ? (top[0] ?? "") : `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}`;
};

/**
 * The steps, biggest first, with links to check always at the top (a wrong
 * cost is worse than none). Gift cards and fees come out of sales instead of
 * getting a cost, so their step moves the share by shrinking what counts.
 */
export function cleanupPlan(input: { items: readonly CleanupItem[]; beers: number; check: { items: number; dollars: number }; total: number; linked: number; skipped: number }): CleanupPlan {
  const { items, total, linked, skipped } = input;
  const share = (x: number) => (total > 0 ? x / total : 0);
  const beer = items.filter((i) => i.beer);
  const rest = items.filter((i) => !i.beer);
  const sure = rest.filter((i) => i.sure);
  const others = rest.filter((i) => !i.sure);
  const each = others.filter((i) => i.kind === "packaged" || i.kind === "retail");
  const notSales = others.filter((i) => i.kind === "notSales");
  const recipes = others.filter((i) => i.kind === "food" || i.kind === "drink" || i.kind === "beer");
  const steps: CleanupStep[] = [];
  if (beer.length && input.beers > 0)
    steps.push({ key: "beer", title: `Enter what a keg costs for ${s(input.beers, "beer", "beers")}`, detail: `One number per beer and every pour of it gets a cost: ${usd(sum(beer))} of draft sales.`, dollars: sum(beer), share: share(sum(beer)), items: beer.length, href: "#beer" });
  if (sure.length)
    steps.push({ key: "sure", title: `Accept ${s(sure.length, "sure match", "sure matches")}`, detail: `Same or nearly the same name as a recipe you have, and the cost looks right. One button links them all.`, dollars: sum(sure), share: share(sum(sure)), items: sure.length, href: "#sure" });
  if (each.length)
    steps.push({ key: "each", title: `Give ${s(each.length, "can, bottle or merch item", "cans, bottles and merch items")} a cost each`, detail: `No recipe needed: type what one costs you, under Not a recipe. Biggest: ${names(each)}.`, dollars: sum(each), share: share(sum(each)), items: each.length, href: "#items" });
  if (recipes.length)
    steps.push({ key: "recipes", title: `Link or create recipes for ${s(recipes.length, "kitchen or bar item", "kitchen and bar items")}`, detail: `Start at the top: ${names(recipes)}. A special you don't want to cost yet: press Skip for now.`, dollars: sum(recipes), share: share(sum(recipes)), items: recipes.length, href: "#items" });
  if (notSales.length)
    steps.push({ key: "notSales", title: `Mark ${s(notSales.length, "gift card or fee", "gift cards and fees")} as not a sale`, detail: `Under Not a recipe → Leave out: money that isn't a sale comes out of the numbers altogether.`, dollars: sum(notSales), share: share(sum(notSales)), items: notSales.length, href: "#items" });
  steps.sort((a, b) => b.dollars - a.dollars);
  if (input.check.items > 0)
    steps.unshift({ key: "check", title: `Check ${s(input.check.items, "link that may be wrong", "links that may be wrong")}`, detail: `The names don't match much, or the cost looks wrong for the price. Fix or confirm each one.`, dollars: input.check.dollars, share: share(input.check.dollars), items: input.check.items, href: "#check" });
  // Taking gift cards and fees out shrinks what counts; everything else adds to what's costed.
  const added = sum(beer) + sum(sure) + sum(each) + sum(recipes);
  const left = total - sum(notSales);
  const after = left > 0 ? Math.min(1, (linked + skipped + added) / left) : 0;
  return { steps, now: share(linked), withSkipped: share(linked + skipped), after, done: items.length === 0 && input.check.items === 0 };
}
