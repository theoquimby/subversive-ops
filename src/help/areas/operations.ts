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
    body: "Copy the order as text, download it as a spreadsheet file, or email it to the supplier. Then press Mark as sent so its quantities count as incoming.",
    article: `- **Copy as text** — paste into a text, email or the distributor's order notes.
- **Download spreadsheet** — a .csv file, for distributor sites that take an upload.
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
  {
    id: "ordering.builder.lines",
    area: "ordering",
    route: "/ordering",
    title: "Items to order",
    body: "Each item with stock on hand at delivery, what's needed, days of cover and the suggested whole packs to order. Badges flag items to count, set up, or that run out first. Items you're already covered on are tucked away at the bottom.",
    related: ["ordering.builder.qty", "ordering.builder.onHand", "ordering.builder.needed"],
  },
  {
    id: "ordering.po.sent",
    area: "ordering",
    route: "/ordering",
    title: "How it was sent",
    body: "Who sent the order and when. If it was emailed from here you'll see the address, any cc, and whether the email was delivered, opened or bounced.",
    related: ["ordering.po"],
  },
  {
    id: "ordering.po.lines",
    area: "ordering",
    route: "/ordering",
    title: "Order lines",
    body: "Each item with the quantity ordered (and the original suggestion if you changed it), the unit price and line total. Once sent, a Received column shows what actually arrived.",
    related: ["ordering.po.receive"],
  },
  {
    id: "ordering.po.total",
    area: "ordering",
    route: "/ordering",
    title: "Order total",
    body: "The estimated total at the order's prices, or today's prices where a line has none. Once invoices are matched to the order, their billed total shows here with links to them.",
    related: ["invoices.match"],
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
    body: "Each button is a storage area. \"Everything\" lists every item, in the order you walk the areas. If that area already has a count in progress, you'll continue it. Managers can add, rename or reorder areas with Add or edit areas.",
  },
  {
    id: "settings.areas",
    area: "settings",
    route: "/settings/areas",
    title: "Storage areas",
    body: "Where things live: walk-in, freezer, bar, dry storage. Each area gets its own count button. Add one, rename it (every item in it follows), move it up or down to match the order you walk, or remove it — its items move to an area you pick.",
    keywords: ["storage", "areas", "locations", "walk-in", "freezer", "inventory space", "shelf"],
  },
  {
    id: "settings.areas.list",
    area: "settings",
    route: "/settings/areas",
    title: "Your areas",
    body: "The number on the left is the walking order. Tap the item count to see what's in an area on Ingredients. To put items in an area, set their Storage on Ingredients.",
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
  {
    id: "count.find",
    area: "counts",
    route: "/count",
    title: "Find an item",
    body: "Type part of a name to show only matching items. Handy when you're standing in front of something and can't see where it is on the list.",
    audience: "all",
  },
  {
    id: "count.area",
    area: "counts",
    route: "/count",
    title: "Items in this area",
    body: "Everything kept in this storage area. Type how much is on the shelf and pick the unit; a green tick means it's saved. Enter jumps to the next item.",
    related: ["count.units", "count.enter"],
    audience: "all",
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
  {
    id: "variance.stats",
    area: "variance",
    route: "/variance",
    title: "The gap in four numbers",
    body: "What costs should have been if recipes were followed, what actually left the shelves, the waste staff logged, and what's left unexplained — the money to go looking for.",
    related: ["variance.theoretical", "variance.actual", "variance.waste", "variance.unexplained"],
  },
  {
    id: "variance.split",
    area: "variance",
    route: "/variance",
    title: "Food and beverage",
    body: "Actual cost against recipe cost for food and for drinks separately. Tap one to see the page for just that side.",
    related: ["pnl.split"],
  },
  {
    id: "variance.reading",
    area: "variance",
    route: "/variance",
    title: "Reading this",
    body: "What usually causes a gap: over-use is heavy portions, unlogged waste or an unlinked Square item; under-use is often a delivery not checked in or a counting slip.",
  },
];

// ---- Sales ---------------------------------------------------------------------

export const sales: HelpEntry[] = [
  {
    id: "sales.page",
    area: "sales",
    route: "/sales",
    title: "Sales",
    body: "Square sales, the forecast that drives ordering, and the list that links each Square item to its recipe. Sync now pulls the latest from Square; Import history brings in past months.",
    related: ["sales.sync", "sales.forecast", "sales.mapping"],
  },
  {
    id: "sales.connect",
    area: "sales",
    route: "/settings/connections",
    title: "Connecting Square",
    body: "Settings → Connections → Square walks you through it with pictures: first the app is registered with Square (once, about 5 minutes), then you sign in to Square and press Allow. Sales, the menu and timecards then flow in by themselves.",
    article: `1. Open [Settings → Connections → Square](/settings/connections?open=square). The guide has two parts.
2. **Part 1 — Register the app** (one time, ~5 minutes, whoever sets up the app — any Square login works): create an app on Square's developer site and copy two codes back — the **Application ID** from **Credentials** and the **Application secret** from **OAuth** (press **Show**). Every click is shown in a picture.
3. **Part 2 — Connect** (1 minute): press **Connect with Square**, sign in with the restaurant's Square login and press **Allow**. The app only asks to *read*: business profile, items, orders, payments, team, timecards and inventory.
4. You land on the [Square page](/settings/square), where all your past sales and timecards start coming in by themselves, newest first (**First import**). Check the **Locations** — keep your Square Online location picked if you sell online.
5. Turn on **Instant updates** (recommended, one paste), then match Square items to recipes on [Menu from Square](/sales/square-menu).

**Another way:** on the Square page, **Paste an access code instead** takes the long code (it starts with EAAA) from your Square app's **Credentials** page. It works like a password for your sales data — keep it out of emails and chats.

**Disconnect** on the Square page stops new data coming in and removes the app's access.`,
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
    body: "Past Square sales and timecards. Connecting Square brings in all your history by itself, newest week first. It carries on while the Square page is open, and the nightly sync finishes anything left. After a 6- or 12-month import, All history only fetches what's older.",
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
  {
    id: "sales.next7",
    area: "sales",
    route: "/sales",
    title: "Next 7 days",
    body: "Forecast sales from today through the next seven days, with events, weather and your adjustments included.",
    related: ["sales.forecast"],
  },
  {
    id: "sales.next28",
    area: "sales",
    route: "/sales",
    title: "Next 4 weeks",
    body: "Forecast sales for the next 28 days. Useful for checking budgets and planning staffing ahead.",
    related: ["budgets.page"],
  },
  {
    id: "sales.bias",
    area: "sales",
    route: "/sales",
    title: "Bias",
    body: "Whether the forecast has tended to run high or low over the last four weeks. A plus means it forecast more than you sold; close to zero means no lean either way.",
    related: ["sales.accuracy"],
  },
  {
    id: "sales.outlook",
    area: "sales",
    route: "/sales",
    title: "Sales and orders, next 7 days",
    body: "Each of the next seven days: forecast sales, expected number of orders (checks) and average check. Once there's a year of history, a Season column shows the seasonal swing.",
    related: ["sales.forecast"],
  },
  {
    id: "sales.accuracyWeeks",
    area: "sales",
    route: "/sales",
    title: "How the forecast did",
    body: "Each of the last four weeks: what the forecast said the day before against what you actually sold, and the average daily miss. Show each day lists them one by one.",
    related: ["sales.accuracy"],
  },
  {
    id: "sales.squareMenu.empty",
    area: "sales",
    route: "/sales/square-menu",
    title: "No Square menu yet",
    body: "The Square menu comes in with the first sync. Connect Square, or press Sync now on Sales, and the items show up here to match.",
    related: ["sales.connect", "sales.sync"],
  },
  {
    id: "sales.squareMenu.items",
    area: "sales",
    route: "/sales/square-menu",
    title: "Square items",
    body: "How many items and modifiers are live in Square, and how many of them are linked to a recipe or ignored.",
  },
  {
    id: "sales.squareMenu.open",
    area: "sales",
    route: "/sales/square-menu",
    title: "Still to match",
    body: "Square items that aren't linked to a recipe or ignored yet, so their sales don't count toward costing and ordering. Some may have a suggested match below.",
  },
  {
    id: "sales.squareMenu.driftCount",
    area: "sales",
    route: "/sales/square-menu",
    title: "Price differences",
    body: "Linked items where Square charges a different price from the recipe's menu price. Food cost % uses the menu price, so these can make it look better or worse than it is.",
  },
  {
    id: "sales.squareMenu.needIngredients",
    area: "sales",
    route: "/sales/square-menu",
    title: "Need ingredients",
    body: "Recipes linked to Square that have no ingredient lines yet, so they cost nothing and order nothing. Open them on Menu costs to fill them in.",
    related: ["menu.editor.lines"],
  },
  {
    id: "sales.squareMenu.suggestions",
    area: "sales",
    route: "/sales/square-menu",
    title: "Suggested matches",
    body: "Recipes whose names closely match a Square item, with how confident the match is. Check them, then accept one at a time or all at once.",
    related: ["sales.mapping"],
  },
  {
    id: "sales.squareMenu.create",
    area: "sales",
    route: "/sales/square-menu",
    title: "Create recipes from Square",
    body: "Tick the Square items you don't have recipes for and press Create: each gets a recipe with Square's name, price and category, ready for ingredients. Or ignore ones that need no recipe, like merch.",
  },
  {
    id: "sales.squareMenu.drift",
    area: "sales",
    route: "/sales/square-menu",
    title: "Price differences",
    body: "Each linked item where the prices differ: Square's price next to the recipe's menu price. Use Square's price to update the recipe, one at a time or all together.",
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
    article: `**Only want recipes?** Use **Bulk add** on [Menu costs](/menu) (or [this link](/import?for=recipes)): copy just your recipe rows — with a header like *Recipe · Ingredient · Qty · Unit* — and paste. No need to link the whole spreadsheet. Ingredients that don't exist yet are created for you.

1. **Choose a source** — upload a file, paste cells from a sheet, or paste a Google Sheets link.
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
    body: "Upload an Excel or .csv spreadsheet file (every tab is read), paste cells copied from a sheet (include the header row), or paste a Google Sheets link shared as \"Anyone with the link\".",
  },
  {
    id: "import.tabs",
    area: "import",
    route: "/import",
    title: "What's in each tab",
    body: "Tell it whether a tab is ingredients & prices, recipes, or something to skip, and which column is which. Starred columns are required.",
    article: `- **Ingredients & prices** needs at least an ingredient column. Supplier, price and pack columns bring prices in too. Optional columns: *Description* (the supplier's item name), *Order unit* (case or piece), *Conversions* (e.g. \`1 slice = 21 g; 1 cup = 340 g\`), *Count unit* and *Par* (minimum on hand, in the count unit). The same ingredient on several rows means several products — the first row is the one you normally buy.
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
  {
    id: "import.done",
    area: "import",
    route: "/import",
    title: "Imported",
    body: "What the import created or updated: ingredients, suppliers, supplier products, prices and recipes. Check the menu costs and the ingredient grid next, or import another sheet.",
    related: ["menu.list", "ingredients.grid"],
  },
  {
    id: "import.actions",
    area: "import",
    route: "/import",
    title: "Review and import",
    body: "Review import checks every tab and shows what will happen; nothing is saved yet. Import everything then saves it. Start over clears the tabs you've read.",
  },
];

// ---- Settings ------------------------------------------------------------------

export const settings: HelpEntry[] = [
  {
    id: "settings.connections",
    area: "settings",
    route: "/settings/connections",
    title: "Connections",
    body: "Link Square, email, phone notifications, AI features, Google reviews and QuickBooks. Each card says what it turns on and opens a step-by-step guide with pictures. Keys you paste are stored locked (encrypted) and never shown again.",
    article: `Every connection is optional — the app works without them, each one just turns more on.

- **Square** — sales, the menu and timecards, brought in by themselves. About 6 minutes.
- **Email** — orders to suppliers, schedules and the weekly brief by email. About 10 minutes plus a short wait.
- **Phone notifications** — alerts on phones. One tap, then a minute per phone.
- **AI features** — invoice reading, review replies and Ask. About 3 minutes.
- **Google reviews** — new Google reviews every morning. About 5 minutes.
- **QuickBooks** — approved supplier invoices go to QuickBooks Online as bills. About 20 minutes, plus a review by Intuit.

Press **Set up** on a card. The guide shows exactly where to click on the other site (numbered circles), gives you copy buttons for anything you need to paste there, and a box to paste what you bring back. Each box checks the value as you paste it and says plainly if it looks wrong — for example a code pasted into the wrong box.

**Manage** on a card that's working shows what it's connected to, a **Test** button, and **Replace** or **Remove** for each key — the setup steps are one tap away under **Show the setup steps**. Square's **Manage** opens the [Square page](/settings/square).

**Test connection** on each card tries the service for real and tells you what happened. If the place the app is hosted blocks outside connections, the test says so — what you saved stays saved.

**Is it safe?** Keys are encrypted before they're saved, only the last four characters are ever shown, and only managers can open this page. **Replace** swaps a key; **Remove** turns that feature off.

Whoever hosts the app can still set the same keys as hosting settings instead; a key pasted here takes priority.`,
    related: ["settings.connections.square", "settings.connections.email", "settings.connections.push", "settings.connections.ai", "settings.connections.google", "settings.connections.quickbooks"],
    keywords: ["api key", "keys", "integrations", "connect", "setup", "resend", "anthropic", "claude", "google", "vapid", "environment variables", "env"],
  },
  {
    id: "settings.connections.square",
    area: "settings",
    route: "/settings/connections",
    title: "Connecting Square",
    body: "Part 1 registers the app with Square — once, about 5 minutes, done by whoever sets up the app. Part 2 is Max signing in to Square and pressing Allow. Part 3, instant updates, is one paste and recommended.",
    article: `**Part 1 — Register the app (one time, ~5 min).** On Square's developer site, create an application called Subversive Ops, switch to **Production**, paste the return address the guide gives you under **OAuth → Redirect URL** (Square's sign-in settings), then copy the **Application ID** (on **Credentials**) and the **Application secret** (on **OAuth** — press **Show**) into the guide. Ignore the access token for now.

**Part 2 — Connect (Max, 1 minute).** Press **Connect with Square**, sign in with the restaurant's Square login and press **Allow**. The app can only read — it never changes anything in Square.

**Part 3 — Instant updates (recommended, one paste).** On Square's developer site press **Credentials**, then **Show** next to **Access token**, and paste it into the guide (or the Square page). The app uses it once to ask Square to send each sale and clock-in, then throws it away — Square only lets the app's own token do this. Max doesn't need to do anything in his own Square account. New sales and clock-ins then arrive within seconds instead of every 15 minutes.

Connecting takes you to the [Square page](/settings/square), where your sales history starts coming in by itself.`,
    related: ["sales.connect", "settings.square", "sales.backfill"],
    keywords: ["square", "oauth", "redirect", "webhook", "application id", "secret", "access token", "instant updates"],
  },
  {
    id: "settings.connections.email",
    area: "settings",
    route: "/settings/connections",
    title: "Setting up email",
    body: "Email goes out through Resend, a free sending service. Sign up, prove you own your website's domain (copy three records into your domain provider), paste the key, choose the sending address, then send yourself a test.",
    related: ["settings.notify.email"],
    keywords: ["resend", "email", "domain", "dns", "from address"],
  },
  {
    id: "settings.connections.push",
    area: "settings",
    route: "/settings/connections",
    title: "Phone notifications",
    body: "One tap turns them on for the app — no account needed. Then each person turns them on for their own phone. The guide shows the steps for iPhone (add to Home Screen first), Android or a computer.",
    related: ["settings.notify.device", "app.phone"],
    keywords: ["push", "notifications", "iphone", "android", "home screen", "vapid"],
  },
  {
    id: "settings.connections.ai",
    area: "settings",
    route: "/settings/connections",
    title: "AI features",
    body: "Reads invoices from a photo, drafts review replies in your tone and answers questions in Ask. Needs a Claude key: create an account in the Claude Console, add a little credit and paste the key.",
    keywords: ["claude", "anthropic", "ai", "api key", "invoice reading"],
  },
  {
    id: "settings.connections.google",
    area: "settings",
    route: "/settings/connections",
    title: "Google reviews",
    body: "Brings in new Google reviews every morning. Create a free Google Cloud project, turn on Places API (New), paste the key, then use Find my business — no Place ID needed. The search doubles as the test.",
    related: ["reviews.import"],
    keywords: ["google", "places", "place id", "reviews", "maps"],
  },
  {
    id: "settings.connections.more",
    area: "settings",
    route: "/settings/connections",
    title: "Keeping keys safe",
    body: "Keys are encrypted before they're saved and only their last four characters are ever shown. Only managers can open Connections. Treat keys like passwords: don't email or text them.",
  },
  {
    id: "settings.square",
    area: "settings",
    route: "/settings/square",
    title: "Square connection",
    body: "Managing the Square connection: who's connected, instant updates, which locations are read, the history import, when each part last synced and anything that went wrong. Disconnect is here too.",
    article: `- **Connection** — the Square business, and whether it's the real account or a test one. **Test connection** checks Square still answers. Connections made with **Connect with Square** stay signed in by themselves.
- **Instant updates** — on or off, and when the last one arrived. Turn them on with one paste (see [Connecting Square](/settings/connections?open=square)).
- **Locations** — orders and timecards are read from every location picked.
- **First import** — past sales and timecards, a week at a time. It starts by itself when Square is connected and carries on while this page is open; the nightly sync finishes anything left.
- **Data we have** — how far back sales go and how many timecards are in.
- **Sync** — the last menu, sales and timecard sync. With instant updates on, new orders and clock-ins arrive within seconds; otherwise today's numbers top up every 15 minutes while someone is using the app, and everything re-syncs nightly.
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
    body: "Everyone signs in with their name and a 4–8 digit PIN. Staff see their shifts, counts, waste and help; managers see everything. Reset a PIN, deactivate someone or add a login here.",
    related: ["app.roles"],
  },
  {
    id: "settings.suppliers",
    area: "settings",
    route: "/settings",
    title: "Suppliers",
    body: "Delivery days and lead time decide when each order is due and how many days it covers. Minimum order warns you when an order is too small. You can also add a supplier straight from an invoice — including stores like Price Chopper.",
    article: `- **Type** — just a label. **Distributor** sends a price sheet (Sysco, Hudson Valley Foodservice); **Local** is a farm, bakery or store run like Price Chopper. Nothing else changes with it.
- **Delivery days** — the weekdays the truck comes.
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
  {
    id: "settings.page",
    area: "settings",
    route: "/settings",
    title: "Settings",
    body: "Connections to outside services, notifications, the Square connection, team logins, suppliers, the food cost target, labor rules and clearing data — the things you set once and rarely touch.",
    article: `Start with **Connections**: it links Square, email, phone notifications, AI features and Google reviews, each with a step-by-step guide.`,
    related: ["settings.team", "settings.suppliers", "settings.laborRules"],
  },
  {
    id: "settings.getStarted",
    area: "settings",
    route: "/settings",
    title: "Get your data in",
    body: "Shown while there's no data yet. Import your existing spreadsheet of ingredients, prices and recipes, or load demo data to look around first.",
    related: ["import.page"],
  },
  {
    id: "settings.notifications",
    area: "settings",
    route: "/settings",
    title: "Notifications",
    body: "Choose which alerts you get by email and on your phone: schedules, shift changes, the weekly brief, price spikes, invoice issues, staff requests and low reviews. Staff turn theirs on from My shifts.",
    related: ["settings.notify.events"],
  },
  {
    id: "settings.laborRules",
    area: "settings",
    route: "/settings",
    title: "Labor rules",
    body: "Minimum and tipped wages, overtime, spread of hours, call-in pay, employer burden, meal breaks, rest, minors, paid sick leave and the pay period. Pre-filled for New York; each compliance check can be Must fix, Warn or Off.",
    related: ["schedule.compliance", "labor.overtime", "labor.sick", "settings.wageSchedule"],
  },
  {
    id: "settings.notify.email",
    area: "settings",
    route: "/settings/notifications",
    title: "Email",
    body: "Whether the app can send email. When it's set up, notifications and orders to suppliers (with a spreadsheet file attached) go out from the address shown. Without it everything still works — orders can be copied or downloaded.",
  },
  {
    id: "settings.notify.push",
    area: "settings",
    route: "/settings/notifications",
    title: "Push",
    body: "Whether phone and computer notifications are available. Once set up, each person turns them on for their own device, here or on My shifts.",
  },
  {
    id: "settings.notify.device",
    area: "settings",
    route: "/settings/notifications",
    title: "This device",
    body: "Turn notifications on or off for the phone or computer you're using, send yourself a test, and see your other devices that have them on. On iPhone, add the app to your Home Screen first.",
    related: ["app.phone"],
  },
  {
    id: "settings.notify.address",
    area: "settings",
    route: "/settings/notifications",
    title: "Your email",
    body: "Where your notification emails go, and the reply-to address on orders you send. Leave it blank to use the email on your team profile.",
  },
  {
    id: "settings.notify.events",
    area: "settings",
    route: "/settings/notifications",
    title: "What you get",
    body: "Turn each alert on or off for email and push: schedule published, shift changes, weekly brief, price spikes, invoice issues, staff requests and low reviews. Staff only get schedule and shift messages about themselves.",
  },
  {
    id: "settings.notify.previews",
    area: "settings",
    route: "/settings/notifications",
    title: "Email previews",
    body: "Development only: each email template rendered with sample data, as the email or as plain text.",
  },
  {
    id: "settings.square.locations",
    area: "settings",
    route: "/settings/square",
    title: "Locations",
    body: "Which Square locations sales and timecards are read from. Square Online orders often use a location of their own, so include it if you sell online.",
  },
  {
    id: "settings.square.coverage",
    area: "settings",
    route: "/settings/square",
    title: "Data we have",
    body: "How much Square history is in the app: days of sales and their range, completed orders, timecards (and how many came from Square), and the last day with sales.",
    related: ["sales.backfill"],
  },
  {
    id: "settings.square.instant",
    area: "settings",
    route: "/settings/square",
    title: "Instant updates",
    body: "With instant updates on, Square tells the app about each sale, refund and clock-in within seconds. Turning them on is one paste: the Access token from the Credentials page of the Square app (the developer site). It's used once and not kept.",
    related: ["settings.connections.square", "settings.square.sync"],
    keywords: ["webhook", "instant", "real time", "live", "access token"],
  },
  {
    id: "settings.square.sync",
    area: "settings",
    route: "/settings/square",
    title: "Sync",
    body: "When each kind of data — sales, the menu, timecards and so on — last came in from Square and how much. Today's numbers top up through the day and everything re-syncs nightly; with instant updates on, new orders arrive as they happen.",
    related: ["sales.sync"],
  },
  {
    id: "settings.square.problems",
    area: "settings",
    route: "/settings/square",
    title: "Recent problems",
    body: "The last 20 things that went wrong talking to Square, newest first. Clear them once they're sorted.",
  },
];
