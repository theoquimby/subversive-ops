import type { HelpEntry } from "../types";

/** Brewery: brewing stock, what to order when, and costs with a what-if. Kept apart from the kitchen's counts and ordering. */
export const breweryStock: HelpEntry[] = [
  {
    id: "brewery.stock",
    area: "brewery",
    route: "/brewery/stock",
    title: "Brewing stock",
    body: "Malt, hops, yeast and other brewing ingredients: what's on the shelf, what brews used, what planned brews need, and which are running short. Kept apart from kitchen counts.",
    article: `Every ingredient on the brewery side, with:

- **On hand**: the last count, plus deliveries, less what each brew used, plus fixes since. Malt and hops are in lb, yeast in packs (or grams), liquids in gallons. Red means below zero: a brew used more than was on record, so count it.
- **Last counted**, and what brews **used in the last 30 days**.
- **Planned brews need**: what brews on the [schedule](/brewery/schedule) in the next 8 weeks need, scaled to each brew's size.
- **Weeks of cover**: on hand ÷ the faster of recent use and planned need.
- **Status**: **Short** when a planned brew in the next three weeks can't be covered (or the shelf is below zero), **Order soon** when one in the next 8 weeks can't, otherwise **Fine**. Stock goes to the earliest brew first.

### Counting and deliveries

- **Count brewing stock** lists everything on one page for a phone. Type what's there in lb, oz, kg, packs, or a sack or box when the ingredient says what one holds. Blank rows stay as they are.
- **Received a delivery** adds what came in. When a brewing supplier's invoice is approved under [Invoices](/invoices), its malt, hops and yeast are added on their own (lines matched to a product with a pack size), so you only need this for deliveries without an invoice.
- Tap an ingredient for its history, to add a delivery, or to **fix** the amount (plus or minus, with why). A count, delivery or fix typed by mistake can be removed there.

### What brews use

When a brew is marked brewed, each recipe line matched to an ingredient is taken off, scaled to the brew's barrels (packs round up to whole ones). Marking it brewed again replaces what it took, never doubles it.

### Kept apart from the kitchen

Only ingredients on the brewery side show here, and they never show in kitchen counts or kitchen ordering. New ones added here start on the brewery side. Ingredients on a brewing recipe that are still on the kitchen side are listed under **Bring one over from the kitchen**.`,
    keywords: ["stock", "inventory", "malt", "hops", "yeast", "count", "delivery", "received", "on hand", "brewing", "shelf"],
    related: ["brewery.stock.count", "brewery.ordering", "brewery.costs"],
  },
  {
    id: "brewery.stock.onHand",
    area: "brewery",
    route: "/brewery/stock",
    title: "On hand",
    body: "The last count, plus deliveries, less what each brew used, plus fixes since. Never counted: the same from zero. Red when below zero.",
    related: ["brewery.stock"],
  },
  {
    id: "brewery.stock.needed",
    area: "brewery",
    route: "/brewery/stock",
    title: "Planned brews need",
    body: "What brews planned in the next 8 weeks need of this, scaled to each brew's size. A brew planned before today that isn't brewed yet counts as due now.",
    related: ["brewery.stock", "brewery.ordering"],
  },
  {
    id: "brewery.stock.count",
    area: "brewery",
    route: "/brewery/stock/count",
    title: "Count brewing stock",
    body: "Type what's on the shelf for each brewing ingredient, in any unit that fits, then save once. Blank rows are left as they are; what you've typed is kept if the page reloads.",
    related: ["brewery.stock"],
  },
  {
    id: "brewery.stock.received",
    area: "brewery",
    route: "/brewery/stock/received",
    title: "Received a delivery",
    body: "Type what came in to add it to brewing stock. Approved invoices for brewing ingredients add themselves, so this is for deliveries without one.",
    related: ["brewery.stock"],
  },
  {
    id: "brewery.ordering",
    area: "brewery",
    route: "/brewery/ordering",
    title: "What to order when",
    body: "For every brew planned in the next 12 weeks: what each brewing supplier needs to send after what's on the shelf, and the day to order by.",
    article: `One row per brew and brewing supplier, grouped **Late**, **Order this week**, **Next week** and **Later**. Orders already placed and ones the shelf covers are folded away at the bottom.

### The order-by day

Each supplier has a lead time and the day it counts back from:

- **Brew day**: malt (Hudson Valley Malt, 14 days), yeast (Omega Yeast, 10 days), MoreBeer (14 days).
- **Dry-hop day**: hops (NY Hop Guild, 7 days; Yakima Quality Hops, 10 days). The dry-hop day is the brew's own, or brew day plus the recipe's dry-hop day. If that supplier's hops also go in on brew day and are short, the order is for brew day instead.
- **Packaging day**: labels, 10 days before. Every planned brew gets a labels row.

When a supplier only delivers on some days (Omega: Tuesday to Friday, shipped overnight), the order-by day moves earlier until the next day is one of them.

### How much

Stock goes to planned brews in the order they need it (brew day, or the dry-hop day for dry hops), so the earliest brew is covered first and later ones order what's left short. When the supplier's pack size is known (a 50 lb sack, an 11 lb box), the suggestion rounds up to whole packs.

### Placing

**Mark placed** once the order is in; **Undo** takes it back. Orders due within three days, or late, show on the Overview and in the morning brief as "Order Hudson Valley Malt by Fri Nov 20 for NY Nectar" until they're marked placed.

### Which supplier

An ingredient's supplier is the brewing supplier it's bought as (its preferred product, else the one with the latest price). With none, a name on the recipe line like "Hudson Valley", "HVM", "NYHG", "Yakima" or "Omega" is used. Anything else is under **No supplier set**, with a two-week lead time.`,
    keywords: ["order", "ordering", "supplier", "lead time", "order by", "malt", "hops", "yeast", "labels", "placed", "dry hop"],
    related: ["brewery.ordering.suppliers", "brewery.stock", "brewery.schedule"],
  },
  {
    id: "brewery.ordering.orderBy",
    area: "brewery",
    route: "/brewery/ordering",
    title: "Order by",
    body: "The reference day (brew day, dry-hop day or packaging day) less the supplier's lead time, moved earlier if the delivery would land on a day the supplier doesn't deliver.",
    related: ["brewery.ordering"],
  },
  {
    id: "brewery.ordering.allocation",
    area: "brewery",
    route: "/brewery/ordering",
    title: "From stock",
    body: "How many of the lines the shelf covers. Stock goes to planned brews in date order, so the earliest brew gets it first.",
    related: ["brewery.ordering", "brewery.stock"],
  },
  {
    id: "brewery.ordering.suppliers",
    area: "brewery",
    route: "/brewery/ordering",
    title: "Brewing suppliers",
    body: "Each brewing supplier's lead time, what it counts back from, and the days a delivery can arrive. They never show in kitchen ordering; a kitchen supplier can be moved here.",
    related: ["brewery.ordering"],
  },
  {
    id: "brewery.ordering.lead",
    area: "brewery",
    route: "/brewery/ordering",
    title: "Lead time",
    body: "Days before the brew day, dry-hop day or packaging day to order by.",
    related: ["brewery.ordering.suppliers"],
  },
  {
    id: "brewery.ordering.days",
    area: "brewery",
    route: "/brewery/ordering",
    title: "Arrives",
    body: "Days a delivery can arrive. None picked means any day. Orders ship overnight, so the order-by day moves earlier until the next day is one of these.",
    related: ["brewery.ordering.suppliers"],
  },
  {
    id: "brewery.costs",
    area: "brewery",
    route: "/brewery/costs",
    title: "Brewing costs",
    body: "Each recipe's cost per batch, barrel, keg and pint from today's prices, what a pint sells for, the margin, and a what-if that changes prices, batch size or loss without saving.",
    article: `### The numbers

- **Per batch**: every recipe line × its ingredient's price today (the same prices as the recipe pages and menu costs).
- **Per barrel, ½ keg (15.5 gal), ⅙ keg (5.17 gal) and pint (16 oz)** share the batch over what reaches the kegs: the batch less 5% lost to trub, tank bottoms and transfers.
- **Pint sells for**: the average price of a 16 oz draft pour on Square over the last four months, for the beer the recipe pours as.
- **Pint margin**: what's left of that price after the cost of a pint poured (foam and line loss included, from kicked kegs when measured).
- **Keg margins** use the wholesale keg prices you type at the bottom of the page.

A recipe with lines that have no price shows "≥" before its cost and "≤" before its margin: the real cost is at least that much.

### What if

Nothing here is saved. Try:

- **An ingredient's price**: "Pilsner malt +10%". Every recipe that uses it updates, with how much it moved underneath. Add as many as you like.
- **Batch size**: every recipe brewed at this size. Amounts scale; packs round up to whole ones, so per-pint cost can move a little.
- **Yield loss**: more loss spreads the batch over less beer.

**Changed by the what-if** filters to the recipes it moves. **Back to today's numbers** clears it.

### Cost history

Open a recipe for its cost per pint on the first of each month over the year: today's recipe at that month's prices, from the price history. It shows once every line has had a price for two months.`,
    keywords: ["cogs", "cost", "margin", "what if", "price", "pint", "keg", "wholesale", "batch", "yield"],
    related: ["brewery.recipes", "brewery.costs.margin"],
  },
  {
    id: "brewery.costs.pint",
    area: "brewery",
    route: "/brewery/costs",
    title: "Per pint",
    body: "16 oz of packaged beer: the batch cost shared over the batch less yield loss. Foam and line loss at the tap are added in the pint margin.",
    related: ["brewery.costs"],
  },
  {
    id: "brewery.costs.margin",
    area: "brewery",
    route: "/brewery/costs",
    title: "Pint margin",
    body: "The Square pour price less the cost of a pint poured (after foam and line loss), as a share of the price.",
    related: ["brewery.costs"],
  },
];
