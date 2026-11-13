"use client";

import { cx } from "@/components/ui";
import { Check } from "lucide-react";

/** A large, app-styled checkbox (role=checkbox, no native control). */
export function TickBox({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.preventDefault(); onChange(!checked); }}
      className={cx(
        "relative grid size-6 shrink-0 place-items-center rounded-md border transition-[background-color,border-color,transform] duration-120 ease-motion after:absolute after:-inset-2 after:content-[''] active:scale-95 disabled:opacity-50",
        checked ? "border-good bg-good text-white" : "border-border-strong bg-surface hover:border-ink-2/50",
      )}
    >
      {checked && <Check className="size-4 animate-pop" strokeWidth={2.5} />}
    </button>
  );
}
