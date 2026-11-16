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

**Duplicate** makes an in-development copy to try changes on. **Delete** removes a recipe no brew uses; one that brews use is archived instead, so their history keeps it.

**Brew-day targets** and **Timing** hold what the brew day checks against and when the beer moves, dry hops and goes on tap. **Brew this** opens a brew day for the recipe (or carries on the one already going).`,
    related: ["brewery.recipes.numbers", "brewery.recipes.grain", "brewery.recipes.hops", "brewery.recipes.targets", "brewery.recipes.timing", "brewery.brewday"],
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
    body: "Batch size in barrels, brewhouse efficiency and boil length, and the OG and FG you aim for. The numbers at the top are worked out from the recipe and show how far they are from the targets.",
    keywords: ["batch size", "efficiency", "boil", "target", "og", "fg"],
  },
  {
    id: "brewery.recipes.targets",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Brew-day targets",
    body: "Strike and mash temperatures, the mash rest, and the gravity you expect in the mash tun (MT), boil kettle (BK) and at knock-out (KO). The brew day shows each beside its reading.",
    article: `These are Brew Manager's targets, kept on the recipe:

- **Strike** and **Mash**, in °F, and how long the mash rests (the brew day's mash timer counts down from it).
- **MT**, **BK** and **KO gravity**: first runnings in the mash tun, the kettle before the boil, and knock-out.

Gravity is shown and typed in the brewery's unit, °Plato unless SG was chosen (the °P / SG switch at the top). Either can be typed: 15.5P is always Plato, 1.063 always SG. It's kept as specific gravity, so switching changes nothing stored.`,
    related: ["brewery.recipes.timing", "brewery.brewday", "brewery.gravity"],
    keywords: ["strike", "mash", "temperature", "mt", "bk", "ko", "knock-out", "plato", "target"],
  },
  {
    id: "brewery.recipes.timing",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Timing",
    body: "Pick a profile (Hazy IPA, Sour, Lager, Pale / Clear IPA) to fill in the dry-hop day, days fermenting and conditioning, and the day it goes on tap. Change any day to make it your own.",
    article: `The profiles are Brew Manager's:

- **Hazy IPA**: dry hop on day 7, to a brite on day 20, packaged day 23, on tap day 30.
- **Sour**: to a brite on day 38, packaged day 42, on tap day 49.
- **Lager**: a transfer on day 21, to a brite on day 49, packaged day 52, on tap day 60.
- **Pale / Clear IPA**: to a brite on day 32, packaged day 35, on tap day 42.

**Days fermenting** run from brew day to the move into a brite, **days conditioning** from there to packaging. The tank schedule plans tanks from these two. Changing a day turns the profile to **Custom**.`,
    related: ["brewery.recipes.targets", "brewery.schedule"],
    keywords: ["profile", "hazy", "sour", "lager", "pale", "dry hop", "tap day", "release", "ferment days", "condition days"],
  },
  {
    id: "brewery.recipes.dev",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Beers in development",
    body: "What a development beer still needs before it's brewed for real: a supplier for every ingredient, gravity targets, a batch size and label artwork.",
    article: `Brew Manager's development notes say things like "Needs suppliers + gravity targets". The checklist on an in-development recipe shows the same, worked out from the recipe:

- **A supplier for every ingredient**: each line matched to an ingredient that has a price from a supplier. Lines without one are named.
- **Gravity targets**: an OG and an FG.
- **A batch size**.
- **Label artwork done**: tick it when the label is ready.

Set the status to **Live** when it's ready.`,
    related: ["brewery.recipes.details", "brewery.import"],
    keywords: ["development", "dev", "artwork", "label", "suppliers", "checklist", "missing"],
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
    body: "Bring in everything from the Brew Manager app: its app data file for recipes, the schedule, development beers and tanks, and its backup file for brews.",
    article: `Brew Manager keeps its data in two files. Either can go first, and each can be imported again later.

- **brewmanager-app-data.json** (made from Brew Manager's own page): recipes, the 2026 schedule, development beers, tanks with where they stand, and suppliers' lead times.
- **The backup** (in Brew Manager, **Settings → Backup → Export backup JSON**, a file like subversive-backup-2026-11-16.json): recipes and every brew, with its tanks, readings and brew-day log.

1. Upload a file. You see what's in it before anything changes.
2. For the app data, pick a recipe for any schedule name it couldn't match, and choose whether past planned brews come too.
3. Press **Import**.

Importing again **updates** what came in last time instead of adding copies. What you add here afterwards (ingredient matches, extract, colour and alpha, a Live or In development status, artwork done) is kept.

### From the app data

- **Recipes**, with grain, hops, yeast and Brew Manager's targets: strike, mash temperature and rest, and MT, BK, KO, OG and FG gravity (°Plato there; kept as specific gravity here). Archived ones come in archived.
- **Development beers** become recipes **In development**, with their artwork tick and their yeast as a yeast line.
- **The schedule**: each planned brew on its brew day, matched to its recipe and beer by name (capitals and accents don't matter). Short names match too: Marzen is Mountain Marzen, Golden Lime is Golden Lime Lager, Saison is Saison / Farmhouse, Verdant is Verdant Voyage. Each gets its dry-hop and release days from its profile (transfers on a Monday or Tuesday, packaging on a Wednesday, as Brew Manager does), keeps a locked release date and its reason, and goes on the tank schedule where a fermenter and brite are free. Past brews are left out unless you tick **Include past brews**: they show what was planned, not what was brewed. A planned brew that has since been brewed in Ops is never changed.
- **Tanks**, with their sizes and their spot on Brew Manager's floor plan (back wall, front, separate room). A size set in Ops stays; a size the backup import guessed is put right.
- **Suppliers' lead times** as brewery suppliers, with the day each counts back from (brew day, dry-hop day or packaging day).

### From the backup

- **Recipes**, as above. Amounts like "400-700lb" use the middle; ones it can't read ("4bbl pitch") come in as 0 to fill in.
- **Brews**, with their stage: fermenting and conditioning are in a fermenter, brite is in a brite tank, packaged is done. Keg and case counts, and the brew-day log (unless one was written in Ops).
- **Time in each tank**, from each brew's tank path and its dated moves. Tanks not set up yet are added, sized from the brews.

Neither file has alpha acids, extract or colour, so add those on each recipe for IBU and colour.`,
    related: ["brewery.recipes", "brewery.setup", "brewery.schedule", "brewery.recipes.dev"],
    keywords: ["import", "brew manager", "backup", "json", "plato", "schedule", "development", "app data", "tanks", "lead time"],
  },
];
