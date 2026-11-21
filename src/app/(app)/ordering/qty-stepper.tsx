"use client";

import { cx } from "@/components/ui";
import { parseQty, stepQty } from "@/domain/purchasing";
import { useEffect, useState } from "react";

const show = (n: number) => String(Number(n.toFixed(2)));

/**
 * − quantity +, for ordering and receiving. Big targets on a phone (44px),
 * the number box takes part packs ("1.5", "1 1/2") and selects on tap, and
 * Enter moves to the next quantity on the page. `onChange` fires for every
 * valid value (typed or stepped); `onCommit` when a value is settled (a step,
 * or leaving the box), which is when to save.
 */
export function QtyStepper({ value, onChange, onCommit, label, changed, invalidText = "Type a number, like 2 or 1.5", className }: {
  value: number;
  onChange: (n: number) => void;
  onCommit?: (n: number) => void;
  /** What the number is, for screen readers ("Lettuce quantity"). */
  label: string;
  /** Different from what was suggested or ordered: shown bold. */
  changed?: boolean;
  invalidText?: string;
  className?: string;
}) {
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(show(value)); }, [value, focused]);
  const bad = parseQty(text) == null;
  const step = (dir: 1 | -1) => {
    const n = stepQty(value, dir);
    setText(show(n));
    onChange(n);
    onCommit?.(n);
  };
  const btn = "grid h-11 w-11 shrink-0 place-items-center text-lg text-ink-2 transition-colors duration-120 hover:bg-surface-2 active:bg-surface-2 disabled:opacity-40 sm:h-9 sm:w-9 sm:text-base";
  return (
    <div className={cx("inline-flex items-center overflow-hidden rounded-lg border bg-surface", bad ? "border-bad" : "border-border-strong", className)}>
      <button type="button" className={btn} onClick={() => step(-1)} disabled={value <= 0} aria-label={`Less ${label}`}>−</button>
      <input
        inputMode="decimal"
        enterKeyHint="next"
        autoComplete="off"
        value={text}
        data-qty-input
        aria-label={label}
        aria-invalid={bad || undefined}
        title={bad ? invalidText : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseQty(e.target.value);
          if (n != null) onChange(n);
        }}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onBlur={() => {
          setFocused(false);
          const n = parseQty(text);
          setText(show(n ?? value));
          onCommit?.(n ?? value);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-qty-input]"));
          const next = all[all.indexOf(e.currentTarget) + 1];
          if (next) { next.focus(); next.scrollIntoView({ block: "center", behavior: "smooth" }); } else e.currentTarget.blur();
        }}
        className={cx("num h-11 w-14 border-x border-border bg-transparent text-center text-base focus:bg-surface-2/60 focus:outline-none sm:h-9 sm:w-12 sm:text-sm", changed && "font-semibold", bad && "text-bad")}
      />
      <button type="button" className={btn} onClick={() => step(1)} aria-label={`More ${label}`}>+</button>
    </div>
  );
}
