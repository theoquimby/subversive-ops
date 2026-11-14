"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowRight, BellRing, Check, ChevronDown, Gauge, Hammer, TrendingUp, Undo2, X } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { AREA_LABEL, certaintyWord, EFFORT_LABEL, sortActions, SORTS, type LabArea, type SortVector } from "@/domain/lab";
import type { DeckAction } from "./deck-data";
import type { Evidence, InputRow } from "@/domain/analytics";
import { markInsight } from "./actions";
import { AreaChip, AreaTile, StarDots } from "./visuals";
import { EvidenceView } from "./evidence";
import { graphicFor, StoryGraphic } from "./graphics";
import { CountUp, ImpactRange, SureMeter, whole } from "./kit";

type Verdict = "done" | "dismissed" | "snoozed";
const LINK_LABEL: Record<string, string> = { "/schedule": "Open the schedule", "/prices": "Open prices", "/ordering": "Open ordering", "/events": "Open events", "/variance": "Open margin gap", "/invoices": "Open invoices", "/waste": "Open waste", "/reviews": "Open reviews" };
const VERDICT_NOTE: Record<Verdict, string> = { done: "Done. We'll track what it changes.", snoozed: "Back in 2 weeks.", dismissed: "Hidden. Fewer like this." };

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

const isOneOff = (a: Pick<DeckAction, "oneOff" | "monthly">) => !!a.oneOff && a.oneOff > a.monthly * 6;

// ---- The deck: hero + queue ---------------------------------------------------------------

export function ActionDeck({ actions }: { actions: DeckAction[] }) {
  const { gone, act } = useVerdicts();
  const [sort, setSort] = useState<SortVector>("best");
  const [area, setArea] = useState<LabArea | null>(null);
  const [last, setLast] = useState<{ a: DeckAction; v: Verdict; at: number } | null>(null);
  const [all, setAll] = useState(false);
  const live = actions.filter((a) => !gone[a.key]);
  const hero = live[0] ?? null;
  const rest = useMemo(() => sortActions(live.slice(1), sort, area), [live, sort, area]);
  const areas = [...new Set(live.slice(1).map((a) => a.area))];
  const total = live.reduce((s, a) => s + a.value, 0);
  const scale = Math.max(1, ...rest.map((a) => Math.max(a.high, a.monthly)));
  const decide = (a: DeckAction, v: Verdict) => {
    act(a, v);
    setLast({ a, v, at: Date.now() });
    // The next one takes the hero's place: bring its top into view if the reader had scrolled past it.
    if (a.key === hero?.key) {
      const el = document.getElementById("lab-today");
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  };
  // The undo note fades after a while; Undo stays possible until then.
  useEffect(() => {
    if (!last) return;
    const t = window.setTimeout(() => setLast((l) => (l && l.at === last.at ? null : l)), 7000);
    return () => window.clearTimeout(t);
  }, [last]);
  return (
    <>
      <section className="mb-12 scroll-mt-32 lg:scroll-mt-20" id="lab-today" aria-labelledby="lab-hero-title" data-tour="insights.hero">
        <div className="mb-3.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 id="lab-hero-title" className="text-[1.05rem] font-semibold tracking-tight text-ink">Today&apos;s one thing</h2>
          {live.length > 0 && (
            <span className="text-xs text-muted">
              {live.length === 1 ? "The last one on the list" : <><span className="num">1 of {live.length}</span> · together about <span className="num font-medium text-ink-2">{whole(total)}</span> a month</>}
            </span>
          )}
        </div>
        {hero ? <Hero key={hero.key} a={hero} onDecide={(v) => decide(hero, v)} /> : <AllClear />}
      </section>

      {last && (
        <div className="fixed inset-x-0 bottom-[calc(var(--tabbar)+0.75rem)] z-40 flex justify-center px-4 lg:bottom-6" aria-live="polite">
          <div key={last.at} className="animate-rise-in flex min-h-12 w-full max-w-md items-center justify-between gap-3 rounded-2xl bg-ink py-1.5 pr-1.5 pl-4 text-sm text-surface shadow-[0_12px_32px_-12px_rgb(0_0_0/0.45)]">
            <span className="flex min-w-0 items-center gap-2">
              {last.v === "done" ? <Check className="size-4 shrink-0" strokeWidth={2.2} /> : last.v === "snoozed" ? <BellRing className="size-4 shrink-0" strokeWidth={1.9} /> : <X className="size-4 shrink-0" strokeWidth={1.9} />}
              <span className="min-w-0 truncate">{VERDICT_NOTE[last.v]}</span>
            </span>
            <button type="button" onClick={() => (act(last.a, "undo"), setLast(null))} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 font-medium text-surface hover:bg-white/10">
              <Undo2 className="size-3.5" strokeWidth={2} />Undo
            </button>
          </div>
        </div>
      )}

      {rest.length + (sort !== "best" || area ? 1 : 0) > 0 && (
        <section className="mb-12 scroll-mt-32 lg:scroll-mt-20" id="lab-next" aria-labelledby="lab-queue-title" data-tour="insights.queue">
          <div className="mb-3.5">
            <h2 id="lab-queue-title" className="text-[1.05rem] font-semibold tracking-tight text-ink">Up next</h2>
            <p className="mt-0.5 text-sm text-muted">One card per root cause. Dots rate the money, how sure we are and how easy it is.</p>
          </div>
          <div className="mb-3 flex flex-col gap-2" data-tour="insights.sort">
            <Chips label="Sort by" value={sort} onChange={(v) => setSort(v as SortVector)} options={SORTS.map((s) => ({ value: s.id, label: s.label }))} />
            {areas.length > 1 && <Chips label="Area" value={area ?? "all"} onChange={(v) => setArea(v === "all" ? null : (v as LabArea))} options={[{ value: "all", label: "All areas" }, ...areas.map((a) => ({ value: a, label: AREA_LABEL[a] }))]} />}
          </div>
          {rest.length ? (
            <>
              <ol className="flex flex-col gap-2.5">
                {(all ? rest : rest.slice(0, 6)).map((a, i) => (
                  <QueueRow key={a.key} a={a} i={i} sort={sort} scale={scale} onDecide={(v) => decide(a, v)} />
                ))}
              </ol>
              {rest.length > 6 && (
                <button type="button" onClick={() => setAll((x) => !x)} className="mt-2.5 flex h-11 w-full items-center justify-center gap-1 rounded-xl text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
                  {all ? "Show fewer" : `Show ${rest.length - 6} more`}
                  <ChevronDown className={cx("size-4 transition-transform duration-180", all && "rotate-180")} strokeWidth={1.75} />
                </button>
              )}
            </>
          ) : (
            <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nothing here for that filter.</p>
          )}
        </section>
      )}
    </>
  );
}

function Chips({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="lab-noscroll -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("h-10 shrink-0 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors sm:h-8 sm:px-3 sm:text-[0.82rem]", value === o.value ? "border-transparent bg-primary text-primary-ink" : "border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AllClear() {
  return (
    <div className="lab animate-rise-in rounded-[20px] border border-border bg-surface px-6 py-14 text-center shadow-[var(--lab-card-shadow)]">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-good-bg text-good"><Check className="size-5" strokeWidth={2.2} /></div>
      <div className="mt-3.5 text-[1.1rem] font-semibold tracking-tight text-ink">You&apos;re all caught up</div>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Nothing worth chasing right now. New things show up here after the nightly update.</p>
    </div>
  );
}

// ---- Money ----------------------------------------------------------------------------------

function MoneyLine({ a, size = "lg", count }: { a: DeckAction; size?: "lg" | "md" | "sm"; count?: boolean }) {
  const one = isOneOff(a);
  const v = one ? a.oneOff! : a.monthly;
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={cx("font-semibold tracking-tight text-ink", size === "lg" ? "text-[2.75rem] leading-none sm:text-[3.25rem]" : size === "md" ? "num text-[1.05rem]" : "num text-[0.95rem]")}>
        {count ? <CountUp value={v} /> : whole(v)}
      </span>
      <span className={cx("text-muted", size === "lg" ? "text-[0.95rem]" : "text-xs")}>{one ? "one-off" : size === "lg" ? "a month" : "/mo"}</span>
    </div>
  );
}

/** What it's worth: the figure, the likely range on a shared-looking track, and the three facts beside it. */
function Worth({ a, className }: { a: DeckAction; className?: string }) {
  const one = isOneOff(a);
  return (
    <div className={className}>
      <div className="mb-2 text-[0.72rem] font-medium tracking-[0.06em] text-muted uppercase">{a.vector === "earn" ? "Money earned" : "Money saved"}</div>
      <MoneyLine a={a} count />
      {!one && <ImpactRange mid={a.monthly} low={a.low} high={a.high} className="mt-4 max-w-[22rem]" />}
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-1">
        <div>
          <dt className="mb-1 flex items-center gap-1.5 text-[0.72rem] text-muted"><Gauge className="size-3.5" strokeWidth={1.9} aria-hidden />How sure</dt>
          <dd><SureMeter confidence={a.confidence} word={certaintyWord(a.confidence)} /></dd>
        </div>
        <div>
          <dt className="mb-1 flex items-center gap-1.5 text-[0.72rem] text-muted"><Hammer className="size-3.5" strokeWidth={1.9} aria-hidden />Effort</dt>
          <dd className="text-[0.8rem] text-ink-2">{EFFORT_LABEL[a.effort]}</dd>
        </div>
      </dl>
    </div>
  );
}

// ---- Story ------------------------------------------------------------------------------------

function Beat({ n, label, children, last, strong }: { n: number; label: string; children: ReactNode; last?: boolean; strong?: boolean }) {
  return (
    <li className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3.5">
      <span className={cx("num relative z-10 mt-[1px] grid size-6 place-items-center rounded-full text-[11px] font-semibold", strong ? "bg-ink text-surface" : "border border-border-strong bg-surface text-ink-2")}>{n}</span>
      {!last && <span className="absolute top-7 bottom-1 left-3 w-px bg-border" aria-hidden />}
      <div className={cx("min-w-0", !last && "pb-5")}>
        <div className="text-[0.7rem] font-medium tracking-[0.06em] text-muted uppercase">{label}</div>
        <div className={cx("mt-1 leading-relaxed", strong ? "text-[1rem] font-medium text-ink" : "text-[0.95rem] text-ink-2")}>{children}</div>
      </div>
    </li>
  );
}

export function StoryBeats({ a, skipNow }: { a: DeckAction; skipNow?: boolean }) {
  const gain = a.story.gain || (a.oneOff ? `About ${whole(a.oneOff)} once.` : `About ${whole(a.monthly)} a month.`);
  let n = 0;
  return (
    <ol className="flex flex-col">
      {!skipNow && <Beat n={++n} label="What's happening">{a.story.now}</Beat>}
      {a.story.why && <Beat n={++n} label="Why we think so">{a.story.why}</Beat>}
      <Beat n={++n} label="What to do" strong>{a.story.todo}</Beat>
      <Beat n={++n} label="What you'd gain" last>
        {gain}
        {a.high > a.low * 1.15 && a.low <= a.monthly && a.high >= a.monthly && !a.oneOff && <span className="text-muted"> Likely <span className="num">{whole(a.low)}–{whole(a.high)}</span>.</span>}
      </Beat>
    </ol>
  );
}

// ---- Hero --------------------------------------------------------------------------------

function DecideButtons({ onDecide, big }: { onDecide: (v: Verdict) => void; big?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" size="lg" onClick={() => onDecide("done")} className={cx("w-full text-base shadow-[0_6px_18px_-8px_rgb(0_0_0/0.5)]", big ? "h-12" : "h-12 sm:h-11")} data-tour="insights.do-it"><Check className="size-4.5" strokeWidth={2.2} />Do it</Button>
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" onClick={() => onDecide("snoozed")} className="h-11 w-full px-2 text-[0.88rem]"><BellRing className="size-4" strokeWidth={1.75} />Later</Button>
        <Button size="lg" variant="ghost" onClick={() => onDecide("dismissed")} className="h-11 w-full px-2 text-[0.88rem]"><X className="size-4" strokeWidth={1.75} />Not for us</Button>
      </div>
    </div>
  );
}

function Hero({ a, onDecide }: { a: DeckAction; onDecide: (v: Verdict) => void }) {
  const [leaving, setLeaving] = useState<Verdict | null>(null);
  const decide = (v: Verdict) => {
    setLeaving(v);
    // Let it slide away, then the next one rises in.
    window.setTimeout(() => onDecide(v), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220);
  };
  const g = graphicFor(a);
  const href = a.href && !a.href.startsWith("/insights") ? a.href : null;
  // Phone: once the in-card buttons scroll off the top, a compact bar keeps the decision under the thumb until the card ends.
  const inline = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const [dock, setDock] = useState(false);
  useEffect(() => {
    const check = () => {
      const b = inline.current?.getBoundingClientRect();
      const c = card.current?.getBoundingClientRect();
      if (!b || !c || b.height === 0) return setDock(false);
      setDock(b.bottom < 60 && c.bottom > window.innerHeight * 0.55);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);
  return (
    <article
      ref={card}
      className={cx(
        "lab relative overflow-clip rounded-[20px] border border-border bg-surface shadow-[var(--lab-hero-shadow)]",
        leaving ? (leaving === "done" ? "lab-leave-right" : "lab-leave-left") : "animate-rise-in",
      )}
      style={{ ["--area" as string]: `var(--area-${AREA_VAR[a.area]})` }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(120%_100%_at_0%_0%,color-mix(in_oklab,var(--area)_9%,transparent),transparent_70%)]" aria-hidden />
      <div className="relative grid lg:grid-cols-[minmax(0,1fr)_19.5rem]">
        <div className="min-w-0 p-5 sm:p-7 lg:p-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <AreaChip area={a.area} pill />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted"><StarDots stars={a.stars} /> {a.rating}</span>
            {a.isNew && <span className="rounded-full bg-[var(--lab-accent-wash)] px-2 py-0.5 text-[0.7rem] font-medium text-ink-2">New</span>}
          </div>
          <h3 className="mt-3.5 max-w-[34ch] text-[1.5rem] leading-[1.2] font-semibold tracking-[-0.015em] text-balance text-ink sm:text-[1.9rem]">{a.title}</h3>

          <Worth a={a} className="mt-6 lg:hidden" />
          <div ref={inline} className="mt-6 lg:hidden">
            <DecideButtons onDecide={decide} />
            {href && <Link href={href} className="mt-1 flex h-10 items-center justify-center gap-1 text-sm text-ink-2 hover:text-ink">{LINK_LABEL[href] ?? "Go there"} <ArrowRight className="size-3.5" strokeWidth={1.75} /></Link>}
          </div>

          {g ? (
            <div className="mt-7">
              <div className="text-[0.7rem] font-medium tracking-[0.06em] text-muted uppercase">What&apos;s happening</div>
              <p className="mt-1 max-w-[62ch] text-[0.98rem] leading-relaxed text-ink">{a.story.now}</p>
              <div className="mt-4 rounded-2xl border border-border bg-[color-mix(in_oklab,var(--surface-2)_45%,var(--surface))] p-4 sm:p-5">
                <StoryGraphic a={a} />
              </div>
              <div className="mt-7"><StoryBeats a={a} skipNow /></div>
            </div>
          ) : (
            <div className="mt-7"><StoryBeats a={a} /></div>
          )}
          {a.alsoSeen.length > 0 && <p className="mt-4 text-xs leading-relaxed text-muted">Also behind this: {a.alsoSeen.join("; ")}.</p>}
        </div>

        <aside className="hidden flex-col gap-6 border-l border-border bg-[color-mix(in_oklab,var(--surface-2)_55%,var(--surface))] p-7 lg:flex">
          <div className="sticky top-24 flex flex-col gap-7">
            <Worth a={a} />
            <div className="flex flex-col gap-2">
              <DecideButtons onDecide={decide} big />
              {href && <Link href={href} className="mt-1 inline-flex h-10 items-center justify-center gap-1 rounded-lg text-sm text-ink-2 hover:bg-surface hover:text-ink">{LINK_LABEL[href] ?? "Go there"} <ArrowRight className="size-3.5" strokeWidth={1.75} /></Link>}
            </div>
          </div>
        </aside>
      </div>

      {/* Phone: the decision docks under the thumb while the rest of the card is read. */}
      <div className={cx("fixed inset-x-0 bottom-[calc(var(--tabbar)+0.5rem)] z-30 px-3 transition-[opacity,transform] duration-180 ease-motion lg:hidden", dock && !leaving ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0")} aria-hidden={!dock} inert={!dock}>
        <div className="mx-auto grid max-w-md grid-cols-[1.35fr_1fr_1fr] gap-1.5 rounded-[18px] border border-border bg-surface/90 p-1.5 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)] backdrop-blur-md">
          <Button variant="primary" onClick={() => decide("done")} className="h-12 rounded-xl text-[0.95rem]"><Check className="size-4.5" strokeWidth={2.2} />Do it</Button>
          <Button onClick={() => decide("snoozed")} className="h-12 rounded-xl px-1 text-[0.86rem]">Later</Button>
          <Button variant="ghost" onClick={() => decide("dismissed")} className="h-12 rounded-xl px-1 text-[0.86rem]">Not for us</Button>
        </div>
      </div>

      <ShowMeHow how={a.how} inputs={a.inputs} evidence={a.evidence} graphic={g} className="relative border-t border-border px-5 sm:px-7 lg:px-8" />
    </article>
  );
}

/** Area → the app's area hue (globals.css --area-*). */
const AREA_VAR: Record<LabArea, string> = { staffing: "people", menu: "food", ordering: "food", hours: "today", costs: "numbers" };

// ---- Queue row ------------------------------------------------------------------------------

function QueueRow({ a, i, sort, scale, onDecide }: { a: DeckAction; i: number; sort: SortVector; scale: number; onDecide: (v: Verdict) => void }) {
  const [open, setOpen] = useState(false);
  const hint = sort === "easiest" ? EFFORT_LABEL[a.effort] : sort === "certain" ? certaintyWord(a.confidence) : a.rating;
  const g = graphicFor(a);
  const one = isOneOff(a);
  return (
    <li className={cx("lab lab-stagger overflow-clip rounded-2xl border bg-surface transition-[box-shadow,border-color] duration-180", open ? "border-border-strong shadow-[var(--lab-hero-shadow)]" : "border-border shadow-[var(--lab-card-shadow)] hover:border-border-strong")} style={{ ["--i" as string]: i }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3.5 py-3.5 text-left sm:gap-4 sm:px-4">
        <AreaTile area={a.area} />
        <div className="min-w-0 flex-1">
          <div className="text-[0.95rem] leading-snug font-medium text-ink">{a.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><StarDots stars={a.stars} />{hint}</span>
            <span aria-hidden className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">{AREA_LABEL[a.area]}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <MoneyLine a={a} size="md" />
          {!one && <ImpactRange mid={a.monthly} low={a.low} high={a.high} scale={scale} size="sm" label={false} className="hidden w-24 sm:block" />}
        </div>
        <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform duration-180", open && "rotate-180")} strokeWidth={1.75} />
      </button>
      <Reveal open={open}>
        <div className="border-t border-border px-4 pt-5 pb-3 sm:px-5">
          <div className={cx("grid gap-6", g && "md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}>
            {g && (
              <div className="min-w-0 rounded-2xl border border-border bg-[color-mix(in_oklab,var(--surface-2)_45%,var(--surface))] p-4">
                <StoryGraphic a={a} compact />
              </div>
            )}
            <StoryBeats a={a} />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => onDecide("done")} className="h-11 px-5 sm:h-10"><Check className="size-4" strokeWidth={2.2} />Do it</Button>
            <Button onClick={() => onDecide("snoozed")} className="h-11 sm:h-10"><BellRing className="size-3.5" strokeWidth={1.75} />Later</Button>
            <Button variant="ghost" onClick={() => onDecide("dismissed")} className="h-11 sm:h-10"><X className="size-3.5" strokeWidth={1.75} />Not for us</Button>
            {a.href && !a.href.startsWith("/insights") && <Link href={a.href} className="ml-auto hidden h-10 items-center gap-1 px-2 text-sm text-ink-2 hover:text-ink sm:inline-flex">{LINK_LABEL[a.href] ?? "Go there"} <ArrowRight className="size-3.5" strokeWidth={1.75} /></Link>}
          </div>
          <ShowMeHow how={a.how} inputs={a.inputs} evidence={a.evidence} graphic={g} className="mt-2 border-t border-border" />
        </div>
      </Reveal>
    </li>
  );
}

/** Height-animated disclosure: mounts on first open, then animates open and shut. */
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return (
    <div className={cx("grid transition-[grid-template-rows,opacity] duration-260 ease-motion", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")} aria-hidden={!open} inert={!open}>
      <div className="min-h-0 overflow-hidden">{(mounted || open) && children}</div>
    </div>
  );
}

// ---- Evidence drawer ----------------------------------------------------------------------

export function ShowMeHow({ how, inputs, evidence, className, label = "Show me how", both = false, graphic }: { how: string[]; inputs?: InputRow[]; evidence?: Evidence | null; className?: string; label?: string; both?: boolean; graphic?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!how.length && !inputs?.length && !evidence) return null;
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="group flex h-12 w-full items-center justify-between gap-2 text-left text-[0.86rem] font-medium text-ink-2 hover:text-ink sm:h-11">
        <span className="inline-flex items-center gap-2">
          <TrendingUp className="size-4 text-muted group-hover:text-ink-2" strokeWidth={1.75} aria-hidden />
          {label}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-normal text-muted">
          <span className="hidden sm:inline">{open ? "Hide" : evidence ? "The numbers behind it" : "How we worked it out"}</span>
          <ChevronDown className={cx("size-4 transition-transform duration-180", open && "rotate-180")} strokeWidth={1.75} />
        </span>
      </button>
      <Reveal open={open}>
        <div className="pb-5">
          {evidence && !both ? (
            <EvidenceView ev={evidence} graphic={graphic} />
          ) : (
            <div className="text-[0.86rem] leading-relaxed text-ink-2">
              {how.map((h, i) => (
                <p key={i} className="mb-2 max-w-[70ch]">{h}</p>
              ))}
              {evidence && (
                <div className="mt-4 border-t border-border pt-4">
                  <h4 className="mb-3 text-[0.7rem] font-medium tracking-[0.06em] text-muted uppercase">Behind the headline</h4>
                  <EvidenceView ev={evidence} />
                </div>
              )}
              {!!inputs?.length && !evidence && (
                <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 rounded-xl bg-surface-2/70 px-3.5 py-3 text-xs">
                  {inputs.map((r, i) => (
                    <div key={i} className="contents">
                      <dt className="text-muted">{r.label}</dt>
                      <dd className="num text-right text-ink">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>
      </Reveal>
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
    <article key={a.key} className="lab animate-rise-in overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--lab-card-shadow)]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
        <div className="flex min-w-0 flex-1 gap-3">
          <AreaTile area={a.area} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="text-xs font-medium text-ink-2">{AREA_LABEL[a.area]}</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted"><StarDots stars={a.stars} />{a.rating}</span>
            </div>
            <div className="mt-1 text-[1.02rem] leading-snug font-semibold text-ink">{a.title}</div>
            <p className="mt-1 line-clamp-2 text-sm text-ink-2">{a.story.todo}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-2">
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <MoneyLine a={a} size="md" />
            {!isOneOff(a) && <ImpactRange mid={a.monthly} low={a.low} high={a.high} size="sm" label={false} className="w-24" />}
          </div>
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

