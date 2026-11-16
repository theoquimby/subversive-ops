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
    article: `Recipes are grouped **Live** (brewed now), **In development** and **Archived**. Each row shows the beer it pours as, the batch size, OG → FG, ABV, IBU, a colour swatch and what a pint costs in ingredients.

**In use** shows live and in-development recipes; the **Archived** tab has the rest. Search by name, style or beer, filter by beer or style, or show only those that **Need prices**. Sort by any number, group by status, beer or style, and **CSV** saves what's shown.

### Where the cost comes from

Each line of a recipe is matched to an ingredient, and costed at that ingredient's price today: the same price the menu costs use, from price sheets, invoices or a price typed in. Nothing is kept twice.

- **Per batch** is every line's amount × its price.
- **Per barrel, per 1/2 bbl keg (15.5 gal), per 1/6 bbl keg (5.17 gal) and per 16 oz pint** share the batch cost over what reaches the kegs: the batch size less 5% lost to trub, tank bottoms and transfers. Foam and line loss at the tap are not included; the keg pages add those.

### "No price yet" and "Needs prices"

A line has no cost when it isn't matched to an ingredient, the ingredient has no price yet, or its unit doesn't fit (a malt in gallons). Those lines are never counted as $0 without saying so: the cost reads "at least $X, 4 ingredients have no price", and the list says **Needs prices**. Add the prices in [Brewing ingredient prices](/brewery/recipes#prices) below the list.

### Keg costs

When a recipe is **Live**, linked to a beer, and every line has a price, the keg pages ([Demand](/kegs/demand)) take that beer's cost per pint from it.`,
    related: ["brewery.recipes.editor", "brewery.recipes.prices", "brewery.recipes.numbers", "brewery.import"],
    keywords: ["recipe", "grain", "malt", "hops", "yeast", "cost", "ibu", "abv", "srm", "beersmith", "cost per pint", "cost per keg"],
  },
  {
    id: "brewery.recipes.editor",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Writing a brewing recipe",
    body: "Add the grain, hops, yeast and anything else, with amounts. The numbers at the top recalculate as you type. Match each line to an ingredient so it has a cost, then Save.",
    article: `1. Name the recipe, give it a style and pick the **beer it pours as**.
2. Set the **batch size** (bbl), **efficiency** and **boil** under Process.
3. Add lines: **Grain bill**, **Hops**, **Yeast** and **Other** (sugars and fruit, water salts, finings, enzymes).
4. Under each line, **match it to an ingredient** so it has a price, or pick **Add as a new ingredient** (it's filed under Malt, Hops, Yeast or Brewing).
5. Press **Save**. Leaving with unsaved changes asks first.

**Scale to** shows every amount for another batch size without changing the recipe. **Make this the batch size** rescales it for real (then Save).

**Duplicate** makes an in-development copy to try changes on. **Delete** removes a recipe no brew uses; one that brews use is archived instead, so their history keeps it.`,
    related: ["brewery.recipes.numbers", "brewery.recipes.grain", "brewery.recipes.hops"],
    keywords: ["new recipe", "edit recipe", "scale", "duplicate", "batch size"],
  },
  {
    id: "brewery.recipes.numbers",
    area: "brewery",
    route: "/brewery/recipes",
    title: "How the numbers are worked out",
    body: "OG from the grain bill and efficiency, FG from the yeast's attenuation, ABV from the drop, IBU by Tinseth and colour by Morey. They are estimates from standard formulas; a hydrometer reading wins.",
    article: `All amounts are turned into pounds, ounces and US gallons (1 barrel = 31 gallons).

- **OG**: each grain's pounds × its extract (ppg, gravity points per pound per gallon) × brewhouse efficiency, added up and divided by the batch in gallons. 700 lb at 37 ppg, 72% efficiency, 7 bbl (217 gal) is 700 × 37 × 0.72 ÷ 217 = 86 points, so 1.086. Sugars and other kettle additions on an Other line with a ppg count in full, as they aren't mashed. A grain with no ppg uses a typical one for its kind (37 for base malt, 34 for crystal, 25 for roasted grain, 46 for sugar); the page says when it did.
- **FG**: OG less the yeast's apparent attenuation (75% when no yeast gives one; with several yeasts, the highest).
- **ABV** = (OG − FG) × 131.25.
- **IBU** (Tinseth): utilisation = 1.65 × 0.000125^(gravity − 1) × (1 − e^(−0.04 × minutes)) ÷ 4.15, times alpha % × ounces × 7490 ÷ gallons. The OG stands in for the boil gravity. First-wort hops count as boiling for the whole boil. Whirlpool hops count half the utilisation of the same minutes in the boil (20 minutes if none given), as the wort is below boiling. Dry hops and mash hops add none. A hop with no alpha % adds none until one is entered.
- **Colour** (Morey): MCU = pounds × °Lovibond ÷ gallons, added up; SRM = 1.4922 × MCU^0.6859. The swatch is roughly what that looks like in the glass.`,
    related: ["brewery.recipes.editor"],
    keywords: ["og", "fg", "abv", "ibu", "srm", "tinseth", "morey", "ppg", "lovibond", "efficiency", "attenuation", "formula"],
  },
  {
    id: "brewery.recipes.grain",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Grain bill",
    body: "Each malt or grain with its weight, extract (ppg) and colour (°L). Grist is its share of the grain by weight. Empty ppg or °L uses a typical value for that kind of grain, shown faintly.",
    keywords: ["malt", "grain", "ppg", "lovibond", "grist"],
  },
  {
    id: "brewery.recipes.hops",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Hops",
    body: "Each addition with its weight, alpha acid %, when it goes in (boil, first wort, whirlpool, dry hop) and minutes (days for a dry hop). IBU shows what each one adds.",
    keywords: ["hops", "alpha", "ibu", "dry hop", "whirlpool", "bittering"],
  },
  {
    id: "brewery.recipes.yeast",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Yeast",
    body: "The yeast with its amount (packages, grams) and apparent attenuation %, which sets the final gravity. With no attenuation, 75% is assumed.",
    keywords: ["yeast", "attenuation", "pitch"],
  },
  {
    id: "brewery.recipes.other",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Other ingredients",
    body: "Adjuncts (sugar, fruit, honey), water salts, finings and enzymes. Give an adjunct a ppg if it adds sugar to the wort; it then counts toward the OG.",
    keywords: ["adjunct", "sugar", "fruit", "water salts", "gypsum", "finings", "enzyme"],
  },
  {
    id: "brewery.recipes.details",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Status and beer",
    body: "Live recipes are brewed now; In development are trials; Archived are kept for the record. Linking the beer it pours as lets the keg pages cost a pint from this recipe.",
    keywords: ["status", "live", "archived", "development", "beer"],
  },
  {
    id: "brewery.recipes.process",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Process",
    body: "Batch size in barrels, brewhouse efficiency, boil length and the usual days fermenting and conditioning (the tank schedule uses these). Targets are what you aim for; the numbers above are worked out.",
    keywords: ["batch size", "efficiency", "boil", "ferment", "condition", "target"],
  },
  {
    id: "brewery.recipes.prices",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Brewing ingredient prices",
    body: "Malt, hops, yeast and brewing ingredients with today's price and where it came from. Type a price to set it. Price sheets and invoices from your suppliers keep them current on their own.",
    article: `Prices here are the same prices as everywhere else in Ops (Ingredients, Prices, menu costs). Typing one records it in the price history, dated today:

- On the product this ingredient is already priced from (from the supplier you pick, if you pick one), so the supplier's next price sheet or invoice updates it.
- Otherwise on a new product under that supplier, or under **Manual prices** when no supplier is picked.

Once you pick a supplier and type a price, the ingredient is costed from that supplier's product.

Malt and hops are priced per lb (hops also show per oz), yeast per package, liquids per gallon.

Once a maltster's or hop supplier's products are linked to these ingredients on [Prices](/prices), their price sheets and invoices keep these current without typing.

The ones with no price come first. Search by name, category or supplier; filter by **Category** or **Supplier**, or show only **No price yet** or those **In a recipe**. On a phone, tap an ingredient to type its price.`,
    related: ["brewery.recipes"],
    keywords: ["price", "malt price", "hop price", "yeast price", "manual price"],
  },
  {
    id: "brewery.batches",
    area: "brewery",
    route: "/brewery/batches",
    title: "Brews",
    body: "Every brew, planned or done: when it was brewed, where it sat, what it cost and the kegs it filled.",
    article: `Pick **Planned**, **In tanks**, **Packaged** or **All**, and search by code, beer or recipe. Filter by **Beer**, **Recipe** or **Year**, or show only brews with **No cost yet**. Sort by any column, group by status, beer, recipe or year; the totals row adds up volume and cost, and **CSV** saves what's shown. The tab, beer, recipe and year stay in the address, so a view can be bookmarked.

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
- **Not in use** hides a tank from the floor and the schedule. A tank with a brew in it stays in use until the brew is moved or packaged. Tanks not in use are listed under **Show tanks not in use**.
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
    article: `1. In Brew Manager, open **Settings → Backup → Export backup JSON**. It saves a file like subversive-backup-2026-11-16.json.
2. Upload that file here. You see what's in it before anything changes: recipes, brews, tanks, which recipes match a beer.
3. Press **Import**.

Importing again (a newer backup) **updates** what came in last time instead of adding copies. What you add here afterwards (ingredient matches, extract, colour and alpha) is kept, and an In development status isn't undone.

### What comes across

- **Recipes**, with their grain, hops and yeast. Brew Manager writes gravity in °Plato; it's turned into specific gravity. Amounts like "400-700lb" use the middle; ones it can't read ("4bbl pitch") come in as 0 to fill in.
- **Brews**, with their stage: fermenting and conditioning are in a fermenter, brite is in a brite tank, packaged is done.
- **Time in each tank**, from each brew's tank path and its dated moves.
- **Tanks** a brew sat in that aren't set up yet are added (FV… a fermenter, BBT… or brite a brite tank), sized from the brews. Check their sizes in [Setup](/brewery/setup).

Recipes are linked to the beer of the same name (capitals and spaces don't matter).

### What doesn't

The backup holds recipes and batches only. Brew Manager's schedule, development beers and stock aren't in it. It has no alpha acids, extract or colour either, so add those on each recipe for IBU and colour.`,
    related: ["brewery.recipes", "brewery.setup"],
    keywords: ["import", "brew manager", "backup", "json", "plato"],
  },
];
