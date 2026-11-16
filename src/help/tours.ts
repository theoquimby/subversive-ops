/**
 * Guided tours. A step points at an element by its `data-tour` attribute
 * (`target`) or, for markup we don't own, a CSS selector. The first *visible*
 * match is used, so a column hidden on phones simply falls back to a centered
 * card. See ./README.md for how to add one.
 */

export type TourPlacement = "top" | "bottom" | "left" | "right" | "auto";

export interface TourStep {
  /** Matches `[data-tour="…"]`. */
  target?: string;
  /** Any CSS selector, used when `target` is absent (e.g. grid cells). */
  selector?: string;
  /** Navigate here before the step if the current path differs. */
  route?: string;
  /**
   * Navigate to the href of the first visible `[data-tour=routeFrom]` link on
   * the *current* page (e.g. "the first recipe"). Used for dynamic routes.
   */
  routeFrom?: string;
  title: string;
  body: string;
  placement?: TourPlacement;
  /** When the element never appears: show the card centered (default) or skip the step. */
  ifMissing?: "center" | "skip";
  /** Help article for "Learn more". */
  helpId?: string;
  /**
   * Copy for the phone/tablet layout (bottom tabs, no sidebar, usually no
   * keyboard), used below the `lg` breakpoint instead of `title` / `body`.
   */
  touch?: { title?: string; body?: string };
}

export interface Tour {
  id: string;
  title: string;
  description: string;
  audience: "manager" | "all";
  /** Rough minutes, shown in the help center. */
  minutes: number;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    id: "today",
    title: "Your day in the app (staff)",
    description: "Today, your shifts, the floor tools and getting alerts on your phone.",
    audience: "all",
    minutes: 1,
    steps: [
      { route: "/my", target: "my.next-shift", title: "Your next shift", body: "When you start, a live countdown, and who's on with you. During the shift it shows how long is left.", helpId: "my.nextShift", ifMissing: "skip" },
      { route: "/my", target: "my.quick", title: "One tap to the floor", body: "Scan a keg, the prep list, log waste, start a count, a shift note. What you use most comes first.", helpId: "my.quick" },
      { route: "/my", target: "my.todo", title: "For you", body: "Documents to sign, certificates to upload, training steps and shifts up for grabs. Tap one to do it. Empty means you're caught up.", helpId: "my.todo" },
      { route: "/my", target: "my.setup", title: "Make it an app", body: "Add it to your Home Screen and turn on notifications to hear about new schedules and swaps.", helpId: "my.setup", ifMissing: "skip" },
      { selector: 'nav[aria-label="Main"]', title: "Always at the bottom", body: "Today, Shifts, Scan and Prep. More has counts, waste, kegs, shift notes and Me.", placement: "top", ifMissing: "skip" },
      { route: "/my/shifts", target: "my.open", title: "Pick up or swap a shift", body: "Open shifts for your positions: first to tap gets it. Tap Swap on one of yours to give it away.", helpId: "my.openShifts", ifMissing: "skip" },
      { route: "/my/shifts", target: "my.time-off", title: "Time off and sick days", body: "Ask for days off early, or tap I'm out sick to log it for today. Your sick leave balance is right above.", helpId: "my.timeOff" },
      { title: "No signal? Keep going", body: "Counts, waste, prep ticks and keg scans wait on your phone and send themselves when you're back in range.", helpId: "my.offline" },
    ],
  },
  {
    id: "prep",
    title: "The prep list",
    description: "What to make today and why, ticking it off, and keeping on hand right.",
    audience: "all",
    minutes: 1,
    steps: [
      { route: "/prep", target: "prep.list", title: "Today's prep, by station", body: "Each line is how much to make — rounded to batches — and why: the dishes forecast to use it, minus what's on hand. Whatever runs out first is at the top.", helpId: "prep.page", ifMissing: "skip" },
      { route: "/prep", target: "prep.tick", title: "Tap when it's made", body: "The circle ticks it off with your name and the time. Tap again to undo. No signal? It's sent when you're back in range.", helpId: "prep.progress", ifMissing: "skip" },
      { route: "/prep", target: "prep.line", title: "Make more or less", body: "Tap the line to change the amount, type what's on hand now, or open the recipe scaled to what you're making.", helpId: "prep.adjust", ifMissing: "skip" },
      { title: "Count what matters before prep", body: "On hand is the last count, plus batches made, minus what sales used and waste. A quick count on the busiest sauces keeps the list honest.", helpId: "prep.onHand" },
      { route: "/prep", target: "prep.tabs", title: "Pars, shelf life, stations", body: "Managers set each item's par, how long it keeps, how it rounds and its station on Prep setup — inline, like a spreadsheet.", helpId: "prep.setup", ifMissing: "skip" },
    ],
  },
  {
    id: "brief",
    title: "Your morning brief",
    description: "Yesterday, today and what to get done before tonight, on one page.",
    audience: "manager",
    minutes: 1,
    steps: [
      { route: "/brief", target: "brief.morning", title: "Your day on one page", body: "This is pushed to your phone each morning. Read it top to bottom: yesterday, today, then what to do.", helpId: "brief.morning" },
      { route: "/brief", target: "brief.yesterday", title: "Yesterday in a line", body: "Sales against forecast, labor and an estimated profit. Badges flag anything unusual, including what the shift notes said.", helpId: "brief.yesterday" },
      { route: "/brief", target: "brief.today", title: "Today", body: "The forecast, the busiest hours, weather and events, and who's on against what the forecast needs.", helpId: "brief.today" },
      { route: "/brief", target: "brief.tonight", title: "Before tonight", body: "Order deadlines, drafts to send, deliveries to check in, invoices and kegs. Tap one to do it.", helpId: "brief.tonight" },
      { route: "/brief", target: "brief.notes", title: "Last night's notes", body: "The handoff from the closing crew. Mark follow-ups handled right here.", helpId: "brief.notes", ifMissing: "skip" },
      { route: "/brief", target: "brief.tabs", title: "This week", body: "The weekly brief lives one tap away: last week against budget and everything to sort before next week.", helpId: "brief.page" },
    ],
  },
  {
    id: "notes",
    title: "Leaving a shift note",
    description: "The end-of-shift handoff in about a minute.",
    audience: "all",
    minutes: 1,
    steps: [
      { route: "/notes", target: "notes.composer", title: "At the end of every shift", body: "Pick the shift, tap the chips that fit, add what was 86'd, comps and the drawer. Save. That's it.", helpId: "notes.composer" },
      { route: "/notes", target: "notes.history", title: "Every note, searchable", body: "Search any word: an item, a name, \"ice machine\". Managers can show just the ones still to follow up.", helpId: "notes.history" },
      { title: "It's in tomorrow's brief", body: "Managers see last night's notes first thing, in the morning brief and on the Overview.", helpId: "notes.page" },
    ],
  },
  {
    id: "kegs",
    title: "Scanning kegs",
    description: "Kick a keg in one tap, put the next one on, and find any keg in the walk-in.",
    audience: "all",
    minutes: 1,
    steps: [
      { route: "/kegs", target: "kegs.scan-button", title: "One button", body: "When a keg kicks, goes on tap, or moves, scan it. That's all anyone has to remember.", helpId: "kegs.scan", touch: { body: "When a keg kicks, goes on tap, or moves, scan it. Scan is also in the tabs at the bottom." } },
      { route: "/kegs/scan", target: "kegs.camera", title: "Point at the sticker", body: "The camera reads the QR code by itself. Old stickers from the previous app work too.", helpId: "kegs.scan" },
      { route: "/kegs/scan", target: "kegs.type", title: "No camera? Type it", body: "The code is printed under the QR, like 7Q3-MX. Dashes don't matter.", helpId: "kegs.scan", ifMissing: "skip" },
      { title: "The big button is the usual next step", body: "On tap: Kicked — one tap. Then it offers the next keg of the same beer and says exactly where it is. Undo stays up for 10 seconds.", helpId: "kegs.scan" },
      { route: "/kegs", target: "kegs.taps", title: "What's on tap", body: "Each line, how long it's been on and about how much is left, worked out from Square pours.", helpId: "kegs.taps", ifMissing: "skip" },
      { route: "/kegs/cooler", target: "kegs.find", title: "Find any beer", body: "Pick a beer and the oldest full keg of it lights up, with its spot written out.", helpId: "kegs.cooler" },
    ],
  },
  {
    id: "insights",
    title: "The Insights Lab",
    description: "One thing to do at a time, how the numbers connect, and what each tile tells you.",
    audience: "manager",
    minutes: 2,
    steps: [
      { route: "/insights", title: "Your numbers, one thing at a time", body: "The Lab reads your Square sales, timecards and costs every night and turns them into specific moves, each with the dollars and the reason." },
      { route: "/insights", target: "insights.hero", title: "Today's one thing", body: "The best move right now. Read it top to bottom: what's happening, why we think so, what to do, what you'd gain.", helpId: "insights.hero", placement: "bottom" },
      { route: "/insights", target: "insights.do-it", title: "Decide, then the next one comes", body: "Do it when you've done it (we'll track the result), Remind me later for two weeks, or Not for us — you'll see fewer like it.", helpId: "insights.hero", ifMissing: "skip" },
      { route: "/insights", target: "insights.queue", title: "Up next", body: "Everything else, one card per root cause, rated with dots for money, certainty and effort.", helpId: "insights.rating", ifMissing: "skip" },
      { route: "/insights", target: "insights.sort", title: "Look at it your way", body: "Sort by money saved, money earned, easiest first or most certain — or pick one area like Staffing.", helpId: "insights.queue", ifMissing: "skip" },
      { route: "/insights", target: "insights.range", title: "How much history", body: "Every model learns from this much history. Three years shows the shape of your year; change it and everything is worked out again.", helpId: "insights.range" },
      { route: "/insights", target: "insights.flow", title: "How it all connects", body: "Guests bring sales; food, drink and wages come off; the rest is yours.", helpId: "insights.story", ifMissing: "skip" },
      { route: "/insights", target: "insights.whatif", title: "Try it", body: "Pull a lever — 2% on prices, one fewer wage hour a day — and watch the chain and your profit move.", helpId: "insights.whatif", ifMissing: "skip", placement: "top" },
      { route: "/insights", target: "insights.lab", title: "The Lab", body: "One question per tile. Open “Show me how” for the evidence. Locked tiles list exactly what unlocks them, with a button that goes there.", helpId: "insights.lab", placement: "top" },
      { route: "/insights", target: "insights.track", title: "Your track record", body: "What you've done and what it was worth — with a before-and-after for price changes.", helpId: "insights.track", ifMissing: "skip", placement: "top" },
    ],
  },
  {
    id: "overview",
    title: "Overview",
    description: "The dashboard, where everything lives, and how to get help.",
    audience: "manager",
    minutes: 1,
    steps: [
      { route: "/", title: "Welcome to Subversive Ops", body: "A one-minute look around. Use → or Next to move on, ← to go back, Esc to stop any time." },
      { route: "/", selector: "aside nav, nav", title: "Everything lives here", body: "Menu costs, prices, ordering, counts and the rest, grouped in the sidebar.", placement: "right", touch: { body: "The tabs along the bottom are the pages you'll use most. More has everything else: menu costs, prices, counts, settings and the rest." } },
      { route: "/", target: "overview.today", title: "Today, live", body: "Sales so far, whether you're ahead of or behind the forecast for this time of day, and where the day will likely close.", helpId: "overview.today" },
      { route: "/", target: "overview.needs", title: "What needs you", body: "Orders due soon, invoices to approve, staff requests and the rest, most urgent first. When it's empty, you're clear.", helpId: "overview.needs" },
      { route: "/", target: "overview.notes", title: "Last night", body: "What the closing crew left in their shift notes: 86'd items, fixes, comps and the drawer. Amber means follow up.", helpId: "overview.notes", ifMissing: "skip" },
      { route: "/", target: "overview.stats", title: "The week at a glance", body: "Each of the last 7 days against its forecast, then profit, labor, food cost and rating against the week before.", helpId: "overview.week" },
      { route: "/", target: "overview.price-changes", title: "Price moves", body: "The biggest supplier price changes in the last 30 days. Every recipe using them has already been recosted.", helpId: "overview.priceChanges" },
      { route: "/", target: "overview.over-target", title: "Over target", body: "Menu items whose food cost % is above target. Tap one to open its recipe and see the price that would hit target.", helpId: "overview.overTarget" },
      { title: "Jump anywhere with ⌘K", body: "Press ⌘K (Ctrl+K) or / to search any recipe, ingredient or supplier, or start a task like \"Import a price sheet\".", helpId: "app.commandBar", touch: { title: "Search finds anything", body: "Tap the magnifying glass at the top to find any recipe, ingredient or supplier, or start a task like \"Import a price sheet\"." } },
      { title: "Help is always one key away", body: "Press ? to turn on help mode, then point at anything to see what it does. The help center has every article and more tours.", helpId: "app.helpMode", touch: { title: "Help is always one tap away", body: "Tap the ? at the top for help mode, then tap anything to see what it does. The help center (under More) has every article and more tours." } },
    ],
  },
  {
    id: "pnl",
    title: "Reading the P&L",
    description: "Profit, where the money went, what moved and why.",
    audience: "manager",
    minutes: 1,
    steps: [
      { route: "/pnl", target: "pnl.headline", title: "The bottom line", body: "Profit before rent for the period, against the same days last week and a year ago. The bars show sales, each cost taken off, and what was left.", helpId: "pnl.headline" },
      { route: "/pnl", target: "pnl.stats", title: "The four ratios", body: "Net sales, labor %, prime cost % and sales per labor hour, each with its change against the period before.", helpId: "pnl.kpis" },
      { route: "/pnl", target: "pnl.notes", title: "What moved", body: "Plain-English notes worked out from the numbers: why labor % moved, the best day, days that lost money.", helpId: "pnl.notes", ifMissing: "skip" },
      { route: "/pnl", target: "pnl.trend", title: "Twelve weeks", body: "Each week's sales split into cost, labor and profit. Tap a week to see its numbers.", helpId: "pnl.trend", ifMissing: "skip", placement: "top" },
      { route: "/pnl", target: "pnl.split", title: "Food and drink", body: "Food and drinks each against their own target. Hatched means not linked to a recipe yet, so the cost is estimated.", helpId: "pnl.split", ifMissing: "skip", placement: "top" },
    ],
  },
  {
    id: "month-end",
    title: "Closing the month",
    description: "The checklist, sales tax, stock value, tips owed and the accountant pack.",
    audience: "manager",
    minutes: 1,
    steps: [
      { route: "/accounting", target: "accounting.period", title: "Pick the period", body: "A month, a sales tax quarter or any dates. The page and the accountant pack follow it.", helpId: "accounting.page" },
      { route: "/accounting", target: "accounting.stats", title: "The period at a glance", body: "Net sales, tax Square collected, actual cost of goods from your counts, and card tips still owed to the team.", helpId: "accounting.stats" },
      { route: "/accounting", target: "accounting.checklist", title: "What's left to do", body: "Invoices, the end-of-month count, tips, payroll and Square sales. Tap a line to go and fix it.", helpId: "accounting.checklist" },
      { route: "/accounting", target: "accounting.inventory", title: "Actual cost of goods", body: "Stock at the start, plus approved invoices, minus stock at the end, valued at the prices on file.", helpId: "accounting.inventory", placement: "top" },
      { route: "/accounting", target: "accounting.tax", title: "Sales tax", body: "Tax collected by month, with taxable sales worked out from your rate. The rate and quarters are settings to check with your accountant.", helpId: "accounting.salesTax", placement: "top" },
      { route: "/accounting", target: "accounting.journal.toggle", title: "Sales to QuickBooks", body: "Off until you turn it on. Preview each day's entry, pick the accounts, then send. Re-sending only updates what changed.", helpId: "accounting.journal", ifMissing: "skip" },
      { route: "/accounting", target: "accounting.pack", title: "One file for your accountant", body: "Everything above in one Excel file, a tab per subject.", helpId: "accounting.pack", touch: { body: "Everything on this page in one Excel file, a tab per subject." } },
    ],
  },
  {
    id: "menu",
    title: "Menu costs & the recipe editor",
    description: "Plate costs, food cost targets, and building a recipe with quick add.",
    audience: "manager",
    minutes: 2,
    steps: [
      { route: "/menu", target: "menu.tabs", title: "Three kinds of recipe", body: "Menu items you sell, add-ons (Square modifiers), and prep recipes like sauces and doughs that go inside other recipes.", helpId: "menu.tabs" },
      { route: "/menu", target: "menu.table", title: "Live plate costs", body: "Every cost here updates on its own when a supplier price changes. The 30-day column shows how much each one moved.", helpId: "menu.list" },
      { route: "/menu", selector: 'input[data-grid="menu"][data-col="price"]', title: "Edit prices in place", body: "Click a price, type, press Enter. It saves on its own and Enter moves to the next row — you can even paste a column of prices from a spreadsheet.", helpId: "app.grids" },
      { route: "/menu", selector: 'input[data-grid="menu"][data-col="target"]', title: "Food cost vs target", body: "Food cost % is cost ÷ price, red when over target. Each item can have its own target; blank uses the default.", helpId: "menu.list.target", ifMissing: "skip" },
      { routeFrom: "menu.recipe-link", target: "menu.summary", title: "Inside a recipe", body: "Plate cost, food cost, margin, and the menu price that would hit your target — all recalculated as you edit.", helpId: "menu.editor.summary" },
      { target: "menu.lines", title: "Recipe lines", body: "Each ingredient or prep recipe with its amount and unit. The cost on the right already includes trim and cook loss (yield).", helpId: "menu.editor.lines" },
      { target: "menu.quick-add", title: "Quick add", body: "Type \"6 oz ground beef\" and press Enter — or paste a whole ingredient list and every line is added at once.", helpId: "menu.editor.quickAdd", placement: "top" },
      { target: "menu.details", title: "Details", body: "Name, type, category, menu price and this item's own target. Prep recipes set their batch yield here.", helpId: "menu.editor.details" },
      { target: "menu.history", title: "Cost over time", body: "This recipe's cost every week for six months, rebuilt from price history.", helpId: "menu.editor.history", ifMissing: "skip" },
      { title: "Saving", body: "When you change anything, a bar appears at the bottom with Save and Discard. Nothing changes until you press Save.", helpId: "menu.editor" },
    ],
  },
  {
    id: "prices",
    title: "Importing a price sheet",
    description: "Bring in a distributor's price list and see every change before it's saved.",
    audience: "manager",
    minutes: 2,
    steps: [
      { route: "/prices", target: "prices.filters", title: "All your prices", body: "Search by name or item number, filter by supplier or by products not linked to an ingredient yet, and sort by any column.", helpId: "prices.filters" },
      { route: "/prices", selector: 'input[data-grid="prices"][data-col="price"]', title: "Change one price", body: "Type a new price and press Enter. It's saved as of today and the old price is kept in history.", helpId: "prices.list.price", ifMissing: "skip" },
      { route: "/prices", target: "prices.import-button", title: "Import a whole sheet", body: "For distributors, download their price list and bring it in here as-is.", helpId: "prices.import" },
      { route: "/prices/import", target: "prices.import.supplier", title: "1 · Whose sheet", body: "Pick the supplier. Item numbers are matched to their products, and the column layout is remembered for them.", helpId: "prices.import.supplier" },
      { route: "/prices/import", target: "prices.import.file", title: "2 · Drop the file", body: "Excel or a .csv spreadsheet file, exactly as downloaded. No tidying needed.", helpId: "prices.import.file" },
      { route: "/prices/import", target: "prices.import.effective", title: "3 · When prices start", body: "Usually today. Pick a later date for next week's pricing — costs before then keep the old prices.", helpId: "prices.import.effective" },
      { route: "/prices/import", target: "prices.import.preview", title: "4 · Preview", body: "Reads the sheet and shows what would change. Nothing is saved yet.", helpId: "prices.import" },
      { target: "prices.import.columns", title: "Columns are detected", body: "Item number, description and price are required; pack size and unit are optional. Fix a wrong guess and the preview refreshes. It's remembered next time.", helpId: "prices.import.columns" },
      { target: "prices.import.diff", title: "See every change", body: "Price changes biggest first, new products, unchanged and skipped rows. Press Save prices and plate costs update at once. New products then need linking to ingredients.", helpId: "prices.import.diff" },
    ],
  },
  {
    id: "ordering",
    title: "Ordering",
    description: "How suggested orders are worked out, adjusting them, sending and checking in.",
    audience: "manager",
    minutes: 2,
    steps: [
      { route: "/ordering", target: "ordering.today", title: "Today", body: "Deadlines in the next 48 hours, drafts to send and deliveries to check in, each with one button.", helpId: "ordering.today" },
      { route: "/ordering", target: "ordering.suppliers", title: "Every supplier in one table", body: "Soonest deadline first, with time left, order status and the suggested order. Edit delivery days, minimum, email and auto-draft in the row; tap a row for details.", helpId: "ordering.board" },
      { route: "/ordering", target: "ordering.toolbar", title: "Filter, group, select", body: "Show only today's deadlines or suppliers that need an order, group by delivery day, or tick several and draft their orders at once.", helpId: "ordering.board.bulk", ifMissing: "skip" },
      { routeFrom: "ordering.supplier-card", target: "ordering.window", title: "Delivery and cover", body: "When the truck comes, and the last day this order needs to last — normally until the next delivery. Change either and the order recalculates.", helpId: "ordering.builder.window" },
      { target: "ordering.formula", title: "Where the numbers come from", body: "Forecast sales × recipes + your buffer − what you'll still have on delivery day, rounded up to whole packs.", helpId: "ordering.builder.formula" },
      { selector: '[data-tour="ordering.on-hand"]', title: "On hand at delivery", body: "Your last count, plus deliveries, minus what sales and waste used since, minus what's needed before the truck arrives. The note says when it was counted.", helpId: "ordering.builder.onHand" },
      { target: "ordering.qty", title: "Adjust with − and +", body: "Suggestions are in whole cases. Change any of them; changed ones go bold and show the original suggestion.", helpId: "ordering.builder.qty" },
      { target: "ordering.save", title: "Save, then send", body: "The total and item count are here, with a warning if you're under the supplier's minimum. Save makes a draft you can copy, email or download, then mark as sent.", helpId: "ordering.builder.save", placement: "top" },
      { title: "When the truck arrives", body: "Open the order, fix any shorts, and press Check in delivery. What arrived is added to stock until the next count.", helpId: "ordering.po.receive" },
    ],
  },
  {
    id: "counting",
    title: "Counting & waste (staff)",
    description: "Counting stock on a phone and logging waste.",
    audience: "all",
    minutes: 1,
    steps: [
      { route: "/count", target: "count.start", title: "Pick what you're counting", body: "Tap an area like the walk-in, or Everything. If someone already started that area, you'll carry on their count.", helpId: "count.start" },
      { route: "/count", target: "count.in-progress", title: "Pick up where you left off", body: "Counts that aren't finished yet. Everything entered so far is saved.", helpId: "count.inProgress", ifMissing: "skip" },
      { title: "On the count sheet", body: "Type how much is on the shelf. Each number saves the moment you move on — a green tick means it's in, a cloud means it's waiting for signal. Enter jumps to the next item.", helpId: "count.autosave" },
      { title: "Any unit you like", body: "Count in cases, jugs, lb, each — pick it next to the number. Some of each? \"Add another unit\" puts both on one line.", helpId: "count.units" },
      { title: "Not sure what it is?", body: "Tap the item's name for its photo, item number and how to count it. Nothing on the shelf? Tap None.", helpId: "count.item" },
      { title: "Send it when every line is done", body: "The button jumps to whatever's left. Staff counts go to the manager to check; something missing from the list? Tell the manager.", helpId: "count.finish" },
      { route: "/waste", target: "waste.form", title: "Log waste", body: "Anything thrown out: pick the item, how much, and why. It keeps stock and food cost honest.", helpId: "waste.page" },
      { route: "/waste", target: "waste.reasons", title: "Why it was thrown out", body: "One tap for the reason. The form clears the moment you log, so you can do several in a row — even with no signal.", helpId: "waste.reasons" },
    ],
  },
  {
    id: "ingredients",
    title: "Ingredients grid",
    description: "Spreadsheet-style editing, yield, order buffer and count units.",
    audience: "manager",
    minutes: 1,
    steps: [
      { route: "/ingredients", target: "ingredients.search", title: "Find an ingredient", body: "Type part of a name — the grid narrows as you type. Press / from anywhere on the page to jump here.", helpId: "ingredients.search" },
      { route: "/ingredients", selector: 'input[data-grid="ing"][data-col="name"]', title: "It's a spreadsheet", body: "Click any cell and type. It saves when you press Enter or click away — a green tick confirms. Enter moves down, Tab moves across, Esc undoes.", helpId: "app.grids" },
      { route: "/ingredients", selector: 'input[data-grid="ing"][data-col="yield"]', title: "Yield %", body: "How much of what you buy ends up on the plate after trim and cooking. Recipes are costed at purchase cost ÷ yield.", helpId: "ingredients.yield" },
      { route: "/ingredients", selector: 'input[data-grid="ing"][data-col="buffer"]', title: "Order buffer %", body: "Extra ordered on top of the forecast, so a busy night doesn't run you out.", helpId: "ingredients.buffer" },
      { route: "/ingredients", selector: 'button[aria-label="Count unit"]', title: "Count in", body: "The unit staff see first when counting this item.", helpId: "ingredients.countIn" },
      { title: "Paste a column", body: "Copy a column of numbers from Excel or Google Sheets, click the first cell, paste. Each line fills the next row down and saves.", helpId: "app.grids" },
      { route: "/ingredients", selector: 'a[aria-label^="Open "]', title: "Everything else", body: "The arrow opens the ingredient: the products it's bought as, pack sizes, custom units like \"1 slice = 21 g\" and its cost history.", helpId: "ingredients.detail" },
    ],
  },
  {
    id: "training",
    title: "Training & certificates",
    description: "The certificate matrix, adding and verifying cards, certificate types and onboarding checklists.",
    audience: "manager",
    minutes: 2,
    steps: [
      { route: "/team/training", target: "training.stats", title: "How the team stands", body: "Required certificates in date, and how many are expiring within 30 days, expired or missing.", helpId: "training.compliant" },
      { route: "/team/training", target: "training.matrix", title: "Everyone × every certificate", body: "Green is in date (the month it runs to), amber expires within 30 days, red is expired or missing. An amber dot means staff uploaded it and it needs verifying.", helpId: "training.matrix", touch: { body: "Each person is a card listing what they need. Green is in date, amber expires within 30 days, red is expired or missing." } },
      { route: "/team/training", target: "training.filters", title: "Narrow it down", body: "Show one position, or only people who need attention, have something expiring, or uploaded a card that isn't verified yet.", helpId: "training.matrix" },
      { title: "Tap a cell to add or renew", body: "Snap a photo or drop a PDF, pick the issue date and the expiry fills in. A renewal adds a new record and keeps the old one. View the photo and mark it verified from the same sheet.", helpId: "training.addCert" },
      { route: "/team/training", target: "training.types", title: "What you track", body: "How long each certificate lasts and which positions need it. Pre-filled for New York — confirm them before relying on them.", helpId: "training.types" },
      { route: "/team/training", target: "training.module", title: "Onboarding checklists", body: "Steps for a new hire, each with an optional linked document. Assign by position or person; staff tick steps on Me and you sign off.", helpId: "training.modules", ifMissing: "skip" },
      { route: "/team/training", target: "training.new-module", title: "Start a checklist", body: "Type a name like “New bartender” and press Enter, then add the steps.", helpId: "training.modules", ifMissing: "skip" },
      { title: "Reminders and warnings", body: "People and managers hear about certificates 30 and 7 days before they expire. The weekly brief lists what's due, and the schedule warns if someone's on a shift without a certificate their position needs.", helpId: "training.reminders" },
    ],
  },
  {
    id: "private-events",
    title: "Private events",
    description: "Take an inquiry, build and send the quote, record the deposit and confirm.",
    audience: "manager",
    minutes: 2,
    steps: [
      { route: "/events/private", target: "private.new", title: "Someone wants a party", body: "Type their name, an email or phone, the date and guests, and press Add inquiry. It opens the booking.", helpId: "events.private.new" },
      { route: "/events/private", target: "private.bookings", title: "Every booking", body: "Stage, guests, space and owner change right in the row. Next step says what to do.", helpId: "events.private.table" },
      { route: "/events/private", target: "private.view", title: "Table or board", body: "The board shows a column per stage, with a button to move each booking along.", helpId: "events.private.board", ifMissing: "skip" },
      { routeFrom: "private.row-link", target: "private.stages", title: "Stages", body: "Inquiry → Quoted → Deposit paid → Confirmed → Done. Moving forward checks it has what it needs.", helpId: "events.private.stages", ifMissing: "skip" },
      { target: "private.quote", title: "Build the quote", body: "Add a package or menu items, then the bar, room fee, service charge and deposit.", helpId: "events.private.quote", ifMissing: "skip" },
      { target: "private.totals", title: "Totals and margin", body: "What the client pays, and — just for you — food cost and margin from your recipes.", helpId: "events.private.totals", ifMissing: "skip" },
      { target: "private.share", title: "Send it", body: "Copy the link to text it, or email it. The client can open, print and accept it.", helpId: "events.private.share", ifMissing: "skip" },
      { target: "private.payments", title: "Record the deposit", body: "Once it's in, the booking moves to Deposit paid. Confirm it and it goes on the calendar and the forecast.", helpId: "events.private.payments", ifMissing: "skip" },
      { route: "/events/private/setup", target: "private.packages", title: "Packages & defaults", body: "Per-guest packages with their recipes, your spaces, and the tax, service charge and deposit new quotes start with.", helpId: "events.private.setup" },
    ],
  },
  {
    id: "website",
    title: "The website, from Ops",
    description: "What guests see on the website and where you change it: hours, the notice, the menu, events and inquiries.",
    audience: "manager",
    minutes: 2,
    steps: [
      { route: "/website", target: "website.live", title: "What's live", body: "Today's hours, what's on the website menu, upcoming events and new inquiries, read from the same feeds the website reads.", helpId: "website.page" },
      { route: "/website", target: "website.connection", title: "The connection", body: "The website refreshes every 5 minutes on its own. With its address and secret in Connections, it refreshes the moment you save. Each feed shows a count so you can see it's working.", helpId: "website.connection", ifMissing: "skip" },
      { route: "/website/hours", target: "website.notice", title: "The notice", body: "One line at the top of the site for a closure or a change. Pick the last day and it comes down by itself.", helpId: "website.notice" },
      { route: "/website/hours", target: "website.hours", title: "Exact hours and kitchen close", body: "Opening hours come from Settings → Business. Type 4:30pm or when the kitchen stops orders here.", helpId: "website.hours" },
      { route: "/website/menu", target: "website.menu", title: "The menu", body: "Turn on the items guests should see and give each a line of description and tags. Prices come from Menu costs.", helpId: "website.menu.items" },
      { route: "/website/menu", target: "website.beer", title: "Draft beer", body: "The draft list is what's on tap right now, from Kegs. Style, ABV and prices come from Kegs → Beers.", helpId: "website.menu.beer", ifMissing: "skip" },
      { route: "/website/events", target: "website.events", title: "Events", body: "Add a picture, a price, a ticket link or a late close to any calendar event. Private bookings never show.", helpId: "website.events" },
      { route: "/website/inquiries", target: "website.inquiries", title: "Inquiries", body: "Party and buyout requests from the website form. Each one is already on Private events.", helpId: "website.inquiries" },
    ],
  },
  {
    id: "webanalytics",
    title: "Website analytics",
    description: "Visits, where they come from, what people do next, and how it lines up with sales and Google.",
    audience: "manager",
    minutes: 1,
    steps: [
      { route: "/website/analytics", target: "webanalytics.kpis", title: "The numbers that matter", body: "People, visits, pages and actions, against the period before. A change is coloured only when it's bigger than normal ups and downs.", helpId: "website.analytics", ifMissing: "skip" },
      { route: "/website/analytics", target: "webanalytics.funnel", title: "Visit to visit-in-person", body: "All visits, the ones that looked at the menu or an event, and the ones that called, got directions, ordered or booked. Look at the biggest drop first.", helpId: "website.analytics.funnel", ifMissing: "skip" },
      { route: "/website/analytics", target: "webanalytics.sources", title: "Where they come from", body: "Google, Maps, Instagram, typed in. The dot is how often those visits act; Better or Lower only shows when it's more than chance.", helpId: "website.analytics.sources", ifMissing: "skip" },
      { route: "/website/analytics", target: "webanalytics.sales", title: "Website and sales", body: "Whether busier website days go with busier days at the taproom, weekday and events allowed for. It never claims more than the numbers show.", helpId: "website.analytics.salesLink", ifMissing: "skip" },
      { route: "/website/analytics", target: "webanalytics.google", title: "Google", body: "Search terms and the Google listing's calls and direction requests, straight from Google once it's connected.", helpId: "website.analytics.google", ifMissing: "skip" },
    ],
  },
  {
    id: "checklists",
    title: "Opening and closing checklists",
    description: "Tick steps on a phone, sign the list off, and see how the last two weeks went.",
    audience: "all",
    minutes: 1,
    steps: [
      { route: "/checklists", target: "checklists.today", title: "Today's lists", body: "Every list that runs today. Yours come first, with who's on the schedule for it.", helpId: "checklists.today" },
      { route: "/checklists", target: "checklists.run", title: "Tick as you go", body: "Each tick saves with your name and the time. The arrow opens the page that helps, like scanning a kicked keg.", helpId: "checklists.page", ifMissing: "skip" },
      { route: "/checklists", target: "checklists.signoff", title: "Sign it off", body: "When it's done, sign it. If something couldn't be done, add a note so the next shift knows.", helpId: "checklists.page", ifMissing: "skip" },
      { title: "The morning after", body: "Managers see the last two weeks here, and a closing list left unfinished shows on the Overview and in the brief.", helpId: "checklists.history" },
    ],
  },
  {
    id: "upkeep",
    title: "Upkeep and repairs",
    description: "Draft lines and other recurring jobs, equipment details and logging a repair.",
    audience: "manager",
    minutes: 1,
    steps: [
      { route: "/upkeep", target: "upkeep.stats", title: "What needs looking after", body: "Jobs overdue or due this week, anything down for repair, and what repairs cost over the last year.", helpId: "upkeep.overdue" },
      { route: "/upkeep", target: "upkeep.jobs", title: "Recurring jobs", body: "Most urgent first. Set when each was last done once; after that, tap Done and the next date moves on.", helpId: "upkeep.jobs" },
      { route: "/upkeep", target: "upkeep.done", title: "Done", body: "Logs it today with your name. The … button logs it with another date, a cost or a note.", helpId: "upkeep.jobs", ifMissing: "skip" },
      { route: "/upkeep", target: "upkeep.repair", title: "When something breaks", body: "Log what broke and what it cost. Out of action shows on the Overview until you mark it fixed.", helpId: "upkeep.log" },
    ],
  },
  {
    id: "beertax",
    title: "Beer tax",
    description: "Where the barrels come from, the tax on them, and marking returns filed.",
    audience: "manager",
    minutes: 1,
    steps: [
      { route: "/beer-tax", target: "beertax.returns", title: "Returns due", body: "Federal excise, the brewer's report and New York beer tax: the last finished period of each and when it's due.", helpId: "beertax.returns" },
      { route: "/beer-tax", target: "beertax.period", title: "Pick a period", body: "Month, quarter or year, to match how you file. The arrows step back and forward.", helpId: "beertax.worksheet" },
      { route: "/beer-tax", target: "beertax.stats", title: "The numbers for the return", body: "Taxable barrels from the keg history, and the federal and New York tax at your rates.", helpId: "beertax.taxable" },
      { route: "/beer-tax", target: "beertax.adjust", title: "Anything not in a keg", body: "Cans from the tank, beer returned or dumped: type the gallons here.", helpId: "beertax.adjustments" },
    ],
  },
];

const BY_ID = new Map(TOURS.map((t) => [t.id, t]));
export const getTour = (id: string) => BY_ID.get(id);
export const toursFor = (role: "MANAGER" | "STAFF") => TOURS.filter((t) => role === "MANAGER" || t.audience === "all");

/** The tour that explains the page at this path, if any ("Tour this page"). */
export function tourForPath(pathname: string): Tour | undefined {
  const map: [RegExp, string][] = [
    [/^\/$/, "overview"],
    [/^\/events\/private/, "private-events"],
    [/^\/website\/analytics/, "webanalytics"],
    [/^\/team\/training/, "training"],
    [/^\/menu/, "menu"],
    [/^\/prices/, "prices"],
    [/^\/ordering/, "ordering"],
    [/^\/(count|waste)/, "counting"],
    [/^\/my/, "today"],
    [/^\/ingredients/, "ingredients"],
    [/^\/insights/, "insights"],
    [/^\/kegs/, "kegs"],
    [/^\/prep/, "prep"],
    [/^\/brief/, "brief"],
    [/^\/notes/, "notes"],
    [/^\/pnl/, "pnl"],
    [/^\/accounting/, "month-end"],
    [/^\/website/, "website"],
    [/^\/checklists/, "checklists"],
    [/^\/upkeep/, "upkeep"],
    [/^\/beer-tax/, "beertax"],
  ];
  const hit = map.find(([re]) => re.test(pathname));
  return hit ? getTour(hit[1]) : undefined;
}
