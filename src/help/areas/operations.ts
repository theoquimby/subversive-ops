import type { HelpEntry } from "../types";

// ---- Ordering ------------------------------------------------------------------

export const ordering: HelpEntry[] = [
  {
    id: "ordering.page",
    area: "ordering",
    route: "/ordering",
    tour: "ordering",
    title: "Ordering",
    body: "Pick a supplier to get a suggested order for its next delivery, worked out from forecast sales, your recipes and your last count.",
    article: `Each supplier card shows its delivery days, how many linked items it has, and the next delivery date (from delivery days and lead time in [Settings](/settings)).

**Recent orders** lists saved orders and where they are: **Draft** (saved, not sent), **Sent** (waiting for delivery) or **Received** (checked in).`,
    related: ["ordering.builder", "ordering.po", "settings.suppliers"],
    keywords: ["purchase order", "po", "order guide"],
  },
  {
    id: "ordering.suppliers",
    area: "ordering",
    route: "/ordering",
    title: "Suppliers",
    body: "Each card shows delivery days, how many linked items the supplier has, and its next delivery date. Tap one to build its order.",
    related: ["settings.suppliers"],
  },
  {
    id: "ordering.recent",
    area: "ordering",
    route: "/ordering",
    title: "Recent orders",
    body: "Saved orders: Draft (not sent yet), Sent (waiting for the truck) and Received (checked in). Tap one to send it or check in the delivery.",
    related: ["ordering.po", "ordering.po.receive"],
  },
  {
    id: "ordering.builder",
    area: "ordering",
    route: "/ordering",
    tour: "ordering",
    title: "Building an order",
    body: "Every item from this supplier with a suggested quantity in whole packs. Adjust with − and +, then Save order.",
    article: `### How the suggestion is worked out
For each ingredient:

1. **On hand at delivery** = your last count + deliveries since (checked-in orders, plus approved invoices that had no checked-in order) − what sales and logged waste used since − what forecast sales will use before the truck arrives + anything already on a sent order.
2. **Needed** = forecast usage from this delivery until the next one × (1 + the ingredient's order buffer).
3. **Order** = needed − on hand at delivery, rounded **up** to whole packs. Never below zero.

### Changing it
- Use **−** and **+**, or type a number. Changed quantities go bold and show the original suggestion underneath.
- Items you're covered on are hidden — "Show N items you're covered on" brings them back.
- The bar at the bottom shows the total and warns if you're under the supplier's minimum.

### Badges
- **Count to auto-order** — this item has never been counted, so stock is unknown. Rather than guess a full case, it suggests 0. Count it once.
- **Set pack size** — the product's pack size isn't known, so a quantity can't be turned into cases.
- **Runs out before delivery** (red) — what's on the shelf plus what's already coming won't last until this truck. It's still on the order, but you'll need a bridge: borrow, buy locally or ask for an earlier drop.
- **Min on hand** — no recipe uses this item, so it's ordered back up to the minimum set on [Ingredients](/ingredients).

**Days of cover** shows how long today's stock lasts at the forecast rate of use.`,
    related: ["ordering.builder.formula", "ordering.builder.onHand", "ordering.builder.needed", "ingredients.buffer", "count.home"],
    keywords: ["suggested order", "par", "how much to order"],
  },
  {
    id: "ordering.builder.window",
    area: "ordering",
    route: "/ordering",
    title: "Delivery and cover",
    body: "Delivery is when the truck arrives. \"Covers through\" is the last day this order needs to last — normally the day before the next delivery.",
    article: `Both are filled in from the supplier's delivery days and lead time. Change them when:

- a holiday moves the delivery,
- you're skipping a delivery and want this one to last longer,
- you're placing an extra order mid-week.

The suggested quantities recalculate when you change either.`,
    related: ["settings.suppliers"],
  },
  {
    id: "ordering.builder.formula",
    area: "ordering",
    route: "/ordering",
    title: "How quantities are worked out",
    body: "Forecast sales × recipes + buffer − stock you'll have on delivery day, rounded up to whole packs.",
    related: ["ordering.builder", "ingredients.buffer", "sales.forecast"],
  },
  {
    id: "ordering.builder.onHand",
    area: "ordering",
    route: "/ordering",
    title: "On hand at delivery",
    body: "What you'll still have when the truck arrives: last count + deliveries since − usage from sales and waste since − forecast usage before delivery + open orders. The note shows when it was last counted.",
    article: `This is an **estimate**, rebuilt every time you open the order:

- start from the most recent finished count of this item,
- add deliveries checked in after that count,
- take away what Square sales used (through recipes) and logged waste since the count,
- take away what forecast sales will use between now and delivery,
- add anything on a **Sent** order arriving by then.

The fresher the count, the better the order. "Not counted yet" means there's no count to start from.`,
    related: ["count.home", "ordering.builder.needsCount", "waste.page", "ordering.po.receive"],
    keywords: ["stock", "inventory", "estimate"],
  },
  {
    id: "ordering.builder.needed",
    area: "ordering",
    route: "/ordering",
    title: "Needed",
    body: "Forecast usage from delivery until the order's cover date, plus the ingredient's order buffer.",
    related: ["ingredients.buffer", "sales.forecast"],
  },
  {
    id: "ordering.builder.qty",
    area: "ordering",
    route: "/ordering",
    title: "Order quantity",
    body: "Whole packs to order. Tap − or + or type a number; a changed quantity goes bold with the original suggestion underneath.",
  },
  {
    id: "ordering.builder.needsCount",
    area: "ordering",
    route: "/ordering",
    title: "Count to auto-order",
    body: "This item has never been counted, so the app doesn't know what's on the shelf and won't guess. Count it once and it'll be suggested from then on.",
    related: ["count.home"],
  },
  {
    id: "ordering.builder.runsOut",
    area: "ordering",
    route: "/ordering",
    title: "Runs out before delivery",
    body: "Stock on hand plus anything already on its way won't last until this delivery. Order it, and plan a bridge: borrow, buy locally or ask for an earlier drop.",
    related: ["ordering.builder.daysOfCover", "ordering.cutoffs"],
  },
  {
    id: "ordering.builder.daysOfCover",
    area: "ordering",
    route: "/ordering",
    title: "Days of cover",
    body: "How many days the estimated stock on hand lasts at the forecast rate of use, from today. Red when it runs out before the delivery.",
    related: ["ordering.builder.onHand", "ingredients.onHand"],
  },
  {
    id: "ordering.builder.par",
    area: "ordering",
    route: "/ordering",
    title: "Min on hand",
    body: "No recipe uses this item, so the forecast can't tell how fast it goes. It's ordered back up to the minimum on hand set on the Ingredients page.",
    related: ["ingredients.minOnHand"],
  },
  {
    id: "ordering.cutoffs",
    area: "ordering",
    route: "/ordering",
    title: "Order cutoffs and auto-drafts",
    body: "When each supplier needs your order: a time and how many days before delivery. With auto-draft on, the suggested order is saved as a draft the day before the cutoff. Review it and send it.",
    article: `Type the time ("2pm" or "14:00") and the days before delivery. Days before starts at the supplier's lead time.

Each morning, any supplier whose cutoff falls in the next 36 hours gets a **draft** order built from the forecast, unless an order for that delivery already exists. Drafts are never sent on their own. They show up on the [weekly brief](/brief) and under Recent orders, marked "Auto-drafted".`,
    related: ["ordering.builder", "brief.page", "settings.suppliers"],
    keywords: ["deadline", "cutoff", "auto order", "draft"],
  },
  {
    id: "ordering.builder.needsSetup",
    area: "ordering",
    route: "/ordering",
    title: "Set pack size",
    body: "The pack size for this product isn't known, so usage can't be converted to cases. Set it on the ingredient's page.",
    related: ["ingredients.packSize"],
  },
  {
    id: "ordering.builder.problems",
    area: "ordering",
    route: "/ordering",
    title: "Recipe lines that couldn't be counted",
    body: "Some recipe lines use a unit that doesn't convert (say, \"slice\" with no slice size set), so their usage is left out of the order. Fix the unit to include them.",
    related: ["ingredients.customUnits", "menu.editor.units"],
  },
  {
    id: "ordering.builder.save",
    area: "ordering",
    route: "/ordering",
    title: "Save order",
    body: "Saves this as a draft order you can copy, email or download, then mark as sent. The total shows a warning if it's under the supplier's minimum.",
    related: ["ordering.po"],
  },
  {
    id: "ordering.po",
    area: "ordering",
    route: "/ordering",
    title: "Sending an order",
    body: "Copy the order as text, download a CSV, or email it to the supplier. Then press Mark as sent so its quantities count as incoming.",
    article: `- **Copy as text** — paste into a text, email or the distributor's order notes.
- **Download CSV** — for distributor sites that take an upload.
- **Email** — opens your mail app with the order filled in (needs the supplier's email in Settings).
- **Mark as sent** — the order now counts as on its way, so the next order won't double up.

A draft can be deleted; a sent order can be checked in.`,
    related: ["ordering.po.receive"],
  },
  {
    id: "ordering.po.receive",
    area: "ordering",
    route: "/ordering",
    title: "Checking in a delivery",
    body: "When the truck arrives, correct any shorted or substituted quantities and press Check in delivery. What you received is added to estimated stock until the next count.",
    related: ["ordering.builder.onHand", "variance.page"],
    keywords: ["receive", "receiving", "check in", "delivery"],
  },
];

// ---- Counts --------------------------------------------------------------------

export const counts: HelpEntry[] = [
  {
    id: "count.home",
    area: "counts",
    route: "/count",
    tour: "counting",
    audience: "all",
    title: "Counting stock",
    body: "Pick an area and count what's on the shelf. Every number saves as you type, so you can stop and pick it up later.",
    article: `1. Tap the area you're counting — **Everything**, or one storage area like the walk-in.
2. Type how much is there next to each item. Enter jumps to the next one.
3. Change the unit if it's easier — cases, lb, each.
4. Tap **Finish count** when you're done.

If someone already started counting that area, you'll carry on their count instead of starting a new one.

### Why it matters
Counts feed the suggested orders (so you don't over- or under-order) and the margin gap (so you can see what went missing).`,
    related: ["count.sheet", "count.autosave", "ordering.builder.onHand", "variance.page"],
    keywords: ["inventory", "stock take", "count"],
  },
  {
    id: "count.start",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Start a count",
    body: "Each button is a storage area. \"Everything\" lists every item. If that area already has a count in progress, you'll continue it.",
  },
  {
    id: "count.inProgress",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Counts in progress",
    body: "Counts that were started but not finished. Tap one to carry on — everything entered so far is still there.",
  },
  {
    id: "count.recent",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Recent counts",
    body: "The last finished counts, who did them and how many items they covered.",
  },
  {
    id: "count.sheet",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "The count sheet",
    body: "Items grouped by storage area. Type the amount, pick the unit, and a green tick shows it's saved. Use \"Find an item\" to jump to something.",
    related: ["count.autosave", "count.units", "count.finish"],
  },
  {
    id: "count.autosave",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Counts save as you go",
    body: "Each number saves the moment you leave the field — a green tick means it's in. You can close the app and come back to the same count.",
    article: `There's no save button. When you move on from a field (Enter, tapping the next one, or scrolling away), that number is saved. A **green tick** means it's saved; a **red dot** means it didn't save — tap the field and try again.

Clearing a number removes that item from the count.`,
    keywords: ["autosave", "lost", "offline"],
  },
  {
    id: "count.enter",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Enter goes to the next item",
    body: "Press Enter (or Next on the phone keyboard) to save and jump to the next item — you can count a whole shelf without touching the screen between items.",
  },
  {
    id: "count.units",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Count in any unit",
    body: "Pick the unit that's easiest — cases, lb, each, or a custom one like \"tub\". It's converted for you; switching the unit re-saves the number in the new unit.",
    related: ["ingredients.countIn", "ingredients.customUnits"],
  },
  {
    id: "count.finish",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Finish count",
    body: "Marks the count as done, timed now. Only finished counts are used for ordering and the margin gap.",
  },
  {
    id: "count.discard",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Discard",
    body: "Throws away this count and everything entered in it. You'll be asked to confirm.",
  },
];

// ---- Waste ---------------------------------------------------------------------

export const waste: HelpEntry[] = [
  {
    id: "waste.page",
    area: "waste",
    route: "/waste",
    tour: "counting",
    audience: "all",
    title: "Logging waste",
    body: "Log anything thrown out — what, how much and why. It keeps stock estimates right and explains part of the margin gap.",
    article: `Pick the item, type how much and the unit, tap why it was thrown out, and **Log waste**.

Logged waste:
- comes off estimated stock, so the next order is right,
- shows as **Logged waste** on the margin gap page instead of counting as unexplained loss.

Waste is valued at purchase cost. Only managers see the dollar amounts.`,
    related: ["variance.waste", "ordering.builder.onHand"],
    keywords: ["spoilage", "throw out", "comps"],
  },
  {
    id: "waste.form",
    area: "waste",
    route: "/waste",
    audience: "all",
    title: "Log waste form",
    body: "Item, amount, unit and reason. The form clears after each log so you can do several in a row.",
  },
  {
    id: "waste.reasons",
    area: "waste",
    route: "/waste",
    audience: "all",
    title: "Why",
    body: "Spoiled, expired, dropped, overcooked, returned or other. Reasons show which kind of waste to work on.",
  },
  {
    id: "waste.leaderboard",
    area: "waste",
    route: "/waste",
    audience: "all",
    title: "Top loggers",
    body: "Who logged the most in the last 30 days. More logging isn't bad — it means the numbers are honest.",
  },
  {
    id: "waste.recent",
    area: "waste",
    route: "/waste",
    audience: "all",
    title: "Last two weeks",
    body: "Everything logged in the last 14 days. Managers also see what it cost.",
  },
];

// ---- Margin gap ----------------------------------------------------------------

export const variance: HelpEntry[] = [
  {
    id: "variance.page",
    area: "variance",
    route: "/variance",
    title: "Margin gap",
    body: "Between two counts, compares what your recipes say you used with what actually left the shelves. What sales and logged waste can't explain is the gap.",
    article: `For each ingredient, between the two counts you pick:

- **Should have used** = items sold × their recipes.
- **Actually used** = opening count + deliveries checked in − closing count.
- **Logged waste** = what staff recorded.
- **Unexplained** = actually used − should have used − logged waste.

### Food, beverage or both
Use **All / Food / Beverage** to filter. Each ingredient sits under whichever sales used most of it: a keg goes with beer, ground beef with food.

### The four numbers at the top
- **Cost if recipes were followed** — theoretical cost for the period, as a share of sales.
- **Actual cost** — from what really left the shelves. Orange when it's more than a point over theoretical, red beyond 2.5.
- **Logged waste** — accounted for.
- **Unexplained** — dollars nobody can account for, and what share of sales that is.

### Reading a line
Notable gaps get a plain-English line, e.g. "5.3 lb more than recipes explain — about 0.5 oz extra per Subversive burger". The gap is spread over the items that use the ingredient in proportion to their recipes, so it reads as "each portion is this much heavy".

- **Positive** (more went out): heavy portions or pours, waste nobody logged, comps not rung in, or a Square item not linked to its recipe.
- **Negative** (less went out): a delivery that wasn't checked in, or a counting slip.

Both columns use prices as of the closing count, so price changes don't show up as gaps.`,
    related: ["variance.unexplained", "variance.period", "count.home", "sales.mapping"],
    keywords: ["variance", "theoretical vs actual", "shrink", "leak", "loss"],
  },
  {
    id: "variance.empty",
    area: "variance",
    route: "/variance",
    title: "Needs two counts",
    body: "The margin gap compares two finished counts. Count once now and again in a week.",
    related: ["count.home"],
  },
  {
    id: "variance.period",
    area: "variance",
    route: "/variance",
    title: "Pick the period",
    body: "Choose the opening count and the closing count. The gap covers everything between them.",
  },
  {
    id: "variance.theoretical",
    area: "variance",
    route: "/variance",
    title: "Cost if recipes were followed",
    body: "What food and drink should have cost given what sold, as a share of sales. Filter to Food or Beverage to see each on its own.",
    related: ["overview.foodCost"],
  },
  {
    id: "variance.actual",
    area: "variance",
    route: "/variance",
    title: "Actual cost",
    body: "What really left the shelves — opening count + deliveries − closing count — as a share of sales.",
  },
  {
    id: "variance.waste",
    area: "variance",
    route: "/variance",
    title: "Logged waste",
    body: "The cost of waste staff logged in this period. It's accounted for, so it isn't part of the unexplained gap.",
    related: ["waste.page"],
  },
  {
    id: "variance.unexplained",
    area: "variance",
    route: "/variance",
    title: "Unexplained",
    body: "What went out that neither sales nor logged waste explain: actually used − should have used − logged waste. This is the money to go looking for.",
    article: `Unexplained = actually used − (items sold × recipe) − logged waste.

A positive number means more product disappeared than it should have. Look first at the ingredients with the biggest dollar badges:

- Is the portion right? Weigh a few plates.
- Is waste being logged?
- Is every Square item linked to a recipe? An unlinked item uses product without "selling" any.

A negative number usually means a delivery wasn't checked in, or a count was off.`,
    related: ["variance.page", "sales.mapping", "waste.page", "ordering.po.receive"],
  },
  {
    id: "variance.byIngredient",
    area: "variance",
    route: "/variance",
    title: "By ingredient",
    body: "Biggest dollar gaps first, each with a plain-English line on what it means per plate or pour. Badges mark gaps over 10% and at least $5; red is over-use, orange is under-use.",
  },
  {
    id: "variance.skipped",
    area: "variance",
    route: "/variance",
    title: "Not in the totals",
    body: "Ingredients missing a count at the start or end, or a price, can't be compared. Count them at both ends to include them.",
  },
];

// ---- Sales ---------------------------------------------------------------------

export const sales: HelpEntry[] = [
  {
    id: "sales.page",
    area: "sales",
    route: "/sales",
    title: "Sales",
    body: "Square sales, the forecast that drives ordering, and the list that links each Square item to its recipe.",
    related: ["sales.sync", "sales.forecast", "sales.mapping"],
  },
  {
    id: "sales.connect",
    area: "sales",
    route: "/settings/square",
    title: "Connecting Square",
    body: "Open Settings → Square and press Connect with Square: sign in with the restaurant's Square account and approve read access. Sales, the menu and timecards then flow in on their own.",
    article: `1. Open [Settings → Square](/settings/square) and press **Connect with Square**.
2. Sign in with the restaurant's Square account (the owner's login) and press **Allow**. The app only asks to *read*: business profile, items, orders, payments, team, timecards and inventory.
3. Back in the app, check the **Locations** — every active location is picked. Keep your Square Online location picked if you sell online.
4. Run the **First import** (6 months is a good start), then match Square items to recipes on [Menu from Square](/sales/square-menu).

**No Connect button?** One-click connect needs the Square app's ID and secret in the hosting settings (whoever manages hosting sets \`SQUARE_APPLICATION_ID\` and \`SQUARE_APPLICATION_SECRET\`). Until then, press **Paste an access token instead**: in the Square Developer Dashboard open your app → **Credentials** → **Production** and copy the **Access token**. The app checks it with Square before saving and stores it encrypted.

The token is a password for your sales data — keep it out of emails and chats. **Disconnect** on the same page stops syncing and revokes the app's access.`,
    related: ["settings.square", "sales.backfill", "sales.mapping", "sales.squareMenu"],
    keywords: ["square", "pos", "token", "api", "connect", "integration", "oauth", "sign in"],
  },
  {
    id: "sales.sync",
    area: "sales",
    route: "/sales",
    title: "Sync now",
    body: "Pulls the latest menu, the last three days of orders and refunds, and recent timecards from Square. You rarely need it: today's numbers top up on their own every 15 minutes while the app is in use, and everything re-syncs nightly.",
  },
  {
    id: "sales.backfill",
    area: "sales",
    route: "/settings/square",
    title: "First import",
    body: "Brings in 3, 6 or 12 months of Square sales and timecards, a week at a time with a progress bar. You can leave the page and press Resume later; re-running just replaces days already imported.",
    related: ["settings.square"],
    keywords: ["import", "history", "backfill"],
  },
  {
    id: "sales.squareMenu",
    area: "sales",
    route: "/sales/square-menu",
    title: "Menu from Square",
    body: "Matches Square items to recipes for you, starts recipes for items you don't have yet (with Square's price and category), and shows where Square's price differs from the recipe's menu price.",
    article: `- **Suggested matches** — recipes whose names closely match a Square item. Check the list and press **Accept all**, or accept one at a time.
- **Create recipes** — pick unmatched items and press **Create**. Each becomes a menu item (modifiers become add-ons) with Square's name, price and category. They show **Needs ingredients** on [Menu costs](/menu) until you add lines.
- **Price differences** — where Square charges something other than the recipe's menu price. **Use Square price** updates the recipe so food cost % is right.

Drinks bought in, merch and gift cards: pick them and press **Ignore selected**.`,
    related: ["sales.mapping", "sales.connect"],
    keywords: ["menu", "match", "recipes", "price", "import menu"],
  },
  {
    id: "sales.forecast",
    area: "sales",
    route: "/sales",
    title: "Forecast",
    body: "Expected sales and orders per day, and items sold per day, from the same weekday over recent weeks (recent weeks count more), the season once there's a year of history, the recent trend and any adjustments.",
    article: `For each day (and each menu item):

- **Baseline** — a recency-weighted average of the same weekday over recent weeks, skipping days you were closed and past event days.
- **Season** — once there's a year of history: how the same week last year compared with this point last year, blended toward no change so one odd week can't swing it. This catches the summer and foliage-season ramp weeks before recent averages would. Item forecasts borrow the store's seasonal factor.
- **Trend** — the last four weeks against the four before, softened and capped. With a year of history it's measured against the same weeks last year, so the seasonal ramp isn't counted twice.
- **Adjustments** — events, weather and your manual tweaks for that day.

**Orders** (Square checks, the closest thing to covers) are forecast the same way, so you can see the average check and staff for the door as well as the till.

It's deliberately simple so you can always see why a number is what it is. Ordering uses it to know how much product the coming days need.`,
    related: ["sales.adjust", "ordering.builder.needed"],
    keywords: ["prediction", "projection", "demand"],
  },
  {
    id: "sales.adjust",
    area: "sales",
    route: "/sales",
    title: "Adjust a day",
    body: "Type a % for days history can't see coming — +40 for a festival, −100 for a closure — and press Set. Orders covering that day change to match.",
  },
  {
    id: "sales.forecastByItem",
    area: "sales",
    route: "/sales",
    title: "Forecast by item",
    body: "The expected number sold of each item, per day and for the week.",
  },
  {
    id: "sales.mapping",
    area: "sales",
    route: "/sales",
    title: "Link Square items to recipes",
    body: "Each Square item and modifier needs its recipe so its sales count toward costing and ordering. Pick \"Ignore\" for drinks, merch and gift cards that have no recipe.",
    article: `When Square sells something, the app needs to know which recipe that was. Unlinked items are listed most-sold first.

- Pick the recipe from the list. It saves straight away.
- **Ignore** anything without a food recipe: beer, merch, gift cards.
- **Show all** lists linked items too, if you need to change one.

An unlinked item still uses product but doesn't count as a sale, which shows up as **unexplained** on the margin gap.`,
    related: ["variance.unexplained", "overview.foodCost"],
    keywords: ["map", "mapping", "modifier", "link"],
  },
  {
    id: "sales.forecast5w",
    area: "sales",
    route: "/sales",
    title: "Five-week forecast",
    body: "Sales expected for each of the next five weeks, day by day, built from history and adjusted for weather, events and your own changes.",
    article: `The forecast looks five weeks out so ordering, scheduling and budgets all work from the same numbers.

Each day shows what moved it: the season (once there's a year of history), the weather forecast (rainy days learn their own effect from your history), events on the [events calendar](/events), and any manual change you made. Tap a day to see the breakdown, the expected number of orders and the hourly shape, or to override it.`,
    related: ["sales.weather", "sales.events", "sales.accuracy", "events.page"],
  },
  {
    id: "sales.weather",
    area: "sales",
    route: "/sales",
    title: "Weather",
    body: "The weather forecast for Catskill feeds the sales forecast. How much rain changes your sales is learned from your own history.",
    related: ["sales.forecast5w"],
  },
  {
    id: "sales.events",
    area: "sales",
    route: "/sales",
    title: "Events in the forecast",
    body: "Days with something on the events calendar are adjusted by that event's expected impact.",
    related: ["events.impact"],
  },
  {
    id: "sales.manual",
    area: "sales",
    route: "/sales",
    title: "Manual adjustments",
    body: "Your own % change for a day, on top of weather and events. Use it for what nothing else can know — a buyout, a closure, a road closure.",
  },
  {
    id: "sales.accuracy",
    area: "sales",
    route: "/sales",
    title: "Forecast accuracy",
    body: "How close past forecasts were to what actually sold. The closer it is, the more you can trust orders and schedules built on it.",
  },
];

// ---- Import --------------------------------------------------------------------

export const importing: HelpEntry[] = [
  {
    id: "import.page",
    area: "import",
    route: "/import",
    title: "Import your sheets",
    body: "Bring in your existing ingredient list, prices and recipes from Excel or Google Sheets in one go. Nothing is saved until you've reviewed it.",
    article: `1. **Choose a source** — upload a file, paste cells from a sheet, or paste a Google Sheets link.
2. **Read sheet.** Every tab is read and given a guess: ingredients & prices, recipes, or skip.
3. **Check each tab** — what it is and which column is which. The first three rows are shown so you can tell.
4. **Review import** shows what will be created and anything worth a look.
5. **Import everything.**

Re-importing the same sheet later only updates what changed — it doesn't make duplicates.`,
    related: ["import.sources", "import.tabs", "import.review", "prices.import"],
    keywords: ["spreadsheet", "excel", "google sheets", "bulk", "migrate", "setup"],
  },
  {
    id: "import.sources",
    area: "import",
    route: "/import",
    title: "File, paste or link",
    body: "Upload an .xlsx or .csv (every tab is read), paste cells copied from a sheet (include the header row), or paste a Google Sheets link shared as \"Anyone with the link\".",
  },
  {
    id: "import.tabs",
    area: "import",
    route: "/import",
    title: "What's in each tab",
    body: "Tell it whether a tab is ingredients & prices, recipes, or something to skip, and which column is which. Starred columns are required.",
    article: `- **Ingredients & prices** needs at least an ingredient column. Supplier, price and pack columns bring prices in too.
- **Recipes** needs an ingredient and a quantity column. With a recipe column, one tab can hold many recipes; without one, the whole tab becomes one recipe named after the tab.
- **Skip** ignores the tab.`,
  },
  {
    id: "import.review",
    area: "import",
    route: "/import",
    title: "Review before importing",
    body: "A summary of what will be created, plus anything worth a look. None of the notes block the import — they can all be fixed afterwards in the grid.",
  },
];

// ---- Settings ------------------------------------------------------------------

export const settings: HelpEntry[] = [
  {
    id: "settings.square",
    area: "settings",
    route: "/settings/square",
    title: "Square connection",
    body: "Who's connected, which locations are read, the first import, when each part last synced and anything that went wrong.",
    article: `- **Connection** — the Square business and whether it's production or sandbox. **Test connection** checks the token still works. Sign-in connections renew their access by themselves.
- **Locations** — orders and timecards are read from every location picked.
- **First import** — past sales and timecards, a week at a time.
- **Data we have** — how far back sales go and how many timecards are in.
- **Sync** — the last menu, sales and timecard sync. With webhooks on, new orders and clock-ins arrive within seconds; otherwise today's numbers top up every 15 minutes while someone is using the app, and everything re-syncs nightly.
- **Recent problems** — the last 20 errors from Square, newest first.

Timecards you corrected here, or that are in an approved week, are never overwritten by a sync.`,
    related: ["sales.connect", "sales.backfill"],
    keywords: ["square", "sync", "webhook", "locations", "disconnect"],
  },
  {
    id: "settings.team",
    area: "settings",
    route: "/settings",
    title: "Team logins",
    body: "Everyone signs in with their name and a 4–8 digit PIN. Staff only see counts and waste. Reset a PIN or deactivate someone here.",
    related: ["app.roles"],
  },
  {
    id: "settings.suppliers",
    area: "settings",
    route: "/settings",
    title: "Suppliers",
    body: "Delivery days and lead time decide when each order is due and how many days it covers. Minimum order warns you when an order is too small.",
    article: `- **Delivery days** — the weekdays the truck comes.
- **Lead time** — how many days before delivery the order must be in. A 1-day lead time means today's order arrives on the next delivery day from tomorrow on.
- **Minimum order** — the order builder warns when you're under it.
- **Email** — lets you email orders in one tap.
- **Type** — distributor (big price sheets) or local (farms, bakeries; prices updated by hand).`,
    related: ["ordering.builder.window", "overview.deliveries"],
  },
  {
    id: "settings.target",
    area: "settings",
    route: "/settings",
    title: "Food cost target",
    body: "The default food cost % for every menu item. Items can override it on the menu page or in the recipe.",
    related: ["menu.list.target"],
  },
  {
    id: "settings.clear",
    area: "settings",
    route: "/settings",
    title: "Clear all data",
    body: "Removes every ingredient, price, recipe, sale, count and order — handy after trying the demo. Logins are kept.",
  },
];
