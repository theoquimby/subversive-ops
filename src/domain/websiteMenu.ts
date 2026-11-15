/**
 * The website menu (GET /api/public/menu) from Ops data: menu recipes and add-ons
 * marked "on website", their sections, and the draft list from what's on tap.
 * Output is the website's own menu shape (src/domain/websiteSchema.ts → menuSchema);
 * an item that wouldn't pass is left out with a plain-English reason, so one bad
 * row never takes the menu down. Nothing about cost, recipes or suppliers.
 * Pure.
 */

import type { BoardPour } from "./taps";
import { MENU_TAGS, menuSchema, plainItemSchema, beerItemSchema, type MenuTag, type WebBeerItem, type WebDrinkSection, type WebFoodSection, type WebMenu, type WebMenuGroup, type WebPlainItem } from "./websiteSchema";

// ---- Slugs ----------------------------------------------------------------------------

/** The website's kebab (src/lib/events/slug.ts): accents and apostrophes dropped, 60 chars. */
export function kebab(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’'‘]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const sectionIdOf = (title: string) => kebab(title) || "menu";

// ---- Guesses --------------------------------------------------------------------------

export type Place = "food" | "drinks";

const DRINK_CATEGORY = /beer|wine|cider|cocktail|drink|beverage|soda|spirit|liquor|non[- ]?alc|^na$|coffee|tea|seltzer|mocktail|bar/i;

/** Drinks or food from the recipe's category (Ops categories are free text). */
export const guessPlace = (category: string): Place => (DRINK_CATEGORY.test(category) ? "drinks" : "food");

/** Draft beer comes from the tap list, so beer pour recipes aren't offered as menu items. */
export const isDraftBeerCategory = (category: string) => /^\s*(draft\s*)?beers?\s*$/i.test(category);

export const BEER_FAMILIES = ["Light", "Hoppy", "Malty", "Farmhouse", "Sour"] as const;
export type BeerFamily = (typeof BEER_FAMILIES)[number];

/** The website's drink filter family (its group titles) from a beer's style or name. */
export function guessFamily(style: string | null | undefined, name = ""): BeerFamily | null {
  const s = `${style ?? ""} ${name}`.toLowerCase();
  if (/sour|gose|berliner|lambic|kriek|fruit|currant|berry/.test(s)) return "Sour";
  if (/saison|farmhouse|grisette|biere de garde|bière de garde|brett|wild/.test(s)) return "Farmhouse";
  if (/ipa|pale|hop|apa\b|nectar/.test(s)) return "Hoppy";
  if (/m[aä]rzen|fest|oktober|amber|brown|bock|dunkel|stout|porter|red|scotch|malt|schwarz|vienna|barleywine/.test(s)) return "Malty";
  if (/pils|lager|helles|k[oö]lsch|light|blonde|golden|wheat|wit|cream|session/.test(s)) return "Light";
  return null;
}

export const isFamily = (s: string | null | undefined): s is BeerFamily => !!s && (BEER_FAMILIES as readonly string[]).includes(s);
export const isMenuTag = (s: string): s is MenuTag => (MENU_TAGS as readonly string[]).includes(s);

// ---- Inputs ---------------------------------------------------------------------------

export interface WebItemFields {
  onWebsite: boolean;
  name: string | null;
  description: string | null;
  tags: string[];
  badge: string | null;
  modifiers: string | null;
  place: string | null;
  section: string | null;
  sort: number;
  showPrice: boolean;
  availableFrom: string | null;
  availableUntil: string | null;
}

export interface MenuRecipeIn {
  id: string;
  name: string;
  category: string;
  kind: "MENU" | "MODIFIER";
  menuPrice: number | null;
  active: boolean;
  web: WebItemFields | null;
}

export interface SectionMetaIn {
  id: string;
  title: string;
  place: string;
  intro: string | null;
  note: string | null;
  modifiers: string | null;
  sort: number;
  availableFrom: string | null;
  availableUntil: string | null;
}

export interface TapBeerIn {
  beerId: string;
  name: string;
  style: string | null;
  abv: number | null;
  description: string | null;
  /** "#RRGGBB" */
  color: string;
  house: boolean;
  diet: string | null;
  pours: BoardPour[];
  web: { onWebsite: boolean; family: string | null; badge: string | null; hazy: boolean } | null;
}

export interface MenuBuildInput {
  recipes: MenuRecipeIn[];
  sections: SectionMetaIn[];
  taps: TapBeerIn[];
  notices: string[];
  today: string;
  /** Latest change to anything on the menu, "YYYY-MM-DD". */
  updated: string;
}

export interface MenuWarning {
  /** recipe id or beer id */
  id: string;
  name: string;
  message: string;
}

// ---- Items ----------------------------------------------------------------------------

const clean = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return v ? v : undefined;
};

/** The resolved placement of a recipe on the website (also used by the Ops screen). */
export function placementOf(r: Pick<MenuRecipeIn, "category" | "web">): { place: Place; section: string; sectionId: string } {
  const place = r.web?.place === "food" || r.web?.place === "drinks" ? r.web.place : guessPlace(r.category);
  const section = clean(r.web?.section) ?? (r.category.trim() || "Menu");
  return { place, section, sectionId: sectionIdOf(section) };
}

function windowOf(from: string | null | undefined, until: string | null | undefined) {
  const w: { seasonal?: true; availableFrom?: string; availableUntil?: string } = {};
  if (from) w.availableFrom = from;
  if (until) w.availableUntil = until;
  if (from || until) w.seasonal = true;
  return w;
}

/** A recipe as a website item (no validation). */
export function recipeItem(r: MenuRecipeIn): WebPlainItem {
  const w = r.web;
  const tags = [...new Set((w?.tags ?? []).filter(isMenuTag))];
  const item: WebPlainItem = {
    name: clean(w?.name) ?? r.name.trim(),
    ...(clean(w?.description) ? { description: clean(w?.description) } : {}),
    ...(clean(w?.modifiers) ? { modifiers: clean(w?.modifiers) } : {}),
    ...(w?.showPrice !== false && r.menuPrice != null && r.menuPrice >= 0 ? { price: Math.round(r.menuPrice * 100) / 100 } : {}),
    ...(tags.length ? { tags } : {}),
    ...(clean(w?.badge) ? { badge: clean(w?.badge) } : {}),
    ...windowOf(w?.availableFrom, w?.availableUntil),
  };
  return item;
}

/**
 * Half and full prices from a beer's pours: full is the biggest pour, half the one
 * nearest 60% of it (a 10 oz next to a 16 oz). Tasters under 40% of the full pour
 * aren't a half. Null when there aren't two such sizes.
 */
export function halfAndFull(pours: BoardPour[]): { half: BoardPour; full: BoardPour } | null {
  const sized = pours.filter((p) => p.oz != null && p.oz > 0 && p.price >= 0).sort((a, b) => a.oz! - b.oz!);
  if (sized.length < 2) return null;
  const full = sized[sized.length - 1];
  const halves = sized.filter((p) => p.oz! < full.oz! && p.oz! >= full.oz! * 0.4);
  if (!halves.length) return null;
  const target = full.oz! * 0.6;
  const half = halves.reduce((best, p) => (Math.abs(p.oz! - target) < Math.abs(best.oz! - target) ? p : best));
  return { half, full };
}

/** A tap as a website beer item, or a plain item when style, ABV or two pour sizes are missing. */
export function beerItem(b: TapBeerIn): { item: WebBeerItem | WebPlainItem; full: boolean; missing: string[] } {
  const hf = halfAndFull(b.pours);
  const missing: string[] = [];
  if (!clean(b.style)) missing.push("style");
  if (b.abv == null || !(b.abv > 0) || b.abv > 20) missing.push("ABV");
  if (!hf) missing.push("two pour sizes with prices");
  if (!/^#[0-9A-Fa-f]{6}$/.test(b.color)) missing.push("color");
  const tags: MenuTag[] = /vegan/i.test(b.diet ?? "") ? ["vegan"] : [];
  const common = {
    name: b.name.trim(),
    ...(clean(b.description) ? { description: clean(b.description) } : {}),
    ...(clean(b.web?.badge) ? { badge: clean(b.web?.badge) } : {}),
    ...(tags.length ? { tags } : {}),
  };
  if (!missing.length && hf) {
    return {
      item: { ...common, style: b.style!.trim(), abv: Math.round(b.abv! * 10) / 10, prices: { half: hf.half.price, full: hf.full.price }, color: b.color, ...(b.web?.hazy ? { hazy: true } : {}) },
      full: true,
      missing,
    };
  }
  const biggest = [...b.pours].sort((a, z) => (z.oz ?? 0) - (a.oz ?? 0))[0];
  const desc = [clean(b.style), b.abv ? `${b.abv}%` : undefined, clean(b.description)].filter(Boolean).join(" · ");
  return { item: { ...common, ...(desc ? { description: desc } : {}), ...(biggest ? { price: biggest.price } : {}) }, full: false, missing };
}

/** "9 oz" / "16 oz" for the menu header: the most common half and full sizes. */
export function pourSizes(taps: TapBeerIn[]): { half: string; full: string } {
  const count = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0];
  const pairs = taps.map((t) => halfAndFull(t.pours)).filter((x): x is NonNullable<typeof x> => !!x);
  return { half: count(pairs.map((p) => p.half.label)) ?? "Half", full: count(pairs.map((p) => p.full.label)) ?? "Full" };
}

// ---- The menu -------------------------------------------------------------------------

const byOrder = <T extends { sort: number; name: string }>(a: T, b: T) => a.sort - b.sort || a.name.localeCompare(b.name);
const expired = (until: string | null | undefined, today: string) => !!until && until < today;

export const DEFAULT_NOTICES = ["If you have a food allergy or intolerance, please notify us.", "*Consuming raw or undercooked meats, poultry, seafood, shellfish or eggs may increase your risk of foodborne illness."];

export function buildMenu(input: MenuBuildInput): { menu: WebMenu; warnings: MenuWarning[]; counts: { food: number; drinks: number; beers: number } } {
  const warnings: MenuWarning[] = [];
  const metaById = new Map(input.sections.map((s) => [s.id, s]));
  const warn = (id: string, name: string, message: string) => warnings.push({ id, name, message });

  // Recipes → food sections and drink groups.
  type Placed = { item: WebPlainItem; sort: number; name: string; sectionId: string; section: string; firstSeen: number };
  const food = new Map<string, Placed[]>();
  const drinks = new Map<string, Placed[]>();
  let seen = 0;
  for (const r of input.recipes) {
    if (!r.web?.onWebsite) continue;
    if (!r.active) {
      warn(r.id, r.name, "Archived in Menu costs, so it's left off");
      continue;
    }
    if (isDraftBeerCategory(r.category)) {
      warn(r.id, r.name, "Draft beer comes from the tap list, so this pour is left off");
      continue;
    }
    if (expired(r.web.availableUntil, input.today)) continue;
    const item = recipeItem(r);
    const ok = plainItemSchema.safeParse(item);
    if (!ok.success) {
      warn(r.id, r.name, `Left off: ${ok.error.issues[0]?.message ?? "doesn't fit the website"}`);
      continue;
    }
    const p = placementOf(r);
    const list = (p.place === "food" ? food : drinks).get(p.sectionId) ?? [];
    list.push({ item, sort: r.web.sort, name: item.name, sectionId: p.sectionId, section: p.section, firstSeen: seen++ });
    (p.place === "food" ? food : drinks).set(p.sectionId, list);
  }

  const sectionOrder = (id: string, list: Placed[]) => metaById.get(id)?.sort ?? 1000 + Math.min(...list.map((x) => x.firstSeen));
  const metaWindow = (id: string) => {
    const m = metaById.get(id);
    return m ? windowOf(m.availableFrom, m.availableUntil) : {};
  };
  const opt = (k: "intro" | "note" | "modifiers", id: string) => {
    const v = clean(metaById.get(id)?.[k]);
    return v ? { [k]: v } : {};
  };

  const foodSections: WebFoodSection[] = [...food.entries()]
    .sort((a, b) => sectionOrder(a[0], a[1]) - sectionOrder(b[0], b[1]))
    .filter(([id]) => !expired(metaById.get(id)?.availableUntil, input.today))
    .map(([id, list]) => ({
      id,
      title: metaById.get(id)?.title?.trim() || list[0].section,
      ...opt("intro", id),
      ...opt("modifiers", id),
      ...opt("note", id),
      ...metaWindow(id),
      items: [...list].sort(byOrder).map((x) => x.item),
    }));

  // Taps → house and guest sections, grouped by family.
  const beerSections: WebDrinkSection[] = [];
  const seenBeer = new Set<string>();
  const house: Map<string, (WebBeerItem | WebPlainItem)[]> = new Map();
  const guest: Map<string, (WebBeerItem | WebPlainItem)[]> = new Map();
  let beers = 0;
  for (const t of input.taps) {
    if (seenBeer.has(t.beerId)) continue;
    seenBeer.add(t.beerId);
    if (t.web && !t.web.onWebsite) continue;
    const b = beerItem(t);
    const schema = b.full ? beerItemSchema : plainItemSchema;
    const ok = schema.safeParse(b.item);
    if (!ok.success) {
      warn(t.beerId, t.name, `Left off: ${ok.error.issues[0]?.message ?? "doesn't fit the website"}`);
      continue;
    }
    if (!b.full) warn(t.beerId, t.name, `Shows without the glass and two prices: add ${b.missing.join(", ")}`);
    else if ("prices" in b.item && b.item.prices.half > b.item.prices.full) warn(t.beerId, t.name, `The ${halfAndFull(t.pours)!.half.label} pour costs more than the ${halfAndFull(t.pours)!.full.label} — check the prices on Kegs → Beers`);
    const fam = isFamily(t.web?.family) ? t.web!.family! : (guessFamily(t.style, t.name) ?? "Other");
    const target = t.house ? house : guest;
    target.set(fam, [...(target.get(fam) ?? []), b.item]);
    beers++;
  }
  const famOrder = [...BEER_FAMILIES, "Other"];
  const groupsOf = (m: Map<string, (WebBeerItem | WebPlainItem)[]>): WebMenuGroup[] => famOrder.filter((f) => m.has(f)).map((f) => ({ title: f, items: m.get(f)! }));
  if (house.size) beerSections.push({ id: "house-beer", title: "House-brewed beer", groups: groupsOf(house) });
  if (guest.size) beerSections.push({ id: "guest-beer", title: "Guest taps", groups: groupsOf(guest) });

  const drinkGroups: WebMenuGroup[] = [...drinks.entries()]
    .sort((a, b) => sectionOrder(a[0], a[1]) - sectionOrder(b[0], b[1]))
    .filter(([id]) => !expired(metaById.get(id)?.availableUntil, input.today))
    .map(([id, list]) => ({ title: metaById.get(id)?.title?.trim() || list[0].section, ...opt("note", id), ...metaWindow(id), items: [...list].sort(byOrder).map((x) => x.item) }));
  const drinkSections: WebDrinkSection[] = [...beerSections, ...(drinkGroups.length ? [{ id: "other-beverages", title: "Other beverages", groups: drinkGroups }] : [])];

  const menu: WebMenu = {
    _meta: { source: "Subversive Ops", verify: [], pourSizes: pourSizes(input.taps), updated: input.updated },
    drinks: drinkSections,
    food: foodSections,
    notices: input.notices.map((n) => n.trim()).filter(Boolean),
  };
  const whole = menuSchema.safeParse(menu);
  if (!whole.success) throw new Error(`website menu failed its own schema: ${whole.error.issues[0]?.path.join(".")} ${whole.error.issues[0]?.message}`);
  return { menu, warnings, counts: { food: foodSections.reduce((n, s) => n + s.items.length, 0), drinks: drinkGroups.reduce((n, g) => n + g.items.length, 0), beers } };
}
