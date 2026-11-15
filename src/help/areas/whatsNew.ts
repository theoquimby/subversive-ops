import type { HelpEntry } from "../types";

/** What's new, the setup checklist and Max's quick start. */
export const whatsNew: HelpEntry[] = [
  {
    id: "app.whatsNew",
    area: "basics",
    title: "What's new",
    body: "The latest changes as short cards, with Show me to go straight there. It opens by itself once after an update; after that it's in the help menu and ⌘K.",
    article: `When something new lands, **What's new** opens once with a card for each change: what it is in a line, and **Show me**, which takes you to the page and starts a short tour when there is one.

- Find it again any time: the **?** help menu → **What's new**, or press ⌘K and type “new”.
- A small dot on the help button means there's something you haven't looked at yet.
- You only see what's for you: staff see the things on their phone, managers see the rest.
- Closing it (or tapping Show me) marks everything as seen, on every device you use.`,
    keywords: ["new", "changes", "updates", "release", "latest", "features"],
    audience: "all",
    related: ["app.quickStart", "app.tours"],
  },
  {
    id: "welcome.checklist",
    area: "basics",
    route: "/welcome/checklist",
    title: "Setup checklist",
    body: "What to connect and set up, essentials first. Each item ticks itself off when the thing is really there — connect Square and it's done. Do it takes you to the right page.",
    article: `The checklist on Overview (**Finish setting up**) and on its own page shows what's left to set up, split in two:

### Essentials
Without these the numbers are empty or guessed: connect Square, bring in your sales history, link Square items to recipes, suppliers with delivery deadlines, storage areas, staff logins and the time your morning brief arrives.

### Nice to have
Each turns on something extra: the prep list, beers and the tap list TV, AI features, QuickBooks, the website and Google.

Nothing is ticked by hand: each item checks the real thing (is Square connected? are most items linked?), so it never gets out of date. The Overview card goes away once the essentials are done — or tap × to hide it sooner. The whole list stays at [Setup checklist](/welcome/checklist).`,
    keywords: ["setup", "onboarding", "checklist", "finish setting up", "getting started"],
    related: ["app.quickStart", "overview.setup"],
  },
  {
    id: "app.quickStart",
    area: "basics",
    route: "/welcome/checklist",
    title: "Max's quick start: your first week",
    body: "The ten things worth doing this week, in order, each with a link. About two hours in all, spread over a few days.",
    article: `Do these in order — each one makes the next more useful. Most take a few minutes; nothing needs to be perfect on the first go.

1. **Connect Square.** Go to [Settings → Square](/settings/square) and tap Connect. Then pick **All history** so the app learns from every sale you've ever made. It fills in by itself in the background.
2. **Link your Square items to recipes.** Open [Menu from Square](/sales/square-menu). Most items come with a suggestion — tap to accept. Items with no recipe yet? [Recipe drafts](/menu/drafts) writes a first draft from the name, a photo or your notes.
3. **Add your suppliers and their order-by times.** In [Settings → Suppliers](/settings/suppliers), give each one its delivery days and when to order by (e.g. Friday delivery ← Wednesday 5pm). [Ordering](/ordering) then counts down to each deadline and drafts the order for you.
4. **Put your storage areas in walking order.** [Settings → Storage areas](/settings/areas): walk-in, dry storage, bar… in the order you walk them. Then do your first [count](/count) on your phone.
5. **Invite your staff.** [Settings → People](/settings/people): add a login for each person and choose Staff or Manager. Staff get their own Today screen with shifts, prep, counts and kegs.
6. **Pick when your morning brief arrives.** Open the [Morning brief](/brief) and choose a time. Every morning you'll get yesterday in a line, today's forecast and what to do before tonight.
7. **Snap this week's invoices.** [Add an invoice](/invoices/new): take a photo (several pages is fine, store receipts too). Lines link to your ingredients and prices update when you approve.
8. **Set up the prep list.** [Prep setup](/prep/setup): pars, how long things keep and which station makes them. The kitchen then gets a [prep list](/prep) every day worked out from the forecast.
9. **Add your beers and put the tap list on the TV.** [Beers](/kegs/beers), then [Tap list](/kegs/taps) → open the TV link on the bar TV. Scan a keg's label to kick it.
10. **Make Overview your morning habit.** [Overview](/) shows today's pace, what needs you and last night's notes. Once a week, look at the [P&L](/pnl) and the top idea in [Insights](/insights).

Done? The [Setup checklist](/welcome/checklist) shows anything still worth connecting — QuickBooks, AI features, the website and Google.`,
    keywords: ["start", "first week", "getting started", "quick start", "max", "where do i begin", "todo"],
    related: ["welcome.checklist", "app.whatsNew"],
  },
];
