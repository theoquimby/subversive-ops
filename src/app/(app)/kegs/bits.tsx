import { Badge, cx } from "@/components/ui";
import { beerColor, kegSizeInfo, STATUS_META, type KegStatus } from "@/domain/kegs";

/** Small swatch in the beer's board color. */
export function BeerDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cx("inline-block size-3 shrink-0 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/15", className)} style={{ background: beerColor(color).bg }} />;
}

export function StatusBadge({ status }: { status: KegStatus }) {
  const m = STATUS_META[status];
  return <Badge tone={m.tone}>{m.short}</Badge>;
}

export const sizeShort = (id: string) => kegSizeInfo(id).short;

/** A keg-shaped fill gauge: how much is left, in the beer's color. */
export function KegGauge({ pct, color, className, label }: { pct: number | null; color: string; className?: string; label?: string }) {
  const p = pct == null ? 0 : Math.max(0, Math.min(1, pct));
  const c = beerColor(color);
  return (
    <div className={cx("relative h-11 w-8 shrink-0 overflow-hidden rounded-[0.55rem] border border-border-strong bg-surface-2", className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} aria-label={label ?? "Left in the keg"}>
      <div className="absolute inset-x-0 bottom-0 transition-[height] duration-260 ease-motion" style={{ height: `${p * 100}%`, background: c.bg }} />
      {/* Keg ribs */}
      <div className="absolute inset-x-0 top-[30%] h-px bg-black/10 dark:bg-white/10" />
      <div className="absolute inset-x-0 top-[70%] h-px bg-black/10 dark:bg-white/10" />
    </div>
  );
}

/** Horizontal gauge for tap rows. */
export function LeftBar({ pct, color }: { pct: number | null; color: string }) {
  const p = pct == null ? 0 : Math.max(0, Math.min(1, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div className="h-full rounded-full transition-[width] duration-260 ease-motion" style={{ width: `${Math.max(p * 100, p > 0 ? 3 : 0)}%`, background: beerColor(color).bg }} />
    </div>
  );
}

export function pctText(p: number | null | undefined) {
  if (p == null) return "—";
  if (p <= 0.02) return "Nearly out";
  return `~${Math.round(p * 20) * 5}% left`;
}

export function daysText(d: number | null | undefined) {
  if (d == null) return null;
  if (d < 1) return "out today";
  const n = Math.round(d);
  return `~${n} day${n === 1 ? "" : "s"} left`;
}
