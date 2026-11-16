/**
 * "What's new": the latest changes, as short cards in the What's new sheet
 * (help menu → What's new, ⌘K → "What's new", and once per person after a
 * release). Pure data, safe on server and client.
 *
 * Add new entries at the TOP with today's date. Keep the title to a few words
 * and the line to one sentence a busy person reads in two seconds. `href` must
 * be a real page (a test checks), `tour` a tour id from ./tours.ts and `help`
 * a help entry id. Staff only ever see `audience: "staff" | "all"` entries, so
 * those must link to pages staff can open.
 *
 * `requiresRoute`: for a feature still landing — the entry only shows while
 * that page exists in the app.
 */

import type { Area } from "@/lib/areas";

export type WhatsNewAudience = "manager" | "staff" | "all";

/** Small illustration per card (mapped to an icon in the sheet). */
export type WhatsNewIcon =
  | "start"
  | "ordering"
  | "deadline"
  | "pace"
  | "pnl"
  | "insights"
  | "brief"
  | "notes"
  | "prep"
  | "keg"
  | "tv"
  | "party"
  | "invoice"
  | "draft"
  | "tips"
  | "learn"
  | "areas"
  | "count"
  | "table"
  | "settings"
  | "quickbooks"
  | "today"
  | "website"
  | "analytics"
  | "checklist"
  | "accounting";

export interface WhatsNewEntry {
  /** Stable id: remembered as "seen" per person. Never reuse one. */
  id: string;
  /** YYYY-MM-DD the change shipped. */
  date: string;
  title: string;
  /** One sentence. */
  line: string;
  icon: WhatsNewIcon;
  /** Tints the illustration with the area's hue. */
  area: Area;
  /** Where "Show me" goes. */
  href: string;
  /** A tour started on arrival, when there is one. */
  tour?: string;
  /** A help article for "Read more". */
  help?: string;
  audience: WhatsNewAudience;
  /** Only shown while this page exists (features still landing). */
  requiresRoute?: string;
}

export const WHATS_NEW: WhatsNewEntry[] = [
  // ---- 16 Nov ----
  {
    id: "2026-11-16.link-sales",
    date: "2026-11-16",
    title: "Link your sales, safely",
    line: "Biggest sellers first, a suggested recipe with its cost before you save, kegs for beer, Undo on everything.",
    icon: "pnl",
    area: "numbers",
    href: "/sales/link",
    help: "sales.link",
    audience: "manager",
  },
  {
    id: "2026-11-16.count-setup",
    date: "2026-11-16",
    title: "Set up the count once",
    line: "Shelf order, photos, how-to notes, allowed units and how often, so anyone can count it right.",
    icon: "count",
    area: "food",
    href: "/count/setup",
    help: "count.setup",
    audience: "manager",
  },
  {
    id: "2026-11-16.count-approve",
    date: "2026-11-16",
    title: "Approve staff counts",
    line: "Staff counts wait for you, with odd numbers flagged next to the last count.",
    icon: "checklist",
    area: "food",
    href: "/count",
    help: "count.review",
    audience: "manager",
  },
  {
    id: "2026-11-16.count-value",
    date: "2026-11-16",
    title: "What the shelves are worth",
    line: "Each count shows its value by area, the change since last time and stock no menu item uses.",
    icon: "pnl",
    area: "numbers",
    href: "/count",
    help: "count.summary",
    audience: "manager",
  },
  {
    id: "2026-11-16.count-clearer",
    date: "2026-11-16",
    title: "Clearer counting",
    line: "Tap an item for its photo and item number, mix units on one line, and nothing gets skipped.",
    icon: "count",
    area: "food",
    href: "/count",
    tour: "counting",
    help: "count.item",
    audience: "all",
  },
  {
    id: "2026-11-16.order-packs",
    date: "2026-11-16",
    title: "Pick the pack when ordering",
    line: "Cans or jugs? See the price per oz of each pack and order the one that suits the week.",
    icon: "ordering",
    area: "food",
    href: "/ordering",
    help: "ordering.builder.packs",
    audience: "manager",
  },
  {
    id: "2026-11-16.honest-numbers",
    date: "2026-11-16",
    title: "Cards say when numbers are missing",
    line: "Overview flags weeks without food costs or timecards instead of comparing against them.",
    icon: "pnl",
    area: "numbers",
    href: "/",
    help: "overview.foodCost",
    audience: "manager",
  },
  // ---- 15 Nov ----
  {
    id: "2026-11-15.release-notes",
    date: "2026-11-15",
    title: "Release notes, every update",
    line: "Every update gets a version and a short note on what changed and what to look for.",
    icon: "checklist",
    area: "setup",
    href: "/help/releases",
    help: "help.releases",
    audience: "all",
  },
  {
    id: "2026-11-15.quick-start",
    date: "2026-11-15",
    title: "Your quick start",
    line: "The ten things worth doing this week, in order, each one a tap away.",
    icon: "start",
    area: "setup",
    href: "/help/app.quickStart",
    help: "app.quickStart",
    audience: "manager",
  },
  {
    id: "2026-11-15.setup-checklist",
    date: "2026-11-15",
    title: "A shorter setup checklist",
    line: "Essentials first, nice-to-haves after, each ticked off by itself once it's done.",
    icon: "checklist",
    area: "setup",
    href: "/welcome/checklist",
    help: "welcome.checklist",
    audience: "manager",
  },
  {
    id: "2026-11-15.accounting",
    date: "2026-11-15",
    title: "Month-end, in one place",
    line: "What's left to close, sales tax, cost of goods, tips owed and one file for your accountant.",
    icon: "accounting",
    area: "numbers",
    href: "/accounting",
    tour: "month-end",
    help: "accounting.page",
    audience: "manager",
    requiresRoute: "/accounting",
  },
  {
    id: "2026-11-15.website",
    date: "2026-11-15",
    title: "The website, run from here",
    line: "Hours, the notice, the menu, events and inquiries — the site updates the moment you save.",
    icon: "website",
    area: "numbers",
    href: "/website",
    tour: "website",
    help: "website.page",
    audience: "manager",
    requiresRoute: "/website",
  },
  {
    id: "2026-11-15.website-analytics",
    date: "2026-11-15",
    title: "Who visits the website",
    line: "Visitors, what they tap (call, directions, menu) and what Google searches bring them in.",
    icon: "analytics",
    area: "numbers",
    href: "/website/analytics",
    tour: "webanalytics",
    help: "website.analytics",
    audience: "manager",
    requiresRoute: "/website/analytics",
  },
  {
    id: "2026-11-15.staff-today",
    date: "2026-11-15",
    title: "A Today screen for staff",
    line: "Staff open the app to their next shift, one-tap floor tools and anything waiting on them.",
    icon: "today",
    area: "people",
    href: "/help/my.today",
    help: "my.today",
    audience: "manager",
  },
  {
    id: "2026-11-15.my-today",
    date: "2026-11-15",
    title: "Your Today screen",
    line: "Your next shift with a countdown, who's on with you, and one tap to scan, prep or count.",
    icon: "today",
    area: "today",
    href: "/my",
    tour: "today",
    help: "my.today",
    audience: "staff",
  },
  {
    id: "2026-11-15.morning-brief",
    date: "2026-11-15",
    title: "A morning brief",
    line: "Yesterday in a line, today's forecast and crew, and what to get done before tonight.",
    icon: "brief",
    area: "today",
    href: "/brief",
    tour: "brief",
    help: "brief.morning",
    audience: "manager",
  },
  {
    id: "2026-11-15.shift-notes",
    date: "2026-11-15",
    title: "Shift notes",
    line: "The end-of-shift handoff: 86'd items, comps, the drawer and anything broken.",
    icon: "notes",
    area: "today",
    href: "/notes",
    tour: "notes",
    help: "notes.page",
    audience: "all",
  },
  {
    id: "2026-11-15.prep",
    date: "2026-11-15",
    title: "The prep list",
    line: "What to make today, worked out from the forecast, what's on hand, pars and shelf life.",
    icon: "prep",
    area: "food",
    href: "/prep",
    tour: "prep",
    help: "prep.page",
    audience: "all",
  },
  {
    id: "2026-11-15.taps",
    date: "2026-11-15",
    title: "Beers, tap list and a TV board",
    line: "Your beers with styles and prices, what's pouring, and a live tap list for the bar TV.",
    icon: "tv",
    area: "floor",
    href: "/kegs/taps",
    help: "taps.tv",
    audience: "manager",
  },
  {
    id: "2026-11-15.pnl-fees",
    date: "2026-11-15",
    title: "Card fees and comps in the P&L",
    line: "Square's card fees and every comp and discount now come off, so profit matches the bank.",
    icon: "pnl",
    area: "numbers",
    href: "/pnl",
    tour: "pnl",
    help: "pnl.fees",
    audience: "manager",
  },
  {
    id: "2026-11-15.private-events",
    date: "2026-11-15",
    title: "Private events and quotes",
    line: "From first inquiry to deposit: build a quote from packages and send a link to accept.",
    icon: "party",
    area: "floor",
    href: "/events/private",
    tour: "private-events",
    help: "events.private.page",
    audience: "manager",
  },

  // ---- 14 Nov ----
  {
    id: "2026-11-14.ordering",
    date: "2026-11-14",
    title: "Ordering, on one page",
    line: "Today's deadlines up top, every supplier in one table, bulk drafts and an Orders tab.",
    icon: "ordering",
    area: "food",
    href: "/ordering",
    tour: "ordering",
    help: "ordering.board",
    audience: "manager",
  },
  {
    id: "2026-11-14.overview",
    date: "2026-11-14",
    title: "Today's pace on Overview",
    line: "Sales so far against the forecast, what needs you, and last night's shift notes.",
    icon: "pace",
    area: "today",
    href: "/",
    tour: "overview",
    help: "overview.today",
    audience: "manager",
  },
  {
    id: "2026-11-14.insights",
    date: "2026-11-14",
    title: "Insights Lab, one thing at a time",
    line: "The most valuable finding first, a picture of why, a Watching list and the data range used.",
    icon: "insights",
    area: "assist",
    href: "/insights",
    tour: "insights",
    help: "insights.queue",
    audience: "manager",
  },

  // ---- 13 Nov ----
  {
    id: "2026-11-13.invoices",
    date: "2026-11-13",
    title: "Invoices that fill themselves in",
    line: "Snap several pages or a store receipt; lines link to ingredients and prices update on approval.",
    icon: "invoice",
    area: "numbers",
    href: "/invoices/new",
    help: "invoices.pages",
    audience: "manager",
  },
  {
    id: "2026-11-13.recipe-drafts",
    date: "2026-11-13",
    title: "Recipes drafted for you",
    line: "From Square items, pasted notes, a brew sheet or a photo — you check and save.",
    icon: "draft",
    area: "food",
    href: "/menu/drafts",
    help: "menu.drafts",
    audience: "manager",
  },
  {
    id: "2026-11-13.deadlines",
    date: "2026-11-13",
    title: "A deadline per delivery",
    line: "Friday delivery? Order by Wednesday 5pm. Set it once per supplier and Ordering counts down.",
    icon: "deadline",
    area: "food",
    href: "/ordering",
    help: "ordering.cutoffs",
    audience: "manager",
  },
  {
    id: "2026-11-13.kegs",
    date: "2026-11-13",
    title: "Keg tracking",
    line: "Scan a keg's QR label to kick it, see the walk-in at a glance and demand per beer.",
    icon: "keg",
    area: "floor",
    href: "/kegs",
    tour: "kegs",
    help: "kegs.page",
    audience: "manager",
  },
  {
    id: "2026-11-13.kegs-scan",
    date: "2026-11-13",
    title: "Scan to kick a keg",
    line: "Point your phone at the keg's QR label and tap Kicked — that's it.",
    icon: "keg",
    area: "floor",
    href: "/kegs",
    tour: "kegs",
    help: "kegs.scan",
    audience: "staff",
  },
  {
    id: "2026-11-13.tips",
    date: "2026-11-13",
    title: "Tips fill in from Square",
    line: "Card tips per person and declared cash per timecard, ready to pool.",
    icon: "tips",
    area: "people",
    href: "/tips",
    help: "tips.sources",
    audience: "manager",
  },
  {
    id: "2026-11-13.settings-learn",
    date: "2026-11-13",
    title: "Settings that learn",
    line: "Suggested hours, delivery days, deadlines and minimums from your own history — one tap to use.",
    icon: "learn",
    area: "setup",
    href: "/settings/business",
    help: "settings.learned",
    audience: "manager",
  },
  {
    id: "2026-11-13.count",
    date: "2026-11-13",
    title: "Faster counts",
    line: "A progress bar, area chips showing what's left, and search that forgives typos.",
    icon: "count",
    area: "floor",
    href: "/count",
    tour: "counting",
    help: "count.area",
    audience: "all",
  },
  {
    id: "2026-11-13.storage-areas",
    date: "2026-11-13",
    title: "Storage areas, in walking order",
    line: "Add, rename and reorder areas so a count follows the way you walk the kitchen.",
    icon: "areas",
    area: "setup",
    href: "/settings/areas",
    help: "settings.areas",
    audience: "manager",
  },
  {
    id: "2026-11-13.tables",
    date: "2026-11-13",
    title: "Power tables",
    line: "Search, filters, bulk edits, a side panel and keyboard shortcuts on every long list.",
    icon: "table",
    area: "food",
    href: "/ingredients",
    tour: "ingredients",
    help: "app.tables",
    audience: "manager",
  },
  {
    id: "2026-11-13.settings",
    date: "2026-11-13",
    title: "Settings, rebuilt",
    line: "Every setting in a plain section, with search — type “tax” or “hours” to jump there.",
    icon: "settings",
    area: "setup",
    href: "/settings",
    help: "settings.home.search",
    audience: "manager",
  },
  {
    id: "2026-11-13.quickbooks",
    date: "2026-11-13",
    title: "QuickBooks Online",
    line: "Approved supplier invoices go to QuickBooks as bills, with the photo attached.",
    icon: "quickbooks",
    area: "numbers",
    href: "/settings/quickbooks",
    help: "settings.quickbooks",
    audience: "manager",
  },
];

/** Entries a role may see, newest first. `hasRoute` filters features still landing. */
export function whatsNewFor(role: "MANAGER" | "STAFF", hasRoute: (route: string) => boolean = () => true): WhatsNewEntry[] {
  return WHATS_NEW.filter((e) => (role === "MANAGER" ? e.audience !== "staff" : e.audience !== "manager"))
    .filter((e) => !e.requiresRoute || hasRoute(e.requiresRoute))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** What a person last saw: the entry ids, and when. Stored per user. */
export interface WhatsNewSeen {
  ids: string[];
  at: string;
}

/**
 * Entries this person hasn't seen. Someone who joined after a change shipped
 * isn't told it's "new" — it was always there for them.
 */
export function unseenEntries(entries: WhatsNewEntry[], seen: WhatsNewSeen | null, joinedOn: string): WhatsNewEntry[] {
  const ids = new Set(seen?.ids ?? []);
  return entries.filter((e) => !ids.has(e.id) && e.date >= joinedOn);
}

/** "Show me": the page, with `?tour=` added when there's a tour to start there. */
export function showMeHref(e: Pick<WhatsNewEntry, "href" | "tour">): string {
  if (!e.tour) return e.href;
  const [path, hash = ""] = e.href.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}tour=${encodeURIComponent(e.tour)}${hash ? `#${hash}` : ""}`;
}

/** Group by date for the sheet: [["2026-11-15", […]], …], newest first. */
export function groupByDate(entries: WhatsNewEntry[]): [string, WhatsNewEntry[]][] {
  const m = new Map<string, WhatsNewEntry[]>();
  for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e]);
  return [...m].sort(([a], [b]) => b.localeCompare(a));
}
