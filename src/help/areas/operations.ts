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

1. **On hand at delivery** = your last count + deliveries checked in since − what sales and logged waste used since − what forecast sales will use before the truck arrives + anything already on a sent order.
2. **Needed** = forecast usage from this delivery until the next one × (1 + the ingredient's order buffer).
3. **Order** = needed − on hand at delivery, rounded **up** to whole packs. Never below zero.

### Changing it
- Use **−** and **+**, or type a number. Changed quantities go bold and show the original suggestion underneath.
- Items you're covered on are hidden — "Show N items you're covered on" brings them back.
- The bar at the bottom shows the total and warns if you're under the supplier's minimum.

### Badges
- **Count to auto-order** — this item has never been counted, so stock is unknown. Rather than guess a full case, it suggests 0. Count it once.
- **Set pack size** — the product's pack size isn't known, so a quantity can't be turned into cases.`,
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

### The four numbers at the top
- **Food cost if recipes were followed** — theoretical food cost for the period.
- **Actual food cost** — from what really left the shelves. Red when it's more than 1.5 points over theoretical.
- **Logged waste** — accounted for.
- **Unexplained** — dollars nobody can account for, and what share of food sales that is.

### Reading it
- **Positive** (more went out): heavy portions, waste nobody logged, theft, or a Square item not linked to its recipe.
- **Negative** (less went out): a delivery that wasn't checked in, or a counting slip.

Both columns use today's prices, so price changes don't show up as gaps.`,
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
    title: "Food cost if recipes were followed",
    body: "What food should have cost given what sold, as a share of food sales.",
    related: ["overview.foodCost"],
  },
  {
    id: "variance.actual",
    area: "variance",
    route: "/variance",
    title: "Actual food cost",
    body: "What really left the shelves — opening count + deliveries − closing count — as a share of food sales.",
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
    body: "Biggest dollar gaps first. Badges mark gaps over 10% and at least $5; red is over-use, orange is under-use.",
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
    route: "/sales",
    title: "Connecting Square",
    body: "Square is connected with an access token and location ID set as environment variables where the app is hosted. Once set, sales sync every night.",
    article: `1. Go to **developer.squareup.com**, sign in with the restaurant's Square account and create an app.
2. Open **Production** credentials and copy the **access token**.
3. On the **Locations** tab, copy the **location ID** for Subversive.
4. In the hosting project (Vercel → Settings → Environment Variables) set \`SQUARE_ACCESS_TOKEN\` and \`SQUARE_LOCATION_ID\`, then redeploy.
5. In the app, open [Sales](/sales) → **Import last 6 months**, then link Square items to recipes.

The token is a password for your sales data — keep it out of emails and chats. Whoever manages the hosting usually does steps 2–4.`,
    related: ["sales.backfill", "sales.mapping"],
    keywords: ["square", "pos", "token", "api", "connect", "integration"],
  },
  {
    id: "sales.sync",
    area: "sales",
    route: "/sales",
    title: "Sync now",
    body: "Pulls the latest orders, refunds and catalog items from Square. It also runs on its own every night.",
  },
  {
    id: "sales.backfill",
    area: "sales",
    route: "/sales",
    title: "Import last 6 months",
    body: "Pulls six months of Square sales in one go so the forecast has history to work from. Run it once after connecting.",
  },
  {
    id: "sales.forecast",
    area: "sales",
    route: "/sales",
    title: "Forecast",
    body: "Expected sales per item per day, from the same weekday over the last weeks (recent weeks count more), nudged by the recent trend and any adjustments.",
    article: `For each menu item and day:

- **Baseline** — a recency-weighted average of the same weekday over recent weeks, skipping days you were closed.
- **Trend** — the last four weeks against the four before, softened and capped so one odd week doesn't swing it.
- **Adjustments** — events, weather and your manual tweaks for that day.

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
    draft: true,
    title: "Five-week forecast",
    body: "Sales expected for each of the next five weeks, day by day, built from history and adjusted for weather, events and your own changes.",
    article: `The forecast looks five weeks out so ordering, scheduling and budgets all work from the same numbers.

Each day shows what moved it: the weather forecast (rainy days learn their own effect from your history), events on the [events calendar](/events), and any manual change you made. Tap a day to see the breakdown or override it.`,
    related: ["sales.weather", "sales.events", "sales.accuracy", "events.page"],
  },
  {
    id: "sales.weather",
    area: "sales",
    route: "/sales",
    draft: true,
    title: "Weather",
    body: "The weather forecast for Catskill feeds the sales forecast. How much rain changes your sales is learned from your own history.",
    related: ["sales.forecast5w"],
  },
  {
    id: "sales.events",
    area: "sales",
    route: "/sales",
    draft: true,
    title: "Events in the forecast",
    body: "Days with something on the events calendar are adjusted by that event's expected impact.",
    related: ["events.impact"],
  },
  {
    id: "sales.manual",
    area: "sales",
    route: "/sales",
    draft: true,
    title: "Manual adjustments",
    body: "Your own % change for a day, on top of weather and events. Use it for what nothing else can know — a buyout, a closure, a road closure.",
  },
  {
    id: "sales.accuracy",
    area: "sales",
    route: "/sales",
    draft: true,
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
