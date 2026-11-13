"use client";

import { cx } from "@/components/ui";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Bottom sheet on phones, side panel from sm up (same shape as the Team notes sheet). */
export function Sheet({ title, subtitle, onClose, children, label }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let open menus and date pickers handle their own Escape first.
      if (e.key === "Escape" && !e.defaultPrevented) close.current();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 animate-fade-in bg-black/25" onMouseDown={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className={cx(
          "absolute flex flex-col overflow-hidden border-border bg-surface shadow-2xl outline-none",
          "inset-x-0 bottom-0 max-h-[90dvh] animate-sheet-in rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]",
          "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[30rem] sm:animate-fade-in sm:rounded-none sm:border-t-0 sm:border-l",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong sm:hidden" />
        <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{title}</div>
            {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink sm:size-8" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
