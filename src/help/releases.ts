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
    version: "1.16",
    date: "2026-11-16",
    title: "Online: how guests find you",
    summary: "A new Online section in the menu puts Google Search, the Google listing, the website and reviews side by side, with a page of its own for the listing.",
    entries: ["2026-11-16.online", "2026-11-16.google-listing"],
    fixed: [
      "The menu has a new Online group: Overview, Website, Google listing and Reviews. Website and Reviews moved there from Numbers; every link still works.",
      "Online → Overview: how often you showed up in Google Search and on the Google listing, and how many visited the website, then what people did next on the listing and on the website, side by side.",
      "Online → Google listing: times shown on Maps and in Search, on phones and computers; calls, direction requests, website clicks and menu views over time; and what people searched for. It says Waiting on Google's approval until Google grants access.",
      "Worth a look: a short list for a count that dropped sharply, a source not set up yet, or reviews waiting for a reply.",
      "Periods on the Online pages are whole weeks ending yesterday, and Google's rows end on the last day Google has reported, so late numbers never read as a drop.",
      "Website → Analytics no longer repeats Google's numbers; it links to their new home.",
    ],
  },
  {
    version: "1.15",
    date: "2026-11-16",
    title: "Wholesale keg orders",
    summary: "Take an order from an account, see how many full kegs are free to promise, and fill it by scanning each keg as it leaves.",
    entries: ["2026-11-16.keg-orders", "2026-11-16.keg-order-scan"],
    fixed: [
      "The Kegs home now leads with the fleet: one bar showing where every keg is, the last 12 weeks beside it, and a single Needs you list (taps about to run dry, what to fill, kegs out too long, kegs gone quiet).",
      "Orders is in the Kegs menu and on the Kegs page. Open orders also show on the Kegs page, for whoever is loading them.",
      "Each account's page lists its orders, with a New order button.",
      "Overview: keg orders due today or overdue show under Needs you.",
      "Undoing a keg's last scan from its card also takes it off the open order it was scanned for.",
    ],
  },
  {
    version: "1.14",
    date: "2026-11-16",
    title: "Kegs everywhere you look",
    summary: "What the keg history knows now reaches the Overview, the morning and weekly briefs and Insights, not just the keg pages.",
    entries: ["2026-11-16.keg-signals"],
    fixed: [
      "Overview: kegs out at accounts too long and kegs not scanned in a long time sit at the bottom of Needs you.",
      "Morning brief: those two show on Mondays, or on the day another keg crosses the line, so they don't nag daily.",
      "Weekly brief: a Kegs section with fills, taps, kegs sent out and how many came back with no scan.",
      "Insights: the keg tile shows turns, days per cycle and the scan gap, and the feed can raise the scan gap or a fleet with kegs to spare.",
      "Insights no longer prints $0 a month on a finding that has no dollar figure.",
      "The Kegs menu is six sections with icons (Taps, Scan, Walk-in, Analytics, Wholesale, Manage); the pages inside a section are tabs at the top of the page.",
    ],
  },
  {
    version: "1.13",
    date: "2026-11-16",
    title: "Keg accounts and reports",
    summary: "A page for every account you send kegs to, and two reports you can export: volume for any period, and kegs sitting at accounts.",
    entries: ["2026-11-16.keg-accounts", "2026-11-16.keg-reports"],
    fixed: [
      "Accounts and Reports are in the Kegs menu and on the Kegs page.",
      "On Keg setup, each account's name links to its page.",
    ],
  },
  {
    version: "1.12",
    date: "2026-11-16",
    title: "Scan many kegs, keep your stickers",
    summary: "Scan a whole stack of kegs in one go, keep using the stickers already on your kegs, and find every keg page from the menu.",
    entries: ["2026-11-16.scan-many", "2026-11-16.old-stickers", "2026-11-16.nav-sublists"],
    fixed: [
      "Scanning a sticker from Distribrewtion now finds its keg. Before, only typing the long code from the sticker worked.",
      "A keg's card shows how many times it has been filled.",
      "Fleet & trends has a button at the top of the Kegs page.",
    ],
  },
  {
    version: "1.11",
    date: "2026-11-16",
    title: "Keg fleet and trends",
    summary: "Graphs of how the keg fleet is used, worked out from every scan, and two lists of kegs that need a look: out at an account too long, and not scanned in a long time.",
    entries: ["2026-11-16.keg-fleet"],
    fixed: [
      "Kegs brought in from your old keg app show how long they've really been in their state, not the day they were imported. Press Fix dates on the keg import page once for kegs already brought in.",
      "Keg setup has two new numbers: how many days out at an account is too long, and how many days without a scan is too quiet.",
    ],
  },
  {
    version: "1.10",
    date: "2026-11-16",
    title: "Your team, end to end",
    summary: "Shift swaps and pickups that check the rules for you, new-hire checklists, shout-outs, a payroll hand-off for Square Payroll or Gusto, covers next to sales, and a fuller staff home.",
    entries: ["2026-11-16.swap-board", "2026-11-16.my-everything", "2026-11-16.swap-rules", "2026-11-16.onboarding", "2026-11-16.shoutouts", "2026-11-16.payroll-handoff", "2026-11-16.covers"],
    fixed: [
      "A swap request no longer counts as waiting on a manager until someone says they'll take the shift.",
      "Withdrawn swaps are kept in the history instead of disappearing.",
      "Staff can see their own clock-ins for the pay period and flag a mistake before it's approved.",
    ],
  },
  {
    version: "1.9",
    date: "2026-11-16",
    title: "Running the floor and the brewery",
    summary: "Opening and closing checklists anyone can tick on a phone, upkeep for the draft lines and everything else, and the beer tax worked out from your kegs.",
    entries: ["2026-11-16.checklists", "2026-11-16.upkeep", "2026-11-16.beer-tax"],
    fixed: [
      "The Overview and the morning brief now flag a closing list left unfinished, an overdue upkeep job, equipment down for repair and a beer tax return coming due.",
      "Jobs staff can do, like cleaning the draft lines, show on Checklists when they're due and are logged with their name.",
    ],
  },
  {
    version: "1.8",
    date: "2026-11-16",
    title: "Getting your data in",
    summary: "Everything Square sends in one list, price sheets from paper, products and count frequencies worked out for you, and a setup checklist in the order things build on each other.",
    entries: ["2026-11-16.datain-square-all", "2026-11-16.datain-paper-prices", "2026-11-16.datain-link-products", "2026-11-16.datain-count-every", "2026-11-16.datain-checklist", "2026-11-16.plate-cost-breakdown", "2026-11-16.numbers-explain", "2026-11-16.live-roles"],
    fixed: [
      "Switching a login off, or from manager to staff, now takes away access straight away instead of when their sign-in ran out.",
      "Insights says in plain English when an update didn't run, with the technical details tucked away for whoever looks after the app.",
      "Insights' “How it all connects” counts sales with no recipe at a typical 30% (like the Overview and P&L) and shows rent in the sum, so profit isn't overstated.",
      "An Insights card about undoing a price change says what you'd get back, never a negative “gain”.",
      "Ordering says when no supplier has delivery days yet, instead of “no deadlines”.",
      "The inventory value on Counts says how many items it's based on.",
      "“What staff can open” lists everything staff really see: prep, kegs, shift notes and checklists too.",
      "Help popovers no longer flash in the corner before they settle into place.",
      "Pages with tables no longer report a hydration error while charts are still loading.",
      "New positions that come in from Square jobs take Square's tip-eligible setting, and kitchen jobs land in Back of house.",
      "A store added from a receipt (Price Chopper and the like) starts as a Local supplier, and each supplier shows Local or Distributor on phones.",
      "Invoice and product matching no longer mistakes a short word for a longer one (\"Pork Butt\" isn't Buttermilk, \"Cont\" isn't Cornstarch).",
      "Suppliers works out delivery days and deadlines from your invoices the first time you open it, instead of waiting for the night.",
      "QuickBooks lists exactly what goes over (bills and vendors) and what doesn't, before you connect.",
      "Keg import says it takes Distribrewtion's exports.",
    ],
  },
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
