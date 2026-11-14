import type { HelpEntry } from "../types";

/** Insights Lab: /insights, plus where it shows up elsewhere (Overview, Sales, brief, Ask). */
export const insights: HelpEntry[] = [
  {
    id: "insights.page",
    area: "insights",
    route: "/insights",
    title: "Insights Lab",
    body: "Your sales, wages and costs turned into one thing to do at a time. Each one says what's happening, why we think so, what to do, and what it's worth a month.",
    tour: "insights",
    article: `Open it from **Numbers → Insights**. It reads your Square sales, timecards and costs every night and asks: *where is money being left on the table?*

### Start at the top

**Today's one thing** is the single best move right now — the most money, that we're most sure of, that's easiest to do. A picture made for that kind of finding shows what's happening — a profit curve for a price to try, people on against people needed for an hour, a calendar of slow days, where an hour's sales go. Then it tells you in four steps:

1. **What's happening** — the plain facts ("Fridays 4–5pm: $210 of sales, 4.7 people on").
2. **Why we think so** — the comparison behind it.
3. **What to do** — one specific change.
4. **What you'd gain** — dollars a month, and a likely range.

Press **Do it** when you've done it (or will), **Remind me later** to see it again in two weeks, or **Not for us** if it doesn't fit how you run the place — you'll see fewer like it. The next one slides in.

### Then, when you have time

- **Up next** — everything else, one card per root cause, rated with dots. Sort by **Money saved**, **Money earned**, **Easiest first** or **Most certain**, or pick an area.
- **How it all connects** — your month as a chain (guests → sales → food, drink and wages → what's left), with sliders to try a price rise, fewer wage hours or more guests.
- **The Lab** — one tile per question (next two weeks, staffing, your week, your seasons, prices, menu, ordering, unusual days). Tiles that need more data list exactly what unlocks them.
- **Your track record** — what you've done and what it was worth.

On a phone, the shortcuts under the title (Today, Up next, Watching, How it connects, The Lab, Track record) jump straight to each part, and the Do it / Later / Not for us buttons stay under your thumb while you read the card. The worth of each move is always shown the same way: the monthly figure, with a bar for the likely range.

### How much history

The buttons at the top pick how much history every model learns from: **1, 2, 3 or 4 years, or All**. Three years is the default — enough to see the shape of the year and how guests react to price changes, recent enough to reflect how you run things now. Staffing always looks at the last 6 months, because schedules change.

### What we leave out

Today (it isn't finished), a day whose last sync ran before closing, closed days that only had a stray sale (a refund, a test order), and the setup before you open and cleanup after you close — those wages are expected and never counted against an hour.`,
    related: ["insights.hero", "insights.queue", "insights.range", "insights.story", "insights.lab", "insights.track"],
    keywords: ["analytics", "insights", "lab", "recommendations", "what should i do", "models", "statistics", "opportunities"],
  },
  {
    id: "insights.hero",
    area: "insights",
    route: "/insights",
    title: "Today's one thing",
    body: "The single best move right now: most money, most certain, easiest. Do it, Remind me later (2 weeks) or Not for us — the next one slides in.",
    related: ["insights.rating", "insights.queue"],
    keywords: ["do it", "remind me later", "not for us", "snooze", "dismiss", "top"],
  },
  {
    id: "insights.queue",
    area: "insights",
    route: "/insights",
    title: "Up next",
    body: "Everything else worth doing, one card per root cause — an hour that loses money and too many people on that hour are one card, not two. Sort by money saved, earned, easiest or most certain.",
    related: ["insights.rating", "insights.hero"],
    keywords: ["queue", "list", "sort", "filter", "money saved", "money earned", "easiest"],
  },
  {
    id: "insights.rating",
    area: "insights",
    route: "/insights",
    title: "The dots",
    body: "1–5 dots: up to 2½ for the money, 1½ for how sure we are, 1 for how easy it is. 4–5 is worth doing, 3 is a maybe, 1–2 is low.",
    related: ["insights.queue", "insights.confidence"],
    keywords: ["stars", "rating", "score", "worth doing", "maybe", "effort"],
  },
  {
    id: "insights.range",
    area: "insights",
    route: "/insights",
    title: "How much history",
    body: "Pick how much history every model learns from: 1–4 years or all. Three years is the default. Changing it works everything out again in a few seconds.",
    related: ["insights.page"],
    keywords: ["range", "years", "history", "window", "data range", "how far back"],
  },
  {
    id: "insights.story",
    area: "insights",
    route: "/insights#lab-story",
    title: "How it all connects",
    body: "Your month as a chain: guests × what they spend = sales; take off food, drink and wages; the rest is yours. Pull a lever below and the chain moves.",
    related: ["insights.whatif", "insights.drivers", "insights.fixedCosts"],
    keywords: ["drivers", "levers", "profit", "chain", "connects"],
  },
  {
    id: "insights.whatif",
    area: "insights",
    route: "/insights#lab-story",
    title: "Try it",
    body: "Sliders for higher prices, fewer wage hours a day and more guests. A price rise counts the few guests who'd buy a little less. Nothing changes until you change it in Square or the schedule.",
    related: ["insights.story"],
    keywords: ["what if", "slider", "simulate", "price rise"],
  },
  {
    id: "insights.lab",
    area: "insights",
    route: "/insights",
    title: "The Lab",
    body: "One tile per question. The big line is the answer, the small picture shows it, and “Show me how” has the evidence. Locked tiles list what unlocks them.",
    related: ["insights.setup", "insights.forecast", "insights.staffing", "insights.week", "insights.seasons"],
  },
  {
    id: "insights.setup",
    area: "insights",
    route: "/insights",
    title: "Needs setup",
    body: "A tile that needs data you haven't added yet — like recipes linked to Square items, or a stock count. Each step shows how far along it is and a button that goes there.",
    related: ["insights.lab", "insights.menu", "insights.orders"],
    keywords: ["locked", "needs more data", "unlock", "checklist"],
  },
  {
    id: "insights.track",
    area: "insights",
    route: "/insights",
    title: "Your track record",
    body: "What you've marked done and what it was expected to be worth — and, for price changes, what really happened before and after, allowing for how busy it was.",
    related: ["insights.page"],
    keywords: ["done", "history", "results", "follow up", "before and after"],
  },
  {
    id: "insights.confidence",
    area: "insights",
    title: "How sure we are",
    body: "“A hunch” means little history or no direct evidence; “Fairly sure” a few months that agree; “Pretty sure” a long, steady pattern. Numbers lean cautious either way.",
    related: ["insights.rating"],
  },
  {
    id: "insights.how",
    area: "insights",
    title: "Show me how",
    body: "Every card opens to show what was compared: the raw numbers, the same numbers relative to how busy you were, the same weeks last year, what was left out (events, holidays, short days) and how sure we are.",
    article: `Every card has **Show me how**. It answers "why does it say that?" in the order a skeptic would ask:

1. **The raw numbers** — e.g. "Lager sold per open day: 4.9 → 2.5".
2. **How busy you were** — orders per open day before and after. If the place was quieter, the item is judged **per 100 orders**, with each weekday counted the same in both periods.
3. **The time of year** — what the same weeks did last year (and the year before) with no price change, so autumn isn't blamed on a price.
4. **What was left out** — event days, holidays like Labor Day, short days (closed early, storms) and days an item didn't sell at all (86'd, keg kicked).
5. **The result and its likely range** — drawn on a line with "no change" marked. If the range crosses "no change", it isn't reported as a result; it goes on the **Watching** list.
6. **How sure are we** — one line saying why.

The two or three numbers that matter come first as big figures, before-and-after numbers are drawn as two dots on a line, and each finding has its own small chart (week by week, side by side, or expected against what happened). Tap any mark on a chart for its numbers.`,
    related: ["insights.page", "insights.watching", "insights.confidence"],
    keywords: ["why", "explain", "evidence", "relative", "traffic", "per 100 orders", "last year", "how sure"],
  },
  {
    id: "insights.watching",
    area: "insights",
    route: "/insights#lab-watching",
    title: "Watching",
    body: "Things that looked like something on the raw numbers but don't hold up once we allow for how busy you were, the weekday mix, the season and events. Each says what would make it count.",
    article: `A raw before-and-after mixes the thing we're judging with everything else that moved at the same time. "30% fewer Lagers since the price went up" might just be 10% fewer guests and the start of autumn.

So before anything becomes a card, it's checked:

- **Relative to how busy you were** — per 100 orders, same weekday mix.
- **Against the same weeks last year** — or, for something new, against similar items.
- **Fair days only** — no events, holidays or short days.
- **Timing** — a price change works the day guests see it. If the first two weeks after didn't move, a later slide is put down to something else.
- **Size and steadiness** — the likely range has to stay clear of "no change", and staffing gaps have to show up most weeks, lately, and against other hours that bring in the same sales.

What doesn't pass is listed here instead of as a to-do, with exactly what would make it count ("about 3 more weeks of sales will tell").

The small bar on each row is the likely range drawn against a dark "no change" line (every row on the same scale). A bar that crosses the line means it could be nothing yet. Open a price change to see it before and after, next to the same weeks last year and the range we'd expect with no price change at all.`,
    related: ["insights.how", "insights.queue"],
    keywords: ["watching", "watch list", "not significant", "not sure", "why did it disappear", "traffic", "season"],
  },
  {
    id: "insights.forecast",
    area: "insights",
    route: "/insights#lab-forecast",
    title: "Next two weeks",
    body: "Each day's likely sales, from your weekdays, the time of year and the last few weeks. Tested on past days; 4 days in 5 land inside the range.",
    related: ["insights.forecast.ranges", "sales.forecast"],
    keywords: ["forecast", "range", "busy", "next week"],
  },
  {
    id: "insights.forecast.ranges",
    area: "insights",
    route: "/insights#lab-forecast",
    title: "Likely range",
    body: "4 days in 5 land inside the range. Staff and prep for the middle; have someone on call for the top.",
    related: ["insights.forecast"],
  },
  {
    id: "insights.staffing",
    area: "insights",
    route: "/insights#lab-staffing",
    title: "Staffing by hour",
    body: "Hour by hour over the last 6 months. An hour counts as over-staffed only if it has more people than that week's pace needs and than you usually put on for hours with the same sales — most weeks, and lately. Events, holidays, setup and cleanup are left out.",
    related: ["schedule.page", "insights.week"],
    keywords: ["sales per labor hour", "overstaffed", "understaffed", "stagger"],
  },
  {
    id: "insights.week",
    area: "insights",
    route: "/insights#lab-week",
    title: "Your week",
    body: "What an average day of each weekday leaves after food, drink and wages, over the last 12 months. Rent isn't taken off — you pay it whether you open or not.",
    related: ["insights.staffing", "insights.seasons"],
    keywords: ["weekday", "monday", "worth opening", "profit by day"],
  },
  {
    id: "insights.seasons",
    area: "insights",
    route: "/insights#lab-seasons",
    title: "Your seasons",
    body: "Each month against a typical month, from every year in the range, and how the last 12 months compare with the 12 before. Needs a full year of history.",
    related: ["insights.range", "insights.week"],
    keywords: ["seasonality", "slow months", "winter", "year over year"],
  },
  {
    id: "insights.price",
    area: "insights",
    route: "/insights#lab-price",
    title: "Prices",
    body: "Where $1 more would pay, after the few guests who'd buy a little less. When a price has really changed in Square, it uses how your own guests reacted.",
    article: `For each item we ask: if the price goes up $1, how many fewer would you sell, and what's left after its cost?

When an item's price has really changed in your Square history (and stayed changed for a few weeks), we measure how your guests reacted, week by week, allowing for how busy the place was and the time of year. One item's history is noisy, so it's blended with what similar items on your menu showed — and items that never changed price borrow from those. Weeks an item barely sold (off the menu, keg out) are left out, and an item that hasn't sold in the last four weeks never gets a price suggestion.

After you change a price, the follow-up compares the item **per 100 orders** (so a quieter month isn't blamed on the price), against what the same weeks did last year, leaving out events and holidays. Only a change whose likely range stays clear of "no change" is reported; the rest are on the **Watching** list.

Until items are linked to recipes we use a typical cost (beer about 22% of the price, food about 30%) and say so.`,
    related: ["insights.menu", "insights.whatif"],
    keywords: ["raise prices", "price increase", "what if", "price test"],
  },
  {
    id: "insights.menu",
    area: "insights",
    route: "/insights#lab-menu",
    title: "Menu",
    body: "Each dish by how much it sells and how much it earns: Stars (keep), Crowd-pleasers (nudge the price), Hidden gems (promote), Rethink (rework or drop). Popularity is judged against its own category and per day it was on the menu, so a new dish isn't marked down. Needs plate costs.",
    related: ["insights.price", "insights.setup", "menu.page"],
    keywords: ["menu engineering", "stars", "dogs", "puzzles", "workhorses", "menu mix"],
  },
  {
    id: "insights.orders",
    area: "insights",
    route: "/insights#lab-orders",
    title: "Ordering",
    body: "Checks each suggested order against running out vs throwing out, and says when one pack more or less is better. Needs a stock count and pack sizes.",
    related: ["ordering.page", "insights.setup"],
    keywords: ["par", "waste", "running out", "order size"],
  },
  {
    id: "insights.anomalies",
    area: "insights",
    route: "/insights#lab-anomalies",
    title: "Unusual days",
    body: "Days far off what was expected for that date: the same weekday lately, moved the way last year moved into that week, with events, rain and holidays built in. A slow day counts fully against the crew only if it was foreseeable when the schedule was written.",
    related: ["insights.page"],
  },
  {
    id: "insights.drivers",
    area: "insights",
    route: "/insights#lab-story",
    title: "Which lever moves most",
    body: "What each small move is worth a month from your own numbers: 1% higher prices, one fewer wage hour a day, 10% less waste, 5% more guests.",
    related: ["insights.story", "insights.fixedCosts"],
    keywords: ["break even", "breakeven", "levers", "profit"],
  },
  {
    id: "insights.fixedCosts",
    area: "insights",
    route: "/insights#lab-story",
    title: "Fixed costs",
    body: "Rent, utilities, insurance and anything else you pay every month regardless of sales. Used for break-even and “profit after rent”; saves as you type.",
    related: ["insights.drivers"],
  },
  {
    id: "insights.overview",
    area: "insights",
    route: "/insights",
    title: "Today's one thing",
    body: "The best move from the Insights Lab right now. Do it or Later here; the rest of the list and the evidence are in the Lab.",
    related: ["insights.hero", "insights.page"],
  },
  {
    id: "insights.brief",
    area: "insights",
    route: "/brief",
    title: "Insights in the brief",
    body: "The three moves worth most this week, the same ones the Sunday email and push lead with.",
    related: ["insights.page", "brief.page"],
  },
];
