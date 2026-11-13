import type { HelpEntry } from "../types";

/** The shared DataTable (src/components/data-table.tsx): long lists on Prices, Ingredients, Menu costs, Square items, Invoices, Team and order building. */
export const tables: HelpEntry[] = [
  {
    id: "app.tables",
    area: "basics",
    title: "Finding things in long lists",
    body: "Type in the search box (or press /) to narrow the list as you type. Filters stack: pick a supplier, then Show only to keep, say, unlinked items. The count shows how many match. Click a header to sort; shift-click adds a second sort.",
    article: `Long lists (Prices, Ingredients, Menu costs, Square items, Invoices, Team, order building) share the same tools.

### Search
- Every word you type must match, in any order: \`beef ground\` finds "Ground beef 80/20".
- Short-hands work for longer words: \`chkn\` finds "Chicken".
- Press **/** anywhere on the page to jump to the search box, **Esc** to clear it.

### Filters
- Buttons like **Supplier** or **Category** open a list with how many items each choice would show. Pick several to see any of them.
- **Show only** narrows to things that need attention: not linked, no price, over target, below minimum.
- The line of numbers above the table is clickable too: "204 not linked" filters to those 204.
- **Clear all** puts everything back.

### Sort, group and columns
- Click a column header to sort, again to reverse, a third time to stop. **Shift-click** another header to sort by it second.
- **Group** sorts rows under headings (by supplier, category, storage area…) with counts and subtotals. Click a heading to fold it away.
- **View** hides or shows columns and switches between comfortable and compact rows. Drag a header's edge to resize a column.
- **CSV** downloads what you're looking at as a spreadsheet.

Your search, filters, sort, grouping and columns are remembered on this device for each list. Filters also go in the page address, so you can bookmark or share a filtered view.`,
    related: ["app.tables.keys", "app.tables.bulk", "app.tables.panel", "app.grids"],
    keywords: ["search", "filter", "sort", "group", "columns", "csv", "export", "table", "find"],
    audience: "manager",
  },
  {
    id: "app.tables.keys",
    area: "basics",
    title: "Keyboard in lists",
    body: "/ jumps to search. j and k (or ↓ and ↑) move between rows, Enter opens the row, x ticks it. Esc closes the side panel, then clears the selection, then the search.",
    related: ["app.tables", "app.commandBar"],
    keywords: ["keyboard", "shortcut", "j", "k", "hotkey"],
  },
  {
    id: "app.tables.bulk",
    area: "basics",
    title: "Changing many rows at once",
    body: "Tick rows on the left (shift-click to tick a range, or the top box for everything that matches). A bar appears at the bottom with what you can do to all of them: link, set a category, archive, accept matches, export.",
    related: ["app.tables"],
    keywords: ["bulk", "select all", "checkbox", "many", "batch"],
  },
  {
    id: "app.tables.panel",
    area: "basics",
    title: "Row details panel",
    body: "Click a row (away from the editable cells) to open its details beside the list: price history, products, recipes using it. j and k move to the next row with the panel open. Open page goes to the full page.",
    related: ["app.tables", "app.tables.keys"],
    keywords: ["drawer", "panel", "details", "side"],
  },
  {
    id: "sales.squareMenu.table",
    area: "sales",
    route: "/sales/square-menu",
    title: "Matching Square items",
    body: "Every Square item in one list. Start with Status: Suggested match. Tick the right ones and Accept, or Reject the wrong ones so they aren't suggested again. Link to recipe, Create recipes and Ignore work on the ticked rows too.",
    article: `The list starts on **Suggested match**: Square items whose names closely match a recipe.

1. Sort by **Suggested match** to see the surest ones first, or use **Show only → Match 90%+**.
2. Tick them (shift-click a range) and press **Accept**. Wrong ones: **Reject** — that recipe won't be suggested for that item again.
3. Switch Status to **Not matched**. Tick items that need a recipe and press **Create recipes**, or pick one with **Link to recipe**.
4. Merch, gift cards and drinks bought in: **Ignore**. **Un-ignore** brings them back.
5. **Show only → Price differs** lists linked items whose Square price isn't the recipe's menu price; **Use Square price** updates them.`,
    related: ["sales.mapping", "sales.squareMenu.suggestions", "app.tables.bulk"],
    keywords: ["match", "accept", "reject", "link", "square menu", "bulk"],
  },
];
