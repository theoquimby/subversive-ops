import type { HelpEntry } from "../types";

/** The kitchen prep list: what to make today, on hand, ticks, setup. */
export const prep: HelpEntry[] = [
  {
    id: "prep.page",
    area: "prep",
    route: "/prep",
    title: "Prep list",
    body: "What to make today, by station, most urgent first. Each line says how much (rounded to batches) and why. Tap the circle when it's made.",
    article: `The list is worked out fresh every time you open it.

1. **Forecast**: how many of each dish will sell over the next service days (two by default — change it on Prep setup).
2. **Use**: every dish that uses the item, through its recipe. Aioli in a burger and in a side of fries both count.
3. **Minus on hand**: the last count on this list, plus batches made since, minus what's been used and thrown out.
4. **Rounded up** to whole batches (or half batches, or exact — set per item).

Par is the least to keep, even when the forecast says less. Shelf life caps it: you're never told to make more than gets used before it goes off.

Lines that run out first are at the top of each station. Items with enough on hand are folded away under **Enough on hand**.`,
    audience: "all",
    tour: "prep",
    related: ["prep.onHand", "prep.how", "prep.setup"],
    keywords: ["prep", "prep list", "mise en place", "sauces", "batches", "par", "kitchen"],
  },
  {
    id: "prep.how",
    area: "prep",
    route: "/prep",
    title: "How the amounts are worked out",
    body: "Each line says what it's for: the dishes forecast over the next days (today and tomorrow, say), minus what's on hand, rounded up to batches.",
    article: `**Linked items win.** Square items linked to a recipe on [Sales & forecast](/sales) are used as they are. Items with no link are matched by name ("Classic Smash Burger" → Classic Burger) only onto recipes that have no links, so nothing counts twice.

The forecast is the same one ordering uses: recent weeks of each weekday, the trend, events, weather and any manual change to the day.

A prep item inside another (roasted garlic in the aioli) is needed for the batches of the parent being made today.`,
    audience: "all",
    related: ["prep.page", "prep.setup.par", "prep.setup.shelfLife"],
    keywords: ["forecast", "why", "how much", "matched by name", "square items"],
  },
  {
    id: "prep.day",
    area: "prep",
    route: "/prep",
    title: "Today or tomorrow",
    body: "Plan tonight for tomorrow's prep. Tomorrow's list takes off what today is expected to use and counts what's been made today.",
    audience: "all",
    related: ["prep.page"],
  },
  {
    id: "prep.progress",
    area: "prep",
    route: "/prep",
    title: "Done so far",
    body: "How many lines are ticked today. Each tick records who made it and when, and the amount counts as on hand from tomorrow.",
    audience: "all",
    related: ["prep.adjust"],
    keywords: ["tick", "done", "who", "when"],
  },
  {
    id: "prep.adjust",
    area: "prep",
    route: "/prep",
    title: "Changing the amount",
    body: "Tap a line, then − or + to make more or less (by a batch, half batch or quarter unit). Ticking it done records the amount you chose.",
    audience: "all",
    related: ["prep.setup.rounding"],
    keywords: ["adjust", "more", "less", "override"],
  },
  {
    id: "prep.onHand",
    area: "prep",
    route: "/prep",
    title: "On hand",
    body: "Tap a line and type what's in the walk-in now, in the unit shown. The list updates straight away. No signal? It's kept on the phone and sent later.",
    article: `Between counts, on hand is estimated: the last count, plus batches ticked since, minus what sales used and what was logged on [Waste](/waste).

Count the things that matter most before prep starts — the list is only as good as its starting point. Items never counted show **Not counted yet** and are treated as empty.`,
    audience: "all",
    related: ["prep.page", "prep.setup.unit"],
    keywords: ["count", "on hand", "stock", "walk-in", "offline"],
  },
  {
    id: "prep.enough",
    area: "prep",
    route: "/prep",
    title: "Enough on hand",
    body: "Items that don't need making today, with how long what's there should last. Tap one to update its count.",
    audience: "all",
    related: ["prep.onHand"],
  },
  {
    id: "prep.nodata",
    area: "prep",
    route: "/prep",
    title: "No forecast or par yet",
    body: "Nothing that sells uses these yet (or its Square item isn't linked or matched), and no par is set. Set a par on Prep setup to keep some on hand.",
    audience: "all",
    related: ["prep.setup.par"],
  },
  {
    id: "prep.recipe",
    area: "prep",
    route: "/prep",
    title: "Scaled recipe",
    body: "The recipe multiplied for the amount you're making, in kitchen units (96 fl oz shows as 3 qt). Use − and + to rescale.",
    audience: "all",
    related: ["prep.adjust"],
    keywords: ["recipe", "scale", "multiply", "batch"],
  },
  {
    id: "prep.setup",
    area: "prep",
    route: "/prep/setup",
    title: "Prep setup",
    body: "Pars, shelf life, rounding and station for each prep item, edited in place like a spreadsheet. Tick rows to set several at once. Each row opens its recipe, for the batch size.",
    tour: "prep",
    related: ["prep.setup.par", "prep.setup.shelfLife", "prep.setup.unit", "prep.cover"],
    keywords: ["prep settings", "par levels", "shelf life", "stations"],
  },
  {
    id: "prep.cover",
    area: "prep",
    route: "/prep/setup",
    title: "Prep enough for",
    body: "How many service days each day's prep should cover — usually until the next delivery or prep day. Closed days are skipped. Shelf life still caps each item.",
    related: ["prep.setup.shelfLife"],
    keywords: ["cover days", "days ahead", "delivery"],
  },
  {
    id: "prep.setup.onList",
    area: "prep",
    route: "/prep/setup",
    title: "On the list",
    body: "Turn off items that aren't prepped ahead, like portions plated to order. They stay in recipes and costing.",
  },
  {
    id: "prep.setup.station",
    area: "prep",
    route: "/prep/setup",
    title: "Station",
    body: "Groups the prep list, like Sauces, Fry or Garde manger. Blank uses the recipe's category.",
  },
  {
    id: "prep.setup.unit",
    area: "prep",
    route: "/prep/setup",
    title: "Counted in",
    body: "What the kitchen counts and makes it in: qt, lb, each — or a container with its size, like cambro = 6 qt or bottle = 24 fl oz.",
    keywords: ["cambro", "quart", "bottle", "deli", "container", "unit"],
  },
  {
    id: "prep.setup.par",
    area: "prep",
    route: "/prep/setup",
    title: "Par",
    body: "The least to keep on hand, in the counted unit. The list never suggests less, even on a quiet forecast. Leave blank to go by the forecast alone.",
    keywords: ["par", "minimum", "par level"],
  },
  {
    id: "prep.setup.shelfLife",
    area: "prep",
    route: "/prep/setup",
    title: "Keeps for",
    body: "Days it lasts once made. The list won't suggest more than gets used in that time, and warns when a whole batch is more than that.",
    keywords: ["shelf life", "expiry", "days", "use by"],
  },
  {
    id: "prep.setup.rounding",
    area: "prep",
    route: "/prep/setup",
    title: "Round to",
    body: "Whole batches (the recipe as written), half batches, or the exact amount to the nearest quarter unit.",
    keywords: ["rounding", "batch", "half batch"],
  },
];
