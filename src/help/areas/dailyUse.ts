import type { HelpEntry } from "../types";

/**
 * Release 1.8 — daily use: every number on the Overview, P&L and morning brief
 * explains itself (what it is, how it's worked out, what's good), the plate-cost
 * breakdown, and logins whose role change applies straight away.
 */
export const dailyUse: HelpEntry[] = [
  {
    id: "overview.labor",
    area: "overview",
    route: "/",
    title: "Labor, last 7 days",
    body: "Wages for the last 7 days ÷ net sales. Wages are hours on timecards × each person's pay rate. For a taproom with a kitchen, 25–30% is healthy; above your target means more hours than the sales needed.",
    article: `**What it is.** How much of every sales dollar went to the people working: labor cost ÷ net sales.

**How it's worked out.** Each timecard's hours × that person's pay rate (from Team), added up for the last 7 days, divided by the same 7 days' net sales from Square. Shifts with no pay rate count as $0 and the card says how many.

**What's good.** Most full-service places run 25–35%. Set your own target on [Budgets](/budgets): the number turns amber or red when it's over. A slow week pushes the percent up even when nobody worked extra — fewer guests, same crew — so check the sales card next to it before cutting hours.`,
    related: ["overview.profit", "pnl.labor", "pnl.splh"],
    keywords: ["wages", "labour", "payroll %"],
  },
  {
    id: "pnl.sales",
    area: "pnl",
    route: "/pnl",
    title: "Net sales",
    body: "What guests paid for food and drink in the period, from Square: after discounts and refunds, before tax and tips. The arrow compares with the period before; the badge with your budget or the forecast.",
    article: `**What it is.** The money that's really yours from what you sold — the starting line for every other number on this page.

**How it's worked out.** Square's gross sales − discounts − refunds/comps, for each day in the period. Sales tax and tips are left out (they belong to the state and the staff).

**What's good.** Compare against the same period last year and your budget rather than last week: weather, events and the season move sales a lot. If the badge says "vs forecast", the forecast already allows for the day of the week and the time of year.`,
    related: ["pnl.page", "pnl.kpis", "pnl.forecast"],
    keywords: ["revenue", "net", "gross"],
  },
  {
    id: "brief.figure.sales",
    area: "brief",
    route: "/brief",
    title: "Yesterday's sales",
    body: "Net sales from Square for the whole business day: after discounts and refunds, without tax or tips. Orders is the number of tickets.",
    related: ["brief.figure.vsForecast", "pnl.sales"],
  },
  {
    id: "brief.figure.vsForecast",
    area: "brief",
    route: "/brief",
    title: "Versus forecast",
    body: "How sales landed against what the forecast expected for that day (same weekday, recent trend, season, weather and events). Within 3% is on plan (green); 15% or more under is worth a look (amber).",
    related: ["sales.forecast5w", "brief.figure.sales"],
  },
  {
    id: "brief.figure.labor",
    area: "brief",
    route: "/brief",
    title: "Labor %",
    body: "Wages ÷ net sales for the day: timecard hours × pay rates. Green is at or under your target, amber a little over, red more than 3 points over. A quiet day pushes it up even with a normal crew.",
    related: ["overview.labor", "pnl.labor"],
  },
  {
    id: "brief.figure.profit",
    area: "brief",
    route: "/brief",
    title: "Profit (estimated)",
    body: "Net sales − what the food and drink sold should have cost (recipes × prices) − wages. Before rent, utilities and other fixed costs, so it's what the day contributed, not the bottom line. Items not linked to a recipe count at a typical 30%.",
    related: ["overview.profit", "pnl.page"],
  },
  {
    id: "menu.editor.breakdown",
    area: "menu",
    route: "/menu",
    title: "Where the plate cost comes from",
    body: "Tap the Plate cost card for the breakdown: every ingredient line's share of the cost, biggest first, with the sum written out. Each line opens the ingredient — its supplier, price, pack size and yield.",
    article: `**The sum.** Plate cost = for each line, the amount on the plate × what that ingredient costs per unit **after trim and yield**, at the latest price on file.

**Where a price comes from.** The ingredient's linked supplier product: the last invoice or price sheet, divided down to the unit (a $72 case of 40 lb is $1.80 a lb). If an ingredient's yield is 80%, every usable pound costs 1 ÷ 0.8 = 1.25× the bought price.

**Prep recipes.** A line that's a prep recipe (aioli, pulled pork) costs its batch cost ÷ what the batch makes — open it to see its own breakdown.

**Missing prices.** A line with no price adds $0 and is flagged, so the plate really costs more than the card shows until you add one.`,
    related: ["menu.editor.summary", "menu.editor.lines", "ingredients.yield"],
    keywords: ["plate cost", "drill down", "why", "how calculated"],
  },
  {
    id: "settings.people.liveRole",
    area: "settings",
    route: "/settings/people",
    title: "Role changes apply straight away",
    body: "Switching a login between Staff and Manager (or switching it off) takes effect on that person's next tap — they don't need to sign out. Staff see Today, shifts, counts, waste, prep, kegs and shift notes; managers see everything, including costs, pay and settings.",
    related: ["settings.people.role"],
    keywords: ["permissions", "access", "promote", "demote"],
  },
];
