"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Minus, RotateCcw } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { whatIf, type ProfitBase } from "@/domain/lab";
import { money } from "@/lib/format";

/**
 * "How it all connects": a month of the business as a chain Max already
 * thinks in — guests → sales → what's left after food, drink and wages — with
 * three levers he can pull. Each lever's slider moves the chain live, so he
 * sees that a little more on prices and one fewer hour a day can beat "get more
 * guests". Same arithmetic as the drivers model (domain/lab whatIf).
 */

const whole = (n: number) => money(n, { whole: true });
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${whole(Math.abs(n))}`;

export interface Lever {
  key: string;
  label: string;
  monthly: number;
}

export function ProfitStory({ base, levers, costMeasured, fixedSet }: { base: ProfitBase; levers: Lever[]; costMeasured: boolean; fixedSet: boolean }) {
  const [price, setPrice] = useState(0);
  const [hours, setHours] = useState(0);
  const [guests, setGuests] = useState(0);
  const r = whatIf(base, { pricePct: price / 100, laborHoursPerDay: hours, guestsPct: guests / 100 });
  const moved = price !== 0 || hours !== 0 || guests !== 0;
  const check = base.guests > 0 ? base.sales / base.guests : 0;
  const afterCheck = r.after.guests > 0 ? r.after.sales / r.after.guests : 0;
  const maxLever = Math.max(1, ...levers.map((l) => l.monthly));
  const tryLever = (key: string) => {
    if (key === "covers" || key === "guests") setGuests(5);
    else if (key === "labor") setHours(1);
    else if (key === "price") setPrice(1);
  };
  const leftAfter = r.after.sales - r.after.cogs - r.after.labor - r.after.waste;
  const parts = [
    { key: "cogs", label: "Food & drink", v: r.after.cogs, fill: "var(--lab-context-2)", text: "var(--ink)" },
    { key: "labor", label: "Wages", v: r.after.labor, fill: "var(--lab-context)", text: "var(--ink)" },
    ...(r.after.waste > 0 ? [{ key: "waste", label: "Waste", v: r.after.waste, fill: "var(--lab-hot)", text: "#fff" }] : []),
    { key: "left", label: "Left for you", v: Math.max(0, leftAfter), fill: "var(--lab-accent)", text: "#fff" },
  ];
  const per100 = (v: number) => (r.after.sales > 0 ? (v / r.after.sales) * 100 : 0);
  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      {/* The chain */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--lab-card-shadow)] sm:p-6" data-tour="insights.flow">
        <div className="grid items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          <Node label="Guests a month" value={Math.round(r.after.guests).toLocaleString("en-US")} delta={moved ? r.after.guests - base.guests : 0} fmt={(n) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString("en-US")}`} hint={`each spends about ${money(moved ? afterCheck : check)}`} lit={guests !== 0 || price !== 0} />
          <Joint />
          <Node label="Sales" value={whole(r.after.sales)} delta={moved ? r.after.sales - base.sales : 0} fmt={signed} hint="guests × what they spend" lit={moved} />
          <Joint sign="minus" />
          <Node
            label="Food, drink & wages"
            value={whole(r.after.cogs + r.after.labor + r.after.waste)}
            delta={moved ? r.after.cogs + r.after.labor + r.after.waste - (base.cogs + base.labor + base.waste) : 0}
            fmt={signed}
            invert
            hint={`wages ${Math.round(r.after.laborPct * 100)}% of sales`}
            lit={hours !== 0 || moved}
          />
          <Joint sign="equals" />
          <Node label={fixedSet ? "Profit after rent" : "Left before rent"} value={whole(r.after.profit)} delta={moved ? r.change : 0} fmt={signed} hint="a month" lit={moved} strong />
        </div>

        <figure className="mt-6" aria-label={`Of every $100 of sales: ${parts.map((p) => `${p.label} $${Math.round(per100(p.v))}`).join(", ")}.`}>
          <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[0.78rem]">
            <span className="font-medium text-ink-2">Where each $100 of sales goes</span>
            {!costMeasured && <span className="text-xs text-muted">food &amp; drink at a typical 30% until recipes are linked</span>}
          </figcaption>
          <div className="flex h-7 gap-[2px]" aria-hidden>
            {parts.map((p) => {
              const share = per100(p.v);
              return (
                <div key={p.key} className="relative flex min-w-0 items-center overflow-hidden rounded-[4px] px-2 transition-[flex-grow] duration-260 ease-motion" style={{ flexGrow: Math.max(0.001, share), flexBasis: 0, background: p.fill }}>
                  {share >= 9 && <span className="num truncate text-[0.75rem] font-semibold" style={{ color: p.text }}>${Math.round(share)}</span>}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.72rem] text-ink-2" aria-hidden>
            {parts.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-[3px] ring-1 ring-black/5 ring-inset" style={{ background: p.fill }} />{p.label}</span>
            ))}
          </div>
        </figure>
      </div>

      {/* Levers */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-5">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--lab-card-shadow)] sm:p-6" data-tour="insights.whatif">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[0.98rem] font-semibold tracking-tight text-ink">Try it</h3>
              <p className="mt-0.5 text-sm text-muted">Pull a lever and watch the chain above.</p>
            </div>
            {moved && (
              <Button size="sm" variant="ghost" onClick={() => (setPrice(0), setHours(0), setGuests(0))} className="h-10 sm:h-8"><RotateCcw className="size-3.5" strokeWidth={1.75} />Reset</Button>
            )}
          </div>
          <div className="mt-5 flex flex-col gap-5">
            <LabSlider label="Prices" value={price} min={0} max={10} step={1} onChange={setPrice} show={(v) => (v ? `+${v}%` : "as today")} note="Some guests buy a little less — that's counted." />
            <LabSlider label="Wage hours a day" value={hours} min={0} max={8} step={0.5} onChange={setHours} show={(v) => (v ? `${v} fewer` : "as today")} note="Same sales, fewer paid hours (trim quiet hours, stagger starts)." />
            <LabSlider label="Guests" value={guests} min={0} max={15} step={1} onChange={setGuests} show={(v) => (v ? `+${v}%` : "as today")} note="More guests with the same team." />
          </div>
          <div className={cx("mt-6 flex items-center justify-between gap-3 rounded-xl px-4 py-3 transition-colors duration-260", moved ? "bg-[var(--lab-accent-wash)]" : "bg-surface-2")} aria-live="polite">
            <span className="text-sm text-ink-2">That changes profit by</span>
            <span className={cx("num text-[1.5rem] font-semibold tracking-tight", !moved ? "text-muted" : r.change >= 0 ? "text-ink" : "text-bad")}>{moved ? <>{signed(r.change)}<span className="ml-1 text-sm font-normal text-muted">a month</span></> : "—"}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--lab-card-shadow)] sm:p-6">
          <h3 className="text-[0.98rem] font-semibold tracking-tight text-ink">Which lever moves most</h3>
          <p className="mt-0.5 text-sm text-muted">What each small move is worth a month, from your own numbers. Tap one to try it.</p>
          <ul className="mt-4 flex flex-col gap-1">
            {levers.map((l, i) => (
              <li key={l.key}>
                <button type="button" onClick={() => tryLever(l.key)} disabled={l.key === "waste"} className="w-full rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface-2 disabled:hover:bg-transparent">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                    <span className={cx(i === 0 ? "font-medium text-ink" : "text-ink-2")}>{l.label}</span>
                    <span className="num font-semibold text-ink">{whole(l.monthly)}</span>
                  </div>
                  <div className="h-2.5"><div className={cx("lab-grow-x h-full rounded-r-[4px]", i === 0 ? "bg-[var(--lab-accent)]" : "bg-[var(--lab-context)]")} style={{ width: `${Math.max(2, (l.monthly / maxLever) * 100)}%`, animationDelay: `${i * 80}ms` }} /></div>
                </button>
              </li>
            ))}
          </ul>
          {levers.length > 1 && levers[1].monthly > 0 && (
            <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-3 text-[0.82rem] leading-relaxed text-ink-2">
              <span className="font-medium text-ink">{levers[0].label}</span> is worth about <span className="num font-medium text-ink">{(levers[0].monthly / levers[1].monthly).toFixed(1)}×</span> {levers[1].label.toLowerCase()} — but the smaller levers are usually easier to pull this week.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Joint({ sign }: { sign?: "minus" | "equals" }) {
  return (
    <div className="flex items-center justify-center py-0.5 text-muted lg:px-1" aria-hidden>
      {sign === "equals" ? (
        <span className="text-lg leading-none font-medium">=</span>
      ) : sign === "minus" ? (
        <Minus className="size-4" strokeWidth={2} />
      ) : (
        <>
          <ArrowDown className="size-4 lg:hidden" strokeWidth={1.75} />
          <ArrowRight className="hidden size-4 lg:block" strokeWidth={1.75} />
        </>
      )}
    </div>
  );
}

function Node({ label, value, delta, fmt, hint, lit, strong, invert }: { label: string; value: string; delta: number; fmt: (n: number) => string; hint?: ReactNode; lit?: boolean; strong?: boolean; invert?: boolean }) {
  const good = invert ? delta < 0 : delta > 0;
  return (
    <div className={cx("flex min-w-0 flex-col justify-center rounded-xl border px-4 py-3 transition-colors duration-260", strong ? "border-transparent bg-[var(--lab-accent-wash)]" : "border-border bg-surface", lit && !strong && "border-[var(--lab-accent-2)]")}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <span className={cx("num font-semibold tracking-tight text-ink", strong ? "text-[1.5rem]" : "text-[1.2rem]")}>{value}</span>
        {Math.abs(delta) >= 1 && <span className={cx("num animate-fade-in text-xs font-medium", good ? "text-good" : "text-bad")}>{fmt(delta)}</span>}
      </div>
      {hint && <div className="mt-0.5 truncate text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function LabSlider({ label, value, min, max, step, onChange, show, note }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; show: (v: number) => string; note?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const setFrom = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - b.left) / b.width));
    onChange(Math.round((min + t * (max - min)) / step) * step);
  };
  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (e.key === "Home") return (e.preventDefault(), onChange(min));
    if (e.key === "End") return (e.preventDefault(), onChange(max));
    if (!dir) return;
    e.preventDefault();
    onChange(Math.min(max, Math.max(min, value + dir * step)));
  };
  const pos = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className={cx("num text-sm", value ? "font-semibold text-ink" : "text-muted")}>{show(value)}</span>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={show(value)}
        onKeyDown={onKey}
        onPointerDown={(e: PointerEvent) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          setFrom(e.clientX);
        }}
        onPointerMove={(e: PointerEvent) => e.buttons && setFrom(e.clientX)}
        className="relative h-10 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2" />
        <div className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-[var(--lab-accent)]" style={{ width: `${pos}%` }} />
        <div className="absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-strong bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_10px_-2px_rgb(0_0_0/0.18)] transition-transform duration-120 active:scale-110" style={{ left: `${pos}%` }}><span className="absolute inset-[7px] rounded-full bg-[var(--lab-accent)]" /></div>
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}
