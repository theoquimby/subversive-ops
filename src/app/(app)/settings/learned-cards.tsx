"use client";

/**
 * Learned suggestions on the page they belong to: "Your sales say Thu 4–9pm —
 * use these?" One tap applies through the normal savers; "Not now" remembers
 * the suggestion so it doesn't come back (a different one later still will).
 */

import { HelpTip } from "@/components/help";
import { Button } from "@/components/ui";
import { DAY_NAMES } from "@/domain/openingHours";
import { coverageLabel, dayHoursLabel, weekdaysLabel, type DayChange } from "@/domain/learned";
import { cn } from "@/lib/cn";
import type { HoursSuggestion, ParSuggestion, BufferSuggestion, SupplierSuggestion, WeatherSuggestion } from "@/server/services/learned";
import { Sparkles, X } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { applyLearnedBuffers, applyLearnedHours, applyLearnedPars, applyLearnedSupplier, applyLearnedWeather, dismissLearned, dismissLearnedSupplier } from "./learned-actions";

type R = { error?: string; message?: string };

function useAct() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const act = (fn: () => Promise<R>) => start(async () => {
    const r = await fn();
    setMsg(r.error ? { text: r.error, bad: true } : r.message ? { text: r.message } : null);
  });
  return { pending, msg, act };
}

const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const clock = (t: string) => {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "am" : "pm"}`;
};
const touch = "h-10 sm:h-8";

/** The frame every suggestion shares. */
export function SuggestionCard({ title, children, actions, msg, help, className }: { title: ReactNode; children?: ReactNode; actions: ReactNode; msg?: { text: string; bad?: boolean } | null; help?: string; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border-strong bg-surface p-4 sm:px-5", className)} role="region" aria-label="Suggestion">
      <div className="flex items-start gap-3">
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium text-ink">{title}{help && <HelpTip id={help} />}</div>
          {children && <div className="mt-1 text-[0.8rem] text-muted">{children}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>
          {msg && <p aria-live="polite" className={cn("mt-2 text-xs", msg.bad ? "text-bad" : "text-good")}>{msg.text}</p>}
        </div>
      </div>
    </div>
  );
}

// ---- Opening hours ------------------------------------------------------------------------

function HoursTable({ changes, square, sales }: { changes: DayChange[]; square: boolean; sales: boolean }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border">
      <table data-no-resize className="w-full text-[0.8rem]">
        <thead className="bg-surface-2/60 text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-1.5 font-medium">Day</th>
            <th className="px-3 py-1.5 font-medium">Saved</th>
            {square && <th className="px-3 py-1.5 font-medium">Square</th>}
            {sales && <th className="px-3 py-1.5 font-medium">Sales</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {changes.map((c) => (
            <tr key={c.weekday}>
              <td className="px-3 py-1.5 font-medium text-ink"><span className="sm:hidden">{SHORT[c.weekday]}</span><span className="hidden sm:inline">{DAY_NAMES[c.weekday]}</span></td>
              <td className="num px-3 py-1.5 text-muted">{dayHoursLabel(c.saved)}</td>
              {square && <td className={cn("num px-3 py-1.5", c.square === undefined ? "text-muted" : "text-ink")}>{c.square === undefined ? "—" : dayHoursLabel(c.square)}</td>}
              {sales && <td className={cn("num px-3 py-1.5", c.sales === undefined ? "text-muted" : "text-ink")}>{c.sales === undefined ? "not sure" : dayHoursLabel(c.sales)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HoursSuggestionCard({ s, className = "mb-3" }: { s: HoursSuggestion; className?: string }) {
  const { pending, msg, act } = useAct();
  const [hidden, setHidden] = useState(false);
  if (hidden) return msg ? <p className="px-4 py-3 text-xs text-good sm:px-5" aria-live="polite">{msg.text}</p> : null;
  // Rows: every day either version would change.
  const days = new Map<number, DayChange>();
  for (const c of [...s.changes, ...(s.salesChanges ?? [])]) if (!days.has(c.weekday)) days.set(c.weekday, c);
  const rows = [...days.values()].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  const from = [s.hasSquare && `Square${s.squareLocation ? ` (${s.squareLocation})` : ""}`, s.hasSales && `the last ${s.weeks} weeks of sales`].filter(Boolean).join(" and ");
  const target = s.target.kind === "season" ? `your ${s.target.label} hours` : "your saved hours";
  const only = s.changes.length === 1 ? s.changes[0] : null;
  return (
    <SuggestionCard
      className={className}
      help="settings.learned.hours"
      title={only ? `${DAY_NAMES[only.weekday]}: ${only.square !== undefined ? "Square" : "your sales"} say${only.square !== undefined ? "s" : ""} ${dayHoursLabel(only.next)}` : `${from.startsWith("Square") ? "Square and your sales" : "Your sales"} suggest different hours`}
      msg={msg}
      actions={
        <>
          {s.changes.length > 0 && <Button variant="primary" size="sm" className={touch} disabled={pending} onClick={() => act(async () => { const r = await applyLearnedHours("square"); if (!r.error) setHidden(true); return r; })}>{s.hasSquare && s.salesChanges ? "Use Square's hours" : "Use these"}</Button>}
          {s.salesChanges && <Button size="sm" className={touch} disabled={pending} onClick={() => act(async () => { const r = await applyLearnedHours("sales"); if (!r.error) setHidden(true); return r; })}>Use what sales show</Button>}
          <Button variant="ghost" size="sm" className={touch} disabled={pending} onClick={() => act(async () => { const r = await dismissLearned("hours"); if (!r.error) setHidden(true); return r; })}>Not now</Button>
        </>
      }
    >
      Compared with {target}, from {from}. Only these days change.
      <HoursTable changes={rows} square={s.hasSquare} sales={s.hasSales} />
    </SuggestionCard>
  );
}

// ---- Weather ---------------------------------------------------------------------------------

export function WeatherSuggestionCard({ s, className = "mb-3" }: { s: WeatherSuggestion; className?: string }) {
  const { pending, msg, act } = useAct();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <SuggestionCard
      className={className}
      help="settings.learned.weather"
      title={`${s.source === "square" ? "Square has your business in" : "Your address is in"} ${s.label}`}
      msg={msg}
      actions={
        <>
          <Button variant="primary" size="sm" className={touch} disabled={pending} onClick={() => act(async () => { const r = await applyLearnedWeather(); if (!r.error) setHidden(true); return r; })}>Use {s.label}</Button>
          <Button variant="ghost" size="sm" className={touch} disabled={pending} onClick={() => act(async () => { const r = await dismissLearned("weather"); if (!r.error) setHidden(true); return r; })}>Not now</Button>
        </>
      }
    >
      The forecast reads weather from {s.current}, about {s.km} km away. <span className="num">{s.lat.toFixed(4)}, {s.lon.toFixed(4)}</span>
    </SuggestionCard>
  );
}

// ---- Suppliers ---------------------------------------------------------------------------------

/** "Tue ← Mon 3:30pm · Fri ← Wed 4pm" */
const deadlinesLabel = (perDay: Record<number, { day: number; time: string }>) =>
  Object.entries(perDay).sort(([a], [b]) => ((Number(a) + 6) % 7) - ((Number(b) + 6) % 7)).map(([wd, v]) => `${SHORT[Number(wd)]} ← ${SHORT[v.day]} ${clock(v.time)}`).join(" · ");

/** One supplier's waiting suggestions, as plain lines. */
function supplierLines(s: SupplierSuggestion) {
  const lines: { what: "days" | "lead" | "deadlines"; text: string }[] = [];
  if (s.days) lines.push({ what: "days", text: `Delivers ${weekdaysLabel(s.days.days)} (${coverageLabel(s.days)}, from ${s.days.sources}). Saved: ${weekdaysLabel(s.days.current)}.` });
  if (s.lead) lines.push({ what: "lead", text: `Orders usually go in ${s.lead.days} day${s.lead.days === 1 ? "" : "s"} ahead (${s.lead.n} orders). Saved: ${s.lead.current}.` });
  if (s.deadlines) lines.push({ what: "deadlines", text: `Order deadlines ${deadlinesLabel(s.deadlines.perDay)} — the latest each order has gone out and still arrived.` });
  return lines;
}

export function SupplierSuggestionCard({ s, className }: { s: SupplierSuggestion; className?: string }) {
  const { pending, msg, act } = useAct();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const lines = supplierLines(s);
  const title = s.days ? `${s.days.sources.includes("invoice") ? "Invoices say" : "Past orders say"} ${s.name} delivers ${weekdaysLabel(s.days.days)}` : s.lead ? `${s.name}: orders go in ${s.lead.days} day${s.lead.days === 1 ? "" : "s"} ahead` : `${s.name}: order deadlines from past orders`;
  return (
    <SuggestionCard
      className={className}
      help="settings.learned.suppliers"
      title={title}
      msg={msg}
      actions={
        <>
          <Button variant="primary" size="sm" className={touch} disabled={pending} onClick={() => act(async () => { const r = await applyLearnedSupplier(s.id, "all"); if (!r.error) setHidden(true); return r; })}>{lines.length > 1 ? "Set all" : "Set it"}</Button>
          <Button variant="ghost" size="sm" className={touch} disabled={pending} onClick={() => act(async () => { const r = await dismissLearnedSupplier(s.id); if (!r.error) setHidden(true); return r; })}>Not now</Button>
        </>
      }
    >
      <ul className="space-y-0.5">{lines.map((l) => <li key={l.what}>{l.text}</li>)}</ul>
    </SuggestionCard>
  );
}

export function SupplierSuggestionList({ list }: { list: SupplierSuggestion[] }) {
  if (!list.length) return null;
  return (
    <section aria-label="Suggested from invoices and orders" className="mb-5 space-y-2">
      {list.map((s) => <SupplierSuggestionCard key={s.id} s={s} />)}
    </section>
  );
}

/** Compact, for the supplier card on Ordering: one line and two small buttons. Sits above the card's full-size link. */
export function SupplierSuggestionLine({ s }: { s: SupplierSuggestion }) {
  const { pending, msg, act } = useAct();
  const [hidden, setHidden] = useState(false);
  if (hidden) return msg && !msg.bad ? <p className="relative z-10 mt-2 text-xs text-good">{msg.text}</p> : null;
  const text = s.days ? `${s.days.sources.includes("invoice") ? "Invoices say" : "Past orders say"} ${weekdaysLabel(s.days.days)} — set it?` : s.deadlines ? `Past orders suggest deadlines ${deadlinesLabel(s.deadlines.perDay)}` : `Orders usually go in ${s.lead!.days}d ahead — set it?`;
  return (
    <div className="relative z-10 mt-2 flex items-center gap-2 rounded-lg bg-surface-2/70 px-2.5 py-1.5 text-xs">
      <Sparkles aria-hidden className="size-3.5 shrink-0 text-ink-2" />
      <span className="min-w-0 flex-1 text-ink-2">{msg?.bad ? <span className="text-bad">{msg.text}</span> : text}</span>
      <Button size="sm" variant="primary" className="h-9 px-2.5 sm:h-7" disabled={pending} onClick={(e) => { e.preventDefault(); act(async () => { const r = await applyLearnedSupplier(s.id, "all"); if (!r.error) setHidden(true); return r; }); }}>Set</Button>
      <button type="button" aria-label="Not now" disabled={pending} onClick={(e) => { e.preventDefault(); act(async () => { const r = await dismissLearnedSupplier(s.id); if (!r.error) setHidden(true); return r; }); }} className="-mr-1 grid size-9 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink sm:size-7"><X className="size-3.5" /></button>
    </div>
  );
}

// ---- Minimums and buffers (Ingredients) -------------------------------------------------------

const qtyText = (p: ParSuggestion) => (p.packs != null ? `${p.packs} ${p.unit}${p.packs === 1 ? "" : p.unit.endsWith("s") ? "" : "s"}` : `${p.qtyBase}`);

export function LearnedStockSuggestions({ pars, buffers }: { pars: ParSuggestion[]; buffers: BufferSuggestion[] }) {
  const [open, setOpen] = useState(false);
  const { pending, msg, act } = useAct();
  const [done, setDone] = useState<Set<string>>(new Set());
  const p = pars.filter((x) => !done.has(x.key));
  const b = buffers.filter((x) => !done.has(x.key));
  const n = p.length + b.length;
  if (n === 0) return msg ? <p className="mb-3 text-xs text-good" aria-live="polite">{msg.text}</p> : null;
  const hide = (keys: string[]) => setDone((d) => new Set([...d, ...keys]));
  const run = (keys: string[], fn: () => Promise<R>) => act(async () => { const r = await fn(); if (!r.error) hide(keys); return r; });
  const parts = [p.length && `${p.length} minimum${p.length === 1 ? "" : "s"} on hand`, b.length && `${b.length} order buffer${b.length === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
  return (
    <SuggestionCard
      className="mb-4"
      help="ingredients.learned"
      title={`Suggested from what you buy: ${parts}`}
      msg={msg}
      actions={
        <>
          <Button size="sm" className={touch} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide" : "Review"}</Button>
          <Button variant="primary" size="sm" className={touch} disabled={pending} onClick={() => run([...p, ...b].map((x) => x.key), async () => {
            const r1 = p.length ? await applyLearnedPars(p.map((x) => x.ingredientId)) : {};
            if (r1.error) return r1;
            const r2 = b.length ? await applyLearnedBuffers(b.map((x) => x.ingredientId)) : {};
            return r2.error ? r2 : { message: `Set ${n} suggestion${n === 1 ? "" : "s"}.` };
          })}>Use all {n}</Button>
        </>
      }
    >
      {p.length > 0 && "Minimums are for things no recipe uses, sized to last the longest wait between deliveries at the rate you buy them. "}
      {b.length > 0 && "Buffers come from the order-size model on Insights."}
      {open && (
        <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border text-ink">
          {p.map((x) => (
            <li key={x.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1"><span className="font-medium">{x.name}</span><span className="text-muted"> · keep at least {qtyText(x)} ({x.n} purchases)</span></span>
              <Button size="sm" variant="primary" className={touch} disabled={pending} onClick={() => run([x.key], () => applyLearnedPars([x.ingredientId]))}>Set</Button>
              <Button size="sm" variant="ghost" className={touch} disabled={pending} onClick={() => run([x.key], () => dismissLearned(x.key))}>Not now</Button>
            </li>
          ))}
          {b.map((x) => (
            <li key={x.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1"><span className="font-medium">{x.name}</span><span className="text-muted"> · buffer {Math.round(x.buffer * 100)}%, now {Math.round(x.current * 100)}%</span></span>
              <Button size="sm" variant="primary" className={touch} disabled={pending} onClick={() => run([x.key], () => applyLearnedBuffers([x.ingredientId]))}>Set</Button>
              <Button size="sm" variant="ghost" className={touch} disabled={pending} onClick={() => run([x.key], () => dismissLearned(x.key))}>Not now</Button>
            </li>
          ))}
        </ul>
      )}
    </SuggestionCard>
  );
}
