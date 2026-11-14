"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { useReducedMotion } from "@/components/motion";
import { money } from "@/lib/format";
import "./lab.css";

/**
 * The Lab's chart kit: measuring, the tooltip, count-ups, the money-with-range
 * bar every card uses, dot strips and the hidden table every chart carries for
 * screen readers. Marks follow the dataviz rules: 2px lines, ≤24px bars with a
 * 4px rounded data end, hairline solid grid, text in text tokens.
 */

export const whole = (n: number) => money(n, { whole: true });
export const signedMoney = (n: number) => `${n >= 0 ? "+" : "−"}${whole(Math.abs(n))}`;
export const signedPct = (x: number, digits = 0) => {
  const v = Number((x * 100).toFixed(digits));
  return v === 0 ? "0%" : `${v > 0 ? "+" : "−"}${Math.abs(v)}%`;
};
/** Compact money for axis ticks: $800, $1.2k, $12k. */
export const tickMoney = (n: number) => (Math.abs(n) >= 10000 ? `$${Math.round(n / 1000)}k` : Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${Math.round(n)}`);

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Width of a container, kept current with a ResizeObserver. */
export function useWidth(fallback = 320, min = 200) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.max(min, Math.round(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return { ref, w };
}

/** Clean axis ticks: 0, 500, 1,000… */
export function niceTicks(lo: number, hi: number, count = 3) {
  const span = Math.max(1e-9, hi - lo);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/**
 * The tooltip: value first (strong), label after. Positioned inside the chart's
 * relative box, kept on screen. Hover on desktop, tap on phones (the mark's
 * own onClick sets it), focus for keyboards.
 */
export function Tip({ x, y, w, children, below }: { x: number; y: number; w: number; children: ReactNode; below?: boolean }) {
  const half = 84;
  const left = Math.min(Math.max(x, half), Math.max(half, w - half));
  return (
    <div
      role="status"
      className={cx("pointer-events-none absolute z-20 max-w-[15rem] -translate-x-1/2 rounded-lg border border-border bg-surface/95 px-2.5 py-1.5 text-xs shadow-[0_6px_24px_-8px_rgb(0_0_0/0.25)] backdrop-blur-sm", below ? "translate-y-3" : "-translate-y-full")}
      style={{ left, top: below ? y : Math.max(0, y - 10) }}
    >
      {children}
    </div>
  );
}

export function TipValue({ children }: { children: ReactNode }) {
  return <div className="num text-[0.8rem] font-semibold whitespace-nowrap text-ink">{children}</div>;
}
export function TipLabel({ children }: { children: ReactNode }) {
  return <div className="text-[0.72rem] leading-snug text-muted">{children}</div>;
}

/** A visually hidden table with every value a chart shows — the chart's screen-reader twin. */
export function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="sr-only">
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

/** A number that counts up to its value the first time it's shown (instant with reduced motion). */
export function CountUp({ value, format = whole, duration = 700, className }: { value: number; format?: (n: number) => string; duration?: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const [running, setRunning] = useState(false);
  const from = useRef<number | null>(null);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const start = from.current ?? value * 0.55;
    from.current = value;
    if (start === value) return;
    let raf = 0;
    const t0 = performance.now();
    setRunning(true);
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - (1 - k) ** 3;
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else setRunning(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);
  // Equal-width digits only while counting, so the line doesn't wobble; proportional at rest.
  return <span className={cx(running && "tabular-nums", className)}>{format(shown)}</span>;
}

/**
 * Money impact, the same everywhere: the monthly figure's likely range as a
 * soft band on a track from $0, the best guess as a dot. `scale` lets a list
 * of them share one axis.
 */
export function ImpactRange({ mid, low, high, scale, size = "md", label = true, className }: { mid: number; low: number; high: number; scale?: number; size?: "sm" | "md"; label?: boolean; className?: string }) {
  const lo = Math.max(0, Math.min(low, mid));
  const hi = Math.max(high, mid);
  const max = Math.max(1, scale ?? hi * 1.15);
  const x = (v: number) => `${Math.min(100, (Math.max(0, v) / max) * 100)}%`;
  const ranged = hi > lo * 1.08 && hi - lo >= 5;
  return (
    <div className={cx("min-w-0", className)} role="img" aria-label={ranged ? `About ${whole(mid)} a month, likely ${whole(lo)} to ${whole(hi)}` : `About ${whole(mid)} a month`}>
      <div className={cx("relative rounded-full bg-[var(--lab-context-2)]", size === "sm" ? "h-1.5" : "h-2")}>
        {ranged && <div className="lab-grow-x absolute inset-y-0 rounded-full bg-[var(--lab-accent-2)]" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />}
        <div className="lab-grow-x absolute inset-y-0 left-0 rounded-full bg-[var(--lab-accent)]" style={{ width: x(mid), opacity: ranged ? 0 : 1 }} />
        <div className={cx("lab-pop absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-[var(--lab-accent)]", size === "sm" ? "size-2.5" : "size-3.5")} style={{ left: x(mid), animationDelay: "200ms" }} />
      </div>
      {label && size === "md" && ranged && (
        <div className="num mt-1.5 flex justify-between text-[11px] text-muted">
          <span>Likely {whole(lo)}</span>
          <span>to {whole(hi)}</span>
        </div>
      )}
    </div>
  );
}

/** Certainty as a 5-step meter (same ramp, filled steps darker) with the words beside it. */
export function SureMeter({ confidence, word }: { confidence: number; word: string }) {
  const steps = Math.max(1, Math.min(5, Math.round(confidence * 5 + 0.4)));
  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label={`${word}: ${steps} of 5`}>
      <span className="inline-flex gap-[3px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cx("h-2.5 w-1.5 rounded-[2px]", i <= steps ? "bg-ink" : "bg-[var(--lab-context-2)]")} />
        ))}
      </span>
      <span className="text-[0.8rem] text-ink-2">{word}</span>
    </span>
  );
}

/**
 * A strip of dots, one per day/week, split into named groups (each its own
 * look, so it never depends on colour alone), with a count beside each name.
 */
export type DotGroup = { n: number; label: string; look: "accent" | "hot" | "ring" | "context" | "check" };
export function DotStrip({ groups, caption, size = 11 }: { groups: DotGroup[]; caption?: string; size?: number }) {
  const all = groups.flatMap((g, gi) => Array.from({ length: Math.max(0, Math.round(g.n)) }, (_, i) => ({ g, gi, i })));
  return (
    <figure className="min-w-0" aria-label={caption ?? groups.map((g) => `${g.n} ${g.label}`).join(", ")} role="img">
      <div className="flex flex-wrap gap-[5px]" aria-hidden>
        {all.map((d, k) => (
          <Dot key={k} look={d.g.look} size={size} delay={k * 18} />
        ))}
      </div>
      <figcaption className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-hidden>
        {groups.filter((g) => g.n > 0).map((g) => (
          <span key={g.label} className="inline-flex items-center gap-1.5">
            <Dot look={g.look} size={9} />
            <span className="num font-semibold text-ink">{g.n}</span> {g.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function Dot({ look, size, delay }: { look: DotGroup["look"]; size: number; delay?: number }) {
  const base = "lab-pop inline-block shrink-0 rounded-full";
  const style = { width: size, height: size, animationDelay: delay != null ? `${Math.min(delay, 700)}ms` : undefined };
  if (look === "ring") return <span className={cx(base, "border-2 border-[var(--lab-accent)]")} style={style} />;
  if (look === "check") return <span className={cx(base, "relative bg-[var(--lab-context)]")} style={style}><span className="absolute inset-[30%] rounded-full bg-surface" /></span>;
  const bg = look === "accent" ? "bg-[var(--lab-accent)]" : look === "hot" ? "bg-[var(--lab-hot)]" : "bg-[var(--lab-context)]";
  return <span className={cx(base, bg)} style={style} />;
}

/** Small label + big number tile, used for key figures in the evidence. */
export function Figure({ label, value, note, tone }: { label: ReactNode; value: ReactNode; note?: ReactNode; tone?: "good" | "bad" | null }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2/70 px-3.5 py-3">
      <div className="text-[0.72rem] leading-snug text-muted">{label}</div>
      <div className={cx("mt-1 text-[1.15rem] leading-tight font-semibold tracking-tight", tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-ink")}>{value}</div>
      {note && <div className="mt-0.5 text-[0.72rem] leading-snug text-muted">{note}</div>}
    </div>
  );
}

/** A chart caption line under a graphic: the takeaway in plain words. */
export function Takeaway({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[0.82rem] leading-relaxed text-ink-2">{children}</p>;
}

/** Inline key: a short line or a swatch, then the name (legends mirror the mark). */
export function Key({ look, children }: { look: "accent" | "hot" | "context" | "wash" | "line" | "ring" | "context-line"; children: ReactNode }) {
  const mark =
    look === "line" ? <span className="inline-block h-[2px] w-3.5 rounded bg-[var(--lab-accent)]" /> :
    look === "context-line" ? <span className="inline-block h-[2px] w-3.5 rounded bg-[var(--lab-context)]" /> :
    look === "wash" ? <span className="inline-block h-2.5 w-3.5 rounded-[3px] bg-[var(--lab-accent-wash)] ring-1 ring-[var(--lab-accent-2)] ring-inset" /> :
    look === "ring" ? <span className="inline-block size-2.5 rounded-full border-2 border-[var(--lab-accent)]" /> :
    <span className={cx("inline-block size-2.5 rounded-[3px]", look === "accent" ? "bg-[var(--lab-accent)]" : look === "hot" ? "bg-[var(--lab-hot)]" : "bg-[var(--lab-context)]")} />;
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-ink-2">
      {mark}
      {children}
    </span>
  );
}

/** Hover/tap state for a set of marks, cleared when the pointer leaves the chart. */
export function useActive<T = number>() {
  const [active, setActive] = useState<T | null>(null);
  const bind = (v: T) => ({
    onMouseEnter: () => setActive(v),
    onFocus: () => setActive(v),
    onClick: () => setActive((cur) => (cur === v ? null : v)),
    onBlur: () => setActive(null),
  });
  return { active, setActive, bind };
}
