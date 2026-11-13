"use client";

/**
 * DataTable — the one table for long lists (prices, ingredients, menu, Square items…).
 *
 *  - Toolbar: instant search (every word must match, abbreviations ok), facet and
 *    toggle filters with live counts, group by, columns, density, CSV export.
 *  - Headers sort (shift-click adds a second key), resize (drag the edge), stick
 *    to the top; the first column sticks to the left when scrolling sideways.
 *  - Views (search, filters, sort, group, columns, density, widths) are remembered
 *    per table in this browser; filters with a `param` also live in the URL.
 *  - Rows render in chunks as you scroll, so 1,000+ rows stay smooth.
 *  - Checkbox selection (shift-click for a range, header box = everything filtered)
 *    with a floating bulk-action bar.
 *  - Keys: / search · j/k or ↑/↓ move · Enter open · x select · Esc back out.
 *  - A row opens a side panel (`drawer`) or its page (`rowHref`).
 *  - Phones get compact cards and a Filters sheet; no sideways page scroll.
 *
 * Pure logic lives in @/domain/dataTable (tested). Cells may hold GridCell /
 * GridSelect: clicks on inputs, buttons and links never open the row.
 */

import { autoUpdate, flip, offset, shift, size, useDismiss, useFloating, useInteractions, useClick, useRole, FloatingPortal, useTransitionStyles } from "@floating-ui/react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Columns3, Download, ExternalLink, Layers, ListFilter, Minus, RotateCcw, Rows2, Rows3, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import {
  activeFilterCount,
  emptyView,
  facetCounts,
  filterRows,
  groupRows,
  normalize,
  paramsToView,
  parseView,
  selectRange,
  serializeView,
  sortRows,
  toCsv,
  toggleFilterValue,
  toggleSort,
  viewToParams,
  type CsvCell,
  type FilterSpec,
  type FilterState,
  type SortDir,
  type SortValue,
  type ViewState,
} from "@/domain/dataTable";
import { cn } from "@/lib/cn";
import { popoverTransition, useReducedMotion, usePresence } from "./motion";
import { Button, Card, EmptyState, type Tone } from "./ui";
import { HelpTip, HelpZone } from "./help";

// ---- Types --------------------------------------------------------------------

export interface Column<T> {
  id: string;
  header: ReactNode;
  /** Plain name for menus and CSV (defaults to `header` when it's a string). */
  label?: string;
  cell: (row: T) => ReactNode;
  /** Makes the column sortable. */
  sort?: (row: T) => SortValue;
  /** First click direction (numbers usually want "desc"). */
  firstDir?: SortDir;
  align?: "left" | "right" | "center";
  /** The cell holds an inline editor (GridCell/GridSelect): tighter padding. */
  edit?: boolean;
  /** Starting min width in px. */
  width?: number;
  /** false: always shown (the first column is never hideable). */
  hideable?: boolean;
  defaultHidden?: boolean;
  /** Value for CSV export (defaults to `sort`). Return undefined to leave the column out. */
  csv?: (row: T) => CsvCell;
  /** Help entry shown as a "?" beside the header. */
  help?: string;
  /** Per-group subtotal shown in group header rows. */
  total?: (rows: T[]) => ReactNode;
  className?: string;
}

export interface FilterOption {
  value: string;
  label: string;
}

export type Filter<T> =
  | { id: string; label: string; kind: "facet"; values: (row: T) => string | string[] | null | undefined; options?: FilterOption[]; single?: boolean; param?: string; display?: "menu" | "segmented"; allLabel?: string }
  | { id: string; label: string; kind: "toggle"; test: (row: T) => boolean; param?: string; tone?: Tone };

export interface GroupBy<T> {
  id: string;
  label: string;
  key: (row: T) => string | null | undefined;
  /** Shown in the group header (defaults to the key, "None" when blank). */
  title?: (key: string) => ReactNode;
  order?: (a: string, b: string) => number;
}

export interface SummaryItem {
  label: ReactNode;
  value?: ReactNode;
  tone?: Tone;
  /** Clicking toggles this filter value. */
  filter?: { id: string; value?: string };
}

export interface BulkApi<T> {
  rows: T[];
  keys: string[];
  /** Run a server action; shows its { error } / { message } and clears the selection on success. */
  run: (fn: () => Promise<{ error?: string; message?: string } | void | undefined>) => void;
  pending: boolean;
  clear: () => void;
}

export interface CardView {
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  sub?: ReactNode;
}

export interface DataTableProps<T> {
  /** Storage key for the remembered view, e.g. "prices". */
  id: string;
  rows: T[];
  rowKey: (row: T) => string;
  columns: Column<T>[];
  /** Text searched for each row (name, SKU, supplier…). */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  filters?: Filter<T>[];
  groups?: GroupBy<T>[];
  defaultView?: Partial<ViewState>;
  noun?: [string, string];
  summary?: (visible: T[], all: T[]) => SummaryItem[];
  bulkActions?: (api: BulkApi<T>) => ReactNode;
  drawer?: (row: T, close: () => void) => ReactNode;
  drawerTitle?: (row: T) => ReactNode;
  rowHref?: (row: T) => string | null;
  card: (row: T) => CardView;
  empty?: ReactNode;
  toolbar?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  csvName?: string;
  help?: string;
  /** Tour targets: the whole table, the toolbar, the search box. */
  tours?: { root?: string; toolbar?: string; search?: string };
  /** Mirror the search in the URL (`q`). Default true. */
  urlSearch?: boolean;
  /** Max height of the scrolling table on tablets/desktops. */
  maxHeight?: string;
  /** Optional row under the table (e.g. an add row). */
  footer?: ReactNode;
}

// ---- Small parts --------------------------------------------------------------

/** App-styled checkbox with a 40px touch target. */
export function Checkbox({ checked, mixed, onChange, label, className }: { checked: boolean; mixed?: boolean; onChange: (e: React.MouseEvent) => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onChange(e); }}
      className={cn("relative -m-1 inline-flex size-8 items-center justify-center rounded-md after:absolute after:-inset-1 after:content-[''] focus-visible:outline-2", className)}
    >
      <span className={cn("inline-flex size-[17px] items-center justify-center rounded-[5px] border transition-[background-color,border-color,transform] duration-120 ease-motion", checked || mixed ? "border-ink bg-ink text-surface" : "border-border-strong bg-surface hover:border-ink-2/60")}>
        {mixed ? <Minus className="size-3" strokeWidth={3} /> : checked ? <Check className="size-3 animate-pop" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

function usePopover(placement: "bottom-start" | "bottom-end" = "bottom-start") {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 }), size({ padding: 8, apply({ availableHeight, elements }) { elements.floating.style.maxHeight = `${Math.min(420, availableHeight)}px`; } })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context, { role: "dialog" })]);
  const reduced = useReducedMotion();
  const { isMounted, styles } = useTransitionStyles(context, popoverTransition(reduced));
  return { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps, isMounted, styles };
}

function Popover({ button, children, placement, className, label }: { button: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; placement?: "bottom-start" | "bottom-end"; className?: string; label: string }) {
  const p = usePopover(placement);
  return (
    <>
      <span ref={p.refs.setReference} {...p.getReferenceProps()} className="inline-flex">{button(p.open)}</span>
      {p.isMounted && (
        <FloatingPortal>
          <div ref={p.refs.setFloating} aria-label={label} style={{ ...p.floatingStyles, ...p.styles }} {...p.getFloatingProps()} className={cn("z-[60] flex min-w-56 flex-col overflow-hidden rounded-xl border border-border bg-surface text-sm shadow-xl", className)}>
            {children(() => p.setOpen(false))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

const toolButton = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2.5 text-sm text-ink-2 transition-[color,background-color,border-color] duration-120 ease-motion hover:bg-surface-2 hover:text-ink whitespace-nowrap";
const toolActive = "border-ink/70 bg-surface-2 text-ink";

function OptionRow({ checked, label, count, onClick, radio }: { checked: boolean; label: ReactNode; count?: number; onClick: () => void; radio?: boolean }) {
  return (
    <button type="button" role={radio ? "menuitemradio" : "menuitemcheckbox"} aria-checked={checked} onClick={onClick} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors duration-75 hover:bg-surface-2">
      <span className={cn("inline-flex size-4 shrink-0 items-center justify-center border transition-colors duration-120", radio ? "rounded-full" : "rounded-[4px]", checked ? "border-ink bg-ink text-surface" : "border-border-strong")}>
        {checked && (radio ? <span className="size-1.5 rounded-full bg-surface" /> : <Check className="size-2.5" strokeWidth={3.5} />)}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && <span className={cn("num text-xs", count ? "text-muted" : "text-muted/50")}>{count}</span>}
    </button>
  );
}

/** Tiny line of a value over time (price history). Hand-built SVG, 2px line, last point dotted. */
export function Sparkline({ points, width = 240, height = 48, className }: { points: { date: string; value: number }[]; width?: number; height?: number; className?: string }) {
  if (points.length < 2) return null;
  const xs = points.map((p) => Date.parse(p.date));
  const ys = points.map((p) => p.value);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const pad = 4;
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - pad * 2);
  const sy = (y: number) => height - pad - ((y - y0) / (y1 - y0 || 1)) * (height - pad * 2);
  // Prices are steps: a price holds until the next one.
  let d = `M${sx(xs[0])},${sy(ys[0])}`;
  for (let i = 1; i < xs.length; i++) d += ` H${sx(xs[i])} V${sy(ys[i])}`;
  const up = ys[ys.length - 1] > ys[0];
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-12 w-full overflow-visible" role="img" aria-label={`From ${ys[0].toFixed(2)} to ${ys[ys.length - 1].toFixed(2)}`}>
        <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={`${d} V${height - pad} H${sx(xs[0])} Z`} className={up ? "fill-bad/8" : "fill-good/8"} />
        <path d={d} fill="none" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" className={up ? "stroke-bad" : "stroke-good"} />
      </svg>
      <div className="num mt-1 flex justify-between text-[11px] text-muted">
        <span>{fmt(points[0].date)} · ${ys[0].toFixed(2)}</span>
        <span>low ${y0.toFixed(2)} · high ${y1.toFixed(2)}</span>
        <span>{fmt(points[points.length - 1].date)} · ${ys[ys.length - 1].toFixed(2)}</span>
      </div>
    </div>
  );
}

/** Download text as a file (CSV exports). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const labelOf = <T,>(c: Column<T>) => c.label ?? (typeof c.header === "string" ? c.header : c.id);

function csvColumns<T>(cols: Column<T>[]) {
  return cols.filter((c) => c.csv || c.sort).map((c) => ({ header: labelOf(c), value: (r: T) => (c.csv ? c.csv(r) : (c.sort!(r) as CsvCell)) }));
}

// Phones get cards, wider screens the table; only one is rendered. The server renders the
// table (hidden by CSS on phones), and phones switch to cards once hydrated.
const PHONE_MQ = "(max-width: 639px)";
const subscribePhone = (cb: () => void) => {
  const mq = window.matchMedia(PHONE_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useIsPhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_MQ).matches, () => false);

// Only the most recently mounted table answers keyboard shortcuts.
const keyboardStack: string[] = [];

const CHUNK = 60;
const NONE: never[] = [];
const isTyping = (el: Element | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.getAttribute("role") === "listbox");
const interactive = "input, textarea, button, a, select, label, [role=checkbox], [role=button], [data-no-row-click]";

// ---- DataTable ----------------------------------------------------------------

export function DataTable<T>(props: DataTableProps<T>) {
  const { id, rows, rowKey, columns, filters = NONE as Filter<T>[], groups = NONE as GroupBy<T>[], noun = ["row", "rows"], card, urlSearch } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = useIsPhone();
  const urlParams = useMemo(() => Object.fromEntries(filters.filter((f) => f.param).map((f) => [f.id, f.param!])), [filters]);
  const storageKey = `dt:v1:${id}`;
  const defaults = useMemo(() => emptyView({ hidden: columns.filter((c) => c.defaultHidden).map((c) => c.id), ...props.defaultView }), [columns, props.defaultView]);

  // URL filters are known on the server too, so the first render already matches them.
  const fromUrl = useMemo(() => {
    const v = paramsToView(new URLSearchParams(searchParams.toString()), urlParams);
    return v && urlSearch === false ? { ...v, q: "" } : v;
  }, [searchParams, urlParams, urlSearch]);
  const [view, setView] = useState<ViewState>(() => (fromUrl ? { ...defaults, ...fromUrl, filters: fromUrl.filters } : defaults));
  const [loaded, setLoaded] = useState(false);
  const [qInput, setQInput] = useState(view.q);

  // Remembered view (this browser). URL filters win over remembered ones.
  useEffect(() => {
    let stored: ViewState | null = null;
    try {
      stored = parseView(localStorage.getItem(storageKey), defaults);
    } catch {
      /* storage blocked */
    }
    if (stored) {
      const s = stored;
      setView((v) => (fromUrl ? { ...s, q: v.q, filters: v.filters } : s));
      if (!fromUrl) setQInput(s.q);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, serializeView(view));
    } catch {
      /* storage blocked: the view just isn't remembered */
    }
    const next = viewToParams(props.urlSearch === false ? { q: "", filters: view.filters } : view, urlParams, new URLSearchParams(window.location.search));
    const qs = next.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", url);
  }, [view, loaded, storageKey, urlParams, props.urlSearch]);

  // Debounced search.
  useEffect(() => {
    if (qInput === view.q) return;
    const t = setTimeout(() => setView((v) => ({ ...v, q: qInput })), 90);
    return () => clearTimeout(t);
  }, [qInput, view.q]);

  const patch = useCallback((p: Partial<ViewState>) => setView((v) => ({ ...v, ...p })), []);

  // ---- Derived rows
  const specs = useMemo<FilterSpec<T>[]>(() => filters.map((f) => (f.kind === "facet" ? { id: f.id, kind: "facet", values: f.values } : { id: f.id, kind: "toggle", test: f.test })), [filters]);
  const knownFilters = useMemo(() => new Set(filters.map((f) => f.id)), [filters]);
  const activeFilters = useMemo(() => Object.fromEntries(Object.entries(view.filters).filter(([k]) => knownFilters.has(k))) as FilterState, [view.filters, knownFilters]);
  // searchText is usually an inline arrow: index once per rows change, not per render.
  const searchTextRef = useRef(props.searchText);
  searchTextRef.current = props.searchText;
  const items = useMemo(() => rows.map((row) => ({ row, text: normalize(searchTextRef.current ? searchTextRef.current(row) : "") })), [rows]);
  const matched = useMemo(() => filterRows(items, view.q, specs, activeFilters), [items, view.q, specs, activeFilters]);
  const colById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const sorted = useMemo(() => {
    if (view.sort.some((s) => colById.get(s.id)?.sort)) return sortRows(matched.map((m) => m.row), view.sort, (r, c) => colById.get(c)?.sort?.(r), (c) => !!colById.get(c)?.sort);
    if (view.q.trim()) return [...matched].sort((a, b) => b.score - a.score).map((m) => m.row);
    return matched.map((m) => m.row);
  }, [matched, view.sort, view.q, colById]);
  const group = groups.find((g) => g.id === view.group) ?? null;
  const grouped = useMemo(() => (group ? groupRows(sorted, group.key, group.order) : null), [group, sorted]);
  const collapsed = useMemo(() => new Set(view.collapsed), [view.collapsed]);
  /** Rows in display order, skipping collapsed groups: drives keyboard moves and range selection. */
  const ordered = useMemo(() => (grouped ? grouped.flatMap((g) => (collapsed.has(g.key) ? [] : g.rows)) : sorted), [grouped, sorted, collapsed]);
  const orderedKeys = useMemo(() => ordered.map(rowKey), [ordered, rowKey]);
  const byKey = useMemo(() => new Map(rows.map((r) => [rowKey(r), r])), [rows, rowKey]);

  const visibleCols = useMemo(() => columns.filter((c, i) => i === 0 || c.hideable === false || !view.hidden.includes(c.id)), [columns, view.hidden]);

  // ---- Incremental rendering
  const [limit, setLimit] = useState(CHUNK);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  const cardSentinelRef = useRef<HTMLDivElement>(null);
  const resetKey = `${view.q}|${JSON.stringify(activeFilters)}|${JSON.stringify(view.sort)}|${view.group}`;
  const [lastReset, setLastReset] = useState(resetKey);
  if (resetKey !== lastReset) {
    setLastReset(resetKey);
    setLimit(CHUNK);
  }
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [lastReset]);
  useEffect(() => {
    const grow = (entries: IntersectionObserverEntry[]) => { if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + CHUNK); };
    // The table scrolls inside its frame on wider screens; cards scroll with the page.
    const inFrame = new IntersectionObserver(grow, { root: scrollRef.current, rootMargin: "600px" });
    const inPage = new IntersectionObserver(grow, { rootMargin: "600px" });
    if (sentinelRef.current) inFrame.observe(sentinelRef.current);
    if (cardSentinelRef.current) inPage.observe(cardSentinelRef.current);
    return () => { inFrame.disconnect(); inPage.disconnect(); };
  }, [limit, ordered.length, phone]);

  // ---- Selection
  const selectable = !!props.bulkActions;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  useEffect(() => {
    // Rows that disappeared (deleted, archived) leave the selection.
    setSelected((s) => {
      const next = new Set([...s].filter((k) => byKey.has(k)));
      return next.size === s.size ? s : next;
    });
  }, [byKey]);
  const toggleRow = (key: string, shiftKey: boolean) => {
    const from = anchor.current;
    setSelected((s) => {
      if (shiftKey && from) return selectRange(s, orderedKeys, from, key);
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
    anchor.current = key;
  };
  const filteredKeys = useMemo(() => sorted.map(rowKey), [sorted, rowKey]);
  const allSelected = filteredKeys.length > 0 && filteredKeys.every((k) => selected.has(k));
  const someSelected = !allSelected && filteredKeys.some((k) => selected.has(k));
  const selectedRows = useMemo(() => [...selected].map((k) => byKey.get(k)).filter((r): r is T => r != null), [selected, byKey]);
  const [msg, setMsg] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const bulkApi: BulkApi<T> = {
    rows: selectedRows,
    keys: selectedRows.map(rowKey),
    pending,
    clear: () => setSelected(new Set()),
    run: (fn) =>
      start(async () => {
        setMsg(null);
        const r = await fn();
        setMsg(r ?? { message: "Done." });
        if (!r?.error) setSelected(new Set());
        router.refresh();
      }),
  };
  useEffect(() => {
    if (!msg || msg.error) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  // ---- Active row, drawer, keyboard
  const [active, setActive] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openRow = openKey ? byKey.get(openKey) ?? null : null;
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tableId = useId();

  const open = useCallback((key: string) => {
    const row = byKey.get(key);
    if (!row) return;
    if (props.drawer) setOpenKey(key);
    else {
      const href = props.rowHref?.(row);
      if (href) router.push(href);
    }
  }, [byKey, props, router]);

  const focusRow = useCallback((key: string) => {
    const i = orderedKeys.indexOf(key);
    if (i >= limit) setLimit(i + CHUNK);
    requestAnimationFrame(() => {
      const tr = rootRef.current?.querySelector<HTMLElement>(`tr[data-row="${CSS.escape(key)}"]`);
      tr?.focus({ preventScroll: true });
      tr?.scrollIntoView({ block: "nearest" });
    });
  }, [orderedKeys, limit]);

  useEffect(() => {
    keyboardStack.push(tableId);
    return () => { keyboardStack.splice(keyboardStack.lastIndexOf(tableId), 1); };
  }, [tableId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyboardStack[keyboardStack.length - 1] !== tableId) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Another modal (command bar, confirm, sheets) owns the keyboard. Closed ones are inert or hidden.
      if ([...document.querySelectorAll('[aria-modal="true"]')].some((m) => !m.closest('[inert], [aria-hidden="true"]') && (m as HTMLElement).offsetParent !== null)) return;
      // An open select list or menu handles its own keys (Esc closes it, not the table's state).
      if (document.querySelector('[role="listbox"], [role="menu"]')) return;
      const el = document.activeElement;
      const typing = isTyping(el);
      // Phones: cards have no keyboard model (the table is hidden).
      if (!scrollRef.current || scrollRef.current.offsetParent === null) {
        if (e.key === "/" && !typing) { e.preventDefault(); e.stopPropagation(); searchRef.current?.focus(); }
        return;
      }
      if (typing) return;
      const inTable = !!el && rootRef.current?.contains(el);
      const idx = active ? orderedKeys.indexOf(active) : -1;
      const move = (d: number) => {
        const next = orderedKeys[Math.max(0, Math.min(orderedKeys.length - 1, idx < 0 ? 0 : idx + d))];
        if (!next) return;
        setActive(next);
        if (openKey) setOpenKey(next);
        focusRow(next);
      };
      if (e.key === "/") { e.preventDefault(); e.stopPropagation(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (e.key === "j" || (e.key === "ArrowDown" && (inTable || active))) { e.preventDefault(); move(1); }
      else if (e.key === "k" || (e.key === "ArrowUp" && (inTable || active))) { e.preventDefault(); move(-1); }
      else if (e.key === "Enter" && active && (el === document.body || (el instanceof HTMLElement && el.dataset.row === active))) { e.preventDefault(); open(active); }
      else if (e.key === "x" && active && selectable) { e.preventDefault(); toggleRow(active, e.shiftKey); }
      else if (e.key === "Escape") {
        if (openKey) setOpenKey(null);
        else if (selected.size) setSelected(new Set());
        else if (active) { setActive(null); (el as HTMLElement | null)?.blur?.(); }
        else if (view.q) { setQInput(""); patch({ q: "" }); }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  });

  // Sideways scroll: shadow under the sticky first column.
  const [scrolledX, setScrolledX] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const on = () => setScrolledX(el.scrollLeft > 2);
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, []);

  // ---- Column resizing (widths live in the view)
  const startResize = (colId: string, th: HTMLElement, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    document.documentElement.classList.add("col-resizing");
    const moveFn = (ev: PointerEvent) => {
      const w = Math.max(48, Math.round(startW + ev.clientX - startX));
      th.style.width = `${w}px`;
      th.style.minWidth = `${w}px`;
    };
    const up = () => {
      target.removeEventListener("pointermove", moveFn);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      document.documentElement.classList.remove("col-resizing");
      const w = Math.round(th.getBoundingClientRect().width);
      setView((v) => ({ ...v, widths: { ...v.widths, [colId]: w } }));
    };
    target.addEventListener("pointermove", moveFn);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  // ---- Toolbar pieces
  const [nPlural, nSingular] = [noun[1], noun[0]];
  const filteredCount = sorted.length;
  const segmentedIds = new Set(filters.filter((f) => f.kind === "facet" && f.display === "segmented").map((f) => f.id));
  const narrowing = Object.fromEntries(Object.entries(activeFilters).filter(([k]) => !segmentedIds.has(k)));
  const isFiltered = !!view.q.trim() || activeFilterCount(narrowing) > 0;
  // Clear all leaves the tabs (segmented filters) where they are.
  const clearAll = () => { setQInput(""); patch({ q: "", filters: Object.fromEntries(Object.entries(activeFilters).filter(([k]) => filters.some((f) => f.id === k && f.kind === "facet" && f.display === "segmented"))) }); };
  const countsFor = (fid: string) => facetCounts(items, view.q, specs, activeFilters, fid);
  const optionsFor = (f: Extract<Filter<T>, { kind: "facet" }>) => {
    if (f.options) return f.options;
    const seen = new Set<string>();
    for (const r of rows) for (const v of [f.values(r)].flat()) if (v) seen.add(v);
    return [...seen].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  };
  const setFilter = (fid: string, value: string, single?: boolean) => patch({ filters: toggleFilterValue(activeFilters, fid, value, single) });
  const exportCsv = (list: T[]) => downloadText(`${props.csvName ?? id}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list, csvColumns(visibleCols)));
  const sortable = columns.filter((c) => c.sort);
  const segmented = filters.filter((f): f is Extract<Filter<T>, { kind: "facet" }> => f.kind === "facet" && f.display === "segmented");
  const menuFilters = filters.filter((f) => !(f.kind === "facet" && f.display === "segmented"));
  const [sheet, setSheet] = useState(false);
  const toggles = menuFilters.filter((f): f is Extract<Filter<T>, { kind: "toggle" }> => f.kind === "toggle");
  // A couple of toggles sit in the toolbar; more go in a "Show only" menu (active ones still show as chips).
  const inlineToggles = toggles.length <= 2;

  const facetButton = (f: Extract<Filter<T>, { kind: "facet" }>) => {
    const chosen = activeFilters[f.id] ?? [];
    const opts = optionsFor(f);
    const label = chosen.length === 1 ? opts.find((o) => o.value === chosen[0])?.label ?? chosen[0] : chosen.length > 1 ? `${chosen.length}` : null;
    return (
      <FacetMenu key={f.id} f={f} opts={opts} chosen={chosen} counts={() => countsFor(f.id)} onToggle={(v) => setFilter(f.id, v, f.single)} onClear={() => { const n = { ...activeFilters }; delete n[f.id]; patch({ filters: n }); }}>
        {(openNow) => (
          <button type="button" className={cn(toolButton, (chosen.length > 0 || openNow) && toolActive)} aria-label={`Filter by ${f.label}`}>
            <span className={chosen.length ? "text-muted" : undefined}>{f.label}</span>
            {label && <span className="max-w-40 truncate font-medium text-ink">{label}</span>}
            <ChevronDown className={cn("size-3.5 text-muted transition-transform duration-180", openNow && "rotate-180")} />
          </button>
        )}
      </FacetMenu>
    );
  };
  const toggleChip = (f: Extract<Filter<T>, { kind: "toggle" }>, inSheet = false) => {
    const on = !!activeFilters[f.id]?.length;
    const count = countsFor(f.id).get("1") ?? 0;
    return (
      <button
        key={f.id}
        type="button"
        aria-pressed={on}
        onClick={() => setFilter(f.id, "1")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-[color,background-color,border-color] duration-120 ease-motion",
          inSheet ? "h-10" : "h-9",
          on ? (f.tone === "warn" ? "border-warn/40 bg-warn-bg text-warn" : f.tone === "bad" ? "border-bad/40 bg-bad-bg text-bad" : f.tone === "good" ? "border-good/40 bg-good-bg text-good" : "border-ink bg-primary text-primary-ink") : "border-border-strong text-ink-2 hover:bg-surface-2 hover:text-ink",
        )}
      >
        {f.label}
        <span className={cn("num text-xs", on ? "opacity-80" : "text-muted")}>{count}</span>
      </button>
    );
  };

  const summary = props.summary?.(sorted, rows);
  const widthStyle = (c: Column<T>) => {
    const w = view.widths[c.id] ?? c.width;
    return w ? { width: w, minWidth: w } : undefined;
  };
  const densityPad = view.density === "compact" ? "py-1" : "py-2.5";
  const editPad = view.density === "compact" ? "py-0.5" : "py-1.5";
  const colCount = visibleCols.length + (selectable ? 1 : 0);
  const stickyLeft = selectable ? 44 : 0;

  // Rows to render: walk groups until the chunk limit is used.
  let budget = limit;
  const renderGroups = grouped ?? [{ key: "", rows: sorted }];

  // Rows are memoized: loading the next chunk, moving focus or ticking one box only
  // re-renders the rows that changed (cells with GridSelects are not cheap).
  const handlers = useRef({ toggleRow, open, setActive, selectable });
  handlers.current = { toggleRow, open, setActive, selectable };
  const clickable = !!(props.drawer || props.rowHref);
  const renderRow = (r: T) => {
    const key = rowKey(r);
    return (
      <MemoRow<T>
        key={key}
        row={r}
        rowKey={key}
        selected={selected.has(key)}
        active={active === key}
        isOpen={openKey === key}
        cols={visibleCols}
        handlers={handlers}
        densityPad={densityPad}
        editPad={editPad}
        stickyLeft={stickyLeft}
        selectable={selectable}
        clickable={clickable}
        extraClass={props.rowClassName?.(r)}
      />
    );
  };

  const groupHeader = (g: { key: string; rows: T[] }) => {
    const isCollapsed = collapsed.has(g.key);
    const keys = g.rows.map(rowKey);
    const all = keys.every((k) => selected.has(k));
    const some = !all && keys.some((k) => selected.has(k));
    return (
      <tr key={`g:${g.key}`} className="dt-group">
        {selectable && (
          <td className="dt-sticky border-b border-border py-1.5 pr-0 pl-3" style={{ left: 0 }}>
            <Checkbox checked={all} mixed={some} label={`Select group ${g.key || "none"}`} onChange={() => setSelected((s) => { const n = new Set(s); for (const k of keys) { if (all) n.delete(k); else n.add(k); } return n; })} />
          </td>
        )}
        {visibleCols.map((c, i) =>
          i === 0 ? (
            <td key={c.id} className="dt-sticky dt-sticky-last border-b border-border px-2 py-1.5" style={{ left: stickyLeft }}>
              <button type="button" aria-expanded={!isCollapsed} onClick={() => patch({ collapsed: isCollapsed ? view.collapsed.filter((k) => k !== g.key) : [...view.collapsed, g.key] })} className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1 text-left text-[0.8rem] font-semibold text-ink hover:bg-surface-2">
                <ChevronRight className={cn("size-3.5 text-muted transition-transform duration-180 ease-motion", !isCollapsed && "rotate-90")} />
                {group?.title ? group.title(g.key) : g.key || "None"}
                <span className="num font-normal text-muted">{g.rows.length}</span>
              </button>
            </td>
          ) : (
            <td key={c.id} className={cn("border-b border-border px-3 py-1.5 text-[0.8rem] font-medium text-ink-2", c.align === "right" && "num text-right")}>{c.total?.(g.rows)}</td>
          ),
        )}
      </tr>
    );
  };

  const bodyRows: ReactNode[] = [];
  for (const g of phone ? [] : renderGroups) {
    if (budget <= 0) break;
    if (grouped) bodyRows.push(groupHeader(g));
    if (grouped && collapsed.has(g.key)) continue;
    const slice = g.rows.slice(0, budget);
    budget -= slice.length;
    for (const r of slice) bodyRows.push(renderRow(r));
  }
  const more = ordered.length > limit;

  const cardList: ReactNode[] = [];
  if (phone) {
    let b = limit;
    for (const g of renderGroups) {
      if (b <= 0) break;
      if (grouped) cardList.push(
        <button key={`g:${g.key}`} type="button" onClick={() => patch({ collapsed: collapsed.has(g.key) ? view.collapsed.filter((k) => k !== g.key) : [...view.collapsed, g.key] })} className="flex min-h-11 w-full items-center gap-1.5 bg-surface-2/60 px-4 text-left text-[0.8rem] font-semibold">
          <ChevronRight className={cn("size-3.5 text-muted transition-transform", !collapsed.has(g.key) && "rotate-90")} />
          {group?.title ? group.title(g.key) : g.key || "None"} <span className="num font-normal text-muted">{g.rows.length}</span>
        </button>,
      );
      if (grouped && collapsed.has(g.key)) continue;
      for (const r of g.rows.slice(0, b)) {
        const key = rowKey(r);
        const cv = card(r);
        const href = !props.drawer ? props.rowHref?.(r) : null;
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{cv.title}</span>
              {cv.subtitle && <span className="mt-0.5 block truncate text-xs text-muted">{cv.subtitle}</span>}
            </span>
            {(cv.value != null || cv.sub) && (
              <span className="shrink-0 text-right">
                {cv.value != null && <span className="num block text-sm font-medium">{cv.value}</span>}
                {cv.sub && <span className="block text-xs text-muted">{cv.sub}</span>}
              </span>
            )}
            {(props.drawer || href) && <ChevronRight className="size-4 shrink-0 text-muted/70" />}
          </>
        );
        cardList.push(
          <div key={key} data-selected={selected.has(key) || undefined} className="dt-card flex items-center gap-2 border-b border-border pr-3 last:border-b-0">
            {selectable && <span className="pl-3"><Checkbox checked={selected.has(key)} label={`Select ${key}`} onChange={(e) => toggleRow(key, e.shiftKey)} className="size-10" /></span>}
            {href ? (
              <Link href={href} className={cn("flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5", !selectable && "pl-4")}>{body}</Link>
            ) : props.drawer ? (
              <button type="button" onClick={() => setOpenKey(key)} className={cn("flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 text-left", !selectable && "pl-4")}>{body}</button>
            ) : (
              <div className={cn("flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5", !selectable && "pl-4")}>{body}</div>
            )}
          </div>,
        );
      }
      b -= g.rows.length;
    }
  }

  const noRows = rows.length === 0;
  const noMatch = !noRows && sorted.length === 0;

  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-tour={props.tours?.toolbar}>
      <div className="relative min-w-0 flex-1 sm:max-w-80 sm:flex-none sm:basis-64" data-tour={props.tours?.search}>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={searchRef}
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); if (qInput) { setQInput(""); patch({ q: "" }); } else e.currentTarget.blur(); }
            else if (e.key === "Enter" || e.key === "ArrowDown") {
              e.preventDefault();
              // Commit now, then hop into the rows.
              patch({ q: qInput });
              const first = orderedKeys[0];
              if (first && scrollRef.current?.offsetParent) { setActive(first); focusRow(first); }
              else e.currentTarget.blur();
            }
          }}
          placeholder={props.searchPlaceholder ?? `Search ${nPlural}`}
          aria-label={props.searchPlaceholder ?? `Search ${nPlural}`}
          aria-keyshortcuts="/"
          className="h-10 w-full rounded-lg border border-border-strong bg-surface pr-24 pl-9 text-base text-ink transition-[border-color,box-shadow] duration-120 ease-motion placeholder:text-muted/70 hover:border-ink-2/40 focus:border-ink-2 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_7%,transparent)] focus:outline-none sm:h-9 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1.5 text-xs text-muted" aria-live="polite">
          <span className="num">{isFiltered ? `${filteredCount} of ${rows.length}` : rows.length}</span>
          {!qInput && <kbd className="hidden rounded border border-border px-1 font-sans text-[10px] leading-4 text-muted sm:inline">/</kbd>}
        </span>
        {qInput && (
          <button type="button" onClick={() => { setQInput(""); patch({ q: "" }); searchRef.current?.focus(); }} aria-label="Clear search" className="absolute top-1/2 right-[4.6rem] grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Phones: one Filters button opening a sheet. */}
      {(menuFilters.length > 0 || groups.length > 0 || sortable.length > 0) && (
        <button type="button" onClick={() => setSheet(true)} className={cn(toolButton, "h-10 sm:hidden", activeFilterCount(narrowing) > 0 && toolActive)}>
          <ListFilter className="size-4" /> Filters{activeFilterCount(narrowing) > 0 && <span className="num rounded-full bg-ink px-1.5 text-xs text-surface">{activeFilterCount(narrowing)}</span>}
        </button>
      )}

      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        {menuFilters.map((f) => (f.kind === "facet" ? facetButton(f) : inlineToggles || activeFilters[f.id]?.length ? toggleChip(f) : null))}
        {!inlineToggles && (
          <Popover label="More filters" button={(o) => (
            <button type="button" className={cn(toolButton, o && toolActive)} aria-label="More filters">
              <ListFilter className="size-4" />Show only
              <ChevronDown className={cn("size-3.5 text-muted transition-transform duration-180", o && "rotate-180")} />
            </button>
          )}>
            {() => (
              <div className="p-1" role="menu">
                {toggles.map((f) => <OptionRow key={f.id} checked={!!activeFilters[f.id]?.length} label={f.label} count={countsFor(f.id).get("1") ?? 0} onClick={() => setFilter(f.id, "1")} />)}
              </div>
            )}
          </Popover>
        )}
        {isFiltered && (
          <button type="button" onClick={clearAll} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink">
            <X className="size-3.5" /> Clear all
          </button>
        )}
      </div>

      <div className="ml-auto hidden items-center gap-2 sm:flex">
        {groups.length > 0 && (
          <Popover label="Group by" placement="bottom-end" button={(o) => (
            <button type="button" className={cn(toolButton, (view.group || o) && toolActive)} aria-label="Group rows">
              <Layers className="size-4" /><span className="hidden lg:inline">{group ? group.label : "Group"}</span>
            </button>
          )}>
            {(close) => (
              <div className="p-1" role="menu">
                <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-muted">Group by</div>
                <OptionRow radio checked={!view.group} label="No grouping" onClick={() => { patch({ group: null }); close(); }} />
                {groups.map((g) => <OptionRow key={g.id} radio checked={view.group === g.id} label={g.label} onClick={() => { patch({ group: g.id, collapsed: [] }); close(); }} />)}
              </div>
            )}
          </Popover>
        )}
        <Popover label="Columns and density" placement="bottom-end" button={(o) => (
          <button type="button" className={cn(toolButton, o && toolActive)} aria-label="Columns and density"><Columns3 className="size-4" /><span className="hidden lg:inline">View</span></button>
        )}>
          {() => (
            <div className="overflow-y-auto p-1" role="menu">
              <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-muted">Density</div>
              <div className="mx-1 mb-1 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-0.5">
                {(["comfortable", "compact"] as const).map((d) => (
                  <button key={d} type="button" aria-pressed={view.density === d} onClick={() => patch({ density: d })} className={cn("inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-xs capitalize transition-colors duration-120", view.density === d ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
                    {d === "compact" ? <Rows3 className="size-3.5" /> : <Rows2 className="size-3.5" />}{d}
                  </button>
                ))}
              </div>
              <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted">Columns</div>
              {columns.map((c, i) => (i === 0 || c.hideable === false ? null : (
                <OptionRow key={c.id} checked={!view.hidden.includes(c.id)} label={labelOf(c)} onClick={() => patch({ hidden: view.hidden.includes(c.id) ? view.hidden.filter((x) => x !== c.id) : [...view.hidden, c.id] })} />
              )))}
              <div className="mt-1 border-t border-border pt-1">
                <button type="button" onClick={() => { setQInput(""); setView(defaults); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-muted hover:bg-surface-2 hover:text-ink"><RotateCcw className="size-3.5" />Reset view</button>
              </div>
            </div>
          )}
        </Popover>
        <button type="button" className={toolButton} onClick={() => exportCsv(sorted)} title={`Download ${filteredCount} ${filteredCount === 1 ? nSingular : nPlural} as a spreadsheet (CSV)`} aria-label="Export CSV">
          <Download className="size-4" /><span className="hidden lg:inline">CSV</span>
        </button>
        {props.toolbar}
      </div>
    </div>
  );

  const content = (
    <div ref={rootRef} className="dt min-w-0" data-ready={loaded || undefined}>
      {segmented.map((f) => {
        const counts = facetCounts(items, "", specs, {}, f.id);
        const chosen = activeFilters[f.id]?.[0] ?? "";
        return (
          <div key={f.id} className="mb-4 flex gap-0.5 overflow-x-auto border-b border-border sm:gap-1" role="tablist" aria-label={f.label}>
            {[{ value: "", label: f.allLabel ?? "All" }, ...optionsFor(f)].map((o) => (
              <button key={o.value} type="button" role="tab" aria-selected={chosen === o.value} onClick={() => patch({ filters: { ...Object.fromEntries(Object.entries(activeFilters).filter(([k]) => k !== f.id)), ...(o.value ? { [f.id]: [o.value] } : {}) } })} className={cn("-mb-px shrink-0 border-b-2 px-2 pb-2.5 text-sm whitespace-nowrap transition-colors duration-120 sm:px-3", chosen === o.value ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
                {o.label} <span className="num ml-1 text-muted">{o.value ? counts.get(o.value) ?? 0 : rows.length}</span>
              </button>
            ))}
          </div>
        );
      })}

      {summary && summary.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-muted">
          {summary.map((s, i) => {
            const on = s.filter ? !!activeFilters[s.filter.id]?.includes(s.filter.value ?? "1") : false;
            const inner = <>{s.value != null && <span className={cn("num font-medium", s.tone === "bad" ? "text-bad" : s.tone === "warn" ? "text-warn" : s.tone === "good" ? "text-good" : "text-ink")}>{s.value}</span>} {s.label}</>;
            return (
              <Fragment key={i}>
                {i > 0 && <span aria-hidden className="px-0.5 text-border-strong">·</span>}
                {s.filter ? (
                  <button type="button" aria-pressed={on} onClick={() => setFilter(s.filter!.id, s.filter!.value ?? "1")} className={cn("rounded-md px-1 py-0.5 underline decoration-border-strong decoration-dotted underline-offset-4 transition-colors duration-120 hover:bg-surface-2 hover:text-ink", on && "bg-surface-2 text-ink decoration-ink")}>{inner}</button>
                ) : (
                  <span className="px-1 py-0.5">{inner}</span>
                )}
              </Fragment>
            );
          })}
        </div>
      )}

      {!noRows && toolbar}

      {noRows ? (
        props.empty ?? <EmptyState title={`No ${nPlural} yet`} />
      ) : noMatch ? (
        <EmptyState
          title={`No ${nPlural} match`}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {view.q && <Button onClick={() => { setQInput(""); patch({ q: "" }); }}>Clear search “{view.q}”</Button>}
              {activeFilterCount(narrowing) > 0 && <Button onClick={() => { const q = view.q; clearAll(); setQInput(q); patch({ q }); }}>Clear filters</Button>}
            </div>
          }
        >
          {isFiltered ? "Nothing fits this search and these filters together." : null}
        </EmptyState>
      ) : (
        <>
          {/* Phones: cards. */}
          {phone && <Card className="overflow-hidden sm:hidden">
            {cardList}
            {more && <div ref={cardSentinelRef} className="px-4 py-3 text-center text-xs text-muted">Loading more…</div>}
          </Card>}

          {/* Tablets and up: the table, scrolling inside its frame so the header and first column stay put. */}
          <Card className="relative hidden overflow-hidden sm:block">
            <div ref={scrollRef} className={cn("dt-scroll overflow-auto overscroll-x-contain", scrolledX && "dt-scrolled-x")} style={{ maxHeight: props.maxHeight ?? "calc(100dvh - 9.5rem)" }}>
              <table data-no-resize className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    {selectable && (
                      <th className="dt-th dt-sticky w-11 pr-0 pl-3" style={{ left: 0 }}>
                        <Checkbox checked={allSelected} mixed={someSelected} label={allSelected ? "Clear selection" : `Select all ${filteredCount}`} onChange={() => setSelected(allSelected ? new Set() : new Set(filteredKeys))} />
                      </th>
                    )}
                    {visibleCols.map((c, i) => {
                      const si = view.sort.findIndex((s) => s.id === c.id);
                      const s = si >= 0 ? view.sort[si] : null;
                      return (
                        <th
                          key={c.id}
                          aria-sort={s ? (s.dir === "asc" ? "ascending" : "descending") : undefined}
                          className={cn("dt-th px-3", c.edit && "px-3.5", i === 0 && "dt-sticky dt-sticky-last", c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left")}
                          style={{ ...widthStyle(c), ...(i === 0 ? { left: stickyLeft } : null) }}
                        >
                          {c.help && c.align === "right" && <span className="mr-1 inline-flex align-middle"><HelpTip id={c.help} /></span>}
                          {c.sort ? (
                            <button
                              type="button"
                              onClick={(e) => patch({ sort: toggleSort(view.sort, c.id, e.shiftKey, c.firstDir) })}
                              title="Sort · shift-click to add a second sort"
                              className={cn("group/sort inline-flex max-w-full items-center gap-1 rounded py-0.5 whitespace-nowrap transition-colors duration-120 hover:text-ink", s && "text-ink", c.align === "right" && "flex-row-reverse")}
                            >
                              <span className="truncate">{c.header}</span>
                              <span className={cn("inline-flex items-center text-muted transition-opacity duration-120", s ? "opacity-100" : "opacity-0 group-hover/sort:opacity-60")}>
                                {s?.dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
                                {s && view.sort.length > 1 && <span className="num text-[10px]">{si + 1}</span>}
                              </span>
                            </button>
                          ) : (
                            <span className="whitespace-nowrap">{c.header}</span>
                          )}
                          {c.help && c.align !== "right" && <span className="ml-1 inline-flex align-middle"><HelpTip id={c.help} /></span>}
                          <span
                            className="col-resizer"
                            aria-hidden="true"
                            title="Drag to resize · double-click to reset"
                            onPointerDown={(e) => startResize(c.id, e.currentTarget.parentElement as HTMLElement, e)}
                            onDoubleClick={(e) => { e.stopPropagation(); const th = e.currentTarget.parentElement as HTMLElement; th.style.width = ""; th.style.minWidth = ""; setView((v) => { const w = { ...v.widths }; delete w[c.id]; return { ...v, widths: w }; }); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows}
                  {more && (
                    <tr ref={sentinelRef} aria-hidden>
                      <td colSpan={colCount} className="px-3 py-3 text-center text-xs text-muted">Loading more…</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {props.footer}
          </Card>
          <p className="mt-2 hidden text-xs text-muted lg:block">
            <kbd className="dt-kbd">/</kbd> search · <kbd className="dt-kbd">j</kbd><kbd className="dt-kbd">k</kbd> move · <kbd className="dt-kbd">Enter</kbd> open{selectable && <> · <kbd className="dt-kbd">x</kbd> select · shift-click a range</>} · shift-click a header to sort by two columns
          </p>
          <div className="sm:hidden">{props.footer}</div>
        </>
      )}

      {/* Bulk actions */}
      {selectable && (selected.size > 0 || msg) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar)+0.75rem)] z-40 flex justify-center px-3 lg:left-60">
          <div role="toolbar" aria-label="Bulk actions" className="pointer-events-auto flex max-w-full animate-rise-in flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface/95 px-3 py-2 shadow-2xl backdrop-blur">
            {selected.size > 0 ? (
              <>
                <span className="num px-1 text-sm font-medium whitespace-nowrap">{selected.size} selected</span>
                {!allSelected && filteredCount > selected.size && (
                  <button type="button" onClick={() => setSelected(new Set(filteredKeys))} className="text-sm whitespace-nowrap text-muted underline decoration-border-strong underline-offset-2 hover:text-ink">Select all {filteredCount}</button>
                )}
                <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
                {props.bulkActions!(bulkApi)}
                <Button size="sm" variant="ghost" onClick={() => exportCsv(selectedRows)}><Download className="size-3.5" />CSV</Button>
                <button type="button" onClick={() => setSelected(new Set())} aria-label="Clear selection" className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"><X className="size-4" /></button>
              </>
            ) : null}
            {msg && <span role="status" className={cn("px-1 text-sm", msg.error ? "text-bad" : "text-good")}>{msg.error ?? msg.message}</span>}
            {!selected.size && msg && <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss" className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2"><X className="size-4" /></button>}
          </div>
        </div>
      )}

      <Drawer open={!!openRow} onClose={() => setOpenKey(null)} title={openRow ? props.drawerTitle?.(openRow) : null} href={openRow ? props.rowHref?.(openRow) ?? null : null}>
        {openRow && props.drawer?.(openRow, () => setOpenKey(null))}
      </Drawer>

      <FiltersSheet open={sheet} onClose={() => setSheet(false)} title={`${filteredCount} of ${rows.length} ${nPlural}`} onClear={isFiltered ? clearAll : undefined}>
        {menuFilters.map((f) => {
          if (f.kind === "toggle") return null;
          const chosen = activeFilters[f.id] ?? [];
          const counts = countsFor(f.id);
          return (
            <section key={f.id}>
              <h3 className="mb-2 text-xs font-medium text-muted">{f.label}</h3>
              <div className="flex flex-wrap gap-1.5">
                {optionsFor(f).map((o) => (
                  <button key={o.value} type="button" aria-pressed={chosen.includes(o.value)} onClick={() => setFilter(f.id, o.value, f.single)} className={cn("inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm", chosen.includes(o.value) ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2")}>
                    {o.label}<span className="num text-xs opacity-70">{counts.get(o.value) ?? 0}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {menuFilters.some((f) => f.kind === "toggle") && (
          <section>
            <h3 className="mb-2 text-xs font-medium text-muted">Show only</h3>
            <div className="flex flex-wrap gap-1.5">{menuFilters.map((f) => (f.kind === "toggle" ? toggleChip(f, true) : null))}</div>
          </section>
        )}
        {sortable.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-medium text-muted">Sort by</h3>
            <div className="flex flex-wrap gap-1.5">
              {sortable.map((c) => {
                const s = view.sort[0]?.id === c.id ? view.sort[0] : null;
                return (
                  <button key={c.id} type="button" aria-pressed={!!s} onClick={() => patch({ sort: toggleSort(view.sort.slice(0, 1), c.id, false, c.firstDir) })} className={cn("inline-flex h-10 items-center gap-1 rounded-full border px-3 text-sm", s ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2")}>
                    {labelOf(c)}{s && (s.dir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {groups.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-medium text-muted">Group by</h3>
            <div className="flex flex-wrap gap-1.5">
              {[{ id: "", label: "None" }, ...groups].map((g) => (
                <button key={g.id} type="button" aria-pressed={(view.group ?? "") === g.id} onClick={() => patch({ group: g.id || null, collapsed: [] })} className={cn("inline-flex h-10 items-center rounded-full border px-3 text-sm", (view.group ?? "") === g.id ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2")}>{g.label}</button>
              ))}
            </div>
          </section>
        )}
      </FiltersSheet>
    </div>
  );

  if (props.help) return <HelpZone id={props.help} tour={props.tours?.root}>{content}</HelpZone>;
  return props.tours?.root ? <div data-tour={props.tours.root}>{content}</div> : content;
}

// ---- Row ------------------------------------------------------------------------

interface RowProps<T> {
  row: T;
  rowKey: string;
  selected: boolean;
  active: boolean;
  isOpen: boolean;
  cols: Column<T>[];
  handlers: React.RefObject<{ toggleRow: (k: string, shift: boolean) => void; open: (k: string) => void; setActive: (k: string) => void; selectable: boolean }>;
  densityPad: string;
  editPad: string;
  stickyLeft: number;
  selectable: boolean;
  clickable: boolean;
  extraClass?: string;
}

function RowImpl<T>({ row, rowKey: key, selected: sel, active, isOpen, cols, handlers, densityPad, editPad, stickyLeft, selectable, clickable, extraClass }: RowProps<T>) {
  return (
    <tr
      data-row={key}
      tabIndex={-1}
      data-selected={sel || undefined}
      data-active={active || undefined}
      data-open={isOpen || undefined}
      className={cn("dt-row outline-none", clickable && "cursor-pointer", extraClass)}
      onFocus={() => handlers.current.setActive(key)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(interactive)) return;
        const h = handlers.current;
        if (e.shiftKey && h.selectable) { h.toggleRow(key, true); return; }
        h.setActive(key);
        h.open(key);
      }}
    >
      {selectable && (
        <td className={cn("dt-sticky w-11 border-b border-border pr-0 pl-3", densityPad)} style={{ left: 0 }}>
          <Checkbox checked={sel} label={`Select ${key}`} onChange={(e) => handlers.current.toggleRow(key, e.shiftKey)} />
        </td>
      )}
      {cols.map((c, i) => (
        <td
          key={c.id}
          className={cn(
            "border-b border-border align-middle",
            c.edit ? cn("px-1.5", editPad) : cn("px-3", densityPad),
            c.align === "right" ? "num text-right" : c.align === "center" ? "text-center" : "text-left",
            i === 0 && "dt-sticky dt-sticky-last",
            c.className,
          )}
          style={i === 0 ? { left: stickyLeft } : undefined}
        >
          {c.cell(row)}
        </td>
      ))}
    </tr>
  );
}
const MemoRow = memo(RowImpl) as typeof RowImpl;

// ---- Facet menu -----------------------------------------------------------------

function FacetMenu<T>({ f, opts, chosen, counts: getCounts, onToggle, onClear, children }: { f: Extract<Filter<T>, { kind: "facet" }>; opts: FilterOption[]; chosen: string[]; counts: () => Map<string, number>; onToggle: (v: string) => void; onClear: () => void; children: (open: boolean) => ReactNode }) {
  const [q, setQ] = useState("");
  const list = q ? opts.filter((o) => normalize(o.label).includes(normalize(q))) : opts;
  return (
    <Popover label={`${f.label} filter`} button={children}>
      {(close) => {
        // Counted only while the menu is open.
        const counts = getCounts();
        return (
        <>
          {opts.length > 8 && (
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-3.5 text-muted" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find ${f.label.toLowerCase()}`} aria-label={`Find ${f.label}`} className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted" onKeyDown={(e) => { if (e.key === "Enter" && list[0]) onToggle(list[0].value); }} />
            </div>
          )}
          <div className="overflow-y-auto p-1" role="menu">
            {list.length === 0 && <div className="px-3 py-5 text-center text-muted">No matches</div>}
            {list.map((o) => <OptionRow key={o.value} radio={f.single} checked={chosen.includes(o.value)} label={o.label} count={counts.get(o.value) ?? 0} onClick={() => { onToggle(o.value); if (f.single) close(); }} />)}
          </div>
          {chosen.length > 0 && (
            <div className="border-t border-border p-1">
              <button type="button" onClick={() => { onClear(); close(); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-muted hover:bg-surface-2 hover:text-ink"><X className="size-3.5" />Clear {f.label.toLowerCase()}</button>
            </div>
          )}
        </>
        );
      }}
    </Popover>
  );
}

// ---- Drawer and sheet -------------------------------------------------------------

/** Side panel on tablets/desktops (the table stays usable beside it), bottom sheet on phones. */
export function Drawer({ open, onClose, title, href, children }: { open: boolean; onClose: () => void; title: ReactNode; href?: string | null; children: ReactNode }) {
  const { mounted, closing } = usePresence(open, 180);
  // While it animates out, keep showing what it last showed.
  const last = useRef<{ title: ReactNode; children: ReactNode; href?: string | null }>({ title, children, href });
  if (open) last.current = { title, children, href };
  const shown = last.current;
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
    // Focus moves in only when it opens; j/k keep moving rows while it's open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open && !!title]);
  if (!mounted) return null;
  return (
    <>
      <div className={cn("fixed inset-0 z-50 bg-black/25 sm:hidden", closing ? "animate-fade-out" : "animate-fade-in")} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={typeof shown.title === "string" ? shown.title : "Details"}
        tabIndex={-1}
        data-closing={closing || undefined}
        className={cn(
          "dt-drawer fixed z-50 flex flex-col border-border bg-surface shadow-2xl outline-none",
          "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]",
          "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[26rem] sm:rounded-none sm:border-t-0 sm:border-l sm:pb-0 xl:w-[30rem]",
        )}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong sm:hidden" />
        <div className="flex shrink-0 items-start gap-2 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1 text-base font-semibold break-words text-ink">{shown.title}</div>
          {shown.href && (
            <Link href={shown.href} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-8">
              Open page <ExternalLink className="size-3.5" />
            </Link>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink sm:size-8"><X className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{shown.children}</div>
        <div className="hidden shrink-0 border-t border-border px-5 py-2 text-xs text-muted lg:block"><kbd className="dt-kbd">j</kbd><kbd className="dt-kbd">k</kbd> next / previous · <kbd className="dt-kbd">Esc</kbd> close</div>
      </div>
    </>
  );
}

function FiltersSheet({ open, onClose, title, onClear, children }: { open: boolean; onClose: () => void; title: ReactNode; onClear?: () => void; children: ReactNode }) {
  const { mounted, closing } = usePresence(open, 200);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-[55] sm:hidden" role="dialog" aria-modal="true" aria-label="Filters">
      <div className={cn("absolute inset-0 bg-black/30", closing ? "animate-fade-out" : "animate-fade-in")} onClick={onClose} />
      <div className={cn("absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl", closing ? "animate-sheet-out" : "animate-sheet-in")}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong" />
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="num min-w-0 flex-1 text-sm font-medium">{title}</div>
          {onClear && <Button size="sm" variant="ghost" className="h-10" onClick={onClear}>Clear all</Button>}
          <Button size="sm" variant="primary" className="h-10 px-4" onClick={onClose}>Done</Button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

// ---- Bulk helpers -------------------------------------------------------------------

/** A bulk action that asks for one value from a list (e.g. "Link to ingredient…"). */
export function BulkPick({ label, options, onPick, disabled, allowNew, newLabel }: { label: string; options: FilterOption[]; onPick: (value: string, isNew: boolean) => void; disabled?: boolean; allowNew?: boolean; newLabel?: string }) {
  const [q, setQ] = useState("");
  const list = q ? options.filter((o) => normalize(o.label).includes(normalize(q))) : options;
  const exact = options.some((o) => normalize(o.label) === normalize(q));
  return (
    <Popover label={label} button={(o) => <Button size="sm" disabled={disabled} className={cn(o && "bg-surface-2")}>{label}<ChevronDown className="size-3.5 text-muted" /></Button>}>
      {(close) => (
        <>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-3.5 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={allowNew ? "Find or type a new one" : "Find"}
              aria-label={label}
              className="h-10 w-full bg-transparent text-base outline-none placeholder:text-muted sm:text-sm"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (list[0]) { onPick(list[0].value, false); close(); }
                else if (allowNew && q.trim()) { onPick(q.trim(), true); close(); }
              }}
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1" role="menu">
            {allowNew && q.trim() && !exact && (
              <button type="button" onClick={() => { onPick(q.trim(), true); close(); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left hover:bg-surface-2">{newLabel ?? "Use"} “{q.trim()}”</button>
            )}
            {list.slice(0, 200).map((o) => (
              <button key={o.value} type="button" role="menuitem" onClick={() => { onPick(o.value, false); close(); }} className="flex min-h-9 w-full items-center rounded-lg px-2.5 text-left hover:bg-surface-2"><span className="truncate">{o.label}</span></button>
            ))}
            {list.length === 0 && !(allowNew && q.trim()) && <div className="px-3 py-5 text-center text-muted">No matches</div>}
          </div>
        </>
      )}
    </Popover>
  );
}

/** A bulk action that asks for a typed value (e.g. a target %). */
export function BulkValue({ label, placeholder, suffix, onApply, disabled, inputMode = "decimal" }: { label: string; placeholder?: string; suffix?: string; onApply: (value: string) => void; disabled?: boolean; inputMode?: "decimal" | "text" }) {
  const [v, setV] = useState("");
  return (
    <Popover label={label} button={(o) => <Button size="sm" disabled={disabled} className={cn(o && "bg-surface-2")}>{label}<ChevronDown className="size-3.5 text-muted" /></Button>}>
      {(close) => (
        <form className="flex items-center gap-2 p-2" onSubmit={(e) => { e.preventDefault(); if (v.trim() || placeholder) { onApply(v.trim()); setV(""); close(); } }}>
          <div className="relative">
            <input autoFocus value={v} onChange={(e) => setV(e.target.value)} inputMode={inputMode} placeholder={placeholder} aria-label={label} className="h-10 w-32 rounded-lg border border-border-strong bg-surface px-3 text-base outline-none focus:border-ink-2 sm:h-9 sm:text-sm" />
            {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
          </div>
          <Button size="sm" variant="primary" type="submit" className="h-10 sm:h-9">Apply</Button>
        </form>
      )}
    </Popover>
  );
}

/** Label + value line for drawers. */
export function DetailRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right text-ink">{children}</span>
    </div>
  );
}
