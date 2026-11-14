import type { HelpEntry } from "../types";

// ---- Ordering page as a board (/ordering): Today, the suppliers table, orders ----------

export const orderingBoard: HelpEntry[] = [
  {
    id: "ordering.today",
    area: "ordering",
    route: "/ordering",
    tour: "ordering",
    title: "Today",
    body: "What needs you now: order deadlines in the next 48 hours with nothing ordered yet, drafts waiting to be sent, deliveries to check in, and trucks due tomorrow. Each has one button: Build order, Draft, Review & send or Check in.",
    article: `The strip at the top of Ordering lists only what needs doing, most urgent first.

- **Order by …** — a deadline in the next 48 hours and no order yet. The countdown turns amber under a day and red under 6 hours. **Build order** opens the suggested order to adjust; **Draft** saves it as a draft in one tap and opens it.
- **Draft to send** — a saved draft for a delivery that hasn't happened yet. **Review & send** opens it.
- **Check in** — a sent order whose truck was due today or earlier.
- **Arrives tomorrow** — sent orders on their way.

When nothing is urgent it says when the next deadline is.`,
    related: ["ordering.board", "ordering.cutoffs", "ordering.po.receive"],
    keywords: ["today", "due", "countdown", "deadline", "to do"],
  },
  {
    id: "ordering.board",
    area: "ordering",
    route: "/ordering",
    tour: "ordering",
    title: "Suppliers table",
    body: "One row per supplier: delivery days, next delivery, the order deadline with a countdown, where its order stands and the suggested order. Change delivery days, minimum, email and auto-draft right in the row. Sorted by the soonest deadline.",
    article: `Every active supplier in one table, soonest deadline first.

### Columns
- **Delivers** — tap a day to switch it on or off. Saves straight away.
- **Order by** — the next deadline and time left. "Guessed" means no deadline is set for that delivery day yet, so it's worked out from the lead time. The calendar button opens the deadlines for every delivery day.
- **Status** — No order, Draft, Sent or Received for the next delivery, with its total and lines.
- **Suggested** — the suggested order for the next delivery (forecast × recipes + buffer − stock), worked out after the page loads.
- **Minimum**, **Order email** and **Auto-draft** edit in place.

### Faster
Filter by **Deadline today**, **Deadline this week**, **Needs an order**, **Has a draft** or **No delivery days**, or group by next delivery or deadline. Columns, sort and filters are remembered on this device. Press \`/\` to search, \`j\`/\`k\` to move, Enter to open the side panel and \`x\` to select.`,
    related: ["ordering.today", "ordering.board.panel", "ordering.board.bulk", "ordering.cutoffs", "app.tables"],
    keywords: ["suppliers", "table", "delivery days", "deadline", "minimum order", "order email"],
  },
  {
    id: "ordering.board.suggested",
    area: "ordering",
    route: "/ordering",
    title: "Suggested order",
    body: "Roughly what the next order would come to and how many lines, from forecast sales, your recipes, the buffer and estimated stock. Same numbers as Build order. Items never counted aren't suggested until they are.",
    related: ["ordering.builder.formula", "ordering.builder.needsCount"],
    keywords: ["suggested", "estimate", "how much"],
  },
  {
    id: "ordering.board.panel",
    area: "ordering",
    route: "/ordering",
    title: "Supplier side panel",
    body: "Tap a supplier (or press Enter) for its next deadline, the suggested order line by line with its total, recent orders and any suggestion from your invoices, with Build order, Open draft, Draft this order and Edit deadlines.",
    related: ["ordering.board", "app.tables.panel"],
    keywords: ["panel", "details", "preview"],
  },
  {
    id: "ordering.board.bulk",
    area: "ordering",
    route: "/ordering",
    title: "Draft several orders at once",
    body: "Tick suppliers, then Draft orders: each one's suggested order is saved as a draft for its next delivery, like the morning auto-draft. Suppliers already ordered or needing nothing are skipped. You can also turn auto-draft on or off, open or email drafts, or export.",
    related: ["ordering.board", "ordering.cutoffs", "app.tables.bulk"],
    keywords: ["bulk", "draft all", "auto-draft", "select"],
  },
];
