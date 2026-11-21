"use client";

import { Button, cx, DatePicker } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { weekStartOf } from "@/domain/schedule";
import { shortDate } from "@/lib/format";
import { CopyPlus, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { copyWeek, previewWeekCopy } from "./actions";

const range = (monday: string) => `${shortDate(monday)} – ${shortDate(addDays(monday, 6))}`;

/**
 * Copy another week's shifts onto this one. Last week is picked to start;
 * the count is shown before anything is written, and shifts the week already
 * has are skipped.
 */
export function CopyWeekPanel({ monday, onClose, onDone }: { monday: string; onClose: () => void; onDone: (created: number, ids: string[], from: string, skipped: number) => void }) {
  const [from, setFrom] = useState(addDays(monday, -7));
  const [preview, setPreview] = useState<{ create: number; skipped: number; total: number } | { error: string } | null>(null);
  const [copying, start] = useTransition();
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    setPreview(null);
    previewWeekCopy(from, monday).then((r) => {
      if (id !== req.current) return;
      setPreview(r.error ? { error: r.error } : { create: r.create ?? 0, skipped: r.skipped ?? 0, total: r.total ?? 0 });
    });
  }, [from, monday]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const picks = [1, 2, 3, 4].map((n) => ({ week: addDays(monday, -7 * n), label: n === 1 ? "Last week" : `${n} weeks ago` }));
  const n = preview && "create" in preview ? preview.create : 0;
  const copy = () =>
    start(async () => {
      const r = await copyWeek(from, monday);
      if (r.error) setPreview({ error: r.error });
      else {
        onDone(r.created ?? 0, r.ids ?? [], from, r.skipped ?? 0);
        onClose();
      }
    });

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/30 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Copy a week" onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-2xl border border-border bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold"><CopyPlus className="size-4" strokeWidth={1.75} /> Copy a week</div>
            <p className="mt-1 text-sm text-muted">Into {range(monday)}, as drafts. Shifts this week already has are skipped.</p>
          </div>
          <button onClick={onClose} className="-m-1 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close"><X className="size-4" /></button>
        </div>

        <div className="mt-4 text-[0.8rem] font-medium text-ink-2">Copy from</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {picks.map((p) => (
            <button
              key={p.week}
              type="button"
              aria-pressed={from === p.week}
              onClick={() => setFrom(p.week)}
              className={cx("h-10 rounded-full border px-3.5 text-sm sm:h-8", from === p.week ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2 hover:bg-surface-2")}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-sm text-muted">
          <span className="shrink-0">or the week of</span>
          <DatePicker aria-label="Week to copy from" value={from} onChange={(e) => e.target.value && setFrom(weekStartOf(e.target.value))} />
        </div>

        <div className="mt-4 min-h-12 rounded-lg bg-surface-2/60 px-3 py-2.5 text-sm" aria-live="polite">
          {!preview ? (
            <span className="text-muted">Counting {range(from)}…</span>
          ) : "error" in preview ? (
            <span className="text-bad">{preview.error}</span>
          ) : preview.total === 0 ? (
            <span className="text-muted">{range(from)} has no shifts to copy.</span>
          ) : (
            <>
              <span className="num font-medium">{preview.create} shift{preview.create === 1 ? "" : "s"}</span> from {range(from)} will be added.
              {preview.skipped > 0 && <span className="block text-xs text-muted">{preview.skipped} already here {preview.skipped === 1 ? "is" : "are"} skipped.</span>}
            </>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" className="max-sm:h-11" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="max-sm:h-11" pending={copying} disabled={!n} onClick={copy}>
            {n ? `Copy ${n} shift${n === 1 ? "" : "s"}` : "Nothing to copy"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
