"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { ArrowRight, BellRing, Check, ChevronDown, Undo2, X } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { AREA_LABEL, certaintyWord, EFFORT_LABEL, sortActions, SORTS, type LabArea, type SortVector } from "@/domain/lab";
import type { DeckAction } from "./deck-data";
import type { InputRow } from "@/domain/analytics";
import { money } from "@/lib/format";
import { markInsight } from "./actions";
import { AreaChip, StarDots, StoryVisual } from "./visuals";

type Verdict = "done" | "dismissed" | "snoozed";
const whole = (n: number) => money(n, { whole: true });
const LINK_LABEL: Record<string, string> = { "/schedule": "Open the schedule", "/prices": "Open prices", "/ordering": "Open ordering", "/events": "Open events", "/variance": "Open margin gap", "/invoices": "Open invoices", "/waste": "Open waste", "/reviews": "Open reviews" };
const VERDICT_NOTE: Record<Verdict, string> = { done: "Nice — marked done. We'll track what it changes.", snoozed: "We'll bring it back in 2 weeks.", dismissed: "Hidden. We'll show fewer like this." };

function useVerdicts() {
  const [gone, setGone] = useState<Record<string, Verdict>>({});
  const [, start] = useTransition();
  const act = (a: DeckAction, v: Verdict | "undo") => {
    setGone((g) => {
      const n = { ...g };
      if (v === "undo") delete n[a.key];
      else n[a.key] = v;
      return n;
    });
    start(async () => {
      await markInsight({ key: a.key, kind: a.kind, title: a.title, subject: a.subject ?? null, monthly: a.monthly, parts: a.parts }, v);
    });
  };
  return { gone, act };
}

// ---- The deck: hero + queue ---------------------------------------------------------------

export function ActionDeck({ actions }: { actions: DeckAction[] }) {
  const { gone, act } = useVerdicts();
  const [sort, setSort] = useState<SortVector>("best");
  const [area, setArea] = useState<LabArea | null>(null);
  const [last, setLast] = useState<{ a: DeckAction; v: Verdict } | null>(null);
  const [all, setAll] = useState(false);
  const live = actions.filter((a) => !gone[a.key]);
  const hero = live[0] ?? null;
  const rest = useMemo(() => sortActions(live.slice(1), sort, area), [live, sort, area]);
  const areas = [...new Set(live.slice(1).map((a) => a.area))];
  const total = live.reduce((s, a) => s + a.value, 0);
  const decide = (a: DeckAction, v: Verdict) => {
    act(a, v);
    setLast({ a, v });
  };
  return (
    <>
      <section className="mb-10" aria-labelledby="lab-hero-title" data-tour="insights.hero">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="lab-hero-title" className="text-[0.95rem] font-semibold text-ink">Today&apos;s one thing</h2>
          {live.length > 0 && <span className="num text-xs text-muted">{live.length === 1 ? "The last one on the list" : `1 of ${live.length} · together about ${whole(total)} a month`}</span>}
        </div>
        {last && (
          <div className="animate-fade-in mb-3 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 text-sm text-muted" aria-live="polite">
            <span className="min-w-0 truncate">{VERDICT_NOTE[last.v]}</span>
            <Button size="sm" variant="ghost" onClick={() => (act(last.a, "undo"), setLast(null))} className="h-10 sm:h-8"><Undo2 className="size-3.5" strokeWidth={1.75} />Undo</Button>
          </div>
        )}
        {hero ? <Hero key={hero.key} a={hero} onDecide={(v) => decide(hero, v)} /> : <AllClear />}
      </section>

      {rest.length + (sort !== "best" || area ? 1 : 0) > 0 && (
        <section className="mb-10" aria-labelledby="lab-queue-title" data-tour="insights.queue">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div>
              <h2 id="lab-queue-title" className="text-[0.95rem] font-semibold text-ink">Up next</h2>
              <p className="mt-0.5 text-sm text-muted">One root cause per card, rated on money, how sure we are and how easy it is.</p>
            </div>
          </div>
          <div className="mb-3 flex flex-col gap-2" data-tour="insights.sort">
            <Chips label="Sort by" value={sort} onChange={(v) => setSort(v as SortVector)} options={SORTS.map((s) => ({ value: s.id, label: s.label }))} />
            {areas.length > 1 && <Chips label="Area" value={area ?? "all"} onChange={(v) => setArea(v === "all" ? null : (v as LabArea))} options={[{ value: "all", label: "All areas" }, ...areas.map((a) => ({ value: a, label: AREA_LABEL[a] }))]} />}
          </div>
          {rest.length ? (
            <>
              <ol className="flex flex-col gap-2">
                {(all ? rest : rest.slice(0, 6)).map((a) => (
                  <QueueRow key={a.key} a={a} sort={sort} onDecide={(v) => decide(a, v)} />
                ))}
              </ol>
              {rest.length > 6 && (
                <button type="button" onClick={() => setAll((x) => !x)} className="mt-2 flex h-11 w-full items-center justify-center gap-1 rounded-xl text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
                  {all ? "Show fewer" : `Show ${rest.length - 6} more`}
                  <ChevronDown className={cx("size-4 transition-transform duration-180", all && "rotate-180")} strokeWidth={1.75} />
                </button>
              )}
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Nothing here for that filter.</p>
          )}
        </section>
      )}
    </>
  );
}

function Chips({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("h-10 shrink-0 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors sm:h-8 sm:px-3", value === o.value ? "border-ink bg-primary text-primary-ink" : "border-border-strong bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AllClear() {
  return (
    <div className="animate-rise-in rounded-2xl border border-border bg-surface px-6 py-12 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-full bg-good-bg text-good"><Check className="size-5" strokeWidth={2} /></div>
      <div className="mt-3 text-[1.05rem] font-semibold text-ink">You&apos;re all caught up</div>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Nothing worth chasing right now. New things show up here after the nightly update.</p>
    </div>
  );
}

// ---- Hero --------------------------------------------------------------------------------

function Money({ a, size = "lg" }: { a: DeckAction; size?: "lg" | "md" }) {
  const one = !!a.oneOff && a.oneOff > a.monthly * 6;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={cx("num font-semibold tracking-tight text-ink", size === "lg" ? "text-[2.6rem] leading-none sm:text-[3rem]" : "text-[1.05rem]")}>{whole(one ? a.oneOff! : a.monthly)}</span>
      <span className={cx("text-muted", size === "lg" ? "text-base" : "text-xs")}>{one ? "one-off" : "a month"}</span>
    </div>
  );
}

function Beat({ n, label, children, last }: { n: number; label: string; children: ReactNode; last?: boolean }) {
  return (
    <li className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
      <span className="num relative z-10 mt-0.5 grid size-6 place-items-center rounded-full border border-border-strong bg-surface text-[11px] font-semibold text-ink-2">{n}</span>
      {!last && <span className="absolute top-7 bottom-0 left-3 w-px bg-border" aria-hidden />}
      <div className={cx("min-w-0", !last && "pb-4")}>
        <div className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">{label}</div>
        <div className="mt-0.5 text-[0.95rem] leading-relaxed text-ink">{children}</div>
      </div>
    </li>
  );
}

export function StoryBeats({ a }: { a: DeckAction }) {
  const gain = a.story.gain || (a.oneOff ? `About ${whole(a.oneOff)} once.` : `About ${whole(a.monthly)} a month.`);
  return (
    <ol className="flex flex-col">
      <Beat n={1} label="What's happening">{a.story.now}</Beat>
      {a.story.why && <Beat n={2} label="Why we think so">{a.story.why}</Beat>}
      <Beat n={a.story.why ? 3 : 2} label="What to do">{a.story.todo}</Beat>
      <Beat n={a.story.why ? 4 : 3} label="What you'd gain" last>
        {gain}
        {a.high > a.low * 1.15 && !a.oneOff && <span className="text-muted"> Likely <span className="num">{whole(a.low)}–{whole(a.high)}</span>.</span>}
      </Beat>
    </ol>
  );
}

function Hero({ a, onDecide }: { a: DeckAction; onDecide: (v: Verdict) => void }) {
  const [leaving, setLeaving] = useState<Verdict | null>(null);
  const decide = (v: Verdict) => {
    setLeaving(v);
    // Let it slide away, then the next one rises in.
    window.setTimeout(() => onDecide(v), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
  };
  return (
    <article
      className={cx(
        "relative overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_28px_-12px_rgb(0_0_0/0.12)] transition-[opacity,transform] duration-200 ease-motion",
        leaving ? (leaving === "done" ? "translate-x-6 opacity-0" : "-translate-x-6 opacity-0") : "animate-rise-in",
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--area) 70%, transparent), transparent 70%)" }} aria-hidden />
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-10">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <AreaChip area={a.area} />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted"><StarDots stars={a.stars} /> {a.rating}</span>
            {a.isNew && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">New</span>}
          </div>
          <h3 className="mt-3 text-[1.35rem] leading-snug font-semibold tracking-tight text-ink sm:text-[1.6rem]">{a.title}</h3>
          <div className="mt-4">
            <Money a={a} />
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              <span>{certaintyWord(a.confidence)}</span>
              <span aria-hidden>·</span>
              <span>{EFFORT_LABEL[a.effort]}</span>
              <span aria-hidden>·</span>
              <span>{a.vector === "earn" ? "Money earned" : "Money saved"}</span>
            </div>
          </div>
          {a.visual && <div className="mt-6 rounded-xl bg-surface-2/60 p-4 lg:hidden"><StoryVisual visual={a.visual} /></div>}
          <div className="mt-6"><StoryBeats a={a} /></div>
          {a.alsoSeen.length > 0 && <p className="mt-3 text-xs text-muted">Also behind this: {a.alsoSeen.join("; ")}.</p>}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {a.visual && <div className="hidden rounded-xl bg-surface-2/60 p-5 lg:block"><StoryVisual visual={a.visual} /></div>}
          <div className="mt-auto flex flex-col gap-2">
            <Button variant="primary" size="lg" onClick={() => decide("done")} className="h-12 w-full text-base" data-tour="insights.do-it"><Check className="size-4.5" strokeWidth={2} />Do it</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" onClick={() => decide("snoozed")} className="h-11 w-full"><BellRing className="size-4" strokeWidth={1.75} />Remind me later</Button>
              <Button size="lg" variant="ghost" onClick={() => decide("dismissed")} className="h-11 w-full"><X className="size-4" strokeWidth={1.75} />Not for us</Button>
            </div>
            {a.href && !a.href.startsWith("/insights") && (
              <Link href={a.href} className="mt-1 inline-flex h-10 items-center justify-center gap-1 text-sm text-ink-2 hover:text-ink">{LINK_LABEL[a.href] ?? "Go there"} <ArrowRight className="size-3.5" strokeWidth={1.75} /></Link>
            )}
          </div>
        </div>
      </div>
      <ShowMeHow how={a.how} inputs={a.inputs} className="border-t border-border px-5 sm:px-7" />
    </article>
  );
}

// ---- Queue row ------------------------------------------------------------------------------

function QueueRow({ a, sort, onDecide }: { a: DeckAction; sort: SortVector; onDecide: (v: Verdict) => void }) {
  const [open, setOpen] = useState(false);
  const hint = sort === "easiest" ? EFFORT_LABEL[a.effort] : sort === "certain" ? certaintyWord(a.confidence) : a.rating;
  return (
    <li className="animate-fade-in overflow-hidden rounded-xl border border-border bg-surface transition-shadow duration-180 hover:shadow-[0_4px_16px_-10px_rgb(0_0_0/0.25)]">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <AreaChip area={a.area} />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted"><StarDots stars={a.stars} />{hint}</span>
          </div>
          <div className="mt-1 text-[0.95rem] leading-snug font-medium text-ink">{a.title}</div>
        </div>
        <div className="shrink-0 text-right">
          <Money a={a} size="md" />
        </div>
        <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform duration-180", open && "rotate-180")} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="animate-fade-in border-t border-border px-4 pt-4 pb-3">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <StoryBeats a={a} />
            {a.visual && <div className="rounded-xl bg-surface-2/60 p-4"><StoryVisual visual={a.visual} /></div>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onDecide("done")} className="h-10 sm:h-9"><Check className="size-3.5" strokeWidth={2} />Do it</Button>
            <Button onClick={() => onDecide("snoozed")} className="h-10 sm:h-9"><BellRing className="size-3.5" strokeWidth={1.75} />Later</Button>
            <Button variant="ghost" onClick={() => onDecide("dismissed")} className="h-10 sm:h-9"><X className="size-3.5" strokeWidth={1.75} />Not for us</Button>
          </div>
          <ShowMeHow how={a.how} inputs={a.inputs} />
        </div>
      )}
    </li>
  );
}

// ---- Evidence drawer ----------------------------------------------------------------------

export function ShowMeHow({ how, inputs, className, label = "Show me how" }: { how: string[]; inputs?: InputRow[]; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!how.length && !inputs?.length) return null;
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-11 w-full items-center justify-between gap-2 text-left text-[0.85rem] font-medium text-ink-2 hover:text-ink sm:h-10">
        {label}
        <ChevronDown className={cx("size-4 transition-transform duration-180", open && "rotate-180")} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="animate-fade-in pb-3 text-[0.85rem] leading-relaxed text-ink-2">
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

// ---- Compact hero for the Overview ------------------------------------------------------------

export function CompactHero({ actions }: { actions: DeckAction[] }) {
  const { gone, act } = useVerdicts();
  const live = actions.filter((a) => !gone[a.key]);
  const a = live[0];
  if (!a) {
    return <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted">You&apos;re all caught up — nothing worth chasing right now.</div>;
  }
  return (
    <article key={a.key} className="animate-rise-in overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <AreaChip area={a.area} />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted"><StarDots stars={a.stars} />{a.rating}</span>
          </div>
          <div className="mt-1.5 text-[1.05rem] leading-snug font-semibold text-ink">{a.title}</div>
          <p className="mt-1 line-clamp-2 text-sm text-ink-2">{a.story.todo}</p>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-2">
          <Money a={a} size="md" />
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" onClick={() => act(a, "done")} className="h-10 sm:h-8"><Check className="size-3.5" strokeWidth={2} />Do it</Button>
            <Button size="sm" variant="ghost" onClick={() => act(a, "snoozed")} className="h-10 sm:h-8">Later</Button>
          </div>
        </div>
      </div>
      {live.length > 1 && (
        <Link href="/insights" className="flex h-11 items-center justify-between border-t border-border px-4 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink sm:px-5">
          <span><span className="num">{live.length - 1}</span> more in the Insights Lab</span>
          <ArrowRight className="size-3.5" strokeWidth={1.75} />
        </Link>
      )}
    </article>
  );
}
