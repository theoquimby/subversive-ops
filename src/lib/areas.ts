/**
 * Areas of the app — one per nav group — and the nav pages in each.
 *
 * The single source for the nav (sidebar, tab bar, More sheet), the page-header
 * icon chip, the command bar's row icons and the `--area` hue a page inherits.
 * Colors live in globals.css as `--area-<key>`; they tint icons, chips and
 * indicators only (never body text, never status meaning).
 */

import {
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Carrot,
  ChartLine,
  CircleHelp,
  ClipboardList,
  Clock,
  FileCheck,
  FileUp,
  FolderOpen, GraduationCap,
  HandCoins,
  LayoutGrid,
  MessageSquareText,
  Receipt,
  Scale,
  Settings,
  ShoppingCart,
  Sparkles,
  Sunrise,
  Target,
  Trash2,
  TrendingUp,
  Users,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

export type Area = "today" | "food" | "people" | "numbers" | "floor" | "setup" | "assist";

export type NavItem = { href: string; label: string; icon: LucideIcon; area: Area };
export type NavGroup = { title?: string; area: Area; items: NavItem[] };

const item = (area: Area, href: string, label: string, icon: LucideIcon): NavItem => ({ href, label, icon, area });

// Grouped so ~20 pages stay scannable. Order = how often Max uses them.
export const MANAGER_NAV: NavGroup[] = [
  { area: "today", items: [
    item("today", "/", "Overview", LayoutGrid),
    item("today", "/brief", "Weekly brief", Sunrise),
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
    item("people", "/tips", "Tips", HandCoins),
    item("people", "/my", "My shifts", CalendarCheck),
  ] },
  { title: "Numbers", area: "numbers", items: [
    item("numbers", "/pnl", "P&L", TrendingUp),
    item("numbers", "/sales", "Sales & forecast", ChartLine),
    item("numbers", "/events", "Events", CalendarDays),
    item("numbers", "/budgets", "Budgets", Target),
    item("numbers", "/reviews", "Reviews", MessageSquareText),
  ] },
  { title: "Floor", area: "floor", items: [
    item("floor", "/count", "Counts", ClipboardList),
    item("floor", "/waste", "Waste", Trash2),
  ] },
  { title: "Setup", area: "setup", items: [
    item("setup", "/import", "Import sheets", FileUp),
    item("setup", "/settings", "Settings", Settings),
  ] },
];

export const STAFF_NAV: NavGroup[] = [
  { area: "people", items: [
    item("people", "/my", "My shifts", CalendarCheck),
    item("floor", "/count", "Count", ClipboardList),
    item("floor", "/waste", "Waste", Trash2),
  ] },
];

const HELP_ITEM = item("assist", "/help", "Help", CircleHelp);
const WELCOME_ITEM = item("today", "/welcome", "Setup", Sparkles);
const ALL_ITEMS = [...MANAGER_NAV.flatMap((g) => g.items), HELP_ITEM, WELCOME_ITEM];

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
