import type { HelpEntry } from "../types";

// ---- Private events & parties (/events/private) ----------------------------------------

const route = "/events/private";
const tour = "private-events";

export const privateEvents: HelpEntry[] = [
  {
    id: "events.private.page",
    area: "events",
    route,
    tour,
    title: "Private events",
    body: "Every party, buyout, rehearsal dinner and corporate night in one list, from first inquiry to paid in full. Confirmed bookings go on the events calendar and into the forecast by themselves.",
    article: `Each booking moves through five stages:

1. **Inquiry** — someone asked. Add their name, a way to reach them, the date and roughly how many.
2. **Quoted** — the quote has gone out (copying the link or emailing it moves it here).
3. **Deposit paid** — the deposit is recorded. Recording it moves the booking here on its own.
4. **Confirmed** — details are locked. It goes on the [events calendar](/events) as a private event and the forecast plans for it.
5. **Done** — it happened. Close it out once the balance is in.

Anything can be marked **Lost** and reopened later.

Overdue deposits, balances coming due, follow-ups and new inquiries with no quote show up under **Needs you** on the [Overview](/).`,
    related: ["events.private.stages", "events.private.quote", "events.private.payments", "events.page"],
    keywords: ["party", "parties", "buyout", "rehearsal", "wedding", "corporate", "booking", "catering", "inquiry"],
  },
  {
    id: "events.private.stats",
    area: "events",
    route,
    title: "The numbers at the top",
    body: "In the pipeline: inquiries and quotes not yet won. Booked: deposit paid or confirmed in the next 60 days. Deposits waiting: quotes with the deposit still out. Balances owed: what's left after deposits.",
    related: ["events.private.page"],
  },
  {
    id: "events.private.new",
    area: "events",
    route,
    tour,
    title: "New inquiry",
    body: "Type the client's name and an email or phone (one box, it works out which), the date and guests if you know them, then Add. It opens the booking so you can build the quote right away.",
    related: ["events.private.quote"],
    keywords: ["add", "new", "lead"],
  },
  {
    id: "events.private.table",
    area: "events",
    route,
    tour,
    title: "Bookings table",
    body: "One row per booking. Change the stage, guests, space and owner right in the row. Next step says what to do: send the quote, chase a deposit, confirm, or mark it done. Open shows what's still live; Done and Lost show the rest.",
    related: ["events.private.board", "app.tables.keys"],
  },
  {
    id: "events.private.board",
    area: "events",
    route,
    tour,
    title: "Board",
    body: "The same bookings in a column per stage, soonest first, with each column's total. The button under a booking moves it to the next stage if it has what that stage needs.",
    related: ["events.private.table", "events.private.stages"],
    keywords: ["kanban", "columns"],
  },
  {
    id: "events.private.detail",
    area: "events",
    route,
    title: "A booking",
    body: "Details on the left, the quote under them. Totals, sending the quote and payments sit on the right (below on a phone). Everything saves as you type.",
    related: ["events.private.details", "events.private.quote", "events.private.totals"],
  },
  {
    id: "events.private.stages",
    area: "events",
    route,
    tour,
    title: "Stages",
    body: "Tap a stage to move there. Moving forward checks what it needs: a date, guests and a priced quote to be Quoted; the deposit recorded to be Deposit paid or Confirmed; the date passed to be Done. Moving back is always allowed.",
    related: ["events.private.page", "events.private.payments"],
    keywords: ["pipeline", "status", "lost", "reopen"],
  },
  {
    id: "events.private.details",
    area: "events",
    route,
    title: "Details",
    body: "Client, contact, type, date and time, guests, space and who's looking after it. Changing the date, time or guests on a confirmed booking updates its calendar entry and forecast too.",
    related: ["events.private.spaces", "events.private.followup"],
  },
  {
    id: "events.private.followup",
    area: "events",
    route,
    title: "Follow up on",
    body: "Pick a day to check back with the client. On that day it shows under Needs you on the Overview until you move the booking along or clear the date.",
    related: ["events.private.page"],
    keywords: ["reminder", "chase", "call back"],
  },
  {
    id: "events.private.quote",
    area: "events",
    route,
    tour,
    title: "Quote builder",
    body: "Add a package or menu items (prices come from the menu; change any for this quote) or a custom line. Qty is per guest or a total — tap the small label under it to switch. Cost comes from your recipes.",
    article: `- **Packages** are priced per guest. Set them up in [Packages & defaults](/events/private/setup).
- **Menu items** are any recipe with a menu price. A line can be *per guest* (one burger each) or a *total* (three wing platters).
- **Custom lines** are for anything else — an outside cake, a special platter. Give them a cost if you want the margin to count it.
- Below the lines: the bar, room fee, service charge, tax and deposit.`,
    related: ["events.private.bar", "events.private.totals", "events.private.packages"],
    keywords: ["menu", "price", "package", "line"],
  },
  {
    id: "events.private.bar",
    area: "events",
    route,
    title: "Bar options",
    body: "Drink tickets: a count × a price. Open tab: an estimate, billed on what's poured. Bar minimum: the least they'll spend at the bar. Bar cost for the margin uses the bar cost % from Packages & defaults.",
    related: ["events.private.quote", "events.private.defaults"],
    keywords: ["drinks", "tickets", "open bar", "minimum", "tab"],
  },
  {
    id: "events.private.service",
    area: "events",
    route,
    title: "Service charge and tax",
    body: "Service charge is a percent of food and bar (not the room fee). NY sales tax is charged on everything, service charge included, since NY taxes a set service charge. Both start from your defaults.",
    related: ["events.private.defaults", "events.private.totals"],
    keywords: ["gratuity", "tax", "8%", "sales tax"],
  },
  {
    id: "events.private.deposit",
    area: "events",
    route,
    title: "Deposit",
    body: "A percent of the total, or type a fixed amount to use instead (clear it to go back to the percent). Due dates fill in when the quote goes out: the deposit a week later, the balance a few days before the event.",
    related: ["events.private.payments", "events.private.defaults"],
    keywords: ["deposit", "due", "balance"],
  },
  {
    id: "events.private.totals",
    area: "events",
    route,
    tour,
    title: "Totals and margin",
    body: "What the client pays, then deposit, paid and balance. The grey box is just for you: food cost from your recipes, an estimated bar cost, and the margin before labor. A * means some lines have no cost yet.",
    related: ["events.private.quote", "menu.page"],
    keywords: ["margin", "food cost", "profit"],
  },
  {
    id: "events.private.share",
    area: "events",
    route,
    tour,
    title: "Sending the quote",
    body: "Copy link gives a private page the client can open on any phone, print, and accept by typing their name. Email it sends that link if email is set up. You'll see when it was opened and accepted.",
    article: `- The link is long and random, so only people you send it to can open it. **Make a new link** stops the old one working.
- The client's page shows prices, the deposit and due dates — never your costs, margins or notes.
- Accepting records their name and the time. It doesn't take payment; record the deposit when it comes in.
- No email set up? Copy the link and text it. Email lives in Settings → Connections.`,
    related: ["events.private.payments"],
    keywords: ["send", "link", "email", "accept", "share", "print"],
  },
  {
    id: "events.private.payments",
    area: "events",
    route,
    tour,
    title: "Payments",
    body: "Record each deposit or payment as it comes in. Once payments cover the deposit, the booking moves to Deposit paid. Write a reminder makes a friendly note to text or email; with Square connected you can make a payment link.",
    article: `- **Record payment** — amount, date, what it's for and how it was paid.
- **Email a reminder / Write a reminder** — a short note with the amount and due date. Without email set up you get the text to copy.
- **Square payment link** — a Square checkout page for what's owed. It needs Square connected with permission to take payments; if Square says no, reconnect Square or record payments by hand.
- Deposits and balances due in the next 3 days, or overdue, show under **Needs you** on the Overview.`,
    related: ["events.private.deposit", "events.private.stages"],
    keywords: ["paid", "deposit", "balance", "square", "reminder", "card", "cash"],
  },
  {
    id: "events.private.setup",
    area: "events",
    route: "/events/private/setup",
    tour,
    title: "Packages & defaults",
    body: "Your per-guest packages, the spaces you rent, and the tax, service charge, deposit and due dates new quotes start with.",
    related: ["events.private.packages", "events.private.spaces", "events.private.defaults"],
  },
  {
    id: "events.private.packages",
    area: "events",
    route: "/events/private/setup",
    tour,
    title: "Packages",
    body: "A package has a price per guest and the recipes in it, with portions per guest (0.5 = one for every two). That gives the real food cost per guest, and tells the prep list what to make.",
    related: ["events.private.quote", "menu.page"],
    keywords: ["buffet", "package", "per person", "menu"],
  },
  {
    id: "events.private.spaces",
    area: "events",
    route: "/events/private/setup",
    title: "Spaces",
    body: "The whole taproom, the patio, the back room — whatever you rent out, with how many it holds. Mark a space Buyout when it closes the place to the public; the forecast then swaps the normal day for the party.",
    related: ["events.private.details", "events.impact"],
    keywords: ["room", "patio", "back room", "capacity", "buyout"],
  },
  {
    id: "events.private.defaults",
    area: "events",
    route: "/events/private/setup",
    title: "New quote defaults",
    body: "Sales tax (8% in Greene County), service charge, deposit percent, when the deposit and balance are due, and the bar cost % used for margins. Each quote can still be changed on its own.",
    related: ["events.private.service", "events.private.deposit"],
    keywords: ["tax rate", "defaults", "service charge"],
  },
];
