"use client";

import { fuzzyFilter } from "@/domain/search";
import clsx from "clsx";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  group: "Go to" | "Do" | "Recipes" | "Ingredients" | "Suppliers";
  href: string;
  hint?: string;
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

  const show = useCallback(() => { setOpen(true); setQ(""); setActive(0); }, []);

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
    const base = q.trim() ? commands : commands.filter((c) => c.group === "Go to" || c.group === "Do");
    return fuzzyFilter(base, q, (c) => `${c.label} ${c.hint ?? ""}`, 40);
  }, [commands, q]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    router.push(c.href);
  };

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-3 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command bar">
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); run(results[active]); }
              else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search recipes, ingredients, suppliers, or type a task…"
            className="h-13 w-full bg-transparent text-[0.95rem] outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted sm:block">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-1.5">
          {results.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">No matches</div>}
          {results.map((c, i) => {
            const header = !q.trim() && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted">{header}</div>}
                <button
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                  className={clsx("flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm", i === active ? "bg-surface-2 text-ink" : "text-ink-2")}
                >
                  <span className="truncate">{c.label}</span>
                  <span className="shrink-0 text-xs text-muted">{q.trim() ? c.group : c.hint}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
