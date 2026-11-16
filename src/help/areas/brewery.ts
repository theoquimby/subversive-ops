import type { HelpEntry } from "../types";

/** Brewery: tanks, the tank schedule, brewing recipes with live costs, brews and setup. */
export const brewery: HelpEntry[] = [
  {
    id: "brewery.tanks",
    area: "brewery",
    route: "/brewery",
    title: "Tanks",
    body: "What needs doing in the cellar, then every tank as a list or on the floor plan: what's in it, which day it's on and the next thing to do.",
    article: `The page starts with **Needs doing**: brews ready to transfer or package (with how many days overdue), dry hops due, two brews booked into one tank in the next two weeks, and brew days today or tomorrow. Tap one to jump to its tank.

Below that, every tank in use, as a **List** of cards or on the **Floor plan** (see [Floor plan](/help/brewery.floorPlan)). On each card:

- The beer, its batch code and size, and **day N of M**: days in this tank so far against the days it's meant to spend there. Brew day is day 0.
- The bar turns amber when the time is up, and red three days after.
- The next thing to do, at the top right: **Check: transfer?**, **Transfer to brite**, **Package**, **Dry hop** or **Grav check**.
- Its dry-hop, transfer or packaging, and release days, and what goes in next.

### On a tank's card

- **Brew into this tank**: pick a recipe (or a beer with no recipe yet), the brew day and the volume. The batch code is the next number for the year (like 26-031) unless you type one. Its dates come from its timing profile; a free brite is pencilled in for its transfer day.
- **Mark brewed**: for a brew planned on the [schedule](/brewery/schedule) for today or tomorrow. If you brewed early or late, the rest of its plan moves by the same number of days (a locked release stays).
- **Transfer**: to a brite, another fermenter or between brites, with the gravity and a note. See [Moving a brew](/help/brewery.moves).
- **Mark conditioning**: done fermenting, staying in its fermenter for now.
- **Package**: with the final gravity, kegs, cases and CO₂. See [Packaging](/help/brewery.packaging).
- **Gravity**: a reading, or the OG or FG, in °Plato or SG as the brewery is set.
- **Dates**: change when it went in and when it's due out.
- **Split**: part of it into another fermenter as its own brew.
- **Dump**: with a reason, kept on the brew.

When a brew is brewed, its ingredient cost is worked out from that day's prices and kept, so later price changes don't rewrite it.`,
    keywords: ["brewery", "tank", "fermenter", "brite", "floor", "cellar", "transfer", "package", "gravity", "dump"],
    related: ["brewery.floorPlan", "brewery.moves", "brewery.packaging", "brewery.schedule", "brewery.batches", "brewery.setup"],
  },
  {
    id: "brewery.schedule",
    area: "brewery",
    route: "/brewery/schedule",
    title: "Tank schedule",
    body: "Every tank over the coming weeks: what is planned where, its dry-hop, transfer, packaging and release days, the year by month, and a calendar feed.",
    article: `### Plan a brew

Pick what you're brewing, the brew day, the size and its timing. Before anything is saved you see where it goes: the first free fermenter until its transfer day, then the first free brite until packaging, with its dry-hop and release days.

Dates come from its timing profile (Hazy IPA, Sour, Lager, Pale), snapped to your transfer and packaging weekdays: see [Timing profiles](/help/brewery.profiles). A recipe with no profile uses its own days, or the usual days on [Setup](/brewery/setup).

If no brite is free on transfer day, the plan keeps the beer in the fermenter until the next transfer day one is, and says so. If nothing fits, it says why (every fermenter busy, or none big enough) and offers the first day that works.

### Suggested brews

Worked out from keg sales on Square and the kegs you have. Take the day each beer's full kegs run out, less its days fermenting and conditioning: that's the last day to brew so a new keg is ready in time. **Soon** means within two weeks; **Late** means it's already too late to avoid a gap. A beer with a brew planned or in the tanks shows that instead. **Plan it** fills in the form.

### The 12 weeks

One row per tank, a bar per brew. Solid bars are in the tank or done; light dashed bars are planned. A thin line inside a bar is its dry-hop day. The line down the page is today. A red outline is a clash (two brews in one tank at once) or a brew bigger than its tank. One brew can come out and the next go in on the same day. The last row is **Releases**, with a lock on locked ones. On a phone, each tank's coming brews are listed instead.

### Planned brews and the year

**Move** a planned brew to a new day (or size, or fermenter) and its tanks and dates are worked out again; a locked release stays put and you're told if the new day is too late for it ([Locked releases](/help/brewery.lockedRelease)). **Brew now** starts its brew day. **Cancel** takes it off the schedule.

**Brews by month** lists every brew this year, done and planned, with its timing, release day, any lock, and for planned brews how many supplier orders are placed ("Orders: 2 of 3 placed", amber when one is due).

### Calendar

**Add to Google Calendar** puts brew days, dry hops, transfers, packaging and releases in your calendar: see [Brewery calendar](/help/brewery.calendar).`,
    keywords: ["schedule", "rotation", "plan", "tank", "calendar", "brew day", "suggested", "clash", "timeline", "year", "orders"],
    related: ["brewery.tanks", "brewery.batches", "brewery.profiles", "brewery.lockedRelease", "brewery.calendar"],
  },
  {
    id: "brewery.recipes",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Brewing recipes",
    body: "Every brewing recipe with its gravity, bitterness, colour and cost worked out live from ingredient prices.",
    article: `Recipes are grouped **Live** (brewed now), **In development** and **Archived**. Each row shows the beer it pours as, the batch size, OG → FG, ABV, IBU, a colour swatch and what a pint costs in ingredients.

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

Once a maltster's or hop supplier's products are linked to these ingredients on [Prices](/prices), their price sheets and invoices keep these current without typing.`,
    related: ["brewery.recipes"],
    keywords: ["price", "malt price", "hop price", "yeast price", "manual price"],
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

Batch codes run by year: 26-001, 26-002 and so on, unless you type your own. A brew split from another takes its code and the next letter: 26-014B.`,
    keywords: ["batch", "brew", "brew log", "history", "packaged", "abv", "cost per pint"],
    related: ["brewery.batches.one", "brewery.tanks"],
  },
  {
    id: "brewery.batches.one",
    area: "brewery",
    route: "/brewery/batches/[id]",
    title: "One brew",
    body: "A brew's planned days, its path through the tanks, history, gravity readings, cost, what packaging made and the kegs filled from it.",
    article: `- **Planned days**: its timing, dry-hop day, release day and whether the release is locked (with why).
- **Through the tanks**: each fermenter and brite stay with its dates and days. Change a date and the brew's own dates follow. On the tank it's in now, the second date is the day it's due out.
- **History**: each move, stage change, packaging and split, with the gravity and notes taken.
- **Gravity**: every reading, in °Plato or SG as the brewery is set. OG and FG also set the brew's ABV.
- **Kegs**: what packaging made (½ and ⅙ bbl kegs, cases, CO₂), the keg batch with the brew's code, how many kegs were filled from it by size, and where the ones still full are now. **Fill kegs** opens the scanner ready to fill the rest.
- **Split**: part of a planned or in-tank brew into another fermenter as its own brew ([Split batches](/help/brewery.splits)).
- **Details**: code, beer, recipe, volume, OG, FG, cost and notes, each saved as you leave it.`,
    keywords: ["brew", "batch", "kegs", "gravity", "path", "history", "split", "release"],
    related: ["brewery.batches", "brewery.splits", "brewery.lockedRelease", "brewery.packaging"],
  },
  {
    id: "brewery.setup",
    area: "brewery",
    route: "/brewery/setup",
    title: "Brewery setup",
    body: "The tanks in the brewery, their sizes and where they stand, the days you transfer and package, and the usual days a beer spends fermenting and conditioning.",
    article: `**Tanks**: add each fermenter and brite tank with its size in barrels. Click any cell to change it. With no tanks yet, **Start with Brew Manager's tanks** fills in Zane's 11 tanks (FV1 to FV8, BBT1 to BBT3) with their sizes and places; change or remove any before adding them.

- **Zone, row and column** place a tank on the floor plan: the room or wall it stands in ("Back wall", "Front", "Separate room"), then its row and column there, counting from 1. A tank with no place goes on a row of its own.
- **Order** sets where a tank shows on the Tanks list and the schedule, and which tank is tried first when planning.
- **Not in use** hides a tank from the floor and the schedule. A tank with a brew in it stays in use until the brew is moved or packaged.
- A tank can only be deleted if no brew has ever been in it.

**Transfer and packaging days**: tap the weekdays you transfer and package on (Monday or Tuesday, and Wednesday, until changed). Planned dates move to the nearest of them, up to three days either way. With none picked, any day goes.

**Usual days in tanks**: how long a beer ferments, then conditions, when its brew has no recipe and no timing profile. A recipe's own days always win.`,
    keywords: ["tanks", "setup", "fermenter", "brite", "capacity", "barrels", "default days", "zone", "floor plan", "transfer day", "packaging day"],
    related: ["brewery.tanks", "brewery.schedule", "brewery.floorPlan", "brewery.profiles"],
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
