"use client";

/** Free-text input with app-styled suggestions (replaces <datalist>). */

import { cn } from "@/lib/cn";
import { useState } from "react";
import { fuzzyFilter } from "@/domain/search";

export function Combobox({ name, defaultValue = "", suggestions, placeholder, className, "aria-label": ariaLabel }: { name: string; defaultValue?: string; suggestions: string[]; placeholder?: string; className?: string; "aria-label"?: string }) {
  const [v, setV] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = fuzzyFilter(suggestions.filter((s) => s !== v), v, (s) => s, 8);
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
        className={cn("h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-base sm:h-9 sm:text-sm text-ink placeholder:text-muted/70 focus:border-ink-2 focus:outline-none", className)}
      />
      {open && list.length > 0 && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-xl">
          {list.map((s, i) => (
            <div key={s} onMouseDown={(e) => { e.preventDefault(); setV(s); setOpen(false); }} onMouseMove={() => setActive(i)} className={cn("cursor-pointer rounded-lg px-2.5 py-1.5 text-sm", i === active && "bg-surface-2")}>{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}
