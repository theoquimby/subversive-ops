import type { HelpEntry } from "../types";

/** How the app works in general: command bar, grids, help, phones, roles. */
export const basics: HelpEntry[] = [
  {
    id: "app.about",
    area: "basics",
    title: "What Subversive Ops does",
    audience: "all",
    body: "It keeps plate costs live as supplier prices move, drafts orders from forecast sales, and lets staff count stock and log waste from their phones.",
    article: `Subversive Ops is the back-of-house side of the restaurant. Square handles the front; this handles what it costs to make, what to order and what's on the shelf.

### The four things it does
- **Menu costs.** Every recipe is costed from your latest supplier prices. When a distributor raises the price of beef, every burger's plate cost and food cost % update on their own.
- **Ordering.** For each supplier it works out what to order for the next delivery: forecast sales × recipes + a buffer − what you'll still have on the shelf.
- **Counts and waste.** Staff count stock and log waste on their phones. Everything saves as they type.
- **Margin gap.** Between two counts, it compares what your recipes say you used with what actually left the shelves, so you can see where food cost leaks.

### Where to start
1. Run the [setup](/welcome) if you haven't — it takes about ten minutes.
2. Take the [Overview tour](/help/app.tours) to see the main screens.
3. Press **⌘K** (or **/**) anywhere to jump to anything.`,
    related: ["app.commandBar", "app.tours", "app.setup", "overview.page"],
    keywords: ["intro", "about", "start", "nory"],
    tour: "overview",
  },
  {
    id: "app.setup",
    area: "basics",
    title: "Setting up for the first time",
    body: "The setup guide walks you through business basics, suppliers, your data, Square, team logins and the first count. Every step can be skipped and picked up later.",
    article: `Open [Setup](/welcome) any time. Your progress is saved, so you can leave halfway and come back.

1. **Business basics** — name, opening hours and your food cost target.
2. **Suppliers** — who delivers and on which days. This drives order dates.
3. **Your data** — import your ingredient, price and recipe spreadsheet, or load demo data to look around.
4. **Square** — connect so sales drive costing and ordering.
5. **Team logins** — a name and PIN for each person.
6. **First count and phone** — count stock once and add the app to your phone's home screen.`,
    route: "/welcome",
    related: ["import.page", "settings.suppliers", "sales.connect", "app.phone"],
    keywords: ["onboarding", "wizard", "getting started", "first run"],
  },
  {
    id: "app.commandBar",
    area: "basics",
    title: "Command bar (⌘K)",
    audience: "all",
    body: "Press ⌘K (Ctrl+K on Windows), or / where there is no list to search, to find recipes, ingredients and suppliers, or start a task like \"Import a price sheet\". Use ↑ ↓ and Enter.",
    article: `The command bar is the fastest way around the app.

- **Open it:** ⌘K on a Mac, Ctrl+K on Windows, or just press **/** when you're not typing in a field. On a phone, tap the magnifying glass at the top.
- **Type a few letters** of anything — a recipe ("smash"), an ingredient ("brioche"), a supplier ("sysco") or a task ("order", "import", "count").
- Letters don't need to be next to each other: "gbf" finds "Ground beef". Word starts score higher.
- **↑ ↓** to move, **Enter** to go, **Esc** to close.

"Build order · Sysco" goes straight to that supplier's order. "New recipe" opens a blank recipe.`,
    related: ["app.grids", "app.helpMode"],
    keywords: ["search", "cmd k", "ctrl k", "shortcut", "jump", "keyboard"],
  },
  {
    id: "app.grids",
    area: "basics",
    title: "Editing in grids",
    audience: "all",
    body: "Click any cell and type — it saves when you leave the cell or press Enter. Enter or ↓ moves down, Tab moves across, Esc undoes your typing.",
    article: `Tables like Ingredients, Menu costs and Prices work like a spreadsheet. There are no Save buttons.

### Moving around
- **Enter** or **↓** saves and moves to the same column in the next row. **Shift+Enter** or **↑** goes up.
- **Tab** / **Shift+Tab** moves across the row.
- **Esc** puts the cell back to what it was before you started typing.

### Knowing it saved
- A small green **✓** appears next to the cell for a moment.
- If the value can't be saved (say, a yield of 140%), the cell turns red, goes back to the old value, and hovering it tells you why.

### Paste a whole column
Copy a column of numbers from Excel or Google Sheets, click the first cell you want to fill, and paste. Each line goes into the next cell down, and each one saves. A leading **$** is ignored, and only the first column of what you copied is used.

### Dropdown cells
Cells with a ▾ (like "Count in" or "Link to ingredient") save the moment you pick an option.`,
    related: ["ingredients.grid", "menu.list.price", "prices.list.price"],
    keywords: ["spreadsheet", "inline", "autosave", "paste", "excel", "keyboard", "paste-down", "fill down"],
    tour: "ingredients",
  },
  {
    id: "app.helpMode",
    area: "basics",
    title: "Help mode",
    audience: "all",
    body: "Turn on help mode (press ? or use the help button) and point at any part of the page to see what it does. Press ? or Esc again to turn it off.",
    article: `Help mode is a \"what's this?\" switch for the whole app.

- **Turn it on:** press **?** (Shift + /) when you're not typing, or choose **Help mode** in the command bar.
- Sections with help get a faint outline. **Hover** one (or **tap** it on a phone) to see what it does.
- While help mode is on, tapping a section shows its help instead of pressing the buttons inside it — so you can explore without changing anything.
- **Turn it off:** press **?** or **Esc**, or tap "Done" on the help mode bar.

Small **?** icons next to labels work all the time, help mode or not.`,
    related: ["app.tours", "app.commandBar"],
    keywords: ["what's this", "explain", "tooltips", "question mark"],
  },
  {
    id: "app.tours",
    area: "basics",
    title: "Guided tours",
    audience: "all",
    body: "Tours highlight each part of a page and explain it in a sentence or two. Use → or Next to go on, ← or Back to go back, Esc to stop.",
    article: `Each tour takes a minute or two and can be stopped any time.

- **Overview** — the dashboard, the command bar and where everything lives.
- **Menu costs** — the costing table and the recipe editor, including quick add.
- **Price import** — bringing in a distributor's price sheet.
- **Ordering** — how suggested orders are worked out and how to send them.
- **Counting** — for staff: counting stock and logging waste on a phone.
- **Ingredients** — the spreadsheet grid, yield and order buffer.

Start one from the [help center](/help), with **Show me** on any help article, or from the command bar. Tours can move between pages on their own — just follow along.`,
    related: ["app.helpMode", "app.about"],
    keywords: ["walkthrough", "tutorial", "guide", "show me"],
    tour: "overview",
  },
  {
    id: "app.phone",
    area: "basics",
    title: "Put the app on your phone's home screen",
    audience: "all",
    body: "Open the app in your phone's browser and use Add to Home Screen. It then opens full screen like any other app, and you stay signed in for two weeks.",
    article: `### iPhone or iPad (Safari)
1. Open the app in **Safari** and sign in.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.

### Android (Chrome)
1. Open the app in **Chrome** and sign in.
2. Tap the **⋮** menu in the top corner.
3. Tap **Add to Home screen** (or **Install app**), then **Add**.

Sign-ins last two weeks, so a shared kitchen tablet stays signed in. Staff each sign in with their own name and PIN so counts and waste are credited to them.`,
    related: ["count.home", "settings.team"],
    keywords: ["install", "pwa", "home screen", "ios", "android", "tablet", "app icon"],
  },
  {
    id: "app.roles",
    area: "basics",
    title: "Managers and staff",
    audience: "all",
    body: "Managers see everything. Staff sign in with their name and PIN and only see counts and waste (plus their own shifts once scheduling is live).",
    article: `Every login is a **name and a PIN** (4–8 digits). Add people in [Settings](/settings) or during setup.

- **Manager** — costs, prices, ordering, sales, settings, everything.
- **Staff** — counts and waste logging. They don't see costs or prices.

After five wrong PINs a login is locked for ten minutes. A manager can reset anyone's PIN in Settings.`,
    related: ["settings.team", "count.home", "waste.page"],
    keywords: ["login", "pin", "permissions", "access", "locked"],
  },
  {
    id: "app.dates",
    area: "basics",
    title: "Business days and time zone",
    body: "Dates follow the business day in your time zone (New York by default), so a sale at 11pm counts on that day, not the next.",
    article: `Sales, counts, forecasts and price dates all use the restaurant's own calendar, in the business time zone (America/New_York unless changed).

Prices have an **effective date**. The cost of a recipe "today" and "on March 1st" is the same calculation with a different date, which is how cost history charts are drawn.`,
    related: ["prices.history", "menu.editor.history"],
    keywords: ["timezone", "date", "day"],
  },
  {
    id: "help.center",
    area: "basics",
    title: "Help center",
    audience: "all",
    body: "Search every help article, browse by area, and start guided tours.",
    route: "/help",
    related: ["app.tours", "app.helpMode"],
  },
  {
    id: "welcome.progress",
    area: "basics",
    route: "/welcome",
    title: "Setup steps",
    body: "Eight short steps. Green bars are done, grey ones were skipped. Tap any bar to jump to that step, or Finish later to come back from the setup card on the overview.",
    related: ["app.setup"],
  },
  {
    id: "welcome.welcome",
    area: "basics",
    route: "/welcome",
    title: "Welcome",
    body: "What the app does for you: live menu costs, orders that write themselves, counts and waste on a phone, and where margin leaks. Press Get started when you're ready.",
  },
  {
    id: "welcome.basics",
    area: "basics",
    route: "/welcome",
    title: "Business basics",
    body: "Your business name, time zone, opening hours and food cost target. The time zone decides what \"today\" means; opening hours shape the forecast and the schedule.",
    related: ["app.dates", "settings.target"],
  },
  {
    id: "welcome.suppliers",
    area: "basics",
    route: "/welcome",
    title: "Who delivers",
    body: "Add the suppliers you buy from, distributor or local, and the days they deliver. Delivery days decide when each order is due and how long it has to last.",
    related: ["settings.suppliers", "ordering.builder.window"],
  },
  {
    id: "welcome.data",
    area: "basics",
    route: "/welcome",
    title: "Bring in your data",
    body: "Import the spreadsheet you already use for ingredients, prices and recipes, or load demo data to look around first.",
    related: ["import.page"],
  },
  {
    id: "welcome.square",
    area: "basics",
    route: "/welcome",
    title: "Connect Square",
    body: "Square sales drive food cost, the forecast and every suggested order. Connect takes you to the Square settings page to sign in and approve.",
    related: ["sales.connect"],
  },
  {
    id: "welcome.team",
    area: "basics",
    route: "/welcome",
    title: "Team logins",
    body: "Give each person a name, a 4–8 digit PIN and a role. Staff see counts, waste and their shifts; managers see everything.",
    related: ["app.roles", "settings.team"],
  },
  {
    id: "welcome.phone",
    area: "basics",
    route: "/welcome",
    title: "First count and your phone",
    body: "Do one count so ordering has a starting point, and add the app to your phone's home screen. Items aren't ordered automatically until they've been counted.",
    related: ["count.home", "app.phone"],
  },
  {
    id: "welcome.done",
    area: "basics",
    route: "/welcome",
    title: "All set",
    body: "Every step and whether it's done or skipped. Tap one to go back to it, then take the one-minute tour or go to the overview.",
  },
  {
    id: "welcome.footer",
    area: "basics",
    route: "/welcome",
    title: "Back, Skip and Continue",
    body: "Continue saves this step and moves on; Skip moves on without saving and marks the step skipped; Back returns to the previous step. Nothing here is final — you can change it all later.",
  },
  {
    id: "help.search",
    area: "basics",
    route: "/help",
    title: "Search help",
    body: "Type a word like \"yield\" or \"overtime\" to find the right article. Press Enter to open the top result.",
    audience: "all",
  },
  {
    id: "help.results",
    area: "basics",
    route: "/help",
    title: "Search results",
    body: "Articles that match your search, best match first. Tap one to read it.",
    audience: "all",
  },
  {
    id: "help.shortcuts",
    area: "basics",
    route: "/help",
    title: "Help mode and jump anywhere",
    body: "Help mode outlines every section of a page and explains it when you point at or tap it. The command bar (⌘K) jumps to any recipe, ingredient, supplier or task.",
    related: ["app.helpMode", "app.commandBar"],
    audience: "all",
  },
  {
    id: "help.browse",
    area: "basics",
    route: "/help",
    title: "Browse by area",
    body: "Every help article, grouped by the part of the app it's about. Show all opens the full list for an area.",
    audience: "all",
  },
  {
    id: "help.article",
    area: "basics",
    route: "/help",
    title: "This article",
    body: "The short answer. Show me starts a guided tour of it where there is one, and Open this page takes you to the page it's about.",
    audience: "all",
  },
  {
    id: "help.article.more",
    area: "basics",
    route: "/help",
    title: "The details",
    body: "The longer explanation: how it works, step by step, with links to the pages involved.",
    audience: "all",
  },
  {
    id: "help.related",
    area: "basics",
    route: "/help",
    title: "Related",
    body: "Other articles that are useful alongside this one.",
    audience: "all",
  },
  {
    id: "help.areaNav",
    area: "basics",
    route: "/help",
    title: "More in this area",
    body: "Every article in the same area, with the one you're reading highlighted.",
    audience: "all",
  },
];
