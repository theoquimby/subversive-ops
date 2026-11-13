"use client";

/** Free-text input with app-styled suggestions (replaces <datalist>). */

import { cn } from "@/lib/cn";
import { useState } from "react";
import { fuzzyFilter } from "@/domain/search";
import { usePresence } from "./motion";

export function Combobox({ name, defaultValue = "", suggestions, placeholder, className, "aria-label": ariaLabel }: { name: string; defaultValue?: string; suggestions: string[]; placeholder?: string; className?: string; "aria-label"?: string }) {
  const [v, setV] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = fuzzyFilter(suggestions.filter((s) => s !== v), v, (s) => s, 8);
  const { mounted, closing } = usePresence(open && list.length > 0, 100);
  return (
    <div className="relative">
      <input
        name={name}
        value={v}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { setV(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || !list.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); setV(list[active]); setOpen(false); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className={cn("h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-base sm:h-9 sm:text-sm text-ink placeholder:text-muted/70 transition-[border-color,box-shadow] duration-120 ease-motion hover:border-ink-2/40 focus:border-ink-2 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_7%,transparent)] focus:outline-none", className)}
      />
      {mounted && list.length > 0 && (
        <div className={cn("absolute inset-x-0 top-full z-50 mt-1 origin-top overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-xl", closing ? "pointer-events-none animate-scale-out" : "animate-scale-in")}>
          {list.map((s, i) => (
            <div key={s} onMouseDown={(e) => { e.preventDefault(); setV(s); setOpen(false); }} onMouseMove={() => setActive(i)} className={cn("cursor-pointer rounded-lg px-2.5 py-1.5 text-sm transition-colors duration-75", i === active && "bg-surface-2")}>{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}
