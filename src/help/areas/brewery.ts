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

**In use** shows live and in-development recipes; the **Archived** tab has the rest. Search by name, style or beer, filter by beer or style, or show only those that **Need prices**. Sort by any number, group by status, beer or style, and **CSV** saves what's shown.

### Where the cost comes from

Each line of a recipe is matched to an ingredient, and costed at that ingredient's price today: the same price the menu costs use, from price sheets, invoices or a price typed in. Nothing is kept twice.

- **Per batch** is every line's amount × its price.
- **Per barrel, per 1/2 bbl keg (15.5 gal), per 1/6 bbl keg (5.17 gal) and per 16 oz pint** share the batch cost over what reaches the kegs: the batch size less 5% lost to trub, tank bottoms and transfers. Foam and line loss at the tap are not included; the keg pages add those.

### "No price yet" and "Needs prices"

A line has no cost when it isn't matched to an ingredient, the ingredient has no price yet, or its unit doesn't fit (a malt in gallons). Those lines are never counted as $0 without saying so: the cost reads "at least $X, 4 ingredients have no price", and the list says **Needs prices**. Add the prices in [Brewing ingredient prices](/brewery/recipes#prices) below the list.

### Lines not linked to an ingredient

When lines aren't linked (recipes from Brew Manager arrive that way), the page says how many with a **Link them** button. It links every such line to an ingredient, making the malt, hops and yeast that aren't there yet, and says what it did and any lines it left. Then fill in their prices below.

### Keg costs

When a recipe is **Live**, linked to a beer, and every line has a price, the keg pages ([Demand](/kegs/demand)) take that beer's cost per pint from it.`,
    related: ["brewery.recipes.editor", "brewery.recipes.prices", "brewery.recipes.link", "brewery.recipes.numbers", "brewery.import"],
    keywords: ["recipe", "grain", "malt", "hops", "yeast", "cost", "ibu", "abv", "srm", "beersmith", "cost per pint", "cost per keg", "link them"],
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

Once a maltster's or hop supplier's products are linked to these ingredients on [Prices](/prices), their price sheets and invoices keep these current without typing.

The ones with no price come first. Search by name, category or supplier; filter by **Category** or **Supplier**, or show only **No price yet** or those **In a recipe**. On a phone, tap an ingredient to type its price.`,
    related: ["brewery.recipes"],
    keywords: ["price", "malt price", "hop price", "yeast price", "manual price"],
  },
  {
    id: "brewery.recipes.link",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Linking recipe lines to ingredients",
    body: "A recipe line only counts toward brewing stock, ordering and costs once it's linked to an ingredient. Link them does it for every line that isn't, making the ingredients it needs.",
    article: `Recipes imported from Brew Manager come with names like "Pils, Hudson Valley Malt (NYS)" but no ingredient behind them, so stock, ordering and costs skip them. When any line isn't linked, Recipes says how many, with a **Link them** button. Brewing stock has a **Link ingredients** button while its list is empty. The import links its recipes on its own.

Each line gets one ingredient, named the same way every time:

- **Malt**: "Pils malt (NYS) · Hudson Valley Malt", "Munich malt (NYS) · Subversive"
- **Hops**: "Cascade hops (NYS) · NY Hop Guild", "Tettnang hops"
- **Yeast**: "Philly Sour yeast · MoreBeer"; a co-pitch keeps both strains, "Helio Gazer + CellarScience HAZY yeast · Omega Yeast + MoreBeer"
- **Everything else** keeps its own name: "Pickling spice", "Brewzyme D"

**(NYS)** means New York grown and stays in the name, so NY and other Cascade are different ingredients, and so is the same hop from two suppliers. The same malt from the same maltster in ten recipes is one ingredient. Brew Manager's short names are spelled out (NYHG is NY Hop Guild, HVM is Hudson Valley Malt).

An ingredient that already has that name (in the kitchen too) is used rather than copied. New ones go on the brewery side, counted in lb, gallons or each. When the line names a brewery supplier, the ingredient is set up as bought from them (by the lb, gallon or package, no price yet), so [Ordering](/brewery/ordering) knows who to order from. Subversive's own malt has no supplier.

A line is left alone when its unit doesn't fit the ingredient, like cups of a spice that's weighed. The summary lists those with why: say on the ingredient what one cup weighs, then match the line on its recipe.

Running it again changes nothing that's already linked. Next, fill in prices in [Brewing ingredient prices](/brewery/recipes#prices).`,
    related: ["brewery.recipes", "brewery.recipes.prices", "brewery.import", "brewery.stock"],
    keywords: ["link", "link ingredients", "unlinked", "not linked", "match ingredient", "brew manager", "nys", "new york grown"],
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
- **Gravity**: every reading, in °Plato or SG as the brewery is set. The readings are where OG and FG come from: OG is the first reading marked OG (else the brew day's OG), FG the latest reading marked FG or taken on or after packaging (else the brew day's packaging FG). Delete a reading and OG, FG and ABV follow; type OG or FG in Details and it's kept as a reading.
- **Kegs**: what packaging made (½ and ⅙ bbl kegs, cases, CO₂), the keg batch with the brew's code, how many kegs were filled from it by size, and where the ones still full are now. **Fill kegs** opens the scanner ready to fill the rest. The keg batch takes its beer and dates from the brew, and follows when they change. Packaging a brew with a cost also sets the beer's keg cost (Menu → Draft beer).
- **Split**: part of a planned or in-tank brew into another fermenter as its own brew ([Split batches](/help/brewery.splits)).
- **Details**: code, beer, recipe, volume, OG, FG, cost and notes, each saved as you leave it. A brew with a recipe pours as the recipe's beer: change the beer on the recipe (its planned brews follow). Only a brew with no recipe has its own beer.`,
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
- **Not in use** hides a tank from the floor and the schedule. A tank with a brew in it stays in use until the brew is moved or packaged. Tanks not in use are listed under **Show tanks not in use**.
- A tank can only be deleted if no brew has ever been in it.
- **Upkeep** opens the tank's service and repair log on Upkeep (made the first time, named after the tank). A repair there that marks it down shows the tank as down for repair on the Tanks page and the schedule until it's marked fixed.

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
