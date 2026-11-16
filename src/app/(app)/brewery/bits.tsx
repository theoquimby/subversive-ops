import { Badge, cx, type Tone } from "@/components/ui";
import { beerColor } from "@/domain/kegs";
import type { BrewStatus, TankKind } from "@/domain/tankPlan";

/** Small shared pieces for the brewery pages. Plain components, no state. */

export const STATUS: Record<BrewStatus, { label: string; tone: Tone }> = {
  PLANNED: { label: "Planned", tone: "neutral" },
  FERMENTING: { label: "Fermenting", tone: "good" },
  CONDITIONING: { label: "Conditioning", tone: "good" },
  PACKAGED: { label: "Packaged", tone: "neutral" },
  DUMPED: { label: "Dumped", tone: "bad" },
};

export const KIND_LABEL: Record<TankKind, string> = { FERMENTER: "Fermenter", BRITE: "Brite tank", OTHER: "Other" };
export const KIND_PLURAL: Record<TankKind, string> = { FERMENTER: "Fermenters", BRITE: "Brite tanks", OTHER: "Other tanks" };

export function StatusBadge({ status }: { status: BrewStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** The beer's board colour; a plain grey ring when it has none. */
export function BeerDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-3 shrink-0 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/15", !color && "bg-surface-2", className)}
      style={color ? { background: beerColor(color).bg } : undefined}
    />
  );
}

export const beerFill = (color: string | null) => (color ? beerColor(color) : { bg: "var(--muted)", fg: "#fff" });

/** Day N of M as a bar; past M it fills and turns warn, then bad after `redAfter` days over. */
export function DayBar({ day, of, redAfter = 3, label }: { day: number; of: number; redAfter?: number; label?: string }) {
  const over = day - of;
  const pct = Math.max(2, Math.min(100, (day / Math.max(1, of)) * 100));
  const tone = over >= redAfter ? "bg-bad" : over >= 0 ? "bg-warn" : "bg-ink-2";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="num font-medium text-ink">{label ?? `Day ${day} of ${of}`}</span>
        {over > 0 && <span className={cx("num font-medium", over >= redAfter ? "text-bad" : "text-warn")}>{over} day{over === 1 ? "" : "s"} over</span>}
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={Math.min(day, of)} aria-label={label ?? `Day ${day} of ${of}`}>
        <div className={cx("h-full rounded-full transition-[width] duration-300 ease-motion", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export const gravityText = (g: number | null) => (g == null ? "—" : g.toFixed(3));
export const bblText = (n: number | null) => (n == null ? "—" : `${Number(n.toFixed(2))} bbl`);
export const abvText = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
