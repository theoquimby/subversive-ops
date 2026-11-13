"use client";

/**
 * Custom date picker (no native calendar). Value is "YYYY-MM-DD".
 *
 * Keyboard: Enter / Space / ↓ opens it with focus on the selected day (or
 * today). Arrows move a day / a week, PageUp / PageDown a month (with Shift a
 * year), Home / End the start / end of the week, Enter picks, Esc closes and
 * returns focus to the button. Tab cycles inside the calendar while it's open.
 * "Today" is the business date (see businessTodayClient), not the browser's.
 */

import { autoUpdate, flip, offset, useFloating } from "@floating-ui/react";
import { cn } from "@/lib/cn";
import { businessTodayClient } from "@/lib/business-today";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export { businessTodayClient };

type ChangeEvent = { target: { value: string; name?: string } };

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const toIso = (d: Date) => iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
/** Same day-of-month n months away, clamped to the month's last day. */
const addMonths = (s: string, n: number) => {
  const d = parse(s);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))));
};
const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function DatePicker({ value, defaultValue, onChange, name, className, min, max, today: todayProp, "aria-label": ariaLabel }: { value?: string; defaultValue?: string; onChange?: (e: ChangeEvent) => void; name?: string; className?: string; min?: string; max?: string; /** Business date to mark as today; defaults to businessTodayClient(). */ today?: string; "aria-label"?: string }) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string>(current || "");
  const btn = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const { refs, floatingStyles } = useFloating({ open, placement: "bottom-start", whileElementsMounted: autoUpdate, middleware: [offset(4), flip({ padding: 8 })] });

  const today = open ? todayProp ?? businessTodayClient() : "";
  const clamp = (d: string) => (min && d < min ? min : max && d > max ? max : d);

  const openAt = () => { moveFocus.current = true; setFocus(clamp(current || todayProp || businessTodayClient())); setOpen(true); };
  const close = (returnFocus = true) => { setOpen(false); if (returnFocus) btn.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !refs.floating.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, refs.floating]);

  // Roving focus: on open and on arrow keys, move DOM focus to the focused day
  // (the month buttons change `focus` too but keep DOM focus where it is).
  const moveFocus = useRef(true);
  useEffect(() => {
    if (!open || !moveFocus.current) return;
    refs.floating.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus();
  }, [open, focus, refs.floating]);
  const shiftMonth = (n: number) => { moveFocus.current = false; setFocus(clamp(addMonths(focus, n))); };

  const pick = (d: string) => {
    if ((min && d < min) || (max && d > max)) return;
    if (value === undefined) setInner(d);
    onChange?.({ target: { value: d, name } });
    close();
  };

  const view = parse(focus || current || "2000-01-01");
  const vy = view.getUTCFullYear(), vm = view.getUTCMonth();
  const first = new Date(Date.UTC(vy, vm, 1)).getUTCDay();
  const days = new Date(Date.UTC(vy, vm + 1, 0)).getUTCDate();
  const weeks: (number | null)[][] = [];
  const flat = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (flat.length % 7) flat.push(null);
  for (let i = 0; i < flat.length; i += 7) weeks.push(flat.slice(i, i + 7));

  const onGridKey = (e: React.KeyboardEvent) => {
    const wd = parse(focus).getUTCDay();
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      Home: () => addDays(focus, -wd),
      End: () => addDays(focus, 6 - wd),
    };
    if (moves[e.key]) { e.preventDefault(); moveFocus.current = true; setFocus(clamp(moves[e.key]())); }
  };

  const onDialogKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "Tab") {
      // Keep focus inside the popover (it's portaled to <body>, so Tab would otherwise escape).
      const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"])'));
      if (!els.length) return;
      const i = els.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i === els.length - 1 ? 0 : i + 1);
      e.preventDefault();
      els[next].focus();
    }
  };

  return (
    <>
      <button
        ref={(el) => { btn.current = el; refs.setReference(el); }}
        type="button"
        aria-label={ariaLabel ? `${ariaLabel}${current ? `: ${longFmt.format(parse(current))}` : ""}` : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openAt())}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) { e.preventDefault(); close(); }
          else if (e.key === "ArrowDown" && !open) { e.preventDefault(); openAt(); }
        }}
        className={cn("inline-flex h-9 w-full items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-left text-sm hover:border-ink-2/40", open && "border-ink-2", className)}
      >
        <CalendarDays className="size-4 shrink-0 text-muted" strokeWidth={1.75} />
        <span className={cn("truncate", !current && "text-muted")}>{current ? fmt.format(parse(current)) : "Pick a date"}</span>
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      {open && createPortal(
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="z-[60] w-72 rounded-xl border border-border bg-surface p-3 shadow-xl"
          onKeyDown={onDialogKey}
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="Previous month"><ChevronLeft className="size-4" /></button>
            <div id={titleId} className="text-sm font-medium" aria-live="polite">{monthFmt.format(new Date(Date.UTC(vy, vm, 1)))}</div>
            <button type="button" onClick={() => shiftMonth(1)} className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="Next month"><ChevronRight className="size-4" /></button>
          </div>
          <table role="grid" aria-labelledby={titleId} className="w-full border-separate border-spacing-0.5" onKeyDown={onGridKey}>
            <thead>
              <tr>{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <th key={d} scope="col" abbr={d} className="py-1 text-[11px] font-normal text-muted">{d[0]}</th>)}</tr>
            </thead>
            <tbody>
              {weeks.map((w, wi) => (
                <tr key={wi}>
                  {w.map((d, di) => {
                    if (!d) return <td key={di} />;
                    const v = iso(vy, vm, d);
                    const disabled = !!((min && v < min) || (max && v > max));
                    return (
                      <td key={di} className="p-0">
                        <button
                          type="button"
                          data-date={v}
                          tabIndex={v === focus ? 0 : -1}
                          aria-disabled={disabled || undefined}
                          aria-pressed={v === current}
                          aria-current={v === today ? "date" : undefined}
                          aria-label={longFmt.format(parse(v))}
                          onClick={() => pick(v)}
                          className={cn(
                            "num h-9 w-full rounded-lg text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                            v === current ? "bg-primary text-primary-ink" : "hover:bg-surface-2",
                            v === today && v !== current && "font-semibold underline decoration-2 underline-offset-4",
                            disabled && "cursor-default opacity-30 hover:bg-transparent",
                          )}
                        >
                          {d}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex justify-between border-t border-border pt-2">
            <button type="button" onClick={() => pick(today)} disabled={!!((min && today < min) || (max && today > max))} className="h-8 rounded-md px-2 text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-40">Today</button>
            <button type="button" onClick={() => close()} className="h-8 rounded-md px-2 text-xs text-muted hover:bg-surface-2">Close</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
