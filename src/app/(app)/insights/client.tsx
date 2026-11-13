"use client";

import { useMemo, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronDown, Check, Clock, RefreshCw, ThumbsDown, Undo2 } from "lucide-react";
import { GridCell } from "@/components/grid";
import { Button, cx, Select } from "@/components/ui";
import { breakEven, priceWhatIf, type InputRow, type PriceFit } from "@/domain/analytics";
import { money } from "@/lib/format";
import { markInsight, refreshInsights, saveFixedCost } from "./actions";

const whole = (n: number) => money(n, { whole: true });
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${whole(Math.abs(n))}`;

// ---- "How we worked this out" ----------------------------------------------------------

export function HowWeKnow({ how, inputs, label = "How we worked this out", actions }: { how: string[]; inputs?: InputRow[]; label?: string; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!how.length && !inputs?.length) return actions ? <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t border-border pt-2">{actions}</div> : null;
  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cx("flex h-10 items-center gap-1.5 text-left text-[0.8rem] font-medium text-ink-2 hover:text-ink sm:h-8", !actions && "w-full justify-between")}>
          {label}
          <ChevronDown className={cx("size-4 transition-transform duration-180", open && "rotate-180")} strokeWidth={1.75} />
        </button>
        {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
      </div>
      {open && (
        <div className="animate-fade-in pb-1 text-[0.8rem] leading-relaxed text-ink-2">
          {how.map((h, i) => (
            <p key={i} className="mb-2">{h}</p>
          ))}
          {!!inputs?.length && (
            <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-xs">
              {inputs.map((r, i) => (
                <div key={i} className="contents">
                  <dt className="truncate text-muted">{r.label}</dt>
                  <dd className="num text-right text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Feed verdicts ----------------------------------------------------------------------

export interface FeedRowItem {
  key: string;
  kind: string;
  title: string;
  action: string;
  subject?: string | null;
  monthly: number;
  low: number;
  high: number;
  oneOff?: number;
  confidence: number;
  isNew: boolean;
  href: string;
  how: string[];
  inputs: InputRow[];
}

const confWord = (c: number) => (c >= 0.65 ? "Solid" : c >= 0.4 ? "Fair" : "Rough");

export function FeedList({ items, numbered, compact }: { items: FeedRowItem[]; numbered?: boolean; compact?: boolean }) {
  const [gone, setGone] = useState<Record<string, string>>({});
  const [, start] = useTransition();
  const act = (it: FeedRowItem, verdict: "done" | "dismissed" | "snoozed" | "undo") => {
    setGone((g) => {
      const n = { ...g };
      if (verdict === "undo") delete n[it.key];
      else n[it.key] = verdict;
      return n;
    });
    start(async () => {
      await markInsight({ key: it.key, kind: it.kind, title: it.title, subject: it.subject ?? null, monthly: it.monthly }, verdict);
    });
  };
  return (
    <ol className="flex flex-col gap-2">
      {items.map((it, i) => {
        const g = gone[it.key];
        if (g)
          return (
            <li key={it.key} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-2 text-sm text-muted">
              <span className="truncate">{g === "done" ? "Marked done — we'll track what it changed." : g === "snoozed" ? "Snoozed for 2 weeks." : "Hidden. We'll show fewer like this."}</span>
              <Button size="sm" variant="ghost" onClick={() => act(it, "undo")}><Undo2 className="size-3.5" strokeWidth={1.75} />Undo</Button>
            </li>
          );
        const range = it.high > it.low + 1 ? `${whole(it.low)}–${whole(it.high)}` : null;
        return (
          <li key={it.key} className="rounded-xl border border-border bg-surface px-4 py-3">
            <div className="flex items-start gap-3">
              {numbered && <span className="num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2">{i + 1}</span>}
              <div className="min-w-0 flex-1">
                <div className="text-[0.95rem] font-medium text-ink">{it.title}</div>
                <div className="mt-0.5 text-sm text-ink-2">{it.action}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {it.oneOff ? <span className="num">{whole(it.oneOff)} one-off</span> : <span className="num font-medium text-ink">{whole(it.monthly)}/month</span>}
                  {range && !it.oneOff && <span className="num">likely {range}</span>}
                  <span>{confWord(it.confidence)} confidence</span>
                  {it.isNew && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-2">New</span>}
                </div>
              </div>
            </div>
            <HowWeKnow
              how={compact ? [] : it.how}
              inputs={compact ? [] : it.inputs}
              actions={
                <>
                  <Button size="sm" variant="secondary" onClick={() => act(it, "done")} className="h-10 sm:h-8"><Check className="size-3.5" strokeWidth={1.75} />Done</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(it, "snoozed")} className="h-10 sm:h-8"><Clock className="size-3.5" strokeWidth={1.75} />Later</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(it, "dismissed")} className="h-10 sm:h-8"><ThumbsDown className="size-3.5" strokeWidth={1.75} />Not useful</Button>
                </>
              }
            />
          </li>
        );
      })}
    </ol>
  );
}

// ---- Refresh ------------------------------------------------------------------------------

export function RefreshButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-muted" aria-live="polite">{msg}</span>}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await refreshInsights();
            setMsg(r.error ?? `Updated in ${r.seconds}s`);
          })
        }
      >
        <RefreshCw className={cx("size-4", pending && "animate-spin")} strokeWidth={1.75} />
        {pending ? "Working it out…" : "Refresh"}
      </Button>
    </div>
  );
}

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
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={id} onChange={(e) => setId(e.target.value)} options={options} aria-label="Menu item" className="min-w-0 flex-1 sm:max-w-60" />
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
        className="relative h-10 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border-strong" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${Math.min(zero, pos)}%`, width: `${Math.abs(pos - zero)}%` }} />
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-muted" style={{ left: `${zero}%` }} />
        <div className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink shadow" style={{ left: `${pos}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-muted"><span>−$2</span><span>today</span><span>+$3</span></div>
      <div className="mt-2 text-sm text-ink">
        <span className="num font-semibold">{signed(r.profit)}/month</span> <span className="text-muted">(likely <span className="num">{signed(r.low)} to {signed(r.high)}</span>)</span>
      </div>
      <div className="text-xs text-muted">
        About <span className="num">{Math.round(r.qty)}</span> sold a month instead of <span className="num">{Math.round(fit.qtyMonth)}</span> ({r.qtyChange >= 0 ? "+" : ""}{Math.round(r.qtyChange * 100)}%). Price response {fit.elasticity.toFixed(2)} — {fit.source === "measured" ? "measured from your own price changes" : "typical for this kind of item"}.
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
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="mb-2 text-xs font-medium text-ink-2">Fixed costs a month</div>
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
