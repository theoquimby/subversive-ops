/**
 * "What I look after": each manager's areas, so the Overview and the briefs
 * lead with what they care about (Zane the brewing, Max the business). It
 * never changes what anyone may do; roles still decide that. No focus means
 * everything, exactly as before. Pure: safe on server and client.
 */

export const FOCUS_IDS = ["business", "brewery", "kegs", "kitchen", "people", "online"] as const;
export type Focus = (typeof FOCUS_IDS)[number];

export const FOCUS_INFO: Record<Focus, { label: string; description: string; href: string }> = {
  business: { label: "Business", description: "Sales, P&L, labor cost, money, beer tax, events, upkeep", href: "/pnl" },
  brewery: { label: "Brewery", description: "Tanks, brews, brewing stock and brewery orders", href: "/brewery" },
  kegs: { label: "Kegs", description: "Taps, the walk-in, the keg fleet and wholesale", href: "/kegs" },
  kitchen: { label: "Kitchen", description: "Prep, counts, ordering, invoices and menu costs", href: "/ordering" },
  people: { label: "People", description: "Schedule, timecards, the team, training, closing lists", href: "/schedule" },
  online: { label: "Online", description: "Website, Google, social and reviews", href: "/online" },
};

const isFocus = (x: unknown): x is Focus => typeof x === "string" && (FOCUS_IDS as readonly string[]).includes(x);

/** Known ids only, each once, in the order the person picked them. */
export function parseFocus(raw: unknown): Focus[] {
  if (!Array.isArray(raw)) return [];
  const out: Focus[] = [];
  for (const x of raw) if (isFocus(x) && !out.includes(x)) out.push(x);
  return out;
}

export const focusLabels = (focus: readonly Focus[]) => focus.map((f) => FOCUS_INFO[f].label);

/** One string per focus, for building a brief once per distinct focus. */
export const focusKey = (focus: readonly Focus[]) => focus.join(",");

// ---- Which area an item belongs to ------------------------------------------------------

/** Exact keys. */
const EXACT: Record<string, Focus> = {
  // Overview "Needs you" (domain/attention, opsAttention)
  orders: "kitchen",
  invoices: "kitchen",
  kegs: "kegs",
  requests: "people",
  schedule: "people",
  certs: "people",
  checklists: "people",
  reviews: "online",
  upkeep: "business",
  brewery: "brewery",
  // Weekly brief cards (app/(app)/brief/weekly.tsx) and decisions (domain/weekRecap)
  "orders-drafted": "kitchen",
  prices: "kitchen",
  menu: "kitchen",
  gap: "kitchen",
  counts: "kitchen",
  unmapped: "kitchen",
  waste: "kitchen",
  autoOrders: "kitchen",
  invoiceIssues: "kitchen",
  training: "people",
  timeOff: "people",
  swaps: "people",
  rating: "online",
  badReviews: "online",
};

/** Key prefixes, checked in order. */
const PREFIXES: [string, Focus][] = [
  ["brewery.", "brewery"],
  ["kegs.", "kegs"],
  ["tap-", "kegs"],
  ["missed.", "kitchen"],
  ["order.", "kitchen"],
  ["order-", "kitchen"],
  ["draft-", "kitchen"],
  ["deadline:", "kitchen"],
  ["draft:", "kitchen"],
  ["checkin:", "kitchen"],
  ["arriving:", "kitchen"],
  ["upkeep.", "business"],
  ["beertax.", "business"],
  ["private.", "business"],
];

/**
 * The area an Overview "Needs you" item, a morning brief "Before tonight" line
 * or a weekly brief card belongs to, by its key. Anything new or unknown sits
 * with the business, so it is never lost.
 */
export function areaOfItem(key: string): Focus {
  const exact = EXACT[key];
  if (exact) return exact;
  for (const [p, area] of PREFIXES) if (key.startsWith(p)) return area;
  return "business";
}

// ---- Urgent things always show ----------------------------------------------------------

/**
 * At or above this urgency an item shows to everyone, whatever they look
 * after: about as pressing as an order cutoff ten hours away. Red items
 * (overdue beer tax, a missed order, equipment down, an overdue transfer)
 * always count too.
 */
export const URGENT_URGENCY = 90;

export function isUrgent(i: { tone?: string; urgency?: number }): boolean {
  return i.tone === "bad" || (i.urgency ?? 0) >= URGENT_URGENCY;
}

/**
 * Splits a list into what's the person's (their areas, plus anything urgent)
 * and what's elsewhere. Order is kept. No focus: everything is theirs.
 */
export function splitByFocus<T extends { key: string; tone?: string; urgency?: number; area?: Focus }>(items: readonly T[], focus: readonly Focus[]): { mine: T[]; elsewhere: T[] } {
  if (focus.length === 0) return { mine: [...items], elsewhere: [] };
  const mine: T[] = [];
  const elsewhere: T[] = [];
  for (const i of items) (focus.includes(i.area ?? areaOfItem(i.key)) || isUrgent(i) ? mine : elsewhere).push(i);
  return { mine, elsewhere };
}

export interface ElsewhereGroup<T> {
  area: Focus;
  label: string;
  href: string;
  items: T[];
  /** "2 invoices to approve, and 1 more", a note, or "Nothing waiting". */
  line: string;
}

/**
 * The short "Elsewhere" list: one group per area the person doesn't look
 * after, in the usual order, with what's waiting there. `notes` stand in
 * for an area with nothing waiting ("Today: $3,150 forecast").
 */
export function elsewhereGroups<T extends { key: string; title: string; area?: Focus }>(elsewhere: readonly T[], focus: readonly Focus[], notes: Partial<Record<Focus, string>> = {}): ElsewhereGroup<T>[] {
  if (focus.length === 0) return [];
  return FOCUS_IDS.filter((a) => !focus.includes(a)).map((area) => {
    const items = elsewhere.filter((i) => (i.area ?? areaOfItem(i.key)) === area);
    const line = items.length ? `${items[0].title}${items.length > 1 ? `, and ${items.length - 1} more` : ""}` : notes[area] ?? "Nothing waiting";
    return { area, label: FOCUS_INFO[area].label, href: FOCUS_INFO[area].href, items, line };
  });
}

// ---- Sections -----------------------------------------------------------------------------

/** Whole sections of the Overview and the briefs, and whose they are. */
const SECTION_AREAS = {
  // Overview
  brewery: ["brewery"],
  costs: ["kitchen"],
  deliveries: ["kitchen"],
  insights: ["business"],
  week: ["business"],
  // Morning brief
  yesterday: ["business"],
  today: ["business", "people"],
  team: ["people"],
  insight: ["business"],
  notes: ["business"],
  wrap: ["business"],
  // Weekly brief
  lastWeek: ["business"],
  kegs: ["kegs"],
  forecast: ["business"],
} satisfies Record<string, Focus[]>;

export type BriefSection = keyof typeof SECTION_AREAS;

/** Whether a whole section shows for this focus (always, with no focus). */
export function showSection(section: BriefSection, focus: readonly Focus[]): boolean {
  return focus.length === 0 || (SECTION_AREAS[section] as readonly Focus[]).some((a) => focus.includes(a));
}

export type OverviewBlock = "today" | "needs" | "notes" | "insights" | "week" | "costs" | "deliveries" | "brewery" | "elsewhere";

const DEFAULT_OVERVIEW: OverviewBlock[] = ["today", "needs", "notes", "insights", "week", "costs", "deliveries"];
const AREA_BLOCKS: Record<Focus, OverviewBlock[]> = {
  business: ["today", "notes", "insights", "week"],
  brewery: ["brewery"],
  kegs: [],
  kitchen: ["costs", "deliveries"],
  people: [],
  online: [],
};

/**
 * The Overview's blocks, top to bottom. No focus: today's Overview. With a
 * focus: each chosen area's sections in the person's order, "Needs you" first
 * (or right under Today when the business leads), and Elsewhere at the end
 * for the areas left out.
 */
export function overviewBlocks(focus: readonly Focus[]): OverviewBlock[] {
  if (focus.length === 0) return [...DEFAULT_OVERVIEW];
  const blocks = focus.flatMap((f) => AREA_BLOCKS[f]);
  const at = blocks[0] === "today" ? 1 : 0;
  blocks.splice(at, 0, "needs");
  if (FOCUS_IDS.some((a) => !focus.includes(a))) blocks.push("elsewhere");
  return blocks;
}
