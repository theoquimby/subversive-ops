/**
 * Help content types. Content is plain data so it can be searched, shown in
 * popovers (<HelpTip id>), listed in the help center (/help) and linked from
 * guided tours. Ids are stable: never rename one that's in use — add a new one.
 */

export type HelpAreaId =
  | "basics"
  | "overview"
  | "menu"
  | "ingredients"
  | "prices"
  | "ordering"
  | "counts"
  | "waste"
  | "variance"
  | "sales"
  | "import"
  | "settings"
  | "team"
  | "labor"
  | "schedule"
  | "my"
  | "tips"
  | "pnl"
  | "events"
  | "invoices"
  | "reviews"
  | "budgets"
  | "brief";

export type Audience = "manager" | "staff" | "all";

export interface HelpEntry {
  /** Stable id, `area.section.control`, e.g. "ordering.builder.onHand". */
  id: string;
  area: HelpAreaId;
  title: string;
  /** 1–3 short sentences. Shown in the popover. Plain text. */
  body: string;
  /**
   * Optional longer article for /help/[id]. Markdown-ish: blank-line
   * paragraphs, "- " bullets, "1. " steps, "### " headings, **bold**,
   * `code`, [links](/route).
   */
  article?: string;
  related?: string[];
  /** The page this lives on, for "Open this page". */
  route?: string;
  /** A tour id from src/help/tours.ts that shows this in the app. */
  tour?: string;
  /** Who it's for. Defaults to "manager". Staff only see "staff" and "all". */
  audience?: Audience;
  /** Extra words people might search for. */
  keywords?: string[];
  /** Written ahead of the feature shipping — refine once the page exists. */
  draft?: boolean;
}

export interface HelpArea {
  id: HelpAreaId;
  title: string;
  description: string;
  /** Upcoming features are grouped separately in the help center. */
  upcoming?: boolean;
}
