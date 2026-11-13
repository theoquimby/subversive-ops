import type { HelpEntry } from "../types";

// ---- Overview ------------------------------------------------------------------

export const overview: HelpEntry[] = [
  {
    id: "overview.page",
    area: "overview",
    route: "/",
    tour: "overview",
    title: "Overview",
    body: "Today so far, the last 7 days split into food and drink, labor, menu items over target, recent price moves and your next deliveries.",
    article: `The Overview is the page to open each morning. Everything on it links to where you'd fix it.

- **Today so far** — sales, labor on the clock, labor % and where today will likely close against the forecast.
- **Last 7 days** — sales (food vs drinks mix), food cost %, beverage cost %, labor % and prime cost. **P&L →** opens the same week on the P&L.
- **Items over target** — menu items whose cost % is above target.
- **Price increases** — supplier prices that went up in the last 30 days.

Below that: the biggest price moves, the items over target, and when each supplier delivers next.`,
    related: ["overview.today", "overview.foodCost", "overview.bevCost", "overview.priceChanges", "overview.overTarget", "overview.deliveries", "pnl.page"],
    keywords: ["dashboard", "home"],
  },
  {
    id: "overview.today",
    area: "overview",
    route: "/",
    title: "Today so far",
    body: "Sales and labor since opening, as of the last Square sync. Projected close = sales so far + the forecast for the hours left. Labor % by close assumes everyone works their scheduled shift.",
    related: ["pnl.page", "pnl.hourly", "sales.forecast5w"],
    keywords: ["live", "today", "projection"],
  },
  {
    id: "overview.foodCost",
    area: "overview",
    route: "/",
    title: "Food cost, last 7 days",
    body: "What food should have cost: each food item sold in the last 7 days × its recipe cost that day, divided by food sales. Drinks are left out; they have their own number.",
    article: `This is **theoretical** food cost — what it would be if every plate matched its recipe.

It only counts Square items linked to a recipe, so link your Square items on the [Sales](/sales) page to make it complete. Which categories count as food is set on [Menu costs](/menu).

To see what food cost **actually** was, including waste and over-portioning, use the [Margin gap](/variance) page, which compares two stock counts.`,
    related: ["variance.page", "sales.mapping", "settings.target", "menu.classes"],
    keywords: ["theoretical", "food cost %", "cogs"],
  },
  {
    id: "overview.bevCost",
    area: "overview",
    route: "/",
    title: "Beverage cost, last 7 days",
    body: "What beer and other drinks should have cost, as a share of drink sales, against the beverage target. Set up kegs on Draft beer so beer has a cost.",
    related: ["menu.draftBeer", "menu.classes", "pnl.split"],
    keywords: ["pour cost", "beer cost", "bar cost"],
  },
  {
    id: "overview.sales",
    area: "overview",
    route: "/",
    title: "Sales, last 7 days",
    body: "Net sales from Square for the last seven business days, not counting today or items marked Ignore (gift cards, merch). Matches the P&L. The hint shows the food vs drinks mix.",
    related: ["sales.sync", "pnl.page"],
  },
  {
    id: "overview.overTarget",
    area: "overview",
    route: "/",
    title: "Over target",
    body: "Menu items whose food cost % is above their target, worst first. Tap one to open its recipe and see which line is driving the cost.",
    article: `Each menu item has a food cost target — the default from Settings, or its own. An item shows here when plate cost ÷ menu price is above that target.

Common fixes: raise the price (the recipe page shows the **price to hit target**), trim a portion, or swap an ingredient.`,
    related: ["menu.editor.summary", "menu.list.target", "settings.target"],
  },
  {
    id: "overview.priceIncreases",
    area: "overview",
    route: "/",
    title: "Price increases",
    body: "How many supplier products went up in price in the last 30 days.",
    related: ["overview.priceChanges", "prices.list"],
  },
  {
    id: "overview.priceChanges",
    area: "overview",
    route: "/",
    title: "Price changes",
    body: "The biggest supplier price moves in the last 30 days, old price vs new. Red is up, green is down.",
    related: ["prices.list", "prices.import"],
  },
  {
    id: "overview.deliveries",
    area: "overview",
    route: "/",
    title: "Next deliveries",
    body: "When each supplier delivers next, from its delivery days and lead time. Orange means today or tomorrow. Tap a supplier to build its order.",
    related: ["ordering.builder", "settings.suppliers"],
  },
  {
    id: "overview.setup",
    area: "overview",
    route: "/",
    title: "Finish setting up",
    body: "How far through the setup guide you are. Continue setup picks up where you left off; the × hides this card once you don't need it.",
    related: ["app.setup"],
  },
  {
    id: "overview.week",
    area: "overview",
    route: "/",
    title: "Last 7 days",
    body: "Net sales, food cost and beverage cost (theoretical, against their targets) and labor % with prime cost, for the last seven finished days. P&L opens the full breakdown.",
    related: ["overview.sales", "overview.foodCost", "overview.bevCost", "pnl.page"],
  },
  {
    id: "overview.rating",
    area: "overview",
    route: "/",
    title: "Rating, 30 days",
    body: "Average guest rating over the last 30 days and how it moved against the 30 days before. Tap to open Reviews.",
    related: ["reviews.page"],
  },
  {
    id: "overview.waste",
    area: "overview",
    route: "/",
    title: "Waste, 7 days",
    body: "The cost of everything logged as waste in the last week, and how many logs. Amber when nothing was logged — usually a sign it isn't being recorded. Tap to log waste.",
    related: ["waste.page"],
  },
  {
    id: "overview.profit",
    area: "overview",
    route: "/",
    title: "Profit before overhead",
    body: "Last 7 days' net sales minus cost of goods and labor, before rent and other overheads.",
    related: ["pnl.page"],
  },
];

// ---- Menu costs ----------------------------------------------------------------

export const menu: HelpEntry[] = [
  {
    id: "menu.list",
    area: "menu",
    route: "/menu",
    tour: "menu",
    title: "Menu costs",
    body: "Every recipe with its plate cost and food cost %, updated automatically whenever a supplier price changes. Price and target can be edited right in the table.",
    article: `### The three tabs
- **Menu items** — what you sell. These have a menu price and a food cost %.
- **Add-ons** — Square modifiers like "add bacon" or "sub gluten-free bun". Costed like menu items so their sales count too.
- **Prep recipes** — sauces, doughs, pickles and other batches used inside other recipes. These show a batch cost.

### The columns
- **Price** — the menu price. Click to edit; it saves on its own.
- **Cost** — plate cost (or batch cost for prep) at today's prices.
- **30 days** — how much the cost moved in the last 30 days. Red means it went up.
- **Food cost / target** — cost ÷ price, next to the target. The target is editable too.

A **Missing prices** badge means at least one ingredient has no price yet, so the cost is low. Open the recipe to see which.`,
    related: ["menu.editor", "menu.list.target", "app.grids", "menu.tabs"],
    keywords: ["recipes", "plate cost", "food cost", "costing"],
  },
  {
    id: "menu.tabs",
    area: "menu",
    route: "/menu",
    title: "Menu items, add-ons and prep",
    body: "Menu items are what you sell, add-ons are Square modifiers, and prep recipes are batches (sauces, doughs) used inside other recipes.",
    related: ["menu.editor.subRecipes", "menu.editor.details"],
    keywords: ["modifier", "sub-recipe", "batch"],
  },
  {
    id: "menu.classes",
    area: "menu",
    route: "/menu",
    title: "Food and drink",
    body: "Each category counts as Food, Beer, Other beverage or Retail on the P&L, Overview and Margin gap. Categories are guessed from their name until you pick one.",
    article: `Food and drinks run at very different cost %, so the P&L reports them separately. The class comes from the recipe's category: everything in "Beer" counts as beer, "Mains" as food, and so on.

- Change a category's class in the table at the bottom of [Menu costs](/menu). It applies to every recipe in that category, past and future.
- **Retail** (merch, cans to go if you'd rather) counts toward total sales only.
- The **beverage cost target** sits under the table. Drinks without their own target are held to it instead of the food target.`,
    related: ["pnl.split", "menu.draftBeer", "menu.list.target"],
    keywords: ["category", "beverage", "beer", "revenue class", "food vs beverage"],
  },
  {
    id: "menu.draftBeer",
    area: "menu",
    route: "/menu/draft-beer",
    title: "Draft beer",
    body: "Enter a beer, its keg size and what a keg costs you. It creates the keg as an ingredient and a costed recipe for each pour (16 oz, 10 oz, flight), linked to your Square items.",
    article: `### What it creates
- **The keg** as an ingredient measured in ml and counted in kegs, with "1 keg" as a unit so a half-full keg counts as 0.5.
- **The keg price** on a "House brewery" supplier (or the supplier you pick), dated today.
- **One menu recipe per pour**, in the Beer category, using that many fl oz of the keg.
- **Square links** for the pours you pick, so beer sales start costing straight away.

### Usable %
Foam, line flushes and the last pint mean you sell less than the keg holds. 95% is a fair start; lower it if your counts keep showing beer short.

### Price changes
Enter the same beer again with the new keg cost. A new price is recorded from today, the pours update, and past days keep the cost that applied then.`,
    related: ["menu.classes", "pnl.split", "variance.page"],
    keywords: ["keg", "beer", "pour", "half barrel", "sixtel", "bbl", "flight", "pint"],
  },
  {
    id: "menu.list.price",
    area: "menu",
    route: "/menu",
    title: "Menu price",
    body: "Click and type a new price; it saves when you press Enter or click away, and food cost % updates straight away. You can paste a column of prices from a spreadsheet.",
    related: ["app.grids"],
  },
  {
    id: "menu.list.cost",
    area: "menu",
    route: "/menu",
    title: "Cost",
    body: "Plate cost at today's supplier prices, including yield loss and any prep recipes inside it.",
    related: ["ingredients.yield", "menu.editor.subRecipes"],
  },
  {
    id: "menu.list.change",
    area: "menu",
    route: "/menu",
    title: "30-day cost change",
    body: "How much this recipe's cost has moved since 30 days ago, from price history. Red means it's costing you more.",
    related: ["menu.editor.history", "prices.history"],
  },
  {
    id: "menu.list.target",
    area: "menu",
    route: "/menu",
    title: "Food cost and target",
    body: "Food cost % is cost ÷ menu price, shown in red when it's above target. The target next to it is editable; the default comes from Settings.",
    article: `Food cost % = plate cost ÷ menu price.

The target defaults to the one in [Settings](/settings) (usually around 30%). Override it per item where it makes sense — a steak might run at 38%, fries at 15%. Clear the cell to go back to the default.`,
    related: ["settings.target", "menu.editor.summary"],
  },
  {
    id: "menu.list.missing",
    area: "menu",
    route: "/menu",
    title: "Missing prices",
    body: "At least one ingredient in this recipe has no price, or its pack size isn't set, so the cost shown is too low. Open the recipe to see which line.",
    related: ["ingredients.packSize", "prices.link"],
  },
  {
    id: "menu.editor",
    area: "menu",
    route: "/menu",
    tour: "menu",
    title: "Recipe editor",
    body: "Build a recipe line by line and watch plate cost, food cost and margin recalculate as you type. Nothing is saved until you press Save.",
    article: `### Adding ingredients
Type a line like \`6 oz ground beef\` in the quick-add box and press Enter. Paste a whole ingredient list and every line is added at once.

### Each line
Pick the ingredient (or a prep recipe), the quantity and the unit. The line's cost appears on the right. "No price" in orange means that ingredient isn't priced yet.

### The summary cards
- **Plate cost** — total of every line.
- **Food cost** — plate cost ÷ menu price, against the target.
- **Margin** — menu price − plate cost.
- **Price to hit target** — plate cost ÷ target. If you charged this, you'd be exactly on target.

### Saving
A bar appears at the bottom when you've changed something. **Save** keeps it, **Discard** throws your changes away.`,
    related: ["menu.editor.quickAdd", "menu.editor.summary", "menu.editor.subRecipes", "menu.editor.yield"],
    keywords: ["recipe", "build", "lines"],
  },
  {
    id: "menu.editor.summary",
    area: "menu",
    route: "/menu",
    title: "Plate cost, food cost, margin",
    body: "Plate cost adds up every line. Food cost is cost ÷ price, margin is price − cost, and \"price to hit target\" is cost ÷ target.",
    article: `- **Plate cost** — every line's cost added up, using today's prices and each ingredient's yield.
- **Food cost** — plate cost ÷ menu price. Red when above target.
- **Margin** — the dollars left after food: menu price − plate cost.
- **Price to hit target** — plate cost ÷ target food cost. For a $4.20 plate with a 30% target, that's $14.00.

For a prep recipe you see **batch cost** and **yield** instead, because prep isn't sold on its own.`,
    related: ["menu.list.target", "settings.target"],
    keywords: ["margin", "price to hit target", "food cost %"],
  },
  {
    id: "menu.editor.lines",
    area: "menu",
    route: "/menu",
    title: "Recipe lines",
    body: "One line per ingredient or prep recipe, with quantity and unit. The cost on the right uses the ingredient's usable cost after yield loss.",
    related: ["menu.editor.units", "ingredients.yield"],
  },
  {
    id: "menu.editor.quickAdd",
    area: "menu",
    route: "/menu",
    title: "Quick add",
    body: "Type a quantity, unit and ingredient — like \"6 oz ground beef\" — and press Enter. Paste a whole list (one per line) to add every line at once.",
    article: `Quick add understands lines like:

- \`6 oz ground beef\`
- \`2 slices american cheese\` (uses the ingredient's custom units)
- \`1 brioche bun\`
- \`30 ml house aioli\` (prep recipes work too)

Names are matched loosely, so "grnd beef" finds "Ground beef". Before you press Enter, the line underneath shows exactly what will be added.

**Paste a list** from a recipe card, an email or a spreadsheet — one ingredient per line — and every line that matches is added. Anything it couldn't match is listed so you can add it by hand.`,
    related: ["menu.editor.units", "ingredients.customUnits"],
    keywords: ["paste", "type", "fast", "ingredient list"],
  },
  {
    id: "menu.editor.units",
    area: "menu",
    route: "/menu",
    title: "Units in recipes",
    body: "Use any unit that converts to how the ingredient is measured — oz, lb, g, cups, ml — or a custom unit like \"slice\" set on the ingredient.",
    related: ["ingredients.customUnits", "ingredients.baseUnit"],
    keywords: ["oz", "grams", "conversion"],
  },
  {
    id: "menu.editor.subRecipes",
    area: "menu",
    route: "/menu",
    title: "Prep recipes inside recipes",
    body: "Pick a prep recipe (like house aioli) as a line and it's costed from its own batch cost ÷ batch yield. Change the aioli and every burger using it updates.",
    related: ["menu.editor.yield", "menu.tabs"],
    keywords: ["sub-recipe", "sauce", "nested"],
  },
  {
    id: "menu.editor.details",
    area: "menu",
    route: "/menu",
    title: "Recipe details",
    body: "Name, type (menu item, add-on or prep), category, menu price, target and notes for plating or portioning.",
    related: ["menu.tabs", "menu.list.target"],
  },
  {
    id: "menu.editor.yield",
    area: "menu",
    route: "/menu",
    title: "Batch yield",
    body: "How much one batch of a prep recipe makes, like 2 qt of aioli. A line using 30 ml costs 30 ml's share of the batch.",
    related: ["menu.editor.subRecipes"],
  },
  {
    id: "menu.editor.target",
    area: "menu",
    route: "/menu",
    title: "Target food cost",
    body: "This item's own target. Leave it blank to use the default from Settings.",
    related: ["settings.target"],
  },
  {
    id: "menu.editor.history",
    area: "menu",
    route: "/menu",
    title: "Plate cost over time",
    body: "This recipe's cost each week for the last six months, recalculated from price history — so you can see exactly when a price rise hit.",
    related: ["prices.history"],
  },
  {
    id: "menu.editor.archive",
    area: "menu",
    route: "/menu",
    title: "Archive a recipe",
    body: "Hides the recipe from lists, ordering and forecasts. Its history is kept.",
  },
  {
    id: "menu.editor.save",
    area: "menu",
    route: "/menu",
    title: "Save or discard",
    body: "Shows when the recipe has unsaved changes. Save keeps them and re-costs the recipe; Discard puts it back how it was.",
  },
  {
    id: "menu.page",
    area: "menu",
    route: "/menu",
    title: "Menu costs",
    body: "Every recipe's plate cost, menu price and food cost % against target, re-costed whenever a supplier price changes. Draft beer and the allergen chart are one tap away; New recipe adds one, and Bulk add pastes many at once from a spreadsheet.",
    related: ["menu.list", "menu.editor", "menu.draftBeer", "menu.allergenChart"],
  },
  {
    id: "menu.archived",
    area: "menu",
    route: "/menu",
    title: "Archived recipes",
    body: "Recipes you've archived, and when. They're left out of costing, the forecast and orders; Restore brings one back.",
    related: ["menu.editor.archive"],
  },
];

// ---- Ingredients ---------------------------------------------------------------

export const ingredients: HelpEntry[] = [
  {
    id: "ingredients.grid",
    area: "ingredients",
    route: "/ingredients",
    tour: "ingredients",
    title: "Ingredients",
    body: "Every ingredient in one spreadsheet-style grid. Click a cell to edit; Enter moves down, Tab moves across, and you can paste a column from Excel.",
    article: `### Columns
- **Ingredient** — the name. The ↗ arrow opens its full page.
- **Category** and **Storage** — storage area groups the count sheet (walk-in, dry storage, bar…).
- **Cost** — usable cost per lb, gal or each, after yield loss.
- **Yield** — the share you can actually use after trimming or cooking.
- **Buffer** — extra ordered on top of the forecast.
- **Count in** — the unit staff count it in.

A **No supplier** badge means it isn't linked to anything you buy yet, so it has no price.

On a phone, less important columns hide; open the ingredient for everything.`,
    related: ["app.grids", "ingredients.yield", "ingredients.buffer", "ingredients.countIn"],
    keywords: ["items", "spreadsheet", "inventory items"],
  },
  {
    id: "ingredients.search",
    area: "ingredients",
    route: "/ingredients",
    title: "Search ingredients",
    body: "Type part of a name and press Enter to filter the grid. Archived shows ingredients you've archived, so you can bring them back.",
  },
  {
    id: "ingredients.cost",
    area: "ingredients",
    route: "/ingredients",
    title: "Ingredient cost",
    body: "Usable cost per lb, gal or each: the preferred product's price ÷ pack size, then ÷ yield. \"No price\" means it's not linked to a priced product.",
    article: `Cost comes from the supplier product that's set to **Use for cost** on the ingredient's page.

Example: a 10 lb case of ground beef at $61.50 is $6.15/lb. At 85% yield, the **usable** cost is $6.15 ÷ 0.85 = $7.24/lb — that's what recipes are costed at.`,
    related: ["ingredients.yield", "ingredients.boughtAs", "ingredients.packSize"],
  },
  {
    id: "ingredients.yield",
    area: "ingredients",
    route: "/ingredients",
    title: "Yield %",
    body: "The share of what you buy that ends up on the plate after trimming, peeling or cooking. At 80% yield, recipes are costed at purchase cost ÷ 0.8.",
    article: `Yield accounts for loss between the case and the plate.

- Whole onions, peeled and trimmed: about 90%.
- Brisket, trimmed and smoked: often 50–60%.
- Bottled sauce: 100%.

Recipes list the **usable** amount ("6 oz cooked brisket") and yield makes sure it's costed at what you really paid. Yield doesn't change ordering quantities — those are in purchased amounts. Waste is valued at purchase cost (no yield uplift), because it's raw product.

Allowed range: 1–100%.`,
    related: ["ingredients.cost", "menu.editor.lines"],
    keywords: ["trim", "loss", "cook loss", "usable"],
  },
  {
    id: "ingredients.buffer",
    area: "ingredients",
    route: "/ingredients",
    title: "Order buffer %",
    body: "Extra ordered on top of forecast usage, so a busy night doesn't run you out. 15% means order for forecast × 1.15.",
    article: `Suggested orders cover forecast usage between this delivery and the next, **plus this buffer**.

- Keep it low (5–10%) for perishables that spoil.
- Raise it (20–30%) for things you can't run out of, or that a supplier often shorts.

Allowed range: 0–200%.`,
    related: ["ordering.builder.formula", "ordering.builder.needed"],
    keywords: ["safety stock", "par", "extra"],
  },
  {
    id: "ingredients.onHand",
    area: "ingredients",
    route: "/ingredients",
    title: "On hand (est.)",
    body: "What should be on the shelf now: last count + deliveries since (checked-in orders and approved invoices) − what sales used through recipes − logged waste. Orange when below the minimum on hand.",
    related: ["ordering.builder.onHand", "count.home"],
    keywords: ["stock", "inventory", "on hand", "estimate"],
  },
  {
    id: "ingredients.minOnHand",
    area: "ingredients",
    route: "/ingredients",
    title: "Min on hand",
    body: "For items no recipe uses (gloves, napkins, cleaning supplies): the least you want on the shelf, in the count unit. Suggested orders top it back up. Leave blank for items the forecast drives.",
    related: ["ordering.builder.par"],
    keywords: ["par", "par level", "minimum", "reorder point"],
  },
  {
    id: "ingredients.countIn",
    area: "ingredients",
    route: "/ingredients",
    title: "Count in",
    body: "The unit staff see first when counting this item — cases, lb, each, or a custom unit like \"tub\". They can still switch units on the count sheet.",
    related: ["count.units", "ingredients.customUnits"],
  },
  {
    id: "ingredients.noSupplier",
    area: "ingredients",
    route: "/ingredients",
    title: "No supplier",
    body: "This ingredient isn't linked to a supplier product, so it has no price and won't be ordered. Link one from Prices → Not linked.",
    related: ["prices.link"],
  },
  {
    id: "ingredients.detail",
    area: "ingredients",
    route: "/ingredients",
    title: "Ingredient page",
    body: "Everything about one ingredient: the products it's bought as, pack sizes, cost history, custom units and which recipes use it.",
    related: ["ingredients.boughtAs", "ingredients.packSize", "ingredients.customUnits", "ingredients.baseUnit"],
  },
  {
    id: "ingredients.boughtAs",
    area: "ingredients",
    route: "/ingredients",
    title: "Bought as",
    body: "The supplier products linked to this ingredient. The one marked \"Sets cost\" is used for costing and ordering; use \"Use for cost\" to switch.",
    related: ["ingredients.packSize", "prices.link"],
    keywords: ["preferred product", "supplier product"],
  },
  {
    id: "ingredients.packSize",
    area: "ingredients",
    route: "/ingredients",
    title: "Pack size",
    body: "How much is in one purchase unit, like 1 case = 10 lb. Without it a price can't be turned into a cost per lb, and the item can't be ordered automatically.",
    article: `Pack sizes are read from the price sheet where possible ("6/32 OZ", "4/1 GAL", "25 LB", "200 CT"). When the sheet's text isn't clear, set it here once and it's remembered.

Example: \`1 case = 6 gal\`. Then a $54 case is $9/gal.`,
    related: ["ordering.builder.needsSetup", "ingredients.cost"],
    keywords: ["case", "pack", "purchase unit"],
  },
  {
    id: "ingredients.customUnits",
    area: "ingredients",
    route: "/ingredients",
    title: "Custom units",
    body: "Name your own units for recipes and counts, like 1 slice = 21 g or 1 tub = 5 lb.",
    related: ["menu.editor.units", "ingredients.countIn"],
    keywords: ["conversion", "slice", "portion"],
  },
  {
    id: "ingredients.baseUnit",
    area: "ingredients",
    route: "/ingredients",
    title: "Measured by",
    body: "Whether this ingredient is tracked by weight (g), volume (ml) or count (each). Every quantity is stored in that unit and converted for display.",
    related: ["ingredients.customUnits"],
  },
  {
    id: "ingredients.history",
    area: "ingredients",
    route: "/ingredients",
    title: "Cost history",
    body: "Cost per lb, gal or each over the last six months, from the product that sets cost.",
    related: ["prices.history"],
  },
  {
    id: "ingredients.usedIn",
    area: "ingredients",
    route: "/ingredients",
    title: "Used in",
    body: "Every active recipe that uses this ingredient.",
  },
  {
    id: "ingredients.settings",
    area: "ingredients",
    route: "/ingredients",
    title: "Ingredient settings",
    body: "Name, category, storage area, what it's measured by and counted in, yield %, order buffer % and notes. Change what you need and press Save changes.",
    related: ["ingredients.yield", "ingredients.buffer", "ingredients.baseUnit", "ingredients.countIn"],
  },
  {
    id: "ingredients.page",
    area: "ingredients",
    route: "/ingredients",
    title: "Ingredients",
    body: "Everything you buy and cook with: cost, yield, order buffer, stock on hand and where it's kept. New ingredient adds one; tap a name for its full page.",
    related: ["ingredients.grid", "ingredients.detail"],
  },
  {
    id: "ingredients.archived",
    area: "ingredients",
    route: "/ingredients",
    title: "Archived ingredients",
    body: "Ingredients you've archived, and when. They're left out of the grid, orders and counts; Restore brings one back.",
  },
];

// ---- Prices --------------------------------------------------------------------

export const prices: HelpEntry[] = [
  {
    id: "prices.list",
    area: "prices",
    route: "/prices",
    title: "Prices",
    body: "Every product you buy, by supplier, with its current price and how it moved in 30 days. Edit a price in place, or import a whole sheet.",
    article: `- **Supplier chips** filter the list. **Not linked** shows products that aren't tied to an ingredient yet.
- **Price** is editable — type a new one and it's saved as of today. The old price is kept.
- **vs 30 days ago** shows the move, red for up and green for down.

To bring in a distributor's full list, use **Import price sheet**. For a local farm or anything not on a sheet, **Update by hand** is quicker.`,
    related: ["prices.import", "prices.manual", "prices.link", "prices.history"],
    keywords: ["supplier products", "costs", "vendor"],
  },
  {
    id: "prices.filters",
    area: "prices",
    route: "/prices",
    title: "Filter by supplier",
    body: "Show one supplier's products, or only products that aren't linked to an ingredient yet. Search finds an item by name or item number.",
  },
  {
    id: "prices.link",
    area: "prices",
    route: "/prices",
    title: "Linking products to ingredients",
    body: "A supplier product only affects recipe costs once it's linked to an ingredient. Pick the ingredient from the list, or \"+ New\" to create one from the product.",
    article: `After an import, new products show up under **Not linked**. For each one:

- **Link to ingredient…** — pick the ingredient it is. Several products can link to one ingredient (say, two brands of fryer oil); the ingredient page decides which sets cost.
- **+ New** — makes a new ingredient named after the product and links it.

Products you don't use in recipes (cleaning supplies, to-go boxes) can stay unlinked.`,
    related: ["ingredients.boughtAs", "prices.import.diff"],
    keywords: ["unlinked", "not linked", "map"],
  },
  {
    id: "prices.list.price",
    area: "prices",
    route: "/prices",
    title: "Edit a price",
    body: "Type a new price and press Enter. It's saved as effective today, the previous price stays in history, and every recipe using it recalculates.",
    related: ["app.grids", "prices.history"],
  },
  {
    id: "prices.history",
    area: "prices",
    route: "/prices",
    title: "Price history",
    body: "Prices are never overwritten. Each change is kept with its effective date, so costs on any past date can be recalculated exactly.",
    related: ["menu.editor.history", "app.dates"],
    keywords: ["append-only", "effective date"],
  },
  {
    id: "prices.import",
    area: "prices",
    route: "/prices/import",
    tour: "prices",
    title: "Import a price sheet",
    body: "Upload the distributor's download exactly as it comes — an Excel or .csv spreadsheet file. You'll see every price change before anything is saved.",
    article: `1. **Pick the supplier.**
2. **Drop the file** (.xlsx, .xls or .csv) — no need to tidy it up first.
3. **Prices effective** — usually today; set a future date if the sheet is next week's pricing.
4. **Preview.** The columns are detected for you and the changes are listed.
5. **Check the columns** if something looks off, then **Save prices**.

Plate costs update straight away. New products then need linking to ingredients.`,
    related: ["prices.import.columns", "prices.import.diff", "prices.link"],
    keywords: ["upload", "sysco", "us foods", "distributor", "xlsx", "csv"],
  },
  {
    id: "prices.import.supplier",
    area: "prices",
    route: "/prices/import",
    title: "Supplier",
    body: "Whose sheet this is. Item numbers are matched against that supplier's products, and the column layout is remembered for them.",
  },
  {
    id: "prices.import.file",
    area: "prices",
    route: "/prices/import",
    title: "Price sheet file",
    body: "Drag the file here or tap to choose it. Excel and .csv spreadsheet files both work, as downloaded from the distributor's site.",
  },
  {
    id: "prices.import.effective",
    area: "prices",
    route: "/prices/import",
    title: "Prices effective",
    body: "The date these prices start. Costs before this date keep using the old prices.",
    related: ["prices.history"],
  },
  {
    id: "prices.import.columns",
    area: "prices",
    route: "/prices/import",
    title: "Columns",
    body: "Which column holds the item number, description and price (required), and pack size and unit (optional). They're detected for you and remembered for this supplier.",
    article: `The importer looks at the header row and guesses:

- **Item number** — "Item #", "SKU" (stock code), "SUPC", "Product code"…
- **Description** — "Description", "Item name"…
- **Price** — "Case price", "Unit price", "Cost"…
- **Pack / size** — "Pack/Size", "Pk/Sz". Text like \`6/32 OZ\`, \`4/1 GAL\`, \`25 LB\` or \`200 CT\` is turned into a pack size automatically.
- **Unit** — "UOM", "Unit": CS becomes case, EA becomes each, Piece stays piece. When an item is listed twice (per case and per piece), the unit you already buy it in is kept — the case otherwise. Section headings like "DAIRY + EGGS" are skipped.

If a guess is wrong, pick the right column and the preview refreshes. The choice is remembered, so next week's sheet from the same supplier just works.`,
    related: ["ingredients.packSize", "prices.import.diff"],
    keywords: ["mapping", "headers", "detect"],
  },
  {
    id: "prices.import.diff",
    area: "prices",
    route: "/prices/import",
    title: "What changed",
    body: "Price changes (biggest first), new products, unchanged rows and skipped rows. Nothing is saved until you press Save prices.",
    article: `- **Price changes** — products whose price moved, with the % change.
- **New products** — item numbers you haven't had before. They'll need linking to ingredients.
- **Unchanged** — same price as now.
- **Rows skipped** — rows without an item number, with an unreadable price, or duplicated. Open the list to see why.

Products you have on file that aren't in this sheet keep their last price — nothing is deleted.`,
    related: ["prices.link"],
  },
  {
    id: "prices.import.save",
    area: "prices",
    route: "/prices/import",
    title: "Save prices",
    body: "Saves every row as of the effective date and recalculates plate costs.",
  },
  {
    id: "prices.manual",
    area: "prices",
    route: "/prices/update",
    title: "Update prices by hand",
    body: "For local suppliers and anything not on a price sheet. Type new prices next to the ones that changed; only those are saved.",
    article: `Pick the supplier, type the new price next to anything that changed, and press **Save**. The % change appears as you type, and blank fields are left alone.

Set **Effective** if the prices started on a different day than today.`,
    related: ["prices.history"],
    keywords: ["farm", "local", "manual"],
  },
  {
    id: "prices.import.changes",
    area: "prices",
    route: "/prices/import",
    title: "Price changes",
    body: "Every product whose price moved, with the old price, the new one and the change. Red is up, green is down.",
  },
  {
    id: "prices.import.done",
    area: "prices",
    route: "/prices/import",
    title: "Prices updated",
    body: "How many prices changed and how many new products came in. Plate costs are already recalculated; link new products to ingredients so they count.",
    related: ["prices.link"],
  },
  {
    id: "prices.manual.suppliers",
    area: "prices",
    route: "/prices/update",
    title: "Pick a supplier",
    body: "Shows that supplier's active products. Switch supplier to update another one's prices.",
  },
  {
    id: "prices.manual.list",
    area: "prices",
    route: "/prices/update",
    title: "Products and prices",
    body: "Each product with its current price and since when. Type the new price next to any that changed; the % change shows as you type.",
  },
  {
    id: "prices.manual.save",
    area: "prices",
    route: "/prices/update",
    title: "Effective date and save",
    body: "Pick the date the new prices start, then save. Only the prices you changed are saved, and plate costs use them from that date.",
  },
  {
    id: "prices.page",
    area: "prices",
    route: "/prices",
    title: "Prices",
    body: "Every product your suppliers sell you, with its current price and how it moved in the last 30 days. Import a distributor's price sheet, or update local suppliers by hand.",
    related: ["prices.list", "prices.import", "prices.manual"],
  },
  {
    id: "prices.alert",
    area: "prices",
    route: "/prices",
    title: "Price alerts",
    body: "Managers are alerted when a supplier price goes up by at least this %. Choose email or push for price spikes on the Notifications page.",
    related: ["settings.notify.events"],
  },
];
