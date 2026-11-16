/**
 * The setup checklist: what to connect and set up so the app does its job,
 * grouped into Essentials and Nice to have. Each item is ticked off from real
 * data (see services/setupChecklist.ts), never by hand, so it can't drift
 * from the truth. Pure — the order here is the order shown.
 */

export type SetupGroup = "essentials" | "nice";

export type SetupItemId =
  | "square"
  | "history"
  | "menuLinks"
  | "suppliers"
  | "prices"
  | "recipes"
  | "areas"
  | "team"
  | "morning"
  | "prep"
  | "kegs"
  | "beers"
  | "ai"
  | "quickbooks"
  | "website"
  | "google";

export interface SetupItemDef {
  id: SetupItemId;
  group: SetupGroup;
  title: string;
  /** Why it's worth doing, in one line. */
  why: string;
  /** Where "Do it" goes. */
  href: string;
  /** Rough time, so it doesn't feel open-ended. */
  minutes: number;
  /** Only offered while this page exists (features still landing). */
  requiresRoute?: string;
}

export const SETUP_ITEMS: SetupItemDef[] = [
  // Essentials, in the order they build on each other: Square brings sales in, suppliers and
  // prices say what things cost, recipes turn the two into food cost.
  { id: "square", group: "essentials", title: "Connect Square", why: "Sales, the menu, tips and timecards come in by themselves.", href: "/settings/square", minutes: 6 },
  { id: "history", group: "essentials", title: "Bring in your sales history", why: "More history makes the forecast, prep and ordering smarter.", href: "/settings/square#import", minutes: 1 },
  { id: "suppliers", group: "essentials", title: "Suppliers and delivery deadlines", why: "Ordering counts down to each order-by time.", href: "/settings/suppliers", minutes: 5 },
  { id: "prices", group: "essentials", title: "Get your prices in", why: "Snap an invoice or receipt, or upload a price sheet — recipes then know what things cost.", href: "/invoices/new", minutes: 5 },
  { id: "recipes", group: "essentials", title: "Add your recipes", why: "Paste them from a spreadsheet, link a Google Sheet, or photograph recipe cards.", href: "/import?for=recipes", minutes: 20 },
  { id: "menuLinks", group: "essentials", title: "Link Square items to recipes", why: "So every sale counts toward food cost and the prep list.", href: "/sales/square-menu", minutes: 15 },
  { id: "areas", group: "essentials", title: "Storage areas, in walking order", why: "Counts follow the way you walk the kitchen.", href: "/settings/areas", minutes: 2 },
  { id: "team", group: "essentials", title: "Invite staff and set roles", why: "Staff get their shifts, prep, counts and kegs on their phones.", href: "/settings/people", minutes: 5 },
  { id: "morning", group: "essentials", title: "Pick your morning brief time", why: "Your day on one page, on your phone before you walk in.", href: "/brief", minutes: 1 },
  // Nice to have: each one turns on more.
  { id: "ai", group: "nice", title: "Turn on AI features", why: "Reads invoices, receipts and price sheets from a photo, drafts recipes and answers questions.", href: "/settings/connections?open=ai", minutes: 3 },
  { id: "prep", group: "nice", title: "Set up the prep list", why: "Pars, shelf life and stations for what the kitchen makes.", href: "/prep/setup", minutes: 10 },
  { id: "kegs", group: "nice", title: "Bring in your kegs", why: "Every keg, beer and account from Distribrewtion or your old keg app — old stickers keep working.", href: "/kegs/import", minutes: 10 },
  { id: "beers", group: "nice", title: "Beers and the tap list TV", why: "What's pouring, with prices, on the bar TV and the website.", href: "/kegs/beers", minutes: 10 },
  { id: "quickbooks", group: "nice", title: "Connect QuickBooks", why: "Approved invoices go over as bills, photo attached.", href: "/settings/quickbooks", minutes: 20 },
  { id: "website", group: "nice", title: "Connect the website", why: "Hours, menu and events on the site update the moment you save.", href: "/settings/connections?open=website", minutes: 5, requiresRoute: "/website" },
  { id: "google", group: "nice", title: "Connect Google", why: "Search Console, your Google listing and Google reviews, all on one page.", href: "/settings/connections/google", minutes: 20 },
];

export type SetupFacts = Partial<Record<SetupItemId, { done: boolean; detail?: string }>>;

export interface SetupItem extends SetupItemDef {
  done: boolean;
  /** Progress in words, e.g. "32 of 40 linked". */
  detail?: string;
}

export interface SetupChecklist {
  items: SetupItem[];
  essentials: { done: number; total: number };
  nice: { done: number; total: number };
  /** Every essential is done. */
  essentialsDone: boolean;
  /** The first essential still to do, else the first nice-to-have, else null. */
  next: SetupItem | null;
}

/** Build the checklist from facts. Items whose page isn't there (`hasRoute` false) are left out. */
export function buildChecklist(facts: SetupFacts, hasRoute: (route: string) => boolean = () => true): SetupChecklist {
  const items = SETUP_ITEMS.filter((d) => !d.requiresRoute || hasRoute(d.requiresRoute)).map((d) => ({ ...d, done: facts[d.id]?.done ?? false, detail: facts[d.id]?.detail }));
  const count = (g: SetupGroup) => {
    const of = items.filter((i) => i.group === g);
    return { done: of.filter((i) => i.done).length, total: of.length };
  };
  const essentials = count("essentials");
  const nice = count("nice");
  const next = items.find((i) => i.group === "essentials" && !i.done) ?? items.find((i) => !i.done) ?? null;
  return { items, essentials, nice, essentialsDone: essentials.done === essentials.total, next };
}

/** Linking counts as done once most items people actually buy are linked. */
export const LINKED_ENOUGH = 0.8;
export function menuLinksFact(linked: number, total: number): { done: boolean; detail?: string } {
  if (total === 0) return { done: false };
  return { done: linked / total >= LINKED_ENOUGH, detail: `${linked} of ${total} linked` };
}

/** History counts as done when the first import finished or sales go back a season (90+ days). */
export const HISTORY_DAYS = 90;
export function historyFact(importFinished: boolean, salesDays: number): { done: boolean; detail?: string } {
  return { done: importFinished || salesDays >= HISTORY_DAYS, detail: salesDays ? `${salesDays} days back` : undefined };
}

/**
 * Prices count as in once most ingredients the recipes use have a price (that's what
 * food cost needs). Before there are recipes, the first invoice or price sheet will do.
 */
export const PRICED_ENOUGH = 0.8;
export function pricesFact(args: { usedInRecipes: number; priced: number; documents: number }): { done: boolean; detail?: string } {
  const { usedInRecipes, priced, documents } = args;
  if (usedInRecipes > 0) return { done: priced / usedInRecipes >= PRICED_ENOUGH, detail: `${priced} of ${usedInRecipes} recipe ingredients priced` };
  return { done: documents > 0, detail: documents ? `${documents} ${documents === 1 ? "invoice or price sheet" : "invoices and price sheets"}` : undefined };
}

/** Recipes count as in once there are a handful with ingredients (a small menu is still a menu). */
export const RECIPES_ENOUGH = 5;
export function recipesFact(withIngredients: number): { done: boolean; detail?: string } {
  return { done: withIngredients >= RECIPES_ENOUGH, detail: withIngredients ? `${withIngredients} ${withIngredients === 1 ? "recipe" : "recipes"} with ingredients` : undefined };
}
