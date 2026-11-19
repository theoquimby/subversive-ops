import type { HelpEntry } from "../types";

// ---- Ordering ------------------------------------------------------------------

export const ordering: HelpEntry[] = [
  {
    id: "ordering.page",
    area: "ordering",
    route: "/ordering",
    tour: "ordering",
    title: "Ordering",
    body: "Today's deadlines, drafts and deliveries up top, then every supplier in one table with its next deadline, order status and suggested order. Orders lists every purchase order.",
    article: `**Today** lists what needs doing now: deadlines in the next 48 hours, drafts to send, deliveries to check in and tomorrow's trucks.

**Suppliers** is one row per supplier: delivery days, the next delivery and its order deadline with a countdown, where the order stands, the suggested order, last order, minimum, order email and auto-draft. Edit days, minimum, email and auto-draft in the row; tap a row for the side panel; tick several to draft their orders at once.

**Orders** lists purchase orders and where they are: **Draft** (saved, not sent), **Sent** (waiting for delivery) or **Received** (checked in), with quick Mark sent, Check in and Copy.`,
    related: ["ordering.builder", "ordering.po", "settings.suppliers"],
    keywords: ["purchase order", "po", "order guide"],
  },
  {
    id: "ordering.suppliers",
    area: "ordering",
    route: "/ordering",
    title: "Suppliers",
    body: "One row per supplier, soonest order deadline first: delivery days, next delivery, time left to order, status and the suggested order. Tap the name to build its order, or the row for details.",
    related: ["settings.suppliers"],
  },
  {
    id: "ordering.recent",
    area: "ordering",
    route: "/ordering",
    title: "Recent orders",
    body: "Every purchase order: Draft (not sent yet), Sent (waiting for the truck) and Received (checked in). Filter by status, mark drafts sent, check in as ordered or copy an order into a new draft. Tap one to open it.",
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
    title: "Deliveries and order deadlines",
    body: "When each truck comes and when its order has to be in. Press Edit deadlines on a supplier, tick its delivery days, and for each one pick the deadline — e.g. Friday delivery, order by Wednesday 5pm. \"Guessed\" means none is set yet.",
    article: `**Edit deadlines** is the calendar button in the Order by column on Ordering, in each supplier's side panel, and in Settings → Suppliers.

1. Tick the days the truck comes.
2. For each delivery day, pick the day and time the order has to be in. Every delivery day can have its own deadline (Decrescente: Friday delivery, order by Wednesday 5pm).
3. Leave **Draft the order for me** on to have the suggested order waiting about a day before each deadline, with a reminder. Nothing is sent until you press Send.

Until you set them, deadlines are guessed from the supplier's lead time (marked "guessed").

Each morning, any supplier whose cutoff falls in the next 36 hours gets a **draft** order built from the forecast, unless an order for that delivery already exists. Suppliers ordered **when stock runs low** only get one when something runs short. Drafts are never sent on their own. They show up in Today on Ordering, on the [weekly brief](/brief) and under Orders, marked "Auto-drafted".`,
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
    body: "The main button follows how the supplier takes orders: email, a text typed out for your phone, a copy for their website, or a call script. You can also copy, download or mark it sent. Sent orders count as incoming.",
    article: `The main button follows the supplier's **Send orders by** setting (see [How each supplier takes orders](/help/ordering.sendBy)): **Send to supplier** (email), **Text the order**, **Copy order for** their site, or **Call the order in**. After a text, site or call, press **I sent it** / **I placed it**. If the cutoff has passed, the page says so: call or text first.

- **Copy as text** — paste into a text, email or the distributor's order notes.
- **Download spreadsheet** — a .csv file, for distributor sites that take an upload.
- **Email** — opens your mail app with the order filled in (needs the supplier's email in Settings).
- **Mark as sent** — the order now counts as on its way, so the next order won't double up.

A draft can be deleted; a sent order can be checked in.`,
    related: ["ordering.po.receive", "ordering.sendBy"],
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
    related: ["ordering.builder.qty", "ordering.builder.onHand", "ordering.builder.needed", "ordering.builder.packs"],
  },
  {
    id: "ordering.builder.packs",
    area: "ordering",
    route: "/ordering",
    title: "Pick the pack",
    body: "When a supplier sells an item in more than one pack, pick which to order. Each shows its price per oz and how many you'd need; a note says when the cheaper one means a full case. It starts on the pack you ordered last time.",
    keywords: ["case", "jug", "pack size", "cheaper", "split case"],
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
    body: "Pick an area and count what's on the shelf, in walking order. Every number saves as you go. Staff counts go to a manager to approve before they count.",
    article: `1. Tap the area you're counting — **Everything**, or one storage area like the walk-in.
2. Type how much is there next to each item, or tap **None**. Enter jumps to the next one.
3. Change the unit if it's easier — cases, jugs, lb, each. Got some of each? Add another unit on the same line.
4. Tap an item's name to see its photo, item numbers and how to count it.
5. When every line has a number, tap **Finish count** (managers) or **Send to manager** (staff).

If someone already started counting that area, you'll carry on their count instead of starting a new one.

### Who can change what
Staff only enter numbers, in the units the manager allowed. They can't add, rename or remove items. If something's missing or wrong, **Tell the manager** leaves a note on the count. A manager checks a staff count, sees anything that looks off next to the last count, and approves it — only then does it move stock, ordering and the margin gap.

### Why it matters
Counts feed the suggested orders (so you don't over- or under-order) and the margin gap (so you can see what went missing).`,
    related: ["count.sheet", "count.autosave", "count.setup", "count.review", "count.summary", "ordering.builder.onHand", "variance.page"],
    keywords: ["inventory", "stock take", "count", "approve"],
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
    body: "Items in walking order, area by area. Type the amount (or tap None), pick the unit, and a green tick shows it's saved. Tap a name for its photo, item numbers and how to count it.",
    related: ["count.autosave", "count.units", "count.mixed", "count.item", "count.finish"],
  },
  {
    id: "count.autosave",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Counts save as you go",
    body: "Each number saves the moment you leave the field — a green tick means it's in. No signal? A cloud means it's kept on this phone and sends by itself. You can close the app and come back to the same count.",
    article: `There's no save button. When you move on from a field (Enter, tapping the next one, or scrolling away), that number is saved. A **green tick** means it's saved; a **red dot** means it didn't save — tap the field and try again.

**No signal** (the walk-in, the basement): keep counting. Each number is kept on this phone with a **cloud** next to it, and sent as soon as there's signal — a banner at the top says how many are waiting. Finish count waits until they've gone.

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
    body: "Pick the unit that's easiest: the case, the piece inside it, every pack it's bought in, lb, each, or a custom one like \"jug\". It's converted for you. Staff see the units the manager allowed.",
    related: ["count.mixed", "ingredients.countIn", "ingredients.customUnits"],
  },
  {
    id: "count.finish",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Finish or send",
    body: "Every line due needs a number first (0 is fine). The button jumps to the next one left. A manager's count is official at once; a staff count goes to the manager to approve.",
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
    body: "Type any part of a name or item number (\"chkn\" finds chicken). Tap an area chip to jump there — the number is what's left to count in it. \"Not counted yet\" hides what you've done.",
    audience: "all",
  },
  {
    id: "count.area",
    area: "counts",
    route: "/count",
    title: "Items in this area",
    body: "Everything kept here, in shelf order. Type what you see; an opened one? Tap +¼, +½ or +¾. A green tick means it's saved. Counted somewhere else already? It says so, no zero needed.",
    related: ["count.units", "count.enter", "count.foundHere"],
    audience: "all",
  },
  {
    id: "count.mixed",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Some of each: mix units",
    body: "Two jugs and three cans? Pick \"Add another unit\" in the unit list and type both on the same line. They're added up for you; the total shows underneath.",
    keywords: ["jug", "can", "mixed", "two units", "plus"],
  },
  {
    id: "count.item",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "What is this item?",
    body: "Tap an item's name for its photo, the supplier's item number and pack, where it lives, the last count and the manager's note on how to count it.",
    related: ["count.setup"],
    keywords: ["photo", "item number", "sku", "picture", "what is"],
  },
  {
    id: "count.tellManager",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Tell the manager",
    body: "Something on the shelf that isn't on the list, or a unit that doesn't fit? Leave a note. The manager sees it with your count. Only managers add or change items.",
  },
  {
    id: "count.notDue",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Not due this time",
    body: "Slow movers counted monthly or only when they change. Their last count carries into this count's value. Tap Count it anyway if you know it changed.",
    related: ["count.setup.every"],
  },
  {
    id: "count.left",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "What's left",
    body: "Every item due needs a total before the count can be finished, so nothing gets skipped. Counted in one place is enough; no zeros needed elsewhere. None anywhere? Tap None.",
  },
  {
    id: "count.foundHere",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Found something here?",
    body: "Something that usually lives elsewhere, like fryer oil on the overflow shelf? Add it to this area for this count. Its usual place doesn't change. Search by name or item number.",
    keywords: ["overflow", "wrong area", "add item", "elsewhere"],
  },
  {
    id: "count.check",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Before you send",
    body: "Items still without a total (count them, or None anywhere), then anything counted in two or more places or far from what we expected, so nothing is counted twice.",
    keywords: ["double count", "review"],
  },
  {
    id: "count.homeAreas",
    area: "counts",
    route: "/count",
    title: "Found somewhere new",
    body: "Items this count found outside their usual areas. Tap Yes to always list one there too. Nothing changes unless you tap.",
  },
  {
    id: "count.waiting",
    area: "counts",
    route: "/count",
    audience: "all",
    title: "Waiting for approval",
    body: "Counts staff have sent. They don't change stock, ordering or the margin gap until a manager reviews and approves them.",
    related: ["count.review"],
  },
  {
    id: "count.value",
    area: "counts",
    route: "/count",
    title: "Inventory value",
    body: "What everything on the shelves was worth at the last count, the change since the count before, and the trend over the last eight counts. Tap for the breakdown.",
    related: ["count.summary"],
  },
  {
    id: "count.review",
    area: "counts",
    route: "/count",
    title: "Review a count",
    body: "A staff count before it becomes official. Lines that look off next to the last count come first. Fix numbers, send it back, or approve it.",
    article: `Nothing a staff member counts changes stock until you approve it.

- **Looks off**: more than four times, or under a quarter of, the last count. Usually cases typed as each, or the other way round.
- **Notes**: anything they told you while counting (an item that isn't on the list, a wrong label).
- **Carried forward**: monthly and "only when it changes" items that weren't due; their last count stays.

**Fix numbers** opens the count sheet so you can change a line. **Send back** lets them fix it and send it again. **Approve** makes it the official count: ordering, the margin gap, inventory value and the prep list's on-hand all use it from then on.`,
    related: ["count.review.lines", "count.summary"],
  },
  {
    id: "count.review.notes",
    area: "counts",
    route: "/count",
    title: "Notes from the count",
    body: "What whoever counted told you: missing items, wrong labels, units that don't fit. Add or fix items in Set up the count.",
    related: ["count.setup"],
  },
  {
    id: "count.review.lines",
    area: "counts",
    route: "/count",
    title: "Compared with the last count",
    body: "Each line next to the last official count. Highlighted lines look like a typo: over four times or under a quarter of last time. Fix numbers to change one.",
  },
  {
    id: "count.review.skipped",
    area: "counts",
    route: "/count",
    title: "Missing lines",
    body: "Due items with no number. New counts can't be sent with lines missing, so this only shows for older ones. They keep their last count.",
  },
  {
    id: "count.review.carried",
    area: "counts",
    route: "/count",
    title: "Carried forward",
    body: "Items not due this time (monthly, or only when they change). Their last count stays in stock and in the value.",
  },
  {
    id: "count.review.approve",
    area: "counts",
    route: "/count",
    title: "Approve, send back or fix",
    body: "Approve makes it the official count. Send back reopens it for whoever counted. Fix numbers lets you change lines yourself first.",
  },
  {
    id: "count.setup",
    area: "counts",
    route: "/count/setup",
    title: "Set up the count",
    body: "Get every item ready so anyone can count it right: shelf order, photo, how-to note, the units staff may use and how often it's counted. Tap an item to change it.",
    article: `Do this once, then hand the phone to anyone.

- **Shelf order**: the arrows move an item up or down within its area, so the sheet follows the shelf. Change an item's area in its sheet. Areas themselves follow the walking order in **Add or edit areas**.
- **More than one home**: full gallons on the dry shelf, open ones in the walk-in? "Also list it in" puts it on both areas' sheets. Count each place; the total adds up.
- **Photo**: take one with the phone or upload one. It shows on the count row and in the item's sheet.
- **How to count this**: a short note like "Full jugs only — the open one is on the line".
- **Count units**: tap units to limit staff to those; the star is the default. Add a missing one, like "1 jug = 114 oz" or "1/3 pan = 30 each".
- **How often**: every count, monthly, or only when it changes. Items not due stay off the sheet and their last count carries forward.
- **Prep items**: put house-made sauces and portioned proteins on the count. They're valued at recipe cost and become the prep list's on-hand.
- **Take off the count**: archives an ingredient (or just removes a prep item from the count).`,
    related: ["count.setup.every", "count.setup.prep", "count.units", "count.setup.suggest"],
    keywords: ["organize", "setup", "shelf order", "photo", "item number", "lock"],
  },
  {
    id: "count.setup.suggest",
    area: "counts",
    route: "/count/setup",
    title: "Shorter counts",
    body: "Items that don't need counting every time, worked out from past counts: one that's been the same on the last few counts (over three weeks or more) can be counted only when it changes, and one worth under $15 on the shelf can be counted monthly. Untick any you want to keep on every count, then Apply.",
    related: ["count.setup.every", "count.setup"],
    keywords: ["how often", "monthly", "only when it changes", "suggest", "shorter count", "frequency"],
  },
  {
    id: "count.setup.gaps",
    area: "counts",
    route: "/count/setup",
    title: "Missing a photo or note",
    body: "Shows only items without a photo or a how-to note, so you can work through them. The count on the right is how many are fully set up.",
  },
  {
    id: "count.setup.area",
    area: "counts",
    route: "/count/setup",
    title: "Items in this area",
    body: "In the order they're counted. Tap an item to set its photo, note, units and how often; the arrows move it along the shelf.",
  },
  {
    id: "count.setup.order",
    area: "counts",
    route: "/count/setup",
    title: "Shelf order",
    body: "The count sheet lists each area's items in this order. Move them to match the shelf, top to bottom, left to right.",
  },
  {
    id: "count.setup.every",
    area: "counts",
    route: "/count/setup",
    title: "How often it's counted",
    body: "Every count (default), monthly (due again 30 days after its last count) or only when it changes. Slow movers like canned beans stay off the weekly sheet; their last count carries forward.",
    keywords: ["monthly", "slow movers", "frequency", "carried"],
  },
  {
    id: "count.setup.prep",
    area: "counts",
    route: "/count/setup",
    title: "Count prep items",
    body: "House-made sauces, pickles and portioned proteins. Add containers like \"1/3 pan = 30 each\" or \"pan = 20 each\". An approved count becomes the prep list's on-hand.",
    related: ["prep.onHand"],
    keywords: ["prep", "pan", "1/3 pan", "sauce", "house made"],
  },
  {
    id: "count.summary",
    area: "counts",
    route: "/count",
    title: "Count result",
    body: "What the shelves were worth at this count, by area and category, the change since the count before, items carried forward and stock no menu item uses.",
    related: ["count.summary.value", "count.summary.offMenu"],
  },
  {
    id: "count.summary.value",
    area: "counts",
    route: "/count",
    title: "How value is worked out",
    body: "Each item's latest count up to this one, times its cost per unit on that day. Items not counted this time carry their last count. Prep items are valued at recipe cost.",
  },
  {
    id: "count.summary.byArea",
    area: "counts",
    route: "/count",
    title: "Value by area",
    body: "Where the money sits: each storage area's share of the total.",
  },
  {
    id: "count.summary.byCategory",
    area: "counts",
    route: "/count",
    title: "Value by category",
    body: "The total split by ingredient category, biggest first. Prep items show as Prep.",
  },
  {
    id: "count.summary.carried",
    area: "counts",
    route: "/count",
    title: "Carried forward",
    body: "Not counted this time, so their last count is used, with the date it's from.",
  },
  {
    id: "count.summary.offMenu",
    area: "counts",
    route: "/count",
    title: "On hand, not on the menu",
    body: "Food and drink with stock that no active menu item uses, directly or in a prep recipe. Money sitting still: ideas for a special. Packaging and cleaning are left out.",
    keywords: ["specials", "dead stock", "slow"],
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
    body: "Each Square item and modifier needs its recipe so its sales count toward costing and ordering. Link your sales walks through them biggest first; \"Leave out of sales\" is only for gift cards, fees and deposits.",
    article: `When Square sells something, the app needs to know which recipe that was. [Link your sales](/sales/link) is the quickest way: biggest sellers first, with a suggestion, its cost and an Undo for each.

- Pick the recipe from the list. It saves straight away, and shows up under **Changes** on Link your sales with an Undo.
- Draft beer: cost the keg once on [Link your sales](/sales/link) or [Draft beer](/menu/draft-beer) and every pour is linked.
- Cans, bottles and merch: give them a cost each on Link your sales. They still count as sales.
- **Leave out of sales** only for money that isn't a sale: gift cards, service fees, deposits. It comes off net sales entirely.

An unlinked item still uses product but doesn't count as a sale, which shows up as **unexplained** on the margin gap.`,
    related: ["sales.link", "variance.unexplained", "overview.foodCost"],
    keywords: ["map", "mapping", "modifier", "link"],
  },
  {
    id: "sales.forecast5w",
    area: "sales",
    route: "/sales",
    title: "Five-week forecast",
    body: "Sales expected for each of the next five weeks, day by day, built from history and adjusted for weather, events and your own changes.",
    article: `The forecast looks five weeks out so ordering, scheduling and budgets all work from the same numbers.

Each day shows what moved it: the season (once there's a year of history), the weather forecast (rain, heavy rain, snow, heat and cold each learn their own effect from your history), holidays and school breaks (learned from past years), interest on Google (searches and listing activity, where they've made the forecast closer), events on the [events calendar](/events), and any manual change you made. Tap a day to see the breakdown, the expected number of orders and the hourly shape, or to override it.`,
    related: ["sales.weather", "sales.events", "sales.accuracy", "events.page"],
  },
  {
    id: "sales.weather",
    area: "sales",
    route: "/sales",
    title: "Weather",
    body: "The National Weather Service forecast for the next week feeds the sales forecast. What rain, heavy rain, snow, heat and cold do to your sales is learned from your own history, and only used where it has made the forecast closer. Past weather is NOAA's record at Albany International Airport. Both are free US government data.",
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
    id: "sales.scorecard",
    area: "sales",
    route: "/sales/scorecard",
    title: "Forecast scorecard",
    body: "How close the sales forecast has been on every past open day, and where it goes wrong: by weekday, month, weather and event days.",
    article: `Open it from **Sales & forecast → Forecast scorecard**.

The top of the page is the short version: how far to trust the forecast right now (solid, use with a cushion, or a rough guide), what a typical day's miss is in dollars, and a short list of things to do differently. The tables it comes from are folded under **The numbers behind it**.

Each past open day is forecast again the way it would have been made the evening before, using only the sales known by then. That forecast is compared with what actually sold. Nothing from the day itself, or after it, can leak in.

- **Typical daily miss**: all the misses added up, as a share of all the sales. 12% means a $3,000 day is usually forecast within about $360.
- **Against “same day last week”**: the plainest forecast there is. If the forecast can't beat it, the method isn't earning its keep.
- **How far ahead**: the same test for a forecast made a week and two weeks ahead, which is when schedules and orders are set.
- **By weather, weekday, month and event days**: where sales run over or under the forecast. These are the gaps a better method has to close.

The replay leaves weather out, because the weather forecast for past days was never kept. So **By weather** shows what weather does to sales here. From now on each night's forecast is kept as it was made, weather and all, under **Forecasts as they were made**.

Any change to how Ops forecasts has to beat the current method on this page before it replaces it.`,
    related: ["sales.accuracy", "sales.scorecard.miss", "sales.scorecard.weather"],
    keywords: ["scorecard", "accuracy", "backtest", "forecast", "miss", "error", "weather"],
  },
  {
    id: "sales.scorecard.todo",
    area: "sales",
    route: "/sales/scorecard",
    title: "What to do with it",
    body: "The few things worth doing differently because of how the forecast has done: bad-weather days, weekdays it can't call, event days, a steady lean, and how far ahead to plan. Each comes from the tables underneath.",
    related: ["sales.scorecard", "sales.scorecard.numbers"],
  },
  {
    id: "sales.scorecard.numbers",
    area: "sales",
    route: "/sales/scorecard",
    title: "The numbers behind it",
    body: "Every table the summary is built from, folded away: how far ahead, the usual day, weather, holidays, weekdays, event days, months, online signals, the forecasts kept each night, and every scored day. Open a line to see it.",
    related: ["sales.scorecard", "sales.scorecard.weather", "sales.scorecard.days"],
  },
  {
    id: "sales.scorecard.method",
    area: "sales",
    route: "/sales/scorecard",
    title: "The usual day",
    body: "How the usual for a weekday is worked out: stray-sale days aren't counted as open days, and one freak day can't pull the usual for weeks. Used only when the replay shows it's closer.",
    article: `Open **The numbers behind it → The usual day** on the forecast scorecard.

Every forecast starts from the usual for that weekday: the last eight weeks of that weekday, recent ones counting most. Two things used to throw it off.

**Stray-sale days.** A gift card bought online on a Tuesday you're closed shows up as a Tuesday with $40 of sales. That isn't an open day, and it shouldn't sit in the average of recent Tuesdays or be scored as a forecast that missed. A day now counts as open only when it sold at least a tenth of the typical day over the eight weeks before it.

**Freak days.** A holiday Monday or one huge order used to stay in the average for eight weeks, so the Mondays after Labor Day were forecast far too high. Each recent day now counts for at most one-and-a-half times the middle one.

Both are replayed over every past day beside the method without them, and switched **On** only when that's at least 1% closer over all your history and no worse over the last 12 months. It's decided again every night.`,
    related: ["sales.scorecard", "sales.scorecard.numbers", "sales.forecast"],
    keywords: ["baseline", "usual", "average", "outlier", "stray", "closed day", "monday", "tuesday"],
  },
  {
    id: "sales.scorecard.holidays",
    area: "sales",
    route: "/sales/scorecard",
    title: "Holidays and school breaks",
    body: "What each holiday and school break has done to sales here, and which ones the forecast now plans for. Your own event or adjustment on a day always wins.",
    article: `Open **The numbers behind it → Holidays and school breaks** on the forecast scorecard.

Ops knows the calendar for any year: New Year's, the Super Bowl, Valentine's, St. Patrick's, Easter, Mother's and Father's Day, Juneteenth, July 4th, Halloween, Veterans Day, Thanksgiving Eve through the weekend after, Christmas Eve to New Year's Eve, the long weekends, the February school break (the week of Presidents' Day) and the weeks either side of Easter.

Long weekends are pooled so they have enough days behind them: the winter ones (MLK, Presidents' Day) together, and the warm ones (Memorial Day, Labor Day, Columbus Day) together, with the Monday separate from the Saturday and Sunday.

**How it's learned.** For each holiday, Ops compares how sales ran against the forecast with how they ran on ordinary days, then replays it year by year using only the years before. A holiday is switched **On** only if that replay landed at least 5% closer and the holiday moves the day by a tenth or more (with two dozen holidays and a handful of days each, a small effect could pass by luck). A holiday comes once a year, so these rest on few days; they're learned again every night, and a holiday that stops helping switches itself off.

**Closed every year.** If you were closed on a holiday at each of its last three occurrences, the forecast shows it as closed. A year only counts if you'd normally have been open that weekday, so a Christmas Eve that fell on a day you never open says nothing. Opening this year? Add an event with its effect on that day and the forecast starts from a usual day.

**Your plans win.** On a day with your own adjustment, a closure, or an event that changes the forecast, the holiday isn't applied and nothing is learned from the day. A calendar entry with no effect on the forecast (a game on TV, say) doesn't count.

The top of the scorecard lists the holidays in the next four weeks with what the forecast plans for each, so you can check it against what you know.`,
    related: ["sales.scorecard", "sales.scorecard.numbers", "sales.scorecard.weather"],
    keywords: ["holiday", "thanksgiving", "christmas", "new year", "easter", "long weekend", "school break", "closed"],
  },
  {
    id: "sales.scorecard.signals",
    area: "sales",
    route: "/sales/scorecard",
    title: "Online signals",
    body: "Each number from Google and the website tested against sales: does it move with sales on the day, and would it have made the forecast closer ahead of time? The ones that help go into the forecast as one reading.",
    article: `Open **The numbers behind it → Online signals** on the forecast scorecard.

The numbers tested are direction requests, views, calls and website clicks from your Google listing; clicks and times shown from Google Search; and visitors and actions on your own website.

**On the day** asks whether the number and sales move together: when direction requests run above their usual level for that weekday, do sales run above the forecast? A strong link means it's a real sign of demand.

**Ahead** is the test that matters for a forecast. These numbers arrive late (Google's by several days), so a forecast can only use what had arrived when it was made. Ops compares the last week on file with the four weeks before it, then replays every past day using only the days before it. **Helps** means the replay cut the typical miss by at least 1%. **No help** means it didn't. **Too soon** means there isn't enough history for a verdict.

**What the forecast does with them.** The numbers that earn Helps rise and fall together, so they go in as one reading: the average of how far each ran, over the last week on file, from the four weeks before. That reading is replayed twice, for the next few days and for a forecast made a week ahead, and each part is switched **On** only if its replay beat the forecast without it. When interest on Google runs above normal the coming days' forecast goes up a little, and down when it runs below, never by more than a fifth. It's learned again every night, and tapping a day on Sales & forecast shows the line **Interest on Google** when it's moving that day.`,
    related: ["sales.scorecard", "sales.scorecard.numbers", "sales.scorecard.weather"],
    keywords: ["google", "listing", "direction requests", "search", "website", "correlation", "leading", "signal"],
  },
  {
    id: "sales.scorecard.miss",
    area: "sales",
    route: "/sales/scorecard",
    title: "Typical daily miss",
    body: "All the daily misses added up, as a share of all the sales in the period. Lower is better: under 15% is good for a taproom's daily sales.",
    related: ["sales.scorecard"],
  },
  {
    id: "sales.scorecard.skill",
    area: "sales",
    route: "/sales/scorecard",
    title: "Against “same day last week”",
    body: "How much closer the forecast is than simply repeating last week's same weekday, on the days both have a number. Worse than that yardstick means the method needs work.",
    related: ["sales.scorecard"],
  },
  {
    id: "sales.scorecard.within",
    area: "sales",
    route: "/sales/scorecard",
    title: "Within 15% of actual",
    body: "The share of days the forecast landed within 15% of what sold, and whether it leans high or low overall.",
    related: ["sales.scorecard"],
  },
  {
    id: "sales.scorecard.ahead",
    area: "sales",
    route: "/sales/scorecard",
    title: "How far ahead",
    body: "The same replay for a forecast made the day before, a week ahead and two weeks ahead, beside the plain yardstick. Schedules and orders rely on the further ones.",
    related: ["sales.scorecard"],
  },
  {
    id: "sales.scorecard.weather",
    area: "sales",
    route: "/sales/scorecard",
    title: "By weather",
    body: "Each scored day grouped by its weather. Sales ran shows how far actual sales were over or under a forecast made without weather, which is the effect of that weather here.",
    article: `A day is named by the worst of its weather: snow (an inch or more), heavy rain (over 0.6 in), rain (0.2 to 0.6 in), hot (86°F or more), freezing (a high of 32°F or below), otherwise fair.

Past weather is NOAA's daily record at Albany International Airport, about 35 miles north, which runs about five days behind. It has each day's total rain, not the hours it fell, and a shower in Albany can miss Catskill, so read these as the broad effect of a wet or snowy day. The forecast for the coming week is the National Weather Service's for Catskill itself, and there rain counts from 11am to 9pm.

Groups with only a handful of days are greyed, because a few days can't tell you much.

**What the forecast does about it.** For each kind of weather, Ops works out how far sales ran from the forecast on those days compared with fair days. A kind with few days is pulled toward no effect, so a handful of snow days can't swing a forecast. Then every past day is replayed using only the days before it. A kind is switched **On** only if that replay landed closer than the forecast without it; otherwise it stays **Off** and changes nothing. This is learned again every night. Four or more days out the weather forecast is a chance of rain, not an amount, so only part of the effect is applied.`,
    related: ["sales.scorecard", "sales.weather"],
  },
  {
    id: "sales.scorecard.groups",
    area: "sales",
    route: "/sales/scorecard",
    title: "By weekday, month and event days",
    body: "Where the forecast is weakest. Sales ran over means the forecast was too low for those days; under means too high.",
    related: ["sales.scorecard"],
  },
  {
    id: "sales.scorecard.logged",
    area: "sales",
    route: "/sales/scorecard",
    title: "Forecasts as they were made",
    body: "Each night Ops keeps its forecast for the next two weeks exactly as it stood, then scores it once those days have sold. Unlike the replay, this includes the weather forecast.",
    related: ["sales.scorecard"],
  },
  {
    id: "sales.scorecard.days",
    area: "sales",
    route: "/sales/scorecard",
    title: "Every scored day",
    body: "One row per open day: the forecast made the evening before, what sold, the weather and whether an event was on. Filter by weekday, weather or year, and sort to find the biggest misses.",
    related: ["sales.scorecard"],
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
    body: "Link Square, QuickBooks, Google, Instagram and Facebook, the website, email, phone notifications and AI features, grouped by what they're for. Each card says what it turns on and opens a step-by-step guide. Keys you paste are stored locked (encrypted) and never shown again.",
    article: `Every connection is optional — the app works without them, each one just turns more on. The cards are grouped by what they're for.

**Sales and money**
- **Square** — sales, the menu and timecards, brought in by themselves. About 6 minutes.
- **QuickBooks** — approved supplier invoices go to QuickBooks Online as bills. About 20 minutes, plus a review by Intuit.

**Online**
- **Google** — everything Google on [one page](/settings/connections/google): one sign-in for Search Console and your Google listing, and one key for Google reviews.
- **Instagram & Facebook Page** — followers and how far posts travel, from one Facebook sign-in.
- **Website** — the public website refreshes the moment you save. About 5 minutes.

**Messages and helpers**
- **Email** — orders to suppliers, schedules and the weekly brief by email. About 10 minutes plus a short wait.
- **Phone notifications** — alerts on phones. One tap, then a minute per phone.
- **AI features** — invoice reading, review replies and Ask. About 3 minutes.

Press **Set up** on a card. The guide shows exactly where to click on the other site (numbered circles), gives you copy buttons for anything you need to paste there, and a box to paste what you bring back. Each box checks the value as you paste it and says plainly if it looks wrong — for example a code pasted into the wrong box.

**Manage** on a card that's working shows what it's connected to, a **Test** button, and **Replace** or **Remove** for each key — the setup steps are one tap away under **Show the setup steps**. Square's **Manage** opens the [Square page](/settings/square).

**Test connection** on each card tries the service for real and tells you what happened. If the place the app is hosted blocks outside connections, the test says so — what you saved stays saved.

**Is it safe?** Keys are encrypted before they're saved, only the last four characters are ever shown, and only managers can open this page. **Replace** swaps a key; **Remove** turns that feature off.

Whoever hosts the app can still set the same keys as hosting settings instead; a key pasted here takes priority.`,
    related: ["settings.connections.square", "settings.connections.email", "settings.connections.push", "settings.connections.ai", "settings.google", "settings.connections.quickbooks"],
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
    route: "/settings/connections/google",
    title: "Google reviews key",
    body: "Brings in new Google reviews every morning. Create a free Google Cloud project, turn on Places API (New) and paste the key. When your Google listing is picked under the Google sign-in, reviews follow that listing and there's nothing to find; otherwise use Find your business. The search doubles as the test.",
    related: ["reviews.import", "settings.google"],
    keywords: ["google", "places", "place id", "reviews", "maps"],
  },
  {
    id: "settings.google",
    area: "settings",
    route: "/settings/connections/google",
    title: "Google",
    body: "Everything Google on one page. Google needs two things from you: one Google sign-in, which covers Search Console, your Google listing and Google Analytics, and one key, which brings in Google reviews. Nothing is ever posted or changed on Google.",
    article: `Open it from **Settings → Connections → Google**. The line at the top counts where things stand, like *3 working · 1 waiting on Google · 1 coming next*.

Each part says its state, which page it feeds, when it last read from Google (or what went wrong, in plain words) and the one thing to do next. The full steps sit under **How to set this up**, open while a part isn't set up and folded away once it works.

- **Your Google sign-in** — made once in Google Cloud (Client ID and secret), then the owner presses **Connect Google**. Search Console, the Google listing and Google Analytics all use it. If it ever needs connecting again, the rows under it wait for it instead of each showing an error.
- **Search Console** — the searches that show the website. Feeds Online → Overview.
- **Google listing** — how the listing is seen and used on Search and Maps. Feeds Online → Google listing. Google approves access by hand, usually within two weeks; until then it says **Waiting on Google**, which is not an error. When Google emails, press **Find again**.
- **Google Analytics** — coming next. To get ready, whoever runs the Google Analytics property adds the sign-in's Google account as a **Viewer** (Admin → Property access management → Add users) and notes the property ID (Admin → Property details).
- **Google reviews key** — a Places API key. Reviews follow the Google listing picked above, so there's one business, not two; **Find your business** is only needed when no listing is picked. Feeds Reviews. Google only shares the five most relevant reviews at a time.`,
    related: ["website.analytics.googleSetup", "settings.connections.google", "online.google", "settings.connections"],
    keywords: ["google", "search console", "business profile", "listing", "maps", "reviews", "places", "analytics", "ga4", "sign-in", "oauth", "waiting on google"],
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
    route: "/settings/people",
    title: "Team logins",
    body: "Everyone signs in with their name and a 4–8 digit PIN. Staff see their shifts, counts, waste, prep, kegs, shift notes, checklists and help; managers see everything. Rename, change access, set a new PIN (it unlocks a locked login), switch a login off or add one here.",
    related: ["app.roles"],
  },
  {
    id: "settings.suppliers",
    area: "settings",
    route: "/settings/suppliers",
    title: "Suppliers",
    body: "Delivery days and lead time decide when each order is due and how many days it covers. Minimum order warns you when an order is too small. You can also add a supplier straight from an invoice — including stores like Price Chopper.",
    article: `- **Type** — **Distributor** sends a price sheet (Sysco, Hudson Valley Foodservice); **Local** is a farm, bakery or store run like Price Chopper. It shows on each supplier and you can filter by it. A store added from a receipt (or a known store like Price Chopper) starts as Local.
- **Delivery days** — the weekdays the truck comes.
- **Lead time** — how many days before delivery the order must be in. A 1-day lead time means today's order arrives on the next delivery day from tomorrow on. Brewery suppliers keep their own lead time (days before brew, dry-hop or packaging day) on the Brewery's ordering page; the two never overwrite each other.
- **Minimum order** — the order builder warns when you're under it.
- **Email** — lets you email orders in one tap.
- **Type** — distributor (big price sheets) or local (farms, bakeries; prices updated by hand).
- **Orders** — Every delivery, or When stock runs low (only reminds you when something runs short). See [Every delivery or when stock runs low](/help/ordering.cadence).
- **Ordering and reminders** (tap a supplier) — when and whom to remind, and **Send orders by**: email, text, their website or a phone call.
- **Staff who can place orders** — at the bottom: those staff get a guided order screen on their phone.

Brewery suppliers (malt, hops, yeast) are listed apart under **Brewery suppliers, ordered from the Brewery** and stay off kitchen ordering, counts and reminders.`,
    related: ["ordering.builder.window", "overview.deliveries", "ordering.cadence", "ordering.reminders", "ordering.sendBy", "ordering.staff"],
  },
  {
    id: "settings.target",
    area: "settings",
    route: "/settings/food",
    title: "Food cost target",
    body: "The default food cost % for every menu item. Items can override it on the menu page or in the recipe.",
    related: ["menu.list.target"],
  },
  {
    id: "settings.clear",
    area: "settings",
    route: "/settings/data",
    title: "Clear all data",
    body: "Removes every ingredient, price, recipe, sale, count and order — handy after trying the demo. Logins are kept.",
  },
  {
    id: "settings.page",
    area: "settings",
    route: "/settings",
    title: "Settings",
    body: "Everything you set once and rarely touch, grouped: business, people & pay, food & ordering, money, insights, connections, notifications and data. Each line shows its current value; search finds any setting by name.",
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
    route: "/settings/notifications",
    title: "Notifications",
    body: "Choose which alerts you get by email and on your phone: schedules, shift changes, the weekly brief, price spikes, invoice issues, staff requests and low reviews. Staff turn theirs on from Today or Me.",
    related: ["settings.notify.events"],
  },
  {
    id: "settings.laborRules",
    area: "settings",
    route: "/settings/pay",
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
    body: "Whether phone and computer notifications are available. Once set up, each person turns them on for their own device, here or on Me (staff).",
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
    title: "Everything that comes in",
    body: "Every kind of data the app keeps from Square, how much is in, and what it's used for. \"Nothing yet\" means that kind hasn't come in — usually the first import hasn't reached it, or Square has none.",
    article: `What comes in: menu items and their prices, modifiers and add-ons, sales by item by day, orders and sales by hour, card fees, card and declared cash tips, comps and discounts, team members with their jobs and pay rates, and timecards with breaks.

Timecards and declared cash tips only come in if people clock in on Square. Everything keeps itself up to date — through the day, every night, and within seconds once instant updates are on.`,
    related: ["sales.backfill", "settings.square.sync"],
    keywords: ["what syncs", "data", "modifiers", "tips", "fees", "discounts", "comps", "timecards", "team"],
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
