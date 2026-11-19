/**
 * Areas of the app — one per nav group — and the nav pages in each.
 *
 * The single source for the nav (sidebar, tab bar, More sheet), the page-header
 * icon chip, the command bar's row icons and the `--area` hue a page inherits.
 * Colors live in globals.css as `--area-<key>`; they tint icons, chips and
 * indicators only (never body text, never status meaning).
 */

import {
  ChartColumn,
  FileText,
  Inbox,
  ScanLine,
  Settings2,
  Store,
  UtensilsCrossed,
  Warehouse,
  Banknote,
  Beer,
  BookOpen,
  Boxes,
  Calculator,
  CalendarCheck,
  CalendarDays,
  CalendarClock,
  CalendarRange,
  Cylinder,
  Factory,
  Flame,
  FlaskConical,
  Layers,
  Camera,
  Carrot,
  ChefHat,
  CircleUserRound,
  ChartLine,
  UsersRound,
  CircleHelp,
  ClipboardList,
  Clock,
  Compass,
  FileCheck,
  FileUp,
  FolderOpen, GraduationCap,
  Globe,
  Landmark,
  ListChecks,
  HandCoins,
  LayoutGrid,
  Lightbulb,
  MapPin,
  MessageSquareText,
  NotebookPen,
  Receipt,
  Scale,
  Settings,
  ShoppingCart,
  Sparkles,
  Sun,
  Sunrise,
  Target,
  ThumbsUp,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  Wheat,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

export type Area = "today" | "food" | "people" | "numbers" | "online" | "floor" | "setup" | "assist";

/**
 * A section inside a nav item's area, listed under it when the item is popped
 * open. A section with several pages lists them as `tabs` (shown as a tab strip
 * on those pages); `also` names other paths that belong to it.
 */
export type SubItem = { href: string; label: string; icon: LucideIcon; tabs?: { href: string; label: string }[]; also?: string[] };
/** `heading`: the name to show where the group title isn't on screen (the phone top bar), for a label like "Overview" that needs its group to make sense. */
export type NavItem = { href: string; label: string; icon: LucideIcon; area: Area; children?: SubItem[]; heading?: string };
export type NavGroup = { title?: string; area: Area; items: NavItem[] };

const item = (area: Area, href: string, label: string, icon: LucideIcon, children?: SubItem[]): NavItem => ({ href, label, icon, area, ...(children ? { children } : {}) });

// Areas big enough to be an app of their own list their sections under the nav item.
// Kegs: three places staff work (taps, scanner, walk-in), then three manager sections,
// each with its pages as tabs, so the menu stays short however much the area grows.
export const KEG_SECTIONS: SubItem[] = [
  { href: "/kegs", label: "Taps", icon: Beer },
  { href: "/kegs/scan", label: "Scan", icon: ScanLine, also: ["/kegs/k"] },
  { href: "/kegs/cooler", label: "Walk-in", icon: Warehouse },
  { href: "/kegs/fleet", label: "Analytics", icon: TrendingUp, tabs: [
    { href: "/kegs/fleet", label: "Fleet & trends" },
    { href: "/kegs/demand", label: "Demand" },
    { href: "/kegs/reports", label: "Reports" },
  ] },
  { href: "/kegs/orders", label: "Wholesale", icon: Store, tabs: [
    { href: "/kegs/orders", label: "Orders" },
    { href: "/kegs/accounts", label: "Accounts" },
  ] },
  { href: "/kegs/all", label: "Manage", icon: Settings2, tabs: [
    { href: "/kegs/all", label: "All kegs & labels" },
    { href: "/kegs/beers", label: "Beers" },
    { href: "/kegs/taps", label: "Tap list & TV" },
    { href: "/kegs/history", label: "History" },
    { href: "/kegs/setup", label: "Setup" },
    { href: "/kegs/import", label: "Import" },
  ] },
];
const STAFF_KEG_SECTIONS: SubItem[] = KEG_SECTIONS.slice(0, 3);
// Brewery: what's in each tank now, the tank schedule, recipes with live costs, every brew, brewing stock with what to order when and costs, and setup.
export const BREWERY_SECTIONS: SubItem[] = [
  { href: "/brewery", label: "Tanks", icon: Cylinder },
  { href: "/brewery/brew", label: "Brew day", icon: Flame },
  { href: "/brewery/schedule", label: "Schedule", icon: CalendarClock },
  { href: "/brewery/recipes", label: "Recipes", icon: FlaskConical },
  { href: "/brewery/batches", label: "Brews", icon: Layers },
  { href: "/brewery/stock", label: "Stock & orders", icon: Boxes, tabs: [
    { href: "/brewery/stock", label: "Stock" },
    { href: "/brewery/ordering", label: "Ordering" },
    { href: "/brewery/costs", label: "Costs" },
  ] },
  { href: "/brewery/setup", label: "Setup", icon: Settings2, tabs: [
    { href: "/brewery/setup", label: "Tanks & defaults" },
    { href: "/brewery/import", label: "Import" },
  ] },
];
const WEBSITE_PAGES: SubItem[] = [
  { href: "/website", label: "Overview", icon: LayoutGrid },
  { href: "/website/hours", label: "Hours & notice", icon: Clock },
  { href: "/website/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/website/events", label: "Events", icon: CalendarDays },
  { href: "/website/inquiries", label: "Inquiries", icon: Inbox },
  { href: "/website/content", label: "Site content", icon: FileText },
  { href: "/website/analytics", label: "Analytics", icon: ChartColumn },
];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The section a path is in: the longest match across each section's own page, its tabs and its `also` paths. */
export function activeChild(pathname: string, children: SubItem[]): string | null {
  let best: { href: string; len: number } | null = null;
  for (const c of children) {
    for (const h of [c.href, ...(c.tabs?.map((t) => t.href) ?? []), ...(c.also ?? [])]) {
      if (under(pathname, h) && (!best || h.length > best.len)) best = { href: c.href, len: h.length };
    }
  }
  return best?.href ?? null;
}

/** The tab a path is on within a section's tabs (longest match), or null. */
export function activeTab(pathname: string, tabs: { href: string }[]): string | null {
  let best: string | null = null;
  for (const t of tabs) if (under(pathname, t.href) && (!best || t.href.length > best.length)) best = t.href;
  return best;
}

// Grouped so ~20 pages stay scannable. Order = how often Max uses them.
export const MANAGER_NAV: NavGroup[] = [
  { area: "today", items: [
    item("today", "/", "Overview", LayoutGrid),
    item("today", "/brief", "Brief", Sunrise),
    item("today", "/notes", "Shift notes", NotebookPen),
    item("assist", "/ask", "Ask", Sparkles),
  ] },
  { title: "Food", area: "food", items: [
    item("food", "/menu", "Menu costs", BookOpen),
    item("food", "/variance", "Margin gap", Scale),
    item("food", "/ingredients", "Ingredients", Carrot),
    item("food", "/prices", "Prices", Receipt),
    item("food", "/ordering", "Ordering", ShoppingCart),
    item("food", "/invoices", "Invoices", FileCheck),
    item("food", "/menu/allergens", "Allergen chart", Wheat),
  ] },
  { title: "People", area: "people", items: [
    item("people", "/schedule", "Schedule", CalendarRange),
    item("people", "/team", "Team", Users),
    item("people", "/team/documents", "Documents", FolderOpen),
    item("people", "/team/training", "Training", GraduationCap),
    item("people", "/labor", "Timecards & payroll", Clock),
    item("people", "/labor/handoff", "Payroll hand-off", Banknote),
    item("people", "/team/onboarding", "Onboarding", UserPlus),
    item("people", "/tips", "Tips", HandCoins),
    item("people", "/my/shifts", "My shifts", CalendarCheck),
  ] },
  { title: "Numbers", area: "numbers", items: [
    item("numbers", "/insights", "Insights", Lightbulb),
    item("numbers", "/pnl", "P&L", TrendingUp),
    item("numbers", "/accounting", "Month-end", Calculator),
    item("numbers", "/sales", "Sales & forecast", ChartLine),
    item("numbers", "/sales/customers", "Customers", UsersRound),
    item("numbers", "/events", "Events", CalendarDays),
    item("numbers", "/budgets", "Budgets", Target),
    item("numbers", "/beer-tax", "Beer tax", Landmark),
  ] },
  // Where guests find the business: its website, its Google listing, Instagram, its Facebook Page, and the reviews they leave.
  // lucide has no brand marks, so Instagram is a camera and Facebook a thumbs-up: neutral icons that read right.
  { title: "Online", area: "online", items: [
    { ...item("online", "/online", "Overview", Compass), heading: "Online" },
    item("online", "/website", "Website", Globe, WEBSITE_PAGES),
    item("online", "/online/google", "Google listing", MapPin),
    item("online", "/online/instagram", "Instagram", Camera),
    item("online", "/online/facebook", "Facebook", ThumbsUp),
    item("online", "/reviews", "Reviews", MessageSquareText),
  ] },
  { title: "Floor", area: "floor", items: [
    item("floor", "/count", "Counts", ClipboardList),
    item("floor", "/waste", "Waste", Trash2),
    item("floor", "/kegs", "Kegs", Beer, KEG_SECTIONS),
    item("floor", "/brewery", "Brewery", Factory, BREWERY_SECTIONS),
    item("floor", "/prep", "Prep list", ChefHat),
    item("floor", "/checklists", "Checklists", ListChecks),
    item("floor", "/upkeep", "Upkeep", Wrench),
  ] },
  { title: "Setup", area: "setup", items: [
    item("setup", "/import", "Import sheets", FileUp),
    item("setup", "/settings", "Settings", Settings),
  ] },
];

// Staff: their day first, then the floor tools. The tab bar shows Today, Shifts,
// Scan and Prep; everything here also appears in the More sheet.
export const STAFF_NAV: NavGroup[] = [
  { area: "people", items: [
    item("people", "/my", "Today", Sun),
    item("people", "/my/shifts", "My shifts", CalendarCheck),
    item("people", "/my/me", "Me", CircleUserRound),
  ] },
  { title: "Floor", area: "floor", items: [
    item("floor", "/prep", "Prep list", ChefHat),
    item("floor", "/checklists", "Checklists", ListChecks),
    item("floor", "/kegs", "Kegs & taps", Beer, STAFF_KEG_SECTIONS),
    item("floor", "/count", "Count", ClipboardList),
    item("floor", "/waste", "Waste", Trash2),
    item("floor", "/notes", "Shift notes", NotebookPen),
  ] },
];

const HELP_ITEM = item("assist", "/help", "Help", CircleHelp);
const WELCOME_ITEM = item("today", "/welcome", "Setup", Sparkles);
// Manager items win ties (same href), so staff-only pages like /my/me still get their own label and hue.
const ALL_ITEMS = [...MANAGER_NAV.flatMap((g) => g.items), ...STAFF_NAV.flatMap((g) => g.items), HELP_ITEM, WELCOME_ITEM];

const matches = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`));
const ALL_HREFS = [...MANAGER_NAV, ...STAFF_NAV].flatMap((g) => g.items.map((i) => i.href));

/** Active = the most specific nav item matching the path (so /menu/allergens lights "Allergen chart", not "Menu costs"). */
export const isActive = (pathname: string, href: string) => matches(pathname, href) && !ALL_HREFS.some((h) => h.length > href.length && h.startsWith(href) && matches(pathname, h));

/** The nav page a path belongs to (most specific match), e.g. /menu/abc → Menu costs. */
export function navItemFor(path: string): NavItem | null {
  const pathname = path.split("?")[0] || "/";
  let best: NavItem | null = null;
  for (const i of ALL_ITEMS) if (matches(pathname, i.href) && (!best || i.href.length > best.href.length)) best = i;
  return best;
}

export const areaFor = (path: string): Area => navItemFor(path)?.area ?? "today";

/** Inline style that points `--area` (and so `text-area`, `bg-area/10`…) at an area's hue. */
export const areaStyle = (area: Area) => ({ "--area": `var(--area-${area})` }) as CSSProperties;
