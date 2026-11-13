/**
 * Help content registry. Everything the app can explain lives here, keyed by
 * stable ids (see ./README.md). Pure data: safe to import from server and
 * client components alike.
 */

import { fuzzyScore } from "@/domain/search";
import { basics } from "./areas/basics";
import { menu, ingredients, overview, prices } from "./areas/costing";
import { counts, importing, ordering, sales, settings, variance, waste } from "./areas/operations";
import { upcoming } from "./areas/upcoming";
import { finalParity } from "./areas/final";
import { training } from "./areas/training";
import { insights } from "./areas/insights";
import { drafting } from "./areas/drafting";
import { quickbooks } from "./areas/quickbooks";
import { tables } from "./areas/tables";
import { kegs } from "./areas/kegs";
import { settingsPages } from "./areas/settings";
import { getTour } from "./tours";
import type { HelpArea, HelpAreaId, HelpEntry } from "./types";

export type { HelpArea, HelpAreaId, HelpEntry, Audience } from "./types";

export const AREAS: HelpArea[] = [
  { id: "basics", title: "Getting around", description: "The command bar, editing grids, help mode, tours and your phone." },
  { id: "overview", title: "Overview", description: "The dashboard: food cost, sales, price moves, deliveries." },
  { id: "menu", title: "Menu costs", description: "Recipes, plate costs, food cost % and the recipe editor." },
  { id: "ingredients", title: "Ingredients", description: "The ingredient grid, yield, order buffer, pack sizes and units." },
  { id: "prices", title: "Prices", description: "Price sheets, manual updates and linking products to ingredients." },
  { id: "ordering", title: "Ordering", description: "Suggested orders, sending them and checking in deliveries." },
  { id: "counts", title: "Counts", description: "Counting stock on a phone." },
  { id: "waste", title: "Waste", description: "Logging what gets thrown out." },
  { id: "variance", title: "Margin gap", description: "Theoretical vs actual usage between two counts." },
  { id: "sales", title: "Sales & forecast", description: "Square sync, item links and the forecast." },
  { id: "import", title: "Importing sheets", description: "Bringing in your existing spreadsheets." },
  { id: "settings", title: "Settings", description: "Business profile and hours, logins, pay rules, cost targets, suppliers, invoice checks, fixed costs, connections and data." },
  { id: "team", title: "Team", description: "Positions, employees, availability, logins and announcements." },
  { id: "schedule", title: "Schedule", description: "Forecast-driven schedules with NY compliance checks." },
  { id: "my", title: "My shifts", description: "For staff: shifts, pickups, swaps, time off, sick leave and availability." },
  { id: "labor", title: "Labor & payroll", description: "Timecards, approval, sick leave, adjustments and the payroll export." },
  { id: "tips", title: "Tips", description: "Tip pooling by hours or points." },
  { id: "pnl", title: "Live P&L", description: "Sales − cost of goods − labor, split food and beverage." },
  { id: "budgets", title: "Budgets", description: "Weekly sales, food cost and labor targets." },
  { id: "events", title: "Events", description: "The events calendar and its effect on sales." },
  { id: "invoices", title: "Invoices", description: "Snap, match, approve, request credits, send to QuickBooks or export for Xero." },
  { id: "reviews", title: "Reviews", description: "Themes, reply drafts, what to fix this month." },
  { id: "brief", title: "Weekly brief", description: "Next week in a page, with one-tap actions." },
  { id: "insights", title: "Insights", description: "The Insights Lab: one thing to do at a time, how your numbers connect, and a tile for every question." },
  { id: "kegs", title: "Kegs", description: "Scanning kegs on a phone, what's on tap, the walk-in, demand per beer, labels and importing." },
  { id: "training", title: "Training & certificates", description: "ATAP, ServSafe and other certificates, expiry reminders and onboarding checklists." },
];

export const HELP: HelpEntry[] = [
  ...basics,
  ...tables,
  ...overview,
  ...menu,
  ...ingredients,
  ...prices,
  ...ordering,
  ...counts,
  ...waste,
  ...variance,
  ...sales,
  ...importing,
  ...settings,
  ...settingsPages,
  ...upcoming,
  ...finalParity,
  ...training,
  ...insights,
  ...drafting,
  ...quickbooks,
  ...kegs,
];

const BY_ID = new Map(HELP.map((e) => [e.id, e]));
const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]));

/** Look up one entry. Unknown ids return undefined (and HelpTip renders nothing). */
export const getHelp = (id: string): HelpEntry | undefined => BY_ID.get(id);
export const getArea = (id: HelpAreaId): HelpArea | undefined => AREA_BY_ID.get(id);

export const canSee = (e: HelpEntry, role: "MANAGER" | "STAFF") => role === "MANAGER" || (e.audience ?? "manager") !== "manager";

/** Pages staff can open (mirrors STAFF_PATHS in src/middleware.ts). */
const STAFF_ROUTES = ["/my", "/count", "/waste", "/kegs", "/help"];

/**
 * Whether an in-app link in help content leads somewhere this role can go:
 * staff never get links to manager pages, manager-only articles or manager tours
 * (they'd just bounce back to /my).
 */
export function canFollowHelpLink(href: string, role: "MANAGER" | "STAFF"): boolean {
  if (role === "MANAGER") return true;
  const url = new URL(href, "http://x");
  if (!STAFF_ROUTES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return false;
  const article = url.pathname.match(/^\/help\/(.+)$/);
  if (article) {
    const e = getHelp(decodeURIComponent(article[1]));
    if (!e || !canSee(e, role)) return false;
  }
  const tour = url.searchParams.get("tour");
  if (tour && getTour(tour)?.audience !== "all") return false;
  return true;
}

/** Entries a role may read, in registry order. */
export const helpFor = (role: "MANAGER" | "STAFF") => HELP.filter((e) => canSee(e, role));

/**
 * Help entries for a page path — the page's own entries first, then its
 * parent's (so /menu/abc123 falls back to /menu). Used when help mode is on
 * but a page has no outlined sections.
 */
export function helpForPath(pathname: string): HelpEntry[] {
  for (let p = pathname; p; p = p.slice(0, Math.max(0, p.lastIndexOf("/")))) {
    const hits = HELP.filter((e) => e.route === p && !e.draft);
    if (hits.length) return hits;
    if (p === "/") break;
  }
  return HELP.filter((e) => e.route === "/" && !e.draft);
}

/** Related entries that exist and the role may see. */
export const relatedOf = (e: HelpEntry, role: "MANAGER" | "STAFF" = "MANAGER") =>
  (e.related ?? []).map(getHelp).filter((x): x is HelpEntry => !!x && canSee(x, role));

/**
 * Search over title + keywords (fuzzy, like the command bar) and then body
 * text (every word must appear). Scattered fuzzy matches are dropped so a
 * long query doesn't match random titles.
 */
export function searchHelp(query: string, entries: HelpEntry[] = HELP, limit = 30): HelpEntry[] {
  const q = query.trim();
  if (!q) return entries.slice(0, limit);
  const min = q.replace(/\s+/g, "").length * 2.5;
  const byTitle = entries
    .map((e) => ({ e, s: fuzzyScore(q, `${e.title} ${(e.keywords ?? []).join(" ")}`) }))
    .filter((x): x is { e: HelpEntry; s: number } => x.s != null && x.s >= min)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.e);
  const text = (e: HelpEntry) => `${e.title} ${e.body} ${e.article ?? ""} ${(e.keywords ?? []).join(" ")}`.toLowerCase();
  const phrase = q.toLowerCase();
  const seen = new Set(byTitle.map((e) => e.id));
  // Whole phrase in the text first ("on hand"), then entries containing every longer word.
  const inPhrase = entries.filter((e) => !seen.has(e.id) && text(e).includes(phrase));
  inPhrase.forEach((e) => seen.add(e.id));
  const words = phrase.split(/\s+/).filter((w) => w.length > 2);
  const inWords = words.length > 1 ? entries.filter((e) => !seen.has(e.id) && words.every((w) => text(e).includes(w))) : [];
  const inBody = [...inPhrase, ...inWords];
  return [...byTitle, ...inBody].slice(0, limit);
}
