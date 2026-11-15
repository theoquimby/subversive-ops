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
