import type { HelpEntry } from "../types";

/**
 * Pages being built now (team, labor, scheduling, P&L…). Written from the
 * feature descriptions, so every entry is `draft: true` — refine the wording
 * against the real page once it ships, then drop the flag.
 */
const draft = (entries: Omit<HelpEntry, "draft">[]): HelpEntry[] => entries.map((e) => ({ ...e, draft: true }));

export const team = draft([
  {
    id: "team.page",
    area: "team",
    route: "/team",
    title: "Team",
    body: "Your positions and the people who work them, in one grid: pay rates, positions and when each person can work.",
    article: `- **Positions** — line cook, prep, server, bartender, dish… Each has a default pay rate and is used to build the schedule.
- **Employees** — one row per person: name, positions they can work, pay rate, whether they're a minor, and their login.
- **Availability** — the days and times each person can work. The schedule only offers shifts inside it.

Edit cells in place like any other grid — they save as you go.`,
    related: ["team.positions", "team.employees", "team.availability", "schedule.page"],
    keywords: ["staff", "employees", "roster", "people"],
  },
  {
    id: "team.positions",
    area: "team",
    route: "/team",
    title: "Positions",
    body: "The roles you schedule — line, prep, server, bar, dish — each with a default hourly rate.",
  },
  {
    id: "team.employees",
    area: "team",
    route: "/team",
    title: "Employees",
    body: "One row per person with their positions and pay rate. Mark minors so the schedule follows the hours they're allowed to work.",
    related: ["schedule.compliance", "app.grids"],
  },
  {
    id: "team.availability",
    area: "team",
    route: "/team",
    title: "Availability",
    body: "When each person can work, by weekday. Staff can update their own from My shifts; the schedule only uses available hours.",
    related: ["my.timeOff"],
  },
]);

export const labor = draft([
  {
    id: "labor.page",
    area: "labor",
    route: "/labor",
    title: "Labor",
    body: "Timecards from Square, hours and wages by person, and a payroll export with New York overtime and spread-of-hours already worked out.",
    article: `### Timecards
Clock-ins and outs come over from Square. Fix a missed punch in place; the original is kept.

### What's calculated
- **Overtime** — hours over 40 in a workweek are paid at 1.5×.
- **Spread of hours** — when someone's workday spans more than 10 hours from first clock-in to last clock-out, they get one extra hour at minimum wage.
- **Labor cost** includes an employer burden (payroll taxes and the like, 12% by default).

These rules are pre-filled for New York and editable. The app applies whatever is set — check them with your payroll provider.

### Payroll export
Download the week's hours, overtime and spread-of-hours per person for your payroll company.`,
    related: ["labor.timecards", "labor.overtime", "labor.spread", "labor.export", "pnl.page"],
    keywords: ["payroll", "wages", "timesheets", "hours"],
  },
  {
    id: "labor.timecards",
    area: "labor",
    route: "/labor",
    title: "Timecards",
    body: "Each shift worked, from Square clock-ins. Correct a missed punch or break in place.",
  },
  {
    id: "labor.squareSync",
    area: "labor",
    route: "/labor",
    title: "Square labor sync",
    body: "Pulls timecards from Square Team so hours here match what staff clocked. Runs with the nightly sales sync, or on demand.",
    related: ["sales.connect"],
  },
  {
    id: "labor.overtime",
    area: "labor",
    route: "/labor",
    title: "Overtime",
    body: "Hours past 40 in a workweek, paid at 1.5× — counted in the order they were worked.",
  },
  {
    id: "labor.spread",
    area: "labor",
    route: "/labor",
    title: "Spread of hours",
    body: "New York rule: if a workday spans more than 10 hours from start to finish (breaks included), the employee earns one extra hour at minimum wage.",
  },
  {
    id: "labor.export",
    area: "labor",
    route: "/labor",
    title: "Payroll export",
    body: "A file of each person's regular hours, overtime, spread-of-hours and tips for the week, ready for your payroll provider.",
    related: ["tips.page"],
  },
]);

export const schedule = draft([
  {
    id: "schedule.page",
    area: "schedule",
    route: "/schedule",
    title: "Schedule",
    body: "A draft schedule built from the hourly sales forecast, who's available and your labor rules. Adjust it, check the warnings, then publish.",
    article: `1. **Generate** — shifts are drafted to match how busy each hour is forecast to be, using people who are available for each position.
2. **Intensity** — slide toward leaner or more generous staffing. The labor cost and sales per labor hour update as you move it.
3. **Adjust** — drag or edit shifts, swap people, add or remove shifts.
4. **Check warnings** — New York rules are checked as you go.
5. **Publish** — staff see their shifts under My shifts.`,
    related: ["schedule.intensity", "schedule.compliance", "schedule.publish", "sales.forecast5w"],
    keywords: ["rota", "shifts", "roster", "staffing"],
  },
  {
    id: "schedule.generate",
    area: "schedule",
    route: "/schedule",
    title: "Generate from forecast",
    body: "Drafts shifts that follow the hour-by-hour sales forecast, so you're staffed for the rush and not overstaffed in the lull.",
  },
  {
    id: "schedule.intensity",
    area: "schedule",
    route: "/schedule",
    title: "Staffing intensity",
    body: "Leaner or more generous staffing for the same forecast. Watch labor cost % and sales per labor hour change as you slide.",
    related: ["pnl.splh"],
  },
  {
    id: "schedule.compliance",
    area: "schedule",
    route: "/schedule",
    title: "Compliance warnings",
    body: "Flags shifts that would trigger overtime, spread-of-hours or call-in pay, short turnarounds (\"clopens\"), very long shifts, and hours minors aren't allowed to work.",
    article: `Pre-filled for New York and editable in settings:

- **Overtime** past 40 hours in the week.
- **Spread of hours** when a day spans more than 10 hours.
- **Call-in pay** — a shift shorter than 4 hours may owe 4 hours' pay.
- **Clopens** — less than 10 hours between closing and opening.
- **Long shifts** over 12 hours.
- **Minors** (16–17) — max 8 hours on non-school days, and not past 10pm before a school day.

Warnings don't block you; they tell you what it will cost or where to look.`,
    related: ["labor.overtime", "labor.spread", "team.employees"],
  },
  {
    id: "schedule.publish",
    area: "schedule",
    route: "/schedule",
    title: "Publish",
    body: "Makes the week's schedule visible to staff under My shifts. Changes after publishing are shown to the people affected.",
    related: ["my.page"],
  },
]);

export const my = draft([
  {
    id: "my.page",
    area: "my",
    route: "/my",
    audience: "all",
    title: "My shifts",
    body: "Your upcoming shifts, open shifts you can pick up, swap requests and time off — all from your phone.",
    related: ["my.openShifts", "my.swaps", "my.timeOff"],
  },
  {
    id: "my.shifts",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Your shifts",
    body: "Your published shifts for the coming weeks with position and times.",
  },
  {
    id: "my.openShifts",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Pick up open shifts",
    body: "Shifts nobody is on yet that you're able to work. Tap to ask for one; a manager confirms it.",
  },
  {
    id: "my.swaps",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Swap a shift",
    body: "Offer one of your shifts to a teammate. Once they accept and a manager approves, it moves to their schedule.",
  },
  {
    id: "my.timeOff",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Time off",
    body: "Ask for days off. Approved time off is left out when the next schedule is drafted.",
  },
]);

export const tips = draft([
  {
    id: "tips.page",
    area: "tips",
    route: "/tips",
    title: "Tip pooling",
    body: "Splits the week's tips across the people in the pool, by hours worked or by points per position.",
    article: `- **By hours** — each person's share is their hours ÷ everyone's hours in the pool.
- **By points** — each position has points (say server 10, busser 5); share = points × hours ÷ total points × hours.

Pick who's in the pool, check the split, and it's included in the payroll export.`,
    related: ["tips.hours", "tips.points", "labor.export"],
    keywords: ["gratuity", "tip out", "pool"],
  },
  {
    id: "tips.hours",
    area: "tips",
    route: "/tips",
    title: "Split by hours",
    body: "Everyone in the pool earns the same per hour: their hours ÷ total pool hours × tips.",
  },
  {
    id: "tips.points",
    area: "tips",
    route: "/tips",
    title: "Split by points",
    body: "Each position carries points. A share is points × hours worked, as a fraction of everyone's points × hours.",
  },
]);

export const pnl = draft([
  {
    id: "pnl.page",
    area: "pnl",
    route: "/pnl",
    title: "Live P&L",
    body: "Sales minus food cost minus labor, updated daily, so you see this week's profit before the accountant does.",
    article: `- **Sales** — net sales from Square.
- **Food cost** — what was used, from recipes and counts.
- **Labor** — wages from timecards plus employer burden.
- **Prime cost** — food + labor, the number that most decides profit.
- **Sales per labor hour** — sales ÷ hours worked. Higher means each hour on the clock earns more.

Compare against your weekly [budgets](/budgets).`,
    related: ["pnl.splh", "budgets.page", "labor.page"],
    keywords: ["profit", "loss", "prime cost", "p&l"],
  },
  {
    id: "pnl.splh",
    area: "pnl",
    route: "/pnl",
    title: "Sales per labor hour",
    body: "Net sales ÷ hours worked. A quick way to see whether staffing matched how busy you were.",
  },
  {
    id: "pnl.prime",
    area: "pnl",
    route: "/pnl",
    title: "Prime cost",
    body: "Food cost + labor cost, as a share of sales. Most restaurants aim for around 60% or less.",
  },
]);

export const events = draft([
  {
    id: "events.page",
    area: "events",
    route: "/events",
    title: "Events",
    body: "A calendar of what's happening — festivals, live music, holidays, private parties — and how much each moves sales.",
    related: ["events.impact", "events.learned", "sales.forecast5w"],
    keywords: ["calendar", "festival", "holiday", "buyout"],
  },
  {
    id: "events.impact",
    area: "events",
    route: "/events",
    title: "Impact on the forecast",
    body: "Each event carries an expected % change to sales for its day. The forecast, orders and schedule all follow it.",
  },
  {
    id: "events.learned",
    area: "events",
    route: "/events",
    title: "Learned impact",
    body: "After an event has happened, its real effect is worked out from sales, so next year's version starts from what actually happened.",
  },
]);

export const invoices = draft([
  {
    id: "invoices.page",
    area: "invoices",
    route: "/invoices",
    title: "Invoices",
    body: "Snap a photo of a delivery invoice. It's matched to the order, differences are flagged, and you approve it in one tap.",
    article: `1. **Snap** the invoice when the truck arrives.
2. It's **matched** to the open order: shorts, substitutions and price changes are highlighted.
3. **Approve** — the delivery is checked in, and changed prices update your costs.
4. **Request a credit** for anything shorted or damaged — a ready-to-send message is drafted.`,
    related: ["invoices.match", "invoices.credit", "ordering.po.receive"],
    keywords: ["receipt", "bill", "photo", "ocr", "scan"],
  },
  {
    id: "invoices.snap",
    area: "invoices",
    route: "/invoices",
    title: "Snap an invoice",
    body: "Take a photo or upload a PDF. Lines, quantities and prices are read for you.",
  },
  {
    id: "invoices.match",
    area: "invoices",
    route: "/invoices",
    title: "Matched to the order",
    body: "Each invoice line is lined up with what you ordered. Differences in quantity or price are highlighted.",
  },
  {
    id: "invoices.approve",
    area: "invoices",
    route: "/invoices",
    title: "Approve",
    body: "Checks the delivery in and, if you choose, updates prices from the invoice so plate costs stay true.",
    related: ["prices.history"],
  },
  {
    id: "invoices.credit",
    area: "invoices",
    route: "/invoices",
    title: "Request a credit",
    body: "For shorted, damaged or mispriced lines, drafts a credit request to send to the supplier.",
  },
]);

export const reviews = draft([
  {
    id: "reviews.page",
    area: "reviews",
    route: "/reviews",
    title: "Reviews",
    body: "Guest reviews grouped into themes — slow service, cold food, a favorite dish — linked to the shifts and items behind them, with reply drafts.",
    related: ["reviews.themes", "reviews.reply"],
    keywords: ["google", "yelp", "feedback", "ratings"],
  },
  {
    id: "reviews.themes",
    area: "reviews",
    route: "/reviews",
    title: "Themes",
    body: "What guests keep mentioning, linked to what was happening — who was on, what was 86'd, how busy it was.",
  },
  {
    id: "reviews.reply",
    area: "reviews",
    route: "/reviews",
    title: "Reply drafts",
    body: "A suggested reply in a plain, friendly voice. Edit it and post it yourself.",
  },
]);

export const budgets = draft([
  {
    id: "budgets.page",
    area: "budgets",
    route: "/budgets",
    title: "Budgets",
    body: "Weekly targets for sales, food cost % and labor % that the P&L and brief measure against.",
    related: ["pnl.page", "brief.page"],
    keywords: ["targets", "goals"],
  },
  {
    id: "budgets.targets",
    area: "budgets",
    route: "/budgets",
    title: "Weekly targets",
    body: "Set each week's sales, food cost and labor targets. Copy forward to reuse last week's.",
  },
]);

export const brief = draft([
  {
    id: "brief.page",
    area: "brief",
    route: "/brief",
    title: "Weekly brief",
    body: "A short summary of last week against budget and what's coming up, with one-tap actions for the things worth doing.",
    related: ["brief.actions", "budgets.page"],
    keywords: ["summary", "report", "weekly"],
  },
  {
    id: "brief.actions",
    area: "brief",
    route: "/brief",
    title: "One-tap actions",
    body: "Each suggestion — reprice an item, adjust a shift, place an order — links straight to doing it.",
  },
]);

export const upcoming: HelpEntry[] = [...team, ...labor, ...schedule, ...my, ...tips, ...pnl, ...events, ...invoices, ...reviews, ...budgets, ...brief];
