import { cx } from "@/components/ui";
import { shortDate } from "@/lib/format";

/** The strip runs from this far below ordinary to this far above (nights past it sit at the edge). */
const SPAN = 0.8;
const pos = (lift: number) => `${(((Math.max(-SPAN, Math.min(SPAN, lift)) + SPAN) / (2 * SPAN)) * 100).toFixed(2)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`;

/**
 * One series' nights as dots against an ordinary night: the shaded band is how
 * far an ordinary night swings on its own, the line in the middle is ordinary,
 * and the bar is the nights together. Dots inside the band could be chance.
 */
export function NightDots({ nights, noise, lift, label, axis = true }: { nights: { date: string; lift: number }[]; noise: number | null; lift: number | null; label: string; axis?: boolean }) {
  return (
    <div role="img" aria-label={`${label}: ${nights.length} nights against an ordinary night${lift != null ? `, together ${signed(lift)}` : ""}${noise != null ? `; an ordinary night swings about ${Math.round(noise * 100)}% either way` : ""}`}>
      <div className="relative h-7">
        {noise != null && <div aria-hidden className="absolute inset-y-1 rounded-md bg-surface-2" style={{ left: pos(-noise), right: `calc(100% - ${pos(noise)})` }} />}
        <div aria-hidden className="absolute inset-y-0 w-px bg-border-strong" style={{ left: pos(0) }} />
        {nights.map((n) => (
          <span
            key={n.date}
            title={`${shortDate(n.date)}: ${signed(n.lift)} against an ordinary night`}
            className={cx("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface", Math.abs(n.lift) > SPAN ? "bg-ink-2" : "bg-ink")}
            style={{ left: pos(n.lift) }}
          />
        ))}
        {lift != null && <div aria-hidden className="absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full bg-[var(--money-sales)]" style={{ left: pos(lift) }} />}
      </div>
      {axis && <div aria-hidden className="mt-0.5 flex justify-between text-[11px] text-muted">
        <span>Quieter</span>
        <span>Ordinary</span>
        <span>Busier</span>
      </div>}
    </div>
  );
}
