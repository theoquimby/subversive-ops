import type { HelpEntry } from "../types";

/** Brewery: tanks, the tank schedule, brewing recipes with live costs, brews and setup. */
export const brewery: HelpEntry[] = [
  {
    id: "brewery.tanks",
    area: "brewery",
    route: "/brewery",
    title: "Tanks",
    body: "What is in each fermenter and brite tank right now, how long it has been there, and what needs doing next.",
    article: `The page starts with **Needs doing**: brews ready to transfer or package (with how many days overdue), two brews booked into one tank in the next two weeks, and brew days today or tomorrow. Tap one to jump to its tank.

Below that is a card for every tank in use, fermenters first, then brite tanks:

- The beer, its batch code and size, and **day N of M**: days in this tank so far against the days it's meant to spend there. Brew day is day 0.
- The bar turns amber when the time is up, and red three days after.
- **Ready to transfer?** shows on a fermenter once the recipe's fermenting days are up; **Ready to package?** on a brite once its conditioning days are up. A brew with no recipe uses the usual days from [Setup](/brewery/setup).
- What goes in next, or when an empty tank is next booked.

### On a tank's card

- **Brew into this tank**: pick a recipe (or a beer with no recipe yet), the brew day and the volume. The batch code is the next number for the year (like 26-031) unless you type one. If a brite is free when fermenting should be done, it's pencilled in.
- **Mark brewed**: for a brew planned on the [schedule](/brewery/schedule) for today or tomorrow. If you brewed early or late, the rest of its plan moves by the same number of days.
- **Transfer**: pick the brite it went into. Tanks in use or too small can't be picked.
- **Package**: the tank is freed and a keg batch with the brew's code is made. When you fill kegs of that beer, the code is a one-tap choice, so each keg is tied to its brew.
- **Gravity**: a reading, or the OG or FG.
- **Dates**: change when it went in and when it's due out.
- **Dump**: with a reason, kept on the brew.

When a brew is brewed, its ingredient cost is worked out from that day's prices and kept, so later price changes don't rewrite it.`,
    keywords: ["brewery", "tank", "fermenter", "brite", "floor", "cellar", "transfer", "package", "gravity", "dump"],
    related: ["brewery.schedule", "brewery.batches", "brewery.setup"],
  },
  {
    id: "brewery.schedule",
    area: "brewery",
    route: "/brewery/schedule",
    title: "Tank schedule",
    body: "Every tank over the coming weeks: what is planned where, when each brew moves to a brite tank, and when it is packaged.",
    article: `### Plan a brew

Pick what you're brewing, the brew day and the size. Before anything is saved you see where it goes: the first free fermenter for its fermenting days, then the first free brite tank for its conditioning days, and the day it's ready to package. Pick a fermenter if you want a particular one.

If no brite is free on transfer day, the plan keeps the beer in the fermenter a few extra days until one is, and says so. If nothing fits, it says why (every fermenter busy, or none big enough) and offers the first day that works.

Days come from the recipe, or from the usual days on [Setup](/brewery/setup) for a beer with no recipe.

### Suggested brews

Worked out from keg sales on Square and the kegs you have. Take the day each beer's full kegs run out, less its days fermenting and conditioning: that's the last day to brew so a new keg is ready in time. **Soon** means within two weeks; **Late** means it's already too late to avoid a gap. A beer with a brew planned or in the tanks shows that instead. **Plan it** fills in the form.

### The 12 weeks

One row per tank, a bar per brew. Solid bars are in the tank or done; light dashed bars are planned. The line is today. A red outline is a clash (two brews in one tank at once) or a brew bigger than its tank. One brew can come out and the next go in on the same day. On a phone, each tank's coming brews are listed instead.

### Planned brews and the year

**Move** a planned brew to a new day (or size, or fermenter) and its tanks are worked out again. **Cancel** takes it off the schedule. **Brews by month** lists every brew this year, done and planned.`,
    keywords: ["schedule", "rotation", "plan", "tank", "calendar", "brew day", "suggested", "clash", "timeline"],
    related: ["brewery.tanks", "brewery.batches"],
  },
  {
    id: "brewery.recipes",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Brewing recipes",
    body: "Every brewing recipe with its gravity, bitterness, colour and cost worked out live from ingredient prices.",
    keywords: ["recipe", "grain", "malt", "hops", "yeast", "cost", "ibu", "abv", "srm"],
  },
  {
    id: "brewery.batches",
    area: "brewery",
    route: "/brewery/batches",
    title: "Brews",
    body: "Every brew, planned or done: when it was brewed, where it sat, what it cost and the kegs it filled.",
    article: `Filter by **Planned**, **In tanks**, **Packaged** or **All**, and search by code, beer or recipe.

- **ABV** comes from the OG and FG.
- **Cost** is the ingredient cost worked out on brew day from that day's prices, and kept. It says "not known yet" until it can be priced; you can type it in on the brew.
- **Per pint** is that cost over the brew's volume (a barrel is 248 pints).

Batch codes run by year: 26-001, 26-002 and so on, unless you type your own.`,
    keywords: ["batch", "brew", "brew log", "history", "packaged", "abv", "cost per pint"],
    related: ["brewery.batches.one", "brewery.tanks"],
  },
  {
    id: "brewery.batches.one",
    area: "brewery",
    route: "/brewery/batches/[id]",
    title: "One brew",
    body: "A brew's path through the tanks with dates, its gravity readings, cost, and the kegs filled from it and where they are now.",
    article: `- **Through the tanks**: each fermenter and brite stay with its dates and days. Change a date and the brew's own dates follow. On the tank it's in now, the second date is the day it's due out.
- **Gravity**: every reading. OG and FG also set the brew's ABV.
- **Kegs**: once packaged, the keg batch with the brew's code, how many kegs were filled from it by size, and where the ones still full are now. Each keg links to its page.
- **Details**: code, beer, recipe, volume, OG, FG, cost and notes, each saved as you leave it.`,
    keywords: ["brew", "batch", "kegs", "gravity", "path"],
    related: ["brewery.batches"],
  },
  {
    id: "brewery.setup",
    area: "brewery",
    route: "/brewery/setup",
    title: "Brewery setup",
    body: "The tanks in the brewery, their sizes, and the usual days a beer spends fermenting and conditioning.",
    article: `**Tanks**: add each fermenter and brite tank with its size in barrels. Click any cell to change it.

- **Order** sets where a tank shows on the Tanks page and the schedule, and which tank is tried first when planning.
- **Not in use** hides a tank from the floor and the schedule. A tank with a brew in it stays in use until the brew is moved or packaged.
- A tank can only be deleted if no brew has ever been in it.

**Usual days in tanks**: how long a beer ferments, then conditions, when its brew has no recipe. A recipe's own days always win.`,
    keywords: ["tanks", "setup", "fermenter", "brite", "capacity", "barrels", "default days"],
    related: ["brewery.tanks", "brewery.schedule"],
  },
  {
    id: "brewery.import",
    area: "brewery",
    route: "/brewery/import",
    title: "Import brewing data",
    body: "Bring in recipes and brews from the Brew Manager app: press Export backup JSON there, then upload the file here.",
    keywords: ["import", "brew manager", "backup", "json"],
  },
];
