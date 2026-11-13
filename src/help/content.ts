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
  { id: "settings", title: "Settings", description: "Team logins, suppliers, food cost target, data." },
  { id: "team", title: "Team", description: "Positions, employees and availability.", upcoming: true },
  { id: "schedule", title: "Schedule", description: "Forecast-driven schedules with NY compliance checks.", upcoming: true },
  { id: "my", title: "My shifts", description: "For staff: shifts, pickups, swaps and time off.", upcoming: true },
  { id: "labor", title: "Labor & payroll", description: "Timecards, overtime, spread of hours, payroll export.", upcoming: true },
  { id: "tips", title: "Tips", description: "Tip pooling by hours or points.", upcoming: true },
  { id: "pnl", title: "Live P&L", description: "Sales − food − labor, updated daily.", upcoming: true },
  { id: "budgets", title: "Budgets", description: "Weekly targets.", upcoming: true },
  { id: "events", title: "Events", description: "The events calendar and its effect on sales.", upcoming: true },
  { id: "invoices", title: "Invoices", description: "Snap, match, approve, request credits.", upcoming: true },
  { id: "reviews", title: "Reviews", description: "Themes from guest reviews and reply drafts.", upcoming: true },
  { id: "brief", title: "Weekly brief", description: "Last week in a page, with one-tap actions.", upcoming: true },
];

export const HELP: HelpEntry[] = [
  ...basics,
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
  ...upcoming,
];

const BY_ID = new Map(HELP.map((e) => [e.id, e]));
const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]));

/** Look up one entry. Unknown ids return undefined (and HelpTip renders nothing). */
export const getHelp = (id: string): HelpEntry | undefined => BY_ID.get(id);
export const getArea = (id: HelpAreaId): HelpArea | undefined => AREA_BY_ID.get(id);

export const canSee = (e: HelpEntry, role: "MANAGER" | "STAFF") => role === "MANAGER" || (e.audience ?? "manager") !== "manager";

/** Entries a role may read, in registry order. */
export const helpFor = (role: "MANAGER" | "STAFF") => HELP.filter((e) => canSee(e, role));

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

/** First paragraph-ish summary for list rows. */
export const summaryOf = (e: HelpEntry) => e.body;
