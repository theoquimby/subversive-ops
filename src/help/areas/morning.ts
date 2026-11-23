import type { HelpEntry } from "../types";

/** The morning brief (/brief, Today) and shift notes (/notes), plus where they show on the Overview. */
export const morningBrief: HelpEntry[] = [
  {
    id: "brief.morning",
    area: "brief",
    route: "/brief",
    title: "Morning brief",
    body: "Your day on one page: yesterday in a line, today's forecast, busy hours, weather and crew, what to get done before tonight, one insight and last night's shift notes. It's pushed to your phone each morning.",
    article: `The brief opens on **Today**. **This week** is the weekly brief: last week against budget and everything to sort before next week.

### What's on it
- **Yesterday**: sales against forecast, labor %, an estimated profit after food and labor, and anything unusual (a big miss, labor over target, a short drawer, things 86'd).
- **Today**: the forecast with its likely range, the busiest stretch, weather and events, and who's on against what the forecast needs.
- **Before tonight**: order deadlines, drafts to send, deliveries to check in, invoices, kegs and the rest of the Overview's list.
- **One thing to act on**: the top insight, with Do it and Later right there.
- **Last night's notes** from the shift notes, with follow-ups to mark handled.

On Mondays it adds a short wrap of last week.

### When it arrives
Pick the time at the top of the page (7 to 11am, default 9am). It's a phone notification by default; turn on email in [Settings → Notifications](/settings/notifications).`,
    related: ["brief.tonight", "brief.notes", "notes.page", "brief.page"],
    tour: "brief",
    keywords: ["daily", "today", "morning", "summary", "push", "9am"],
  },
  {
    id: "brief.yesterday",
    area: "brief",
    route: "/brief",
    title: "Yesterday",
    body: "Sales against the forecast, labor as a share of sales, and profit after food and labor (an estimate, before rent and other fixed costs). Badges call out anything unusual, including what the shift notes said.",
    related: ["pnl.page", "notes.page"],
  },
  {
    id: "brief.today",
    area: "brief",
    route: "/brief",
    title: "Today",
    body: "The day's forecast and its likely range, the busiest three hours, weather and events. The bars are forecast sales by hour; the numbers under them are people on, amber where the forecast needs more.",
    related: ["sales.forecast", "schedule.page"],
    keywords: ["crew", "staffing", "busy hours", "weather"],
  },
  {
    id: "brief.tonight",
    area: "brief",
    route: "/brief",
    title: "Before tonight",
    body: "The first five things to get done, one per subject, most urgent first. The rest are under Needs you on the Overview.",
    related: ["overview.needs", "ordering.today"],
  },
  {
    id: "brief.insight",
    area: "brief",
    route: "/brief",
    title: "One thing to act on",
    body: "The insight worth most right now. Do it when it's done and we'll track the result; Later brings it back in two weeks. The next one moves up.",
    related: ["insights.page"],
  },
  {
    id: "brief.notes",
    area: "brief",
    route: "/brief",
    title: "Last night's notes",
    body: "Shift notes from last night: what was 86'd, comps, the drawer, issues and fixes. Follow-ups stay marked until a manager taps Mark handled.",
    related: ["notes.page"],
  },
  {
    id: "brief.wrap",
    area: "brief",
    route: "/brief",
    title: "Monday wrap",
    body: "Mondays only: last week's sales against budget (or the week before), labor %, estimated profit and the best day. This week has the full weekly brief.",
    related: ["brief.page", "budgets.page"],
  },
  {
    id: "overview.notes",
    area: "overview",
    route: "/",
    title: "Last night",
    body: "Last night's shift notes, one line each. Amber means something to follow up: an issue, a fix or a short drawer. Tap through to read them or mark them handled.",
    related: ["notes.page"],
  },
  {
    id: "notes.page",
    area: "notes",
    route: "/notes",
    title: "Shift notes",
    body: "The handoff at the end of a shift. Anyone can leave one: tap chips, add what was 86'd, comps and the drawer, and a few words. Managers see them in the morning brief and on the Overview.",
    article: `Leave one at the end of every shift. It takes a minute.

1. Pick **Open**, **Mid** or **Close**. After midnight it's still last night.
2. Tap the chips that fit. Amber ones (ice machine, walk-in, draft lines…) are fixes and count as a follow-up.
3. Add what was **86'd**. Type and press Enter, or tap one of the usual ones.
4. Comps (amount and why), the drawer (even, over or short) and any issues.
5. **Save note**.

Unsent notes are kept on your phone until you save. You can edit or delete your own; managers can change any and mark follow-ups handled. Staff don't see drawer amounts on other people's notes.

Search finds any word in any note: an item, a name, "ice machine".`,
    related: ["brief.notes", "overview.notes"],
    audience: "all",
    tour: "notes",
    keywords: ["handoff", "86", "eighty six", "log", "closing", "drawer", "comps", "maintenance"],
  },
  {
    id: "notes.composer",
    area: "notes",
    route: "/notes",
    title: "Writing a note",
    body: "Tap what fits, add 86'd items with Enter, then comps, the drawer and a few words. Over or Short needs the amount. Drafts stay on this device until you save; one left from another day is offered back.",
    audience: "all",
    related: ["notes.page"],
  },
  {
    id: "notes.history",
    area: "notes",
    route: "/notes",
    title: "Notes history",
    body: "Every note, newest first, grouped by day. Search looks through every field. Managers can show only notes still to follow up and mark them handled.",
    audience: "all",
    related: ["notes.page"],
  },
];
