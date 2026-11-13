"use client";

import { fuzzyFilter } from "@/domain/search";
import { cn } from "@/lib/cn";
import { CircleHelp, Search, Truck, type LucideIcon } from "lucide-react";
import { areaStyle, navItemFor, type Area } from "@/lib/areas";
import { usePresence } from "./motion";
import { startRouteProgress } from "./route-progress";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  group: "Go to" | "Do" | "Help" | "Recipes" | "Ingredients" | "Suppliers";
  href: string;
  hint?: string;
}

/** Row icon + area hue: the nav page the command lands on (help rows are "assist", suppliers get a truck). */
function iconFor(c: Command): { icon: LucideIcon; area: Area } {
  if (c.group === "Help") return { icon: CircleHelp, area: "assist" };
  if (c.group === "Suppliers") return { icon: Truck, area: "food" };
  const item = navItemFor(c.href);
  return item ? { icon: item.icon, area: item.area } : { icon: Search, area: "setup" };
}

const OPEN_EVENT = "command-palette:open";
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** ⌘K / Ctrl+K (or "/") anywhere: jump to anything, start any task. */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const listId = useId();

  const show = useCallback(() => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) returnTo.current = document.activeElement;
    setOpen(true); setQ(""); setActive(0);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    const el = returnTo.current;
    returnTo.current = null;
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  }, []);

  // Esc closes from anywhere while open (not just the input).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, show);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_EVENT, show); };
  }, [show]);

  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);

  const results = useMemo(() => {
    const base = q.trim() ? commands : commands.filter((c) => c.group === "Go to" || c.group === "Do" || c.group === "Help");
    return fuzzyFilter(base, q, (c) => `${c.label} ${c.hint ?? ""}`, 40);
  }, [commands, q]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    returnTo.current = null;
    setOpen(false);
    startRouteProgress(c.href);
    router.push(c.href);
  };

  // Stays mounted for 120ms after closing so it can scale/fade out.
  const { mounted, closing } = usePresence(open, 120);
  if (!mounted) return null;
  let lastGroup = "";
  const activeId = results[active] ? `${listId}-${active}` : undefined;
  return (
    <div data-closing={closing || undefined} className={cn("dialog-backdrop fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-3 pt-[12vh] backdrop-blur-[2px]", closing && "pointer-events-none")} onMouseDown={close}>
      <div
        className={cn("w-full max-w-lg origin-top overflow-hidden rounded-xl border border-border bg-surface shadow-2xl", closing ? "animate-scale-out" : "animate-scale-in")}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command bar"
        onKeyDown={(e) => {
          // Focus trap: the search box is the only tab stop; results are reached with the arrows.
          if (e.key === "Tab") { e.preventDefault(); inputRef.current?.focus(); }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-label="Search pages, recipes, ingredients, suppliers and tasks"
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Home" && e.ctrlKey) { e.preventDefault(); setActive(0); }
              else if (e.key === "End" && e.ctrlKey) { e.preventDefault(); setActive(Math.max(0, results.length - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); run(results[active]); }
            }}
            placeholder="Search recipes, ingredients, suppliers, or type a task…"
            className="h-13 w-full bg-transparent text-[0.95rem] outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted sm:block">esc</kbd>
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto p-1.5">
          {results.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted" role="status">No matches</div>}
          {results.map((c, i) => {
            const header = !q.trim() && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const icon = iconFor(c);
            const Icon = icon.icon;
            return (
              <div key={c.id} role="presentation">
                {header && <div role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted">{header}</div>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                  style={areaStyle(icon.area)}
                  className={cn("flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm", i === active ? "bg-surface-2 text-ink" : "text-ink-2")}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-md transition-colors duration-120", i === active ? "bg-area/15 text-area" : "bg-area/10 text-area")}>
                      <Icon className="size-[0.95rem]" strokeWidth={1.9} />
                    </span>
                    <span className="truncate">{c.label}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{q.trim() ? c.group : c.hint}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
