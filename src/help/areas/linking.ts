import type { HelpEntry } from "../types";

/** Link your sales (/sales/link): giving every Square item a cost, and choosing ingredient vs prep recipe inside recipes. */
export const linking: HelpEntry[] = [
  {
    id: "sales.link",
    area: "sales",
    route: "/sales/link",
    title: "Link your sales",
    body: "Gives every Square item a cost so profit, food cost and ordering are exact: a recipe, a keg for draft beer, or a cost each for things you buy in. Biggest sellers first, each link shows its cost before saving, and anything can be undone.",
    article: `Until a Square item is linked, its sales are costed at a typical 30% on the Overview and P&L, and it doesn't count toward prep or ordering. This page gets you linked fastest, biggest sellers first.

### What to do, in order
The card at the top lists the clean-up as numbered steps, each with how much of the last 30 days' sales it gives a cost to. Tap a step to jump to where it's done. Links that may be wrong always come first; then the biggest: usually keg costs for draft beer, sure matches, cans and bottles, and recipes for the kitchen and bar.

### Specials
- **Specials you aren't running** need nothing. Anything that hasn't sold in 30 days stays out of the way here, so there's nothing to delete in Square.
- **A special that's selling but you don't want to cost yet**: press **Skip for now**. It counts at a typical cost and leaves the list. If it starts selling most weeks again (8 or more of the last 30 days), it comes back with a note. **Skipped for now**, at the bottom, lists them with **Bring back**.

### For each item
- **Accept** links it to the suggested recipe. The suggestion shows how sure it is (Sure, Likely, Maybe) and why: same name, same price, same category.
- **Pick another** opens a searchable list of recipes, each with its cost and what share of this item's price that is.
- **Create recipe** makes a menu recipe named after the item with Square's price and category. Add its ingredients right there (type \"6 oz ground beef\" and Enter, or pick from the list; anything missing can be added as a new ingredient), then **Create with N ingredients and link**: created, costed and linked without leaving the page. **Create and open the recipe** opens it instead. **Draft ingredients for me** suggests the lines from your similar recipes first.
- **Skip for now**: a special you don't want to cost yet. It counts at a typical cost and comes back if it starts selling most weeks.
- **Not a recipe**: **Bought in** for cans, bottles, soda and merch (type what one costs you; it still counts as a sale), or **Leave out of sales** for gift cards, service fees and deposits.

### Draft beer
Pours are grouped by beer. Type what a keg costs once and every pour gets a cost from its ounces (16 oz, 9 oz, tasters), then they're all linked in one go. It sets the beer up on [Draft beer](/menu/draft-beer) too.

### It can't make things worse
- Every link shows its effect before you save it: “Cost $3.10 on $16.00 → 19% cost”.
- Links that look wrong ask before saving: under 5% or over 80% of the price, a different size (Wings (6) vs Wings (10)), or a prep recipe.
- **Check these links** lists saved links whose names hardly agree or whose cost looks off, with **Looks right**, **Change** and **Unlink**.
- The **Linking your sales** tour (Help → Guided tours, or the **?** menu on this page) walks through it in two minutes.
- Every change goes in **Changes** with an **Undo**, and the message after saving has one too.

**Sure matches** links all the near-certain ones at once, after you've looked them over.`,
    related: ["sales.link.coverage", "sales.link.beer", "sales.link.check", "sales.mapping", "menu.draftBeer"],
    keywords: ["link", "map", "mapping", "unlinked", "not linked", "typical 30%", "assistant", "square items", "recipe"],
  },
  {
    id: "sales.link.coverage",
    area: "sales",
    route: "/sales/link",
    title: "How much is linked",
    body: "The share of the last 30 days' Square item sales that has a cost behind it (a recipe or a cost each), against a 90% target. Specials skipped for now are shaded and count towards the target. Below it, the clean-up in order, biggest first.",
    related: ["sales.link", "overview.foodCost"],
    keywords: ["coverage", "linked %", "target"],
  },
  {
    id: "sales.link.bulk",
    area: "sales",
    route: "/sales/link",
    title: "Sure matches",
    body: "Items whose name matches a recipe almost exactly and whose cost looks normal for the price. Untick any you don't want, then link the rest at once. Undo puts them all back.",
    related: ["sales.link"],
  },
  {
    id: "sales.link.items",
    area: "sales",
    route: "/sales/link",
    title: "Still to link",
    body: "Square items that sold in the last 30 days with no cost behind them, biggest first. Accept the suggestion, pick another recipe, create one, mark it as bought in or not a sale, or Skip for now if it's a special you don't want to cost yet.",
    related: ["sales.link", "sales.link.check"],
  },
  {
    id: "sales.link.beer",
    area: "sales",
    route: "/sales/link",
    title: "Draft beer pours",
    body: "Every pour of a beer, grouped. Type the keg cost once (brewing cost for house beer, the invoice for a guest keg) and each pour gets a cost from its ounces after foam and line loss. Check the ounces before saving.",
    related: ["menu.draftBeer", "overview.bevCost"],
    keywords: ["keg", "pour cost", "pint", "beer cost"],
  },
  {
    id: "sales.link.check",
    area: "sales",
    route: "/sales/link",
    title: "Check these links",
    body: "Links worth a second look: the names hardly agree (how a wrong suggestion slips in), or the cost looks wrong for the price. Looks right stops it showing; Change picks another recipe; Unlink takes it off.",
    related: ["sales.link", "menu.editor.lines"],
  },
  {
    id: "sales.link.history",
    area: "sales",
    route: "/sales/link",
    title: "Changes",
    body: "Every link change, here and on the Square items table, with who made it. Undo puts it back as it was, unless the item has been changed again since.",
    related: ["sales.link"],
    keywords: ["undo", "history", "log"],
  },
  {
    id: "menu.editor.picker",
    area: "menu",
    route: "/menu",
    title: "Ingredient or prep recipe",
    body: "Each line uses an ingredient you buy or a prep recipe you make (sauces, pickles, prepped proteins). The list marks which is which, what the line would cost, and when its unit won't work. A house-made ingredient line offers to use or make the prep recipe.",
    article: `Pick a **prep recipe** for anything made in the kitchen, so its cost comes from its own ingredients, it shows on the prep list, and ordering buys what goes into it.

- The list shows a badge on each choice: **Ingredient** or **Prep recipe**. Type to search either.
- Beside each choice: what this line would cost with it, or “unit changes” when the line's unit doesn't work for it (grams for something counted each).
- Under an ingredient line that sounds house-made (aioli, pickles, pulled pork): **Use** the prep recipe of the same name if there is one, or **Make it a prep recipe** to start one.`,
    related: ["menu.editor.lines", "prep.page"],
    keywords: ["sub-recipe", "sub recipe", "prep recipe", "house made", "sauce", "pickles"],
  },
];
