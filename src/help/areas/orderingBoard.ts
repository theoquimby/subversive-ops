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

- **Order by …** — a deadline in the next 48 hours and no order yet. The countdown turns amber under a day and red under 6 hours. **Build order** opens the suggested order to adjust; **Draft** saves it as a draft in one tap and opens it. Suppliers ordered **when stock runs low** only show here when something runs short, and suppliers with reminders off never do.
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
    article: `Every active kitchen supplier in one table, soonest deadline first. Brewery suppliers are ordered from the Brewery and aren't listed.

Suppliers ordered **when stock runs low** that need nothing right now sit in a collapsed **Nothing needed** list under the table instead of looking overdue, with a "count needed to know" note when counts are missing or older than 21 days.

### Columns
- **Orders** — Every delivery or When low. See [Every delivery or when stock runs low](/help/ordering.cadence).
- **Delivers** — tap a day to switch it on or off. Saves straight away.
- **Order by** — the next deadline and time left. "Guessed" means no deadline is set for that delivery day yet, so it's worked out from the lead time. The calendar button opens the deadlines for every delivery day.
- **Status** — No order, Draft, Sent or Received for the next delivery, with its total and lines.
- **Suggested** — the suggested order for the next delivery (forecast × recipes + buffer − stock), worked out after the page loads.
- **Minimum**, **Order email** and **Auto-draft** edit in place.

### Faster
Filter by **Deadline today**, **Deadline this week**, **Needs an order**, **Has a draft** or **No delivery days**, or group by next delivery or deadline. Columns, sort and filters are remembered on this device. Press \`/\` to search, \`j\`/\`k\` to move, Enter to open the side panel and \`x\` to select.`,
    related: ["ordering.today", "ordering.cadence", "ordering.board.panel", "ordering.board.bulk", "ordering.cutoffs", "app.tables"],
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
    body: "Tap a supplier (or press Enter) for its next deadline, the suggested order line by line, recent orders, how often you order, its reminders and how it takes orders, with Build order, Open draft, Draft this order and Edit deadlines.",
    related: ["ordering.board", "ordering.reminders", "ordering.sendBy", "app.tables.panel"],
    keywords: ["panel", "details", "preview"],
  },
  {
    id: "ordering.cadence",
    area: "ordering",
    route: "/ordering",
    title: "Every delivery or when stock runs low",
    body: "Every delivery: Ops expects an order for each truck and reminds you if none is placed. When stock runs low: it only speaks up when counts and sales say something runs short before the delivery after next. Otherwise the supplier sits quietly under Nothing needed.",
    article: `Each kitchen supplier has an **Orders** switch on Ordering and in Settings → Suppliers.

### Every delivery
For suppliers you order from for every truck (Driscoll, Kilcoyne, See & Be). A deadline with nothing placed shows in Today, in Needs you on the Overview and in the morning brief, with reminders before the cutoff.

### When stock runs low
For everyone else. Ordering now is your last chance before the delivery *after* the next one, so for each item Ops works out:

- what's on hand: the last count, plus deliveries since, less what sales and waste used since,
- what the forecast uses until that later delivery,
- the safety level: the item's buffer of one delivery's use, or its minimum on hand.

The supplier **needs an order** only if some item would drop below its safety level before then (or already has). Then it nags like any other supplier. If not, it sits under **Nothing needed** at the bottom of the table.

### When counts are missing
Items never counted, or last counted more than **21 days** ago, aren't guessed at: they don't raise an alert. The supplier shows a quiet "count needed to know" note instead. Count them and the check works again.

Auto-drafts follow the same rule: a "when stock runs low" supplier only gets a draft when something runs short.`,
    related: ["ordering.reminders", "ordering.cutoffs", "ordering.builder.needsCount", "settings.suppliers"],
    keywords: ["cadence", "as needed", "weekly", "nag", "stop reminding", "when low", "nothing needed", "every delivery"],
  },
  {
    id: "ordering.reminders",
    area: "ordering",
    route: "/ordering",
    title: "Order reminders",
    body: "Per supplier: remind every delivery, only when stock runs low, or never; a first reminder a day, 4 hours or the morning before the cutoff; a last call if nothing is placed; and who gets them. A missed cutoff shows in Needs you and the brief.",
    article: `Set these in a supplier's side panel on Ordering, or in Settings → Suppliers.

- **Remind me** — follows the Orders switch unless you pick Every delivery, Only when stock runs low, or Off.
- **First reminder** — a day before, 4 hours before, or the morning of the cutoff (at your morning brief time).
- **Last call** — "You haven't placed it", 30 minutes, 1 hour (the default) or 2 hours before the cutoff, if nothing is sent yet. A saved draft doesn't count as placed.
- **Who gets them** — managers, specific people, or whoever is on today's schedule and can place orders (managers if nobody is). They arrive by push, and by email for anyone who turned it on in Settings → Notifications (Order reminders).

If a cutoff passes with nothing ordered you'll see **Missed: … cutoff passed with no order — next chance …** in Needs you on the Overview and in the morning brief, plus one push.

Reminders run through the day on a schedule, so one can arrive up to about an hour after its set time. Nothing is ever sent to a supplier on its own.`,
    related: ["ordering.cadence", "ordering.cutoffs", "settings.notifications"],
    keywords: ["reminder", "alert", "notification", "last call", "forgot", "missed", "push"],
  },
  {
    id: "ordering.sendBy",
    area: "ordering",
    route: "/ordering",
    title: "How each supplier takes orders",
    body: "Pick Email, Text message, Their website or app, or Phone call per supplier. The order's main button follows it: email it, open Messages with the order typed in, copy it with item numbers for their site, or a call script. You always press send.",
    article: `Set **Send orders by** (and their number or site) in the supplier's side panel or Settings → Suppliers. On a draft order the main button changes:

- **Email** — emails the order with a spreadsheet attached and marks it sent.
- **Text message** — builds a short message (greeting, delivery day, one line per item, sign-off). On a phone, **Open Messages** opens your Messages app with it typed in; check it and press send there. On a computer, copy the message and the number. Then press **I sent it**.
- **Their website or app** (Driscoll, Cut+Dry…) — **Copy order** gives the final quantities with their item numbers, in their own order where Ops knows it (from their invoices), as text or a CSV file, plus an **enter as you go** checklist: tick each line as you key it in. Ops never logs into their site for you. Then press **I placed it**.
- **Phone call** — a call script with every line and a button to dial. Then **I placed it**.

Nothing is sent automatically, and texts go from your own phone: Ops doesn't use a paid texting service.`,
    related: ["ordering.po", "ordering.staff", "settings.suppliers"],
    keywords: ["text", "sms", "portal", "cut+dry", "driscoll", "phone", "call", "send by", "csv", "item numbers"],
  },
  {
    id: "ordering.staff",
    area: "ordering",
    route: "/my/ordering",
    audience: "all",
    title: "Placing an order",
    body: "Pick a supplier, check the suggested order (each line says why: on hand, and what's needed by when), change any quantity, then press the one send button for that supplier. It warns you about anything unusual. Nothing goes out until you send it.",
    article: `Managers choose who can order in Settings → Suppliers (**Staff who can place orders**). They get **Supplier orders** on their Today screen.

1. **Check** — the suggested lines, each with why ("On hand 3 case, need 9 by Fri"). Use − and + to change them. **Add something else** lists the rest of that supplier's items.
2. **Send** — one button that fits the supplier: email, text, their website or a phone call.
3. **Done** — the order counts as on its way.

It asks you to double-check when a quantity is more than 3× the usual, when nothing is on the order, or when the cutoff has already passed (call or text first).`,
    related: ["ordering.sendBy", "ordering.cadence"],
    keywords: ["staff", "order", "guided", "phone", "place order"],
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
