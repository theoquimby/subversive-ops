import type { HelpEntry } from "../types";

/** "What I look after": what the Overview and the briefs lead with, per person (domain/focus.ts). */
export const focus: HelpEntry[] = [
  {
    id: "settings.focus",
    area: "settings",
    route: "/settings/notifications",
    title: "What I look after",
    body: "Pick the areas you look after: business, brewery, kegs, kitchen, people or online. The Overview and your morning and weekly briefs lead with them, in the order you pick. The rest folds into Elsewhere, and anything urgent always shows.",
    article: `Each manager can pick what they look after, so the Overview and the briefs lead with what they care about. Zane might pick **Brewery** and **Kegs**; Max **Business**, **Kitchen** and **People**.

### The areas
- **Business**: sales, the P&L, labor cost, money, beer tax, private events and upkeep.
- **Brewery**: tanks, brews, brewing stock and brewery orders.
- **Kegs**: taps, the walk-in, the keg fleet and wholesale orders.
- **Kitchen**: prep, counts, ordering, invoices and menu costs.
- **People**: the schedule, timecards, the team, training and closing lists.
- **Online**: the website, Google, social and reviews.

### What changes
- **Overview**: your areas' sections come first, in your order, with **Needs you** at the top (right under Today when Business leads). Picking Brewery adds a Brewery card: what's in each tank, what's due and brewery orders. Everything else is one line per area under **Elsewhere**; tap a line to see what's waiting there.
- **Morning brief** (page, email and phone): **Before tonight** keeps your areas; yesterday's numbers and today's forecast show when you look after the business. The rest is a short Elsewhere list.
- **Weekly brief** (page and email): the same, and the brewery's to-dos are added when Brewery is one of yours.

Anything red or very close to its deadline (a missed order, overdue beer tax, equipment down, an overdue transfer) shows to everyone, whatever they picked.

Pick nothing and you see everything, as before. It never changes what you can open or do; roles still decide that.

### Where to set it
Your own: [Settings → Notifications](/settings/notifications#focus), or the prompt on the Overview. A manager can set it for another manager from their row on [Team](/team).`,
    related: ["overview.elsewhere", "brief.elsewhere", "overview.brewery", "brief.morning"],
    keywords: ["focus", "role", "my areas", "brewer", "personalise", "personalize", "lead with", "what I care about"],
  },
  {
    id: "overview.elsewhere",
    area: "overview",
    route: "/",
    title: "Elsewhere",
    body: "The areas you don't look after, one line each: how many things are waiting there and the first of them. Tap a line to see them all. Urgent ones are already up in Needs you.",
    related: ["settings.focus", "overview.needs"],
  },
  {
    id: "overview.brewery",
    area: "overview",
    route: "/",
    title: "Brewery on the Overview",
    body: "Shows when the brewery is something you look after: each tank in use with its brew and day, a badge when it's ready to transfer or package, brewery orders due, and the next brew.",
    related: ["settings.focus", "brewery.tanks"],
  },
  {
    id: "brief.elsewhere",
    area: "brief",
    route: "/brief",
    title: "Elsewhere in the brief",
    body: "With what you look after picked, everything else in the brief is one line per area: how many things wait there, or today's forecast and crew when nothing does. Anything urgent stays in your list.",
    related: ["settings.focus", "brief.tonight"],
  },
];
