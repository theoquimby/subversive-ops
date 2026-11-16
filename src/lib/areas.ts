/**
 * Areas of the app — one per nav group — and the nav pages in each.
 *
 * The single source for the nav (sidebar, tab bar, More sheet), the page-header
 * icon chip, the command bar's row icons and the `--area` hue a page inherits.
 * Colors live in globals.css as `--area-<key>`; they tint icons, chips and
 * indicators only (never body text, never status meaning).
 */

import {
  Banknote,
  Beer,
  BookOpen,
  Calculator,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Carrot,
  ChefHat,
  CircleUserRound,
  ChartLine,
  CircleHelp,
  ClipboardList,
  Clock,
  FileCheck,
  FileUp,
  FolderOpen, GraduationCap,
  Globe,
  Landmark,
  ListChecks,
  HandCoins,
  LayoutGrid,
  Lightbulb,
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
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  Wheat,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

export type Area = "today" | "food" | "people" | "numbers" | "floor" | "setup" | "assist";

/** A page inside a nav item's area, listed under it when the item is popped open. */
export type SubItem = { href: string; label: string };
export type NavItem = { href: string; label: string; icon: LucideIcon; area: Area; children?: SubItem[] };
export type NavGroup = { title?: string; area: Area; items: NavItem[] };

const item = (area: Area, href: string, label: string, icon: LucideIcon, children?: SubItem[]): NavItem => ({ href, label, icon, area, ...(children ? { children } : {}) });

// Areas big enough to be an app of their own list their pages under the nav item.
const KEG_PAGES: SubItem[] = [
  { href: "/kegs", label: "On tap" },
  { href: "/kegs/scan", label: "Scan" },
  { href: "/kegs/cooler", label: "Walk-in" },
  { href: "/kegs/fleet", label: "Fleet & trends" },
  { href: "/kegs/demand", label: "Demand per beer" },
  { href: "/kegs/taps", label: "Tap list & TV" },
  { href: "/kegs/beers", label: "Beers" },
  { href: "/kegs/all", label: "All kegs & labels" },
  { href: "/kegs/history", label: "History" },
  { href: "/kegs/setup", label: "Setup" },
  { href: "/kegs/import", label: "Import" },
];
const STAFF_KEG_PAGES: SubItem[] = [
  { href: "/kegs", label: "On tap" },
  { href: "/kegs/scan", label: "Scan" },
  { href: "/kegs/cooler", label: "Walk-in" },
];
const WEBSITE_PAGES: SubItem[] = [
  { href: "/website", label: "Overview" },
  { href: "/website/hours", label: "Hours & notice" },
  { href: "/website/menu", label: "Menu" },
  { href: "/website/events", label: "Events" },
  { href: "/website/inquiries", label: "Inquiries" },
  { href: "/website/content", label: "Site content" },
  { href: "/website/analytics", label: "Analytics" },
];

/** The sub-page a path is on: the longest match, so /kegs/fleet lights "Fleet & trends" and /kegs/k/… falls back to the first. */
export function activeChild(pathname: string, children: SubItem[]): string | null {
  let best: string | null = null;
  for (const c of children) if ((pathname === c.href || pathname.startsWith(`${c.href}/`)) && (!best || c.href.length > best.length)) best = c.href;
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
    item("numbers", "/events", "Events", CalendarDays),
    item("numbers", "/budgets", "Budgets", Target),
    item("numbers", "/beer-tax", "Beer tax", Landmark),
    item("numbers", "/reviews", "Reviews", MessageSquareText),
    item("numbers", "/website", "Website", Globe, WEBSITE_PAGES),
  ] },
  { title: "Floor", area: "floor", items: [
    item("floor", "/count", "Counts", ClipboardList),
    item("floor", "/waste", "Waste", Trash2),
    item("floor", "/kegs", "Kegs", Beer, KEG_PAGES),
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
    item("floor", "/kegs", "Kegs & taps", Beer, STAFF_KEG_PAGES),
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
