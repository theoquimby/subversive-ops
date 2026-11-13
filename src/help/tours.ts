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
      { route: "/", target: "overview.stats", title: "The week at a glance", body: "Food cost for what sold in the last 7 days, net sales from Square, items over target, and price increases. Green is good, red needs a look.", helpId: "overview.foodCost" },
      { route: "/", target: "overview.price-changes", title: "Price moves", body: "The biggest supplier price changes in the last 30 days. Every recipe using them has already been recosted.", helpId: "overview.priceChanges" },
      { route: "/", target: "overview.over-target", title: "Over target", body: "Menu items whose food cost % is above target. Tap one to open its recipe and see the price that would hit target.", helpId: "overview.overTarget" },
      { route: "/", target: "overview.deliveries", title: "Next deliveries", body: "When each supplier comes next. Tap one to get a suggested order built from your forecast and last count.", helpId: "overview.deliveries" },
      { title: "Jump anywhere with ⌘K", body: "Press ⌘K (Ctrl+K) or / to search any recipe, ingredient or supplier, or start a task like \"Import a price sheet\".", helpId: "app.commandBar", touch: { title: "Search finds anything", body: "Tap the magnifying glass at the top to find any recipe, ingredient or supplier, or start a task like \"Import a price sheet\"." } },
      { title: "Help is always one key away", body: "Press ? to turn on help mode, then point at anything to see what it does. The help center has every article and more tours.", helpId: "app.helpMode", touch: { title: "Help is always one tap away", body: "Tap the ? at the top for help mode, then tap anything to see what it does. The help center (under More) has every article and more tours." } },
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
      { route: "/ordering", target: "ordering.suppliers", title: "Pick a supplier", body: "Each card shows delivery days and the next delivery, from the supplier's settings.", helpId: "ordering.suppliers" },
      { route: "/ordering", target: "ordering.recent", title: "Recent orders", body: "Drafts, orders sent and waiting for the truck, and deliveries already checked in.", helpId: "ordering.recent", ifMissing: "skip" },
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
      { title: "On the count sheet", body: "Type how much is on the shelf. Each number saves the moment you move on — a green tick means it's in. Enter jumps to the next item.", helpId: "count.autosave" },
      { title: "Any unit you like", body: "Count in cases, lb, each or a custom unit — pick it next to the number. Tap Finish count when you're done.", helpId: "count.units" },
      { route: "/waste", target: "waste.form", title: "Log waste", body: "Anything thrown out: pick the item, how much, and why. It keeps stock and food cost honest.", helpId: "waste.page" },
      { route: "/waste", target: "waste.reasons", title: "Why it was thrown out", body: "One tap for the reason. The form clears after each log so you can do several in a row.", helpId: "waste.reasons" },
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
      { route: "/team/training", target: "training.module", title: "Onboarding checklists", body: "Steps for a new hire, each with an optional linked document. Assign by position or person; staff tick steps on My shifts and you sign off.", helpId: "training.modules", ifMissing: "skip" },
      { route: "/team/training", target: "training.new-module", title: "Start a checklist", body: "Type a name like “New bartender” and press Enter, then add the steps.", helpId: "training.modules", ifMissing: "skip" },
      { title: "Reminders and warnings", body: "People and managers hear about certificates 30 and 7 days before they expire. The weekly brief lists what's due, and the schedule warns if someone's on a shift without a certificate their position needs.", helpId: "training.reminders" },
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
    [/^\/team\/training/, "training"],
    [/^\/menu/, "menu"],
    [/^\/prices/, "prices"],
    [/^\/ordering/, "ordering"],
    [/^\/(count|waste)/, "counting"],
    [/^\/ingredients/, "ingredients"],
    [/^\/insights/, "insights"],
  ];
  const hit = map.find(([re]) => re.test(pathname));
  return hit ? getTour(hit[1]) : undefined;
}
