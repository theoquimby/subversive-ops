"use client";

/**
 * Spreadsheet-style editable cells.
 *
 *  - Click and type; the value saves on blur / Enter (no Save buttons).
 *  - A rejected value stays in the cell with the reason underneath, so it can
 *    be corrected (Esc puts back the last saved value).
 *  - Enter / ↓ moves to the same column in the next row, ↑ the row above,
 *    Tab / Shift+Tab across (native). Esc reverts.
 *  - Pasting several lines (e.g. a column copied from Excel / Google Sheets)
 *    fills this cell and the ones below it, saving each.
 *
 * Cells find each other through data attributes, so any table can opt in by
 * giving its cells the same `grid` name and a `col` name.
 */

import { cn } from "@/lib/cn";
import { Check } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { Select } from "./select";
import { prefersReducedMotion } from "./motion";

/** Saved: a brief green wash that fades out. Rejected: one small shake. Transform/background only. */
function flash(el: HTMLElement | null, kind: "saved" | "error") {
  if (!el || prefersReducedMotion()) return;
  if (kind === "saved") el.animate([{ backgroundColor: "color-mix(in oklab, var(--good) 16%, transparent)" }, { backgroundColor: "transparent" }], { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" });
  else el.animate([{ transform: "none" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(-2px)" }, { transform: "translateX(1px)" }, { transform: "none" }], { duration: 280, easing: "cubic-bezier(.4,0,.2,1)" });
}

type SaveResult = void | { error?: string } | undefined;

interface CellProps {
  grid: string;
  col: string;
  value: string | number | null;
  onSave: (value: string) => Promise<SaveResult>;
  type?: "text" | "number";
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  align?: "left" | "right";
  className?: string;
  ariaLabel: string;
  /** Fixed decimals shown while not editing (e.g. 2 for money). */
  decimals?: number;
}

const cellsIn = (grid: string, col: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-grid="${grid}"][data-col="${col}"]`));

function move(el: HTMLInputElement, delta: number) {
  const cells = cellsIn(el.dataset.grid!, el.dataset.col!);
  const next = cells[cells.indexOf(el) + delta];
  if (next) {
    next.focus();
    next.select();
  }
}

export function GridCell({ grid, col, value, onSave, type = "text", prefix, suffix, placeholder, align = type === "number" ? "right" : "left", className, ariaLabel, decimals }: CellProps) {
  const initial = value == null ? "" : String(value);
  const [v, setV] = useState(initial);
  const [focused, setFocused] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const committed = useRef(initial);
  const saving = useRef(false);
  const selectOnFocus = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  const errId = useId();

  // Server data changed (e.g. after another save revalidated the page). Never
  // clobber a value being typed, saved, or waiting to be corrected.
  useEffect(() => {
    if (!focused && !saving.current && !error) {
      setV(initial);
      committed.current = initial;
    }
  }, [initial, focused, error]);

  // Focusing can swap the formatted value ("6.50") for the raw one ("6.5"),
  // which resets the selection; re-select in the same commit, before any key.
  useLayoutEffect(() => {
    if (focused && selectOnFocus.current) {
      selectOnFocus.current = false;
      ref.current?.select();
    }
  }, [focused]);

  const commit = (next: string) => {
    if (next === committed.current && !error) return;
    if (next === committed.current) { setError(null); setState("idle"); return; }
    const prev = committed.current;
    committed.current = next;
    saving.current = true;
    start(async () => {
      const res = await onSave(next);
      saving.current = false;
      if (res && res.error) {
        committed.current = prev;
        setError(res.error);
        setState("error");
        flash(ref.current, "error");
        // Keep the rejected text for correction; bring focus back unless the user is already elsewhere.
        const el = ref.current;
        if (el && (document.activeElement === document.body || document.activeElement === el)) { el.focus(); el.select(); }
      } else {
        setError(null);
        setState("saved");
        flash(ref.current, "saved");
        setTimeout(() => setState("idle"), 1200);
      }
    });
  };

  // Paste-down target: another cell in this column hands us a value.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onSet = (e: Event) => {
      const val = (e as CustomEvent<string>).detail;
      setV(val);
      commit(val);
    };
    el.addEventListener("grid:set", onSet);
    return () => el.removeEventListener("grid:set", onSet);
  });

  const shown = !focused && decimals != null && v !== "" && Number.isFinite(Number(v)) ? Number(v).toFixed(decimals) : v;

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
      {prefix && <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-sm text-muted">{prefix}</span>}
      <input
        ref={ref}
        data-grid={grid}
        data-col={col}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        value={shown}
        placeholder={placeholder}
        inputMode={type === "number" ? "decimal" : undefined}
        enterKeyHint="next"
        onChange={(e) => { selectOnFocus.current = false; setV(e.target.value); }}
        onFocus={(e) => { e.target.select(); selectOnFocus.current = true; setFocused(true); }}
        onBlur={() => { setFocused(false); commit(v.trim()); }}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); commit(v.trim()); move(el, e.shiftKey ? -1 : 1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); commit(v.trim()); move(el, -1); }
          else if (e.key === "Escape") { setV(committed.current); setError(null); setState("idle"); el.blur(); }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text/plain");
          const rows = text.replace(/\r/g, "").split("\n").filter((r, i, a) => !(i === a.length - 1 && r === ""));
          if (rows.length < 2) return;
          e.preventDefault();
          const cells = cellsIn(grid, col);
          const start = cells.indexOf(e.currentTarget);
          rows.forEach((row, i) => {
            const cell = cells[start + i];
            const val = row.split("\t")[0].trim().replace(/^\$/, "");
            cell?.dispatchEvent(new CustomEvent("grid:set", { detail: val }));
          });
        }}
        className={cn(
          "h-10 w-full rounded-md border border-transparent bg-transparent text-base text-ink transition-[border-color,background-color] duration-120 ease-motion sm:h-8 sm:text-sm",
          "hover:border-border focus:border-ink-2 focus:bg-surface focus:outline-none",
          type === "number" && "num",
          align === "right" ? "text-right" : "text-left",
          prefix ? "pl-5" : "pl-2",
          suffix ? "pr-7" : "pr-2",
          state === "error" && "border-bad hover:border-bad",
        )}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
      {state === "saved" && <span className="pointer-events-none absolute top-1/2 -right-4 -translate-y-1/2"><Check className="size-3 animate-pop text-good" strokeWidth={3} /></span>}
      </div>
      <div id={errId} aria-live="polite" className={cn("text-left text-xs leading-snug font-normal text-bad", error ? "mt-0.5 animate-fade-in px-2" : "sr-only")}>{error}</div>
    </div>
  );
}

/** A select that saves the moment it changes. */
export function GridSelect({ value, options, onSave, ariaLabel, className }: { value: string; options: { value: string; label: string; group?: string }[]; onSave: (v: string) => Promise<SaveResult>; ariaLabel: string; className?: string }) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setV(value), [value]);
  return (
    <>
    <Select
      variant="cell"
      aria-label={ariaLabel}
      value={v}
      options={options}
      disabled={pending}
      className={cn(pending && "opacity-60", className)}
      onChange={(e) => {
        const next = e.target.value;
        const prev = v;
        setV(next);
        start(async () => {
          const res = await onSave(next);
          if (res && res.error) { setV(prev); setError(res.error); } else setError(null);
        });
      }}
    />
    <div aria-live="polite" className={error ? "mt-0.5 animate-fade-in px-2 text-xs text-bad" : "sr-only"}>{error}</div>
    </>
  );
}
