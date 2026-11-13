import type { HelpEntry } from "../types";

/** Insights: /insights, plus where insights show up elsewhere (Overview, Sales, brief, Ask). */
export const insights: HelpEntry[] = [
  {
    id: "insights.page",
    area: "insights",
    route: "/insights",
    title: "Insights",
    body: "What your numbers say you should do, in dollars a month. Each finding has one number, one action, how sure we are, and how we worked it out.",
    article: `Open it from **Numbers → Insights**.

- **Top 5 opportunities** are the biggest money moves right now, ranked by dollars a month × how sure we are.
- **Worth knowing** is the insight feed: other things the numbers turned up — supplier prices creeping, events that pay (or don't), stock gaps, schedules running heavy. Things you've already seen fade unless they change.
- **The models** are one card per question: menu engineering, price response, forecast ranges, order sizes, staffing by hour, profit drivers and break-even, unusual days.

Everything is recalculated every night after the Square sync. Press **Refresh** to work it out again now (a few seconds).

### How sure are we?

Every card says how much history it's based on: "Based on 9 weeks — rough" means treat it as a strong hint, not a promise. Numbers are deliberately cautious: ranges instead of single figures, noisy estimates pulled toward typical values, and price moves picked assuming guests are a bit more price-sensitive than our best guess.

### Done, Later, Not useful

- **Done** hides it and, for price changes, we track what it really did ("Since raising the pretzel $1: +$212/month").
- **Later** hides it for 2 weeks.
- **Not useful** hides it and shows you fewer findings of that kind.`,
    related: ["insights.top", "insights.feed", "insights.confidence", "insights.how"],
    keywords: ["analytics", "insights", "recommendations", "opportunities", "what should i do", "models", "statistics"],
  },
  {
    id: "insights.top",
    area: "insights",
    route: "/insights",
    title: "Top 5 opportunities",
    body: "The five biggest money moves right now, ranked by dollars a month × how sure we are. One-off amounts (like cash tied up in stock) count at a twelfth a month.",
    related: ["insights.page", "insights.confidence"],
  },
  {
    id: "insights.feed",
    area: "insights",
    route: "/insights",
    title: "Worth knowing",
    body: "The insight feed: surprising findings ranked by dollars × confidence × how new they are. What you mark Not useful shows up less; what you've seen for weeks fades unless it changes.",
    article: `The feed runs a set of finders every night. Each only speaks up when the data supports it:

- **Hours worth opening**: the first or last hour of a day whose labor costs more than the margin it brings.
- **Event payback**: extra profit from game nights, music and festivals against a normal same weekday, after extra labor — and whether the impact you planned on the Events page matches what really happens.
- **Supplier price creep**: how much each supplier's prices rose on what you actually buy, against general food inflation. Obvious typos (a 10× jump) are flagged separately.
- **Hidden leaks**: the margin gap between counts, waste and over-billed invoice lines, scaled to a month or a year.
- **Beer pour yield**: kegs emptying faster than pints sold, beyond normal foam loss.
- **Menu mix shifts**: a dish taking share from a higher-margin one.
- **Labor this week**: overtime coming up, and a schedule heavier than the labor target.
- **Cash in stock**: categories with more days on hand than typical.
- **Rain**: how much a wet day costs in sales and how many hours to trim.
- **Reviews and staffing**: slow-service complaints that land on lean nights.
- **Follow-through**: what a price change really did, before and after.`,
    related: ["insights.page"],
    keywords: ["feed", "findings", "snooze", "dismiss", "not useful"],
  },
  {
    id: "insights.confidence",
    area: "insights",
    title: "Confidence",
    body: "How much history a number rests on and how well the model fits it: rough (under 2 months or no direct evidence), fair, or solid (4+ months and a good fit).",
    related: ["insights.page", "insights.how"],
  },
  {
    id: "insights.how",
    area: "insights",
    title: "How we worked this out",
    body: "Every card opens to show the method in plain English and the inputs behind the number, so you can check it against what you know.",
    related: ["insights.page"],
  },
  {
    id: "insights.menu",
    area: "insights",
    route: "/insights#menu",
    title: "Menu engineering",
    body: "Each dish placed by popularity and margin: Stars (keep), Workhorses (popular, low margin — nudge the price), Puzzles (high margin, few sold — promote), Dogs (rework or drop).",
    article: `Popularity is an item's share of what its group sells against 70% of an even share; margin is price minus plate cost against the group's average (food and drinks are compared separately). The card names the one move worth most a month, priced with the price response so volume loss is included.

Dishes whose plate cost looks wrong (missing prices, or more than 90% of the price) are left out and named in "How we worked this out" — fix the ingredient price and they come back.`,
    related: ["insights.price", "menu.page"],
    keywords: ["stars", "dogs", "puzzles", "workhorses", "kasavana", "menu mix"],
  },
  {
    id: "insights.price",
    area: "insights",
    route: "/insights#price",
    title: "Price response",
    body: "How many fewer you'd sell if a price goes up, and what that does to profit. Drag the slider to try a price.",
    article: `When an item's price has really changed (and stayed changed for a couple of weeks), we measure the response from your own sales, allowing for weekday and store traffic. Otherwise we use typical figures for that kind of item — the card says which.

To get your own number: change one price, leave it for 3+ weeks, and the card switches to "measured".`,
    related: ["insights.menu"],
    keywords: ["elasticity", "price increase", "raise prices", "what if"],
  },
  {
    id: "insights.forecast",
    area: "insights",
    route: "/insights#forecast",
    title: "Forecast ranges",
    body: "A statistical forecast for the next two weeks with an 80% range for each day, tested against what really happened and compared with the main forecast.",
    related: ["insights.forecast.ranges", "sales.forecast"],
    keywords: ["sarimax", "range", "confidence interval"],
  },
  {
    id: "insights.forecast.ranges",
    area: "insights",
    route: "/insights#forecast",
    title: "Likely range",
    body: "4 days in 5 should land inside the range. Staff and prep for the middle; have a call-in ready for the top.",
    related: ["insights.forecast"],
  },
  {
    id: "insights.orders",
    area: "insights",
    route: "/insights#orders",
    title: "Order quantities",
    body: "Checks each suggested order against the cost of running out vs throwing out, and says when one more or one fewer pack is better.",
    article: `For each ingredient we look at use between this delivery and the next, how much it wobbles day to day, its shelf life, and what running out costs (the margin on dishes you can't sell). We never suggest worse than a 1-in-10 chance of running out.`,
    related: ["ordering.page"],
    keywords: ["newsvendor", "par", "waste", "running out"],
  },
  {
    id: "insights.anomalies",
    area: "insights",
    route: "/insights#anomalies",
    title: "Unusual days",
    body: "Days in the last two weeks where sales, labor %, food cost % or waste were far off normal for that kind of day — with what to check.",
    related: ["insights.page"],
  },
  {
    id: "insights.drivers",
    area: "insights",
    route: "/insights#drivers",
    title: "Profit drivers & break-even",
    body: "Which lever moves monthly profit most — prices, labor hours, waste or more guests — and the daily sales you need to break even.",
    related: ["insights.fixedCosts"],
    keywords: ["break even", "breakeven", "levers", "profit"],
  },
  {
    id: "insights.fixedCosts",
    area: "insights",
    route: "/insights#drivers",
    title: "Fixed costs",
    body: "Rent, utilities, insurance and anything else you pay every month regardless of sales. Only used for break-even; saves as you type.",
    related: ["insights.drivers"],
  },
  {
    id: "insights.staffing",
    area: "insights",
    route: "/insights#staffing",
    title: "Staffing by hour",
    body: "Sales per labor hour for every hour of the week. Hours with more people than the sales need (never below a crew of 2) are priced in dollars a month.",
    related: ["schedule.page"],
    keywords: ["splh", "sales per labor hour", "overstaffed", "understaffed"],
  },
  {
    id: "insights.overview",
    area: "insights",
    route: "/insights",
    title: "Worth your attention",
    body: "The top findings from Insights. Mark them Done, Later or Not useful here or on the Insights page.",
    related: ["insights.page"],
  },
  {
    id: "insights.brief",
    area: "insights",
    route: "/brief",
    title: "Insights in the brief",
    body: "The three findings worth most this week, the same ones the Sunday email and push lead with.",
    related: ["insights.page", "brief.page"],
  },
];
