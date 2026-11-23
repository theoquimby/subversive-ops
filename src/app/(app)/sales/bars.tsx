import { cx } from "@/components/ui";
import type { ReactNode } from "react";

/*
 * Labelled horizontal bars, drawn in plain HTML so they render on the server and
 * read without hovering: a label, the bar, and its value printed beside it. Used
 * on the scorecard, Menu costs, Margin gap and count results. Colour comes in as
 * a CSS value (a money token, usually); the marked row is the one the story is
 * about. Bars can cross zero (a gap either way), and a row can carry a tick for
 * its own target.
 */

export interface Bar {
  key: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Null: not known yet. Drawn as a dashed outline, never as zero. */
  value: number | null;
  /** The value as printed beside the bar. */
  display: ReactNode;
  color?: string;
  mark?: boolean;
  /** A tick across this row's bar (its own target, say). */
  tick?: number | null;
}

export function Bars({ rows, ariaLabel, color = "var(--money-forecast)", max, tickLabel, className }: {
  rows: Bar[];
  ariaLabel: string;
  color?: string;
  /** The value a full bar stands for; defaults to the biggest (ticks included). */
  max?: number;
  /** What the ticks mean, for the key under the bars. */
  tickLabel?: string;
  className?: string;
}) {
  const vals = rows.flatMap((r) => [r.value ?? 0, r.tick ?? 0]);
  const hi = Math.max(max ?? 0, ...vals, 1e-9);
  const lo = Math.min(0, ...vals);
  const span = hi - lo;
  const zero = (-lo / span) * 100;
  const at = (v: number) => ((v - lo) / span) * 100;
  const anyTick = rows.some((r) => r.tick != null);
  return (
    <div className={className}>
      <ul aria-label={ariaLabel} className="space-y-1.5">
        {rows.map((r) => {
          const v = r.value;
          const left = v == null ? zero : Math.min(at(v), zero);
          const width = v == null ? 0 : Math.abs(at(v) - zero);
          return (
            <li key={r.key} className={cx("flex min-h-8 items-center gap-3 rounded-md text-sm", r.mark && "-mx-2 bg-surface-2 px-2")}>
              <div className="w-28 shrink-0 sm:w-44">
                <div className={cx("line-clamp-2 break-words leading-snug", r.mark ? "font-medium text-ink" : "text-ink-2")}>{r.label}</div>
                {r.hint && <div className="truncate text-xs text-muted">{r.hint}</div>}
              </div>
              <div className="relative h-3.5 min-w-0 flex-1" aria-hidden>
                {lo < 0 && <span className="absolute inset-y-[-3px] w-px bg-border-strong" style={{ left: `${zero}%` }} />}
                {v == null ? (
                  <span className="absolute inset-y-0 w-1/3 rounded-[3px] border border-dashed border-border-strong" style={{ left: `${zero}%` }} />
                ) : (
                  <span className="absolute inset-y-0 rounded-[3px]" style={{ left: `${left}%`, width: `max(${width}%, ${v === 0 ? 0 : 2}px)`, background: r.color ?? color }} />
                )}
                {r.tick != null && <span className="absolute inset-y-[-4px] w-0.5 rounded-full bg-ink" style={{ left: `calc(${at(r.tick)}% - 1px)` }} />}
              </div>
              <div className={cx("num w-20 shrink-0 text-right", r.mark ? "font-semibold text-ink" : "text-ink-2", v == null && "text-muted")}>{r.display}</div>
            </li>
          );
        })}
      </ul>
      {anyTick && tickLabel && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden className="inline-block h-3 w-0.5 rounded-full bg-ink" /> {tickLabel}
        </p>
      )}
    </div>
  );
}
