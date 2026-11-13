"use client";

/** Custom date picker (no native calendar). Value is "YYYY-MM-DD". */

import { autoUpdate, flip, offset, useFloating } from "@floating-ui/react";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ChangeEvent = { target: { value: string; name?: string } };

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function DatePicker({ value, defaultValue, onChange, name, className, min, max, "aria-label": ariaLabel }: { value?: string; defaultValue?: string; onChange?: (e: ChangeEvent) => void; name?: string; className?: string; min?: string; max?: string; "aria-label"?: string }) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  const base = current ? new Date(`${current}T00:00:00Z`) : new Date();
  const [view, setView] = useState({ y: base.getUTCFullYear(), m: base.getUTCMonth() });
  const btn = useRef<HTMLButtonElement | null>(null);
  const { refs, floatingStyles } = useFloating({ open, placement: "bottom-start", whileElementsMounted: autoUpdate, middleware: [offset(4), flip({ padding: 8 })] });

  useEffect(() => {
    if (!open) return;
    const b = current ? new Date(`${current}T00:00:00Z`) : new Date();
    setView({ y: b.getUTCFullYear(), m: b.getUTCMonth() });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !refs.floating.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (d: string) => {
    if (value === undefined) setInner(d);
    onChange?.({ target: { value: d, name } });
    setOpen(false);
    btn.current?.focus();
  };
  const today = new Date().toLocaleDateString("en-CA");
  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const shift = (n: number) => setView((v) => ({ y: v.y + Math.floor((v.m + n) / 12), m: (((v.m + n) % 12) + 12) % 12 }));

  return (
    <>
      <button
        ref={(el) => { btn.current = el; refs.setReference(el); }}
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className={clsx("inline-flex h-9 w-full items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-left text-sm hover:border-ink-2/40", open && "border-ink-2", className)}
      >
        <CalendarDays className="size-4 shrink-0 text-muted" strokeWidth={1.75} />
        <span className={clsx("truncate", !current && "text-muted")}>{current ? fmt.format(new Date(`${current}T00:00:00Z`)) : "Pick a date"}</span>
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      {open && createPortal(
        <div ref={refs.setFloating} style={floatingStyles} className="z-[60] w-72 rounded-xl border border-border bg-surface p-3 shadow-xl" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Previous month"><ChevronLeft className="size-4" /></button>
            <div className="text-sm font-medium">{monthFmt.format(new Date(Date.UTC(view.y, view.m, 1)))}</div>
            <button type="button" onClick={() => shift(1)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Next month"><ChevronRight className="size-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-muted">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="py-1">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const v = iso(view.y, view.m, d);
              const disabled = (min && v < min) || (max && v > max);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!!disabled}
                  onClick={() => pick(v)}
                  className={clsx(
                    "num h-9 rounded-lg text-sm transition-colors disabled:opacity-30",
                    v === current ? "bg-primary text-primary-ink" : "hover:bg-surface-2",
                    v === today && v !== current && "font-semibold underline decoration-2 underline-offset-4",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between border-t border-border pt-2">
            <button type="button" onClick={() => pick(today)} className="rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-surface-2">Today</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2">Close</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
