"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { GridCell } from "@/components/grid";
import { Select } from "@/components/ui";
import { breakEven, priceWhatIf, type PriceFit } from "@/domain/analytics";
import { money } from "@/lib/format";
import { saveFixedCost } from "./actions";
import { PriceCurve } from "./graphics";

const whole = (n: number) => money(n, { whole: true });
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${whole(Math.abs(n))}`;

// ---- Price slider ---------------------------------------------------------------------------

const STEP = 0.25;
const MIN = -2;
const MAX = 3;

export function PriceSlider({ fits }: { fits: PriceFit[] }) {
  const options = useMemo(() => fits.map((f) => ({ value: f.id, label: f.name })), [fits]);
  const [id, setId] = useState(fits[0]?.id ?? "");
  const [delta, setDelta] = useState(1);
  const track = useRef<HTMLDivElement>(null);
  const fit = fits.find((f) => f.id === id) ?? fits[0];
  if (!fit) return null;
  const r = priceWhatIf(fit, delta);
  const setFrom = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - b.left) / b.width));
    setDelta(Math.round((MIN + t * (MAX - MIN)) / STEP) * STEP);
  };
  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    setDelta((d) => Math.min(MAX, Math.max(MIN, d + dir * STEP)));
  };
  const pos = ((delta - MIN) / (MAX - MIN)) * 100;
  const zero = ((0 - MIN) / (MAX - MIN)) * 100;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8">
      <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={id} onChange={(e) => setId(e.target.value)} options={options} aria-label="Menu item" className="min-w-0 flex-1 sm:max-w-72" />
        <span className="num text-sm text-ink-2">${fit.price.toFixed(2)} → <b className="text-ink">${(fit.price + delta).toFixed(2)}</b></span>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Price change"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={delta}
        aria-valuetext={`${delta >= 0 ? "plus" : "minus"} $${Math.abs(delta).toFixed(2)}`}
        onKeyDown={onKey}
        onPointerDown={(e: PointerEvent) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          setFrom(e.clientX);
        }}
        onPointerMove={(e: PointerEvent) => e.buttons && setFrom(e.clientX)}
        className="relative h-11 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--lab-accent)]" style={{ left: `${Math.min(zero, pos)}%`, width: `${Math.abs(pos - zero)}%` }} />
        <div className="absolute top-1/2 h-4 w-[2px] -translate-y-1/2 rounded bg-ink-2" style={{ left: `${zero}%` }} />
        <div className="absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-strong bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_10px_-2px_rgb(0_0_0/0.18)]" style={{ left: `${pos}%` }}><span className="absolute inset-[7px] rounded-full bg-[var(--lab-accent)]" /></div>
      </div>
      <div className="flex justify-between text-[11px] text-muted"><span>−$2</span><span>today</span><span>+$3</span></div>
      <div className="mt-5 rounded-xl bg-[var(--lab-accent-wash)] px-4 py-3" aria-live="polite">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="num text-[1.5rem] font-semibold tracking-tight text-ink">{signed(r.profit)}</span>
          <span className="text-sm text-muted">a month · likely <span className="num">{signed(r.low)} to {signed(r.high)}</span></span>
        </div>
        <div className="mt-1 text-xs leading-relaxed text-ink-2">
          About <span className="num">{Math.round(r.qty)}</span> sold a month instead of <span className="num">{Math.round(fit.qtyMonth)}</span> ({r.qtyChange >= 0 ? "+" : ""}{Math.round(r.qtyChange * 100)}%). {fit.source === "measured" ? "How guests react is measured from your own price changes" : "How guests react is typical for this kind of item"}{(fit as PriceFit & { costAssumed?: boolean }).costAssumed ? "; cost is a typical figure until it's linked to a recipe" : ""}.
        </div>
      </div>
      </div>
      <div className="min-w-0">
        <PriceCurve key={fit.id} fit={fit} mark={delta} from={-2} name={fit.name} takeaway={false} compact />
      </div>
    </div>
  );
}

// ---- Fixed costs + live break-even --------------------------------------------------------

export function FixedCostsForm({ initial, be }: { initial: { rent: number | null; utilities: number | null; insurance: number | null; other: number | null }; be: { laborFixedDaily: number; laborVariable: number; cogsPct: number; wastePct: number; openDaysPerMonth: number; avgDaily: number } | null }) {
  const [vals, setVals] = useState(initial);
  const total = (vals.rent ?? 0) + (vals.utilities ?? 0) + (vals.insurance ?? 0) + (vals.other ?? 0);
  const b = be && total > 0 ? breakEven({ fixedMonthly: total, ...be }) : null;
  const field = (k: keyof typeof vals, label: string): ReactNode => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <div className="rounded-lg border border-border-strong bg-surface">
        <GridCell
          grid="fixed"
          col={k}
          type="number"
          prefix="$"
          decimals={0}
          value={vals[k]}
          ariaLabel={`${label} per month`}
          placeholder="0"
          onSave={async (raw) => {
            const r = await saveFixedCost(k, raw);
            if (!r?.error) setVals((v) => ({ ...v, [k]: raw.trim() === "" ? null : Number(raw.replace(/[$,k\s]/gi, "")) * (/k$/i.test(raw.trim()) ? 1000 : 1) }));
            return r;
          }}
        />
      </div>
    </label>
  );
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--lab-card-shadow)] sm:p-6">
      <div className="mb-3">
        <h3 className="text-[0.98rem] font-semibold tracking-tight text-ink">Fixed costs a month</h3>
        <p className="mt-0.5 text-sm text-muted">Add them once: the chain then shows profit after rent, and the sales you need each day to break even.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field("rent", "Rent")}
        {field("utilities", "Utilities")}
        {field("insurance", "Insurance")}
        {field("other", "Other")}
      </div>
      <div className="mt-2 text-sm" aria-live="polite">
        {b && be ? (
          <>
            Break-even: <span className="num font-semibold text-ink">{whole(b.daily)}</span> a day · you average <span className="num font-semibold text-ink">{whole(be.avgDaily)}</span>{" "}
            <span className={be.avgDaily >= b.daily ? "text-good" : "text-bad"}>({be.avgDaily >= b.daily ? "+" : ""}{Math.round((be.avgDaily / b.daily - 1) * 100)}%)</span>
          </>
        ) : (
          <span className="text-muted">Enter rent, utilities and insurance to see the sales you need each day to break even.</span>
        )}
      </div>
    </div>
  );
}
