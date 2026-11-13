import type { HelpEntry } from "../types";

/**
 * Pages being built now (team, labor, scheduling, P&L…). Written from the
 * feature descriptions, so every entry is `draft: true` — refine the wording
 * against the real page once it ships, then drop the flag.
 */
const draft = (entries: Omit<HelpEntry, "draft">[]): HelpEntry[] => entries.map((e) => ({ ...e, draft: true }));

export const team: HelpEntry[] = [
  {
    id: "team.page",
    area: "team",
    route: "/team",
    title: "Team",
    body: "Your positions and the people who work them, in one grid: pay rates, positions, availability, logins, sick leave and team announcements.",
    article: `- **Positions** — server, bartender, line cook, dish… Each has a default pay rate, tip points and a staffing ratio the schedule uses.
- **People** — one row per person: positions, pay rate, minor or not, max hours, and their paid sick leave balance. A rate under the minimum wage (or the tipped minimum for tip-eligible positions) shows in red.
- **Availability and login** — the calendar icon opens when each person can work, and lets you give them a login in one step.
- **Announcements** — short notes that show at the top of everyone's My shifts.

Edit cells in place like any other grid — they save as you go.`,
    related: ["team.positions", "team.employees", "team.availability", "team.invite", "team.announcements", "schedule.page"],
    keywords: ["staff", "employees", "roster", "people"],
  },
  {
    id: "team.positions",
    area: "team",
    route: "/team",
    title: "Positions",
    body: "The roles you schedule, each with a default hourly rate, tip points, whether it's in the tip pool, and how many people it needs per dollar of sales.",
  },
  {
    id: "team.employees",
    area: "team",
    route: "/team",
    title: "Employees",
    body: "One row per person with their positions and pay rate. Mark minors so the schedule follows the hours they're allowed to work. Sick shows their paid sick leave left this year.",
    related: ["schedule.compliance", "app.grids", "labor.sick"],
  },
  {
    id: "team.availability",
    area: "team",
    route: "/team",
    title: "Availability",
    body: "When each person can work, by weekday. Staff can update their own on My shifts. The schedule only offers shifts inside it and flags any that fall outside.",
    related: ["my.availability", "my.timeOff"],
  },
  {
    id: "team.invite",
    area: "team",
    route: "/team",
    title: "Give someone a login",
    body: "Open a person's row (calendar icon) and press Create login. It makes a staff login with a PIN and links it to them, so they can sign in and see their shifts right away.",
    related: ["my.page"],
    keywords: ["invite", "pin", "onboarding", "account"],
  },
  {
    id: "team.announcements",
    area: "team",
    route: "/team",
    title: "Announcements",
    body: "Post a short note from Team or Schedule. Everyone sees it at the top of My shifts. Pin the ones that should stay; the rest drop off after 30 days.",
    related: ["my.page"],
    keywords: ["message", "notice", "news"],
  },
];

export const labor: HelpEntry[] = [
  {
    id: "labor.page",
    area: "labor",
    route: "/labor",
    title: "Timecards and payroll",
    body: "Timecards from Square, a ranked list of problems to fix, adjustments, and a payroll file you approve before it goes to your payroll provider.",
    article: `### Timecards
Clock-ins and outs come over from Square. Fix a missed punch in place: type 4p, 16:30 or 10:15pm. Any card you change is marked edited, and the Square sync leaves it as you set it from then on. Square's own record isn't changed.

### Before you approve
A list of what needs a look, most urgent first: missing clock-outs and pay rates, no-shows against the published schedule, people who left early and are owed call-in pay, long cards, missing meal breaks, people not linked to Square, unscheduled punches, overtime and spread of hours.

### Approve
**Approve period** locks the period's timecards and adjustments and freezes the payroll file exactly as it is. To change something afterwards, **Unlock**, fix it, and approve again.

### What's calculated
- **Overtime** — hours over 40 in a workweek at 1.5×.
- **Spread of hours** — a workday spanning more than 10 hours earns one extra hour at minimum wage.
- **Call-in pay** — leaving a scheduled shift early is paid up to the call-in minimum (or the shift, if shorter) at minimum wage.
- **Paid sick leave and PTO** — from approved requests.
- **Tips** — from finalized tip pools on the Tips page.

These rules are pre-filled for New York and editable in Settings. The app applies whatever is set; check them with your payroll provider.`,
    related: ["labor.timecards", "labor.exceptions", "labor.approve", "labor.adjustments", "labor.export", "labor.sick", "labor.overtime", "labor.spread"],
    keywords: ["payroll", "wages", "timesheets", "hours", "approve"],
  },
  {
    id: "labor.timecards",
    area: "labor",
    route: "/labor",
    title: "Timecards",
    body: "Each shift worked, from Square clock-ins or added by hand. Correct a missed punch or break in place; edited cards are kept when Square syncs again.",
  },
  {
    id: "labor.squareSync",
    area: "labor",
    route: "/labor",
    title: "Square labor sync",
    body: "Pulls timecards from Square Team so hours here match what staff clocked. Today and yesterday top up through the day and nightly; press Sync from Square for the week on screen. Cards you corrected or approved are never overwritten.",
    related: ["sales.connect"],
  },
  {
    id: "labor.exceptions",
    area: "labor",
    route: "/labor",
    title: "Before you approve",
    body: "Problems in the pay period, most urgent first: missing clock-outs and rates must be fixed; no-shows, call-in pay, long cards and missing meal breaks are worth a check.",
    related: ["labor.approve"],
    keywords: ["exceptions", "missing punch", "no show", "errors"],
  },
  {
    id: "labor.approve",
    area: "labor",
    route: "/labor",
    title: "Approve a pay period",
    body: "Locks the period's timecards and adjustments and freezes the payroll file. Unlock to change anything, then approve again. Until then the CSV is marked DRAFT.",
    related: ["labor.export"],
  },
  {
    id: "labor.adjustments",
    area: "labor",
    route: "/labor",
    title: "Adjustments",
    body: "One-off bonuses, corrections, deductions and reimbursements for the period. Deductions are always taken off; reimbursements are listed separately from wages.",
    keywords: ["bonus", "deduction", "correction", "reimbursement"],
  },
  {
    id: "labor.sick",
    area: "labor",
    route: "/labor",
    title: "Paid sick leave",
    body: "New York paid sick leave: 1 hour for every 30 worked, up to 40 hours a year (56 for 100+ employees, set in Settings). Staff log sick time on My shifts; approved hours are paid in the export.",
    related: ["my.timeOff", "team.employees"],
    keywords: ["sick", "pto", "accrual", "balance"],
  },
  {
    id: "labor.overtime",
    area: "labor",
    route: "/labor",
    title: "Overtime",
    body: "Hours past 40 in a workweek, paid at 1.5× — counted in the order they were worked. With two-week pay periods it's still worked out per week.",
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
    body: "A CSV per pay period: regular and overtime hours, spread-of-hours, call-in, sick and PTO pay, adjustments, gross wages, tips and sick balance per person, keyed by Square team member ID.",
    related: ["tips.page", "labor.approve"],
  },
];

export const schedule: HelpEntry[] = [
  {
    id: "schedule.page",
    area: "schedule",
    route: "/schedule",
    title: "Schedule",
    body: "A draft schedule built from the hourly sales forecast, who's available, your labor budget and your labor rules. Adjust it, check the warnings, then publish.",
    article: `1. **Generate** — shifts are drafted to match how busy each hour is forecast to be, using people who are available for each position. Shifts over the meal-break threshold get a meal break.
2. **Intensity** — slide toward leaner or more generous staffing. If the week has a labor % budget, **Fit to budget** picks the most generous level that stays within it.
3. **Adjust** — drag or edit shifts, swap people, add or remove shifts.
4. **Check** — the staff vs demand chart shows each hour's coverage; compliance warnings list what breaks a rule.
5. **Publish** — staff see their shifts under My shifts.

Turn on **Draft next week automatically** in the generate panel and next week is drafted every weekend if it's still empty.`,
    related: ["schedule.generate", "schedule.budget", "schedule.demand", "schedule.intensity", "schedule.compliance", "schedule.publish", "schedule.requests", "sales.forecast5w"],
    keywords: ["rota", "shifts", "roster", "staffing"],
  },
  {
    id: "schedule.generate",
    area: "schedule",
    route: "/schedule",
    title: "Generate from forecast",
    body: "Drafts shifts that follow the hour-by-hour sales forecast, so you're staffed for the rush and not overstaffed in the lull. Approved time off and availability are respected.",
  },
  {
    id: "schedule.budget",
    area: "schedule",
    route: "/schedule",
    title: "Labor budget",
    body: "When the week has a labor % target on Budgets, the schedule shows target vs planned, and Fit to budget sets the staffing level so the plan stays within it.",
    related: ["budgets.page", "schedule.intensity"],
    keywords: ["labor target", "labor percent", "fit"],
  },
  {
    id: "schedule.demand",
    area: "schedule",
    route: "/schedule",
    title: "Staff vs demand",
    body: "For each hour of a day: people on shift (bars) against people the forecast needs (line). Amber bars are short hours.",
    keywords: ["coverage", "hourly"],
  },
  {
    id: "schedule.intensity",
    area: "schedule",
    route: "/schedule",
    title: "Staffing intensity",
    body: "Leaner or more generous staffing for the same forecast. Watch labor cost and labor % change as you slide.",
    related: ["pnl.splh"],
  },
  {
    id: "schedule.compliance",
    area: "schedule",
    route: "/schedule",
    title: "Compliance warnings",
    body: "Flags shifts that miss a meal break, pay under minimum wage, trigger overtime or call-in pay, leave too little rest, run long, or break the rules for minors.",
    article: `Pre-filled for New York and editable in Settings:

- **Meal break** — shifts over 6 hours need a 30-minute break.
- **Minimum wage** — $16.00 upstate, or the tipped cash wage for tip-eligible positions.
- **Overtime** past 40 hours in the week.
- **Call-in pay** — a shift under 4 hours may owe 4 hours' pay. Planned labor cost includes it.
- **Clopens** — less than 10 hours between closing and opening.
- **Long shifts** over 12 hours.
- **Minors** (16–17) — max 8 hours on non-school days, and not past 10pm before a school day.

In Settings each rule can be **Must fix** (publishing stops until you override), **Warn** or **Off**.`,
    related: ["labor.overtime", "labor.spread", "team.employees"],
  },
  {
    id: "schedule.publish",
    area: "schedule",
    route: "/schedule",
    title: "Publish",
    body: "Makes the week's draft shifts visible to staff under My shifts. Must-fix problems stop it unless you choose to publish anyway.",
    related: ["my.page"],
  },
  {
    id: "schedule.requests",
    area: "schedule",
    route: "/schedule/requests",
    title: "Time off and swaps",
    body: "Each request shows who else is off and scheduled vs needed hours for those days. Approving can open up the person's shifts so others can pick them up.",
    related: ["my.timeOff", "my.swaps"],
    keywords: ["approve", "coverage", "pto"],
  },
];

export const my: HelpEntry[] = [
  {
    id: "my.page",
    area: "my",
    route: "/my",
    audience: "all",
    title: "My shifts",
    body: "Your upcoming shifts, open shifts you can pick up, swaps, time off and sick leave, when you can work, and notes from your managers — all from your phone.",
    related: ["my.openShifts", "my.swaps", "my.timeOff", "my.availability"],
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
    body: "Shifts nobody is on yet, for positions you work. The first person to tap Pick up gets it.",
  },
  {
    id: "my.swaps",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Swap a shift",
    body: "Offer one of your shifts to a teammate or to anyone who can cover. Once someone offers and a manager approves, it moves to their schedule.",
  },
  {
    id: "my.timeOff",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Time off and sick leave",
    body: "Ask for days off, or log sick time (even for today). Sick time is paid from your sick leave balance, shown above the form: 1 hour earned for every 30 worked.",
    related: ["labor.sick"],
  },
  {
    id: "my.availability",
    area: "my",
    route: "/my",
    audience: "all",
    title: "When you can work",
    body: "Type the hours you can work each weekday, like 4p-10p, or leave a day blank. It saves as you go and the next schedule uses it.",
    keywords: ["availability"],
  },
];

export const tips: HelpEntry[] = [
  {
    id: "tips.page",
    area: "tips",
    route: "/tips",
    title: "Tip pooling",
    body: "Splits a period's tips across the people in the pool, by hours worked or by points per position. Finalized pools flow into the payroll export.",
    article: `- **By hours** — each person's share is their hours ÷ everyone's hours in the pool.
- **By points** — each position has points (say server 1, expo 0.5); share = points × hours ÷ total points × hours.

Only tip-eligible positions are in the pool (set on the Team page). Check the split, save, then **Finalize** — finalized tips are added to the payroll export on Timecards, prorated by day if the tip period and pay period don't line up.`,
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
];

export const pnl: HelpEntry[] = [
  {
    id: "pnl.page",
    area: "pnl",
    route: "/pnl",
    title: "Live P&L",
    body: "Sales minus cost of goods minus labor for any period, split into food and beverage, with forecast, schedule and budget next to the actuals.",
    article: `Pick a period at the top: today, this week, last week, this month or any range.

- **Net sales** — from Square, leaving out items marked Ignore on the Sales page (gift cards, merch). Badges compare with the budget and the forecast.
- **Cost of goods** — theoretical: items sold × each recipe's cost **on the day it sold**, so a price rise this week doesn't rewrite last month. The hint splits it into food and beverage.
- **Labor** — wages from timecards plus employer burden, including people still on the clock. The hint shows what the schedule planned.
- **Prime cost** — cost of goods + labor.
- **Sales per labor hour** and **orders per labor hour** — how hard each paid hour worked.

Below that: the food and beverage table, an hour-by-hour chart (sales, actual labor, scheduled labor) and a by-day table with the forecast for each day.

Green, orange and red badges compare each number with its target: on or under is green, up to 2 points over is orange, beyond that is red. Set targets on [Budgets](/budgets) and the beverage target on [Menu costs](/menu).`,
    related: ["pnl.split", "pnl.actual", "pnl.hourly", "pnl.forecast", "pnl.splh", "pnl.prime", "budgets.page"],
    keywords: ["profit", "loss", "prime cost", "p&l", "flash", "cogs", "beverage cost", "pour cost"],
  },
  {
    id: "pnl.split",
    area: "pnl",
    route: "/pnl",
    title: "Food and beverage",
    body: "Sales and cost of goods split by what was sold: food against food sales, beer and other drinks against drink sales. Each has its own cost % and target.",
    article: `A taproom is two businesses. A blended cost % hides both: lots of beer makes a high food cost look fine.

Each menu item counts as Food, Beer, Other beverage or Retail, based on its category. Change the mapping at the bottom of [Menu costs](/menu).

- **Food** — food cost % against the food cost target in Settings.
- **Beverage** — beer and other drinks against the beverage target.
- **Other and unlinked** — retail, plus Square sales not linked to a recipe. It counts toward the total only.

Beer only has a cost once its kegs are set up. Use [Draft beer](/menu/draft-beer).`,
    related: ["menu.classes", "menu.draftBeer", "pnl.actual"],
    keywords: ["food vs beverage", "beer cost", "pour cost", "mix"],
  },
  {
    id: "pnl.actual",
    area: "pnl",
    route: "/pnl",
    title: "Actual from counts",
    body: "What really left the shelves between your last two counts, as a share of sales, next to what recipes say it should have been. Green within a point, orange within 2.5, red beyond.",
    related: ["variance.page", "variance.unexplained"],
  },
  {
    id: "pnl.hourly",
    area: "pnl",
    route: "/pnl",
    title: "Hour by hour",
    body: "Sales (bars), actual labor from timecards (solid line) and scheduled labor from shifts (dashed) for one day. Tap a day in the table to switch.",
    article: "Where the solid line sits above the dashed one, people stayed longer than planned. Hover or tap an hour to see sales, actual and scheduled labor, and orders per labor hour.",
    related: ["pnl.page", "schedule.page"],
  },
  {
    id: "pnl.forecast",
    area: "pnl",
    route: "/pnl",
    title: "Forecast",
    body: "For past days, what the forecast said the evening before (the same check as on the Sales page). For today and later, the live forecast. The badge shows how far actual sales landed from it.",
    related: ["sales.forecast5w"],
  },
  {
    id: "pnl.byDay",
    area: "pnl",
    route: "/pnl",
    title: "By day",
    body: "Each day's sales against forecast, food and beverage cost %, actual and scheduled labor, prime cost, profit and productivity. Columns hide on small screens.",
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
    body: "Cost of goods + labor, as a share of sales. Most restaurants aim for around 60% or less.",
  },
];

export const events: HelpEntry[] = [
  {
    id: "events.page",
    area: "events",
    route: "/events",
    title: "Events",
    body: "Festivals, live music, holidays, private parties and closures, with how much each one moves sales. The forecast, orders and schedule all follow them.",
    article: `Add an event to the day it happens and give it an expected change, say +30% for a festival weekend. **Closure** days forecast zero.

Past event days are left out of the "usual day" averages, for both the sales forecast and the item forecast that drives ordering. That way one festival Saturday doesn't inflate every Saturday after it.`,
    related: ["events.impact", "events.learned", "sales.forecast5w"],
    keywords: ["calendar", "festival", "holiday", "buyout", "closure"],
  },
  {
    id: "events.impact",
    area: "events",
    route: "/events",
    title: "Impact on the forecast",
    body: "Each event carries an expected % change to sales for its day. The forecast, the suggested orders and the schedule all use it.",
  },
  {
    id: "events.learned",
    area: "events",
    route: "/events",
    title: "Learned impact",
    body: "Once an event has happened, its real effect is worked out from sales against a normal day, so next year's version starts from what actually happened.",
  },
];

export const invoices: HelpEntry[] = [
  {
    id: "invoices.page",
    area: "invoices",
    route: "/invoices",
    title: "Invoices",
    body: "Snap a photo of a delivery invoice. It's checked against what you ordered and checked in, differences are flagged, and changed prices flow into costing.",
    article: `1. **Snap** the invoice when the truck arrives. Claude reads the lines when the API key is set; otherwise type or paste them.
2. It's **matched** line by line to the order and its check-in. Price and quantity differences over your tolerance are flagged.
3. **Approve.** A clean match is one tap. Approving with open issues needs a short note. Every approval and reopen is kept in the invoice's history.
4. **Request a credit** for anything shorted or overcharged. A ready-to-send message is drafted.

Approved invoices with no checked-in order count as received stock for ordering. Approved invoices also export as bills for QuickBooks Online or Xero from [Exports](/invoices/exports).`,
    related: ["invoices.match", "invoices.approve", "invoices.autoApprove", "invoices.exports", "invoices.credit"],
    keywords: ["receipt", "bill", "photo", "ocr", "scan"],
  },
  {
    id: "invoices.snap",
    area: "invoices",
    route: "/invoices",
    title: "Snap an invoice",
    body: "Take a photo or upload a PDF. Lines, quantities and prices are read for you when the Claude API key is set.",
  },
  {
    id: "invoices.match",
    area: "invoices",
    route: "/invoices",
    title: "Matched to the order",
    body: "Each line is matched by item code, then by description, and compared with the order and what was checked in. Differences over your tolerance are flagged.",
  },
  {
    id: "invoices.approve",
    area: "invoices",
    route: "/invoices",
    title: "Approve and history",
    body: "Approving a clean match is one tap. Approving with open issues asks for a note. Approvals, reopens and price updates are logged on the invoice and never erased, even if it's reopened.",
    related: ["prices.history", "invoices.autoApprove"],
  },
  {
    id: "invoices.autoApprove",
    area: "invoices",
    route: "/invoices",
    title: "Auto-approve clean matches",
    body: "When on, an invoice is approved automatically if every line matches within tolerance, it's billed against an order that was checked in, and it isn't a possible duplicate. An invoice you reopen by hand is never auto-approved again.",
  },
  {
    id: "invoices.exports",
    area: "invoices",
    route: "/invoices/exports",
    title: "Accounting exports",
    body: "Download approved invoices as a bills import for QuickBooks Online or Xero, and a daily sales journal (net sales by category, sales tax, tips). Map each category to an account once, at the bottom of the page.",
    article: `**Bills**: one bill per approved invoice, dated by the invoice date, due after your payment terms. Lines roll up to one per expense account (by ingredient category), or show every line. If the lines don't add up to the invoice total, the gap goes on an "Other charges" line, so the bill always matches the paper.

**Sales journal**: one balanced journal per day. It credits income for each menu category, plus sales tax and tips, and debits your undeposited funds account. Items marked ignored in Square mapping (gift cards, merch) are left out. Tax comes from Square once it's synced. Until then, set your sales tax rate to include an estimate.

Account names must match your chart of accounts exactly. Nothing is paid or posted from here.`,
    keywords: ["quickbooks", "qbo", "xero", "accounting", "bills", "journal", "export", "csv"],
  },
  {
    id: "invoices.credit",
    area: "invoices",
    route: "/invoices",
    title: "Request a credit",
    body: "For shorted or overcharged lines, drafts a credit request to send to the supplier.",
  },
];

export const reviews: HelpEntry[] = [
  {
    id: "reviews.page",
    area: "reviews",
    route: "/reviews",
    title: "Reviews",
    body: "Guest reviews grouped into themes and lined up against what happened that day, with reply drafts and a monthly list of what to fix.",
    article: `- **Google** reviews come in every morning once the Places API key and your Place ID are set. Google only shares the five most relevant at a time. **Yelp, TripAdvisor and others**: paste them in.
- **What to fix this month**: up to three concrete fixes from the last 90 days of themes and what operations looked like on those days. Claude writes it when the API key is set; otherwise it comes from the most-mentioned complaints. Refresh it any time.
- **Rating is slipping**: shown here and in the weekly brief when the last 30 days average 0.3★ or more below the 90 days before.`,
    related: ["reviews.themes", "reviews.reply", "brief.page"],
    keywords: ["google", "yelp", "feedback", "ratings", "what to fix"],
  },
  {
    id: "reviews.themes",
    area: "reviews",
    route: "/reviews",
    title: "Themes",
    body: "What guests keep mentioning, and for critical reviews, what was going on that day: sales against forecast, staff hours against need, and dishes over food-cost target.",
  },
  {
    id: "reviews.reply",
    area: "reviews",
    route: "/reviews",
    title: "Reply drafts",
    body: "A suggested reply in your voice. Edit it, post it yourself, then mark it replied.",
  },
];

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

export const brief: HelpEntry[] = [
  {
    id: "brief.page",
    area: "brief",
    route: "/brief",
    title: "Weekly brief",
    body: "Next week at a glance: the forecast against budget, then everything that needs you before it starts, each with a button to do it.",
    article: `It covers orders to place (and drafts saved automatically before a supplier's cutoff), items that run out before their delivery, the schedule, staff requests, reviews needing a reply, a slipping rating, price increases, items over target, the margin gap, overdue counts and a quiet waste log.`,
    related: ["brief.actions", "budgets.page"],
    keywords: ["summary", "report", "weekly"],
  },
  {
    id: "brief.actions",
    area: "brief",
    route: "/brief",
    title: "One-tap actions",
    body: "Each card links straight to doing it: create the order, publish the schedule, reply to reviews, start a count.",
  },
];

export const upcoming: HelpEntry[] = [...team, ...labor, ...schedule, ...my, ...tips, ...pnl, ...events, ...invoices, ...reviews, ...budgets, ...brief];
