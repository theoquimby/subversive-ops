/**
 * Release notes: every deploy that changes something people use gets a version
 * here, newest first. The What's new sheet groups its cards by release and pops
 * up once per person when a release has cards they haven't seen; the Release
 * notes page (/help/releases) lists every version in full.
 *
 * When shipping: add a release at the TOP with the next version, today's date,
 * a short title, one-sentence summary, the ids of its What's new cards
 * (./whatsNew.ts — every release needs at least one card so it pops up), and
 * plain-English "fixed" lines for smaller changes.
 */

export interface Release {
  version: string;
  /** YYYY-MM-DD it went live. */
  date: string;
  title: string;
  summary: string;
  /** What's new card ids in this release. */
  entries: string[];
  /** Smaller improvements and fixes, one short line each. */
  fixed?: string[];
}

export const RELEASES: Release[] = [
  {
    version: "1.7",
    date: "2026-11-16",
    title: "Link your sales",
    summary: "A step-by-step way to give every Square item a cost, biggest sellers first, with each link's effect shown before saving and Undo on every change.",
    entries: ["2026-11-16.link-sales"],
    fixed: [
      "Draft beer pours can be costed from the keg right where they're linked, all sizes at once.",
      "Cans, bottles and merch can carry a cost each and count as linked, instead of being left out of sales.",
      "Inside a recipe, the ingredient list marks Ingredient or Prep recipe, shows each one's cost for the line, and offers the prep recipe for house-made things.",
      "Overview and P&L “Link items” go straight to the new page.",
    ],
  },
  {
    version: "1.6",
    date: "2026-11-16",
    title: "Counts anyone can do right",
    summary: "Set up the count once, let staff count with guardrails, approve what they send, and see what the shelves are worth.",
    entries: ["2026-11-16.count-setup", "2026-11-16.count-clearer", "2026-11-16.count-approve", "2026-11-16.count-value", "2026-11-16.order-packs"],
    fixed: [
      "Count units now include every pack an item is bought in (the piece inside a case, other suppliers' packs), plus volume for weighed items once a cup weight is known.",
      "Prep items (sauces, portioned proteins) can be counted in pans and containers; an approved count updates the prep list.",
      "Slow movers can be counted monthly or only when they change; their last count carries into the value.",
      "Count things where you find them: items can live in more than one area, anything can be added to an area for one count, and the total adds up across places.",
      "An ingredient can have several packs: add one from its page with “Also bought as”.",
    ],
  },
  {
    version: "1.5",
    date: "2026-11-16",
    title: "Honest numbers and safer saving",
    summary: "The Overview tells you when a figure is missing data, older sales get food costs, and waste and counts never claim to save when they didn't.",
    entries: ["2026-11-16.honest-numbers"],
    fixed: [
      "Waste and counts: a page left open from before an update now says to reload instead of “saved on this phone”. Reload once and anything waiting sends.",
      "Days before your first prices are costed at the earliest prices on file (marked as an estimate) instead of $0.",
      "Help mode: moving the mouse onto a tip no longer jumps to the section underneath.",
      "Prep list says “1 batch”, not “1 batches”.",
    ],
  },
  {
    version: "1.4",
    date: "2026-11-15",
    title: "Month-end for your accountant",
    summary: "A closing checklist, sales tax and inventory value for the month, and one-click files for your accountant.",
    entries: ["2026-11-15.accounting"],
  },
  {
    version: "1.3",
    date: "2026-11-15",
    title: "Staff Today, faster pages and your website",
    summary: "A home screen for staff, pages that load quicker, the website run from here with its own analytics, and this release-notes panel.",
    entries: ["2026-11-15.release-notes", "2026-11-15.quick-start", "2026-11-15.setup-checklist", "2026-11-15.staff-today", "2026-11-15.my-today", "2026-11-15.website", "2026-11-15.website-analytics"],
    fixed: [
      "Overview, P&L, Sales and the brief load with far fewer database trips.",
      "Counts and waste keep working with no signal and send when it's back.",
      "Prep amounts include confirmed private events.",
      "Grey text is a little darker so it's easier to read.",
    ],
  },
  {
    version: "1.2",
    date: "2026-11-15",
    title: "Morning brief, prep list, tap list and parties",
    summary: "A daily brief on your phone, shift notes, the kitchen's prep list, a tap list for the TV and website, card fees and comps in the P&L, and private events.",
    entries: ["2026-11-15.morning-brief", "2026-11-15.shift-notes", "2026-11-15.prep", "2026-11-15.taps", "2026-11-15.pnl-fees", "2026-11-15.private-events"],
    fixed: ["The Overview's week profit now takes off card fees, matching the P&L."],
  },
  {
    version: "1.1",
    date: "2026-11-14",
    title: "Ordering, Overview and Insights redesigned",
    summary: "Ordering became one power table with a Today strip, the Overview and P&L tell the story, and Insights got a graphic for every finding.",
    entries: ["2026-11-14.ordering", "2026-11-14.overview", "2026-11-14.insights"],
    fixed: ["Changing a login to Manager no longer hangs on “Saving…”."],
  },
  {
    version: "1.0",
    date: "2026-11-13",
    title: "Kegs, power tables and smarter invoices",
    summary: "Keg tracking with phone scanning, tables with search and bulk actions everywhere, invoices read from photos, recipe drafts, tips from Square and settings that learn.",
    entries: ["2026-11-13.invoices", "2026-11-13.recipe-drafts", "2026-11-13.deadlines", "2026-11-13.kegs", "2026-11-13.kegs-scan", "2026-11-13.tips", "2026-11-13.settings-learn", "2026-11-13.count", "2026-11-13.storage-areas", "2026-11-13.tables", "2026-11-13.settings", "2026-11-13.quickbooks"],
  },
];

export const CURRENT_VERSION = RELEASES[0].version;

/** The release a card belongs to (or null for a card not yet in one). */
export function releaseOf(entryId: string): Release | null {
  return RELEASES.find((r) => r.entries.includes(entryId)) ?? null;
}

/**
 * Group visible cards by release, newest first. Cards not in any release
 * (shouldn't happen — a test checks) fall into a dated group at the end.
 */
export function groupByRelease<T extends { id: string; date: string }>(entries: T[]): { release: Release | null; date: string; items: T[] }[] {
  const out: { release: Release | null; date: string; items: T[] }[] = [];
  for (const r of RELEASES) {
    const items = entries.filter((e) => r.entries.includes(e.id));
    if (items.length) out.push({ release: r, date: r.date, items });
  }
  const loose = entries.filter((e) => !releaseOf(e.id));
  if (loose.length) out.push({ release: null, date: loose[0].date, items: loose });
  return out;
}
