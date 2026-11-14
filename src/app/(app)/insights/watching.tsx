"use client";

import { useState } from "react";
import { ChevronDown, Eye } from "lucide-react";
import { cx } from "@/components/ui";
import type { WatchItem } from "@/domain/lab";
import { AREA_LABEL } from "@/domain/lab";
import { Reveal } from "./deck";
import { EvidenceView } from "./evidence";
import { followOf, FollowSlope } from "./graphics";
import { signedPct, whole } from "./kit";
import { AREA_HUE, AREA_ICON } from "./visuals";

/**
 * Watching: things that looked like something on the raw numbers but don't hold up once we allow
 * for how busy you were, the weekday, the season and events — with what would make each count.
 * Never actions; they move to "Up next" by themselves if the numbers firm up. Calm on purpose:
 * one quiet card, each row with a tiny picture of its likely range against "no change".
 */
export function WatchList({ items }: { items: WatchItem[] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 5);
  const byArea = Object.entries(items.reduce<Record<string, number>>((m, w) => ((m[w.area] = (m[w.area] ?? 0) + 1), m), {}));
  return (
    <div className="lab overflow-clip rounded-2xl border border-border bg-surface shadow-[var(--lab-card-shadow)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border bg-[color-mix(in_oklab,var(--surface-2)_45%,var(--surface))] px-4 py-3 text-xs text-muted sm:px-5">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink-2"><Eye className="size-3.5" strokeWidth={1.9} aria-hidden /><span className="num">{items.length}</span> being watched</span>
        {byArea.map(([a, n]) => (
          <span key={a} className="inline-flex items-center gap-1"><span className="num text-ink-2">{n}</span> {AREA_LABEL[a as WatchItem["area"]].toLowerCase()}</span>
        ))}
        <span className="ml-auto hidden items-center gap-2 sm:inline-flex">
          <EffectGlyph effect={{ mid: 0.1, low: -0.2, high: 0.35 }} legend />
          likely range against no change
        </span>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((w) => (
          <WatchRow key={w.key} w={w} />
        ))}
      </ul>
      {items.length > 5 && (
        <button type="button" onClick={() => setAll((x) => !x)} className="flex h-12 w-full items-center justify-center gap-1 border-t border-border text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
          {all ? "Show fewer" : `Show ${items.length - 5} more`}
          <ChevronDown className={cx("size-4 transition-transform duration-180", all && "rotate-180")} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

function WatchRow({ w }: { w: WatchItem }) {
  const [open, setOpen] = useState(false);
  const Icon = AREA_ICON[w.area];
  const effect = w.evidence?.effect ?? null;
  const people = !effect && w.evidence?.chart?.type === "compare" && w.evidence.chart.unit === "people" ? w.evidence.chart.rows : null;
  const t = splitTitle(w.title);
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cx("flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors sm:gap-4 sm:px-5", open ? "bg-surface-2/40" : "hover:bg-surface-2/40")}>
        <Icon className="mt-[3px] size-4 shrink-0" strokeWidth={1.8} style={{ color: AREA_HUE[w.area] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[0.92rem] leading-snug font-medium text-ink">{t.head}</span>
            {t.status && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.7rem] font-medium whitespace-nowrap text-ink-2">{t.status}</span>}
          </div>
          {t.sub && <div className="mt-0.5 text-xs text-muted">{t.sub}</div>}
          <p className={cx("mt-1.5 text-[0.82rem] leading-relaxed text-ink-2", !open && "line-clamp-2")}>{w.summary}</p>
        </div>
        <div className="mt-0.5 hidden shrink-0 flex-col items-end gap-1 sm:flex">
          {effect && (
            <>
              <EffectGlyph effect={effect} />
              <span className="num text-[11px] text-muted">{signedPct(effect.low)} to {signedPct(effect.high)}</span>
            </>
          )}
          {people && <PeopleGlyph rows={people} />}
        </div>
        <ChevronDown className={cx("mt-1 size-4 shrink-0 text-muted transition-transform duration-180", open && "rotate-180")} strokeWidth={1.75} />
      </button>
      <Reveal open={open}>
        <div className="px-4 pt-2 pb-5 sm:pr-5 sm:pl-[3.25rem]">
          {w.evidence ? (
            <EvidenceView ev={{ ...w.evidence, summary: "", watch: w.evidence.watch ?? w.watch }} />
          ) : (
            <div className="text-[0.86rem] text-ink-2">{w.how.map((h, i) => <p key={i} className="mb-2">{h}</p>)}</div>
          )}
        </div>
      </Reveal>
    </li>
  );
}

/** "Since raising the Side of Fries $1 on Oct 5: no clear effect yet" → name, what changed, status. */
function splitTitle(title: string): { head: string; sub: string | null; status: string | null } {
  const m = title.match(/^Since (raising|cutting) the (.+?) (\$[\d.]+) on ([A-Z][a-z]{2} \d{1,2}): (.+)$/);
  if (m) return { head: m[2], sub: `${m[1] === "raising" ? "Price up" : "Price down"} ${m[3]} on ${m[4]}`, status: m[5].charAt(0).toUpperCase() + m[5].slice(1) };
  const s = title.match(/^(.+?) (sometimes has more people on than it needs|looks over-staffed on paper)$/);
  if (s) return { head: s[1], sub: null, status: s[2].startsWith("looks") ? "Staffed like other quiet hours" : "Sometimes over" };
  return { head: title, sub: null, status: null };
}

/** Tiny: the likely range as a bar, "no change" as a dark tick. A range across the tick is "could be nothing". */
function EffectGlyph({ effect, legend }: { effect: { mid: number; low: number; high: number }; legend?: boolean }) {
  const W = legend ? 44 : 84;
  // One shared scale for every row (−100% to +150%), so the glyphs compare at a glance.
  const lo = -1;
  const hi = 1.5;
  const x = (v: number) => 3 + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (W - 6);
  return (
    <svg width={W} height={14} aria-hidden className="block shrink-0">
      <line x1={0} x2={W} y1={7} y2={7} stroke="var(--lab-grid)" />
      <rect x={x(effect.low)} y={3} width={Math.max(2, x(effect.high) - x(effect.low))} height={8} rx={4} fill="var(--lab-context-2)" stroke="var(--lab-context)" strokeWidth={1} />
      <line x1={x(0)} x2={x(0)} y1={0} y2={14} stroke="var(--ink-2)" strokeWidth={1.5} />
      <circle cx={x(effect.mid)} cy={7} r={3} fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}

/** Tiny: people on (dot) against what hours this quiet usually get (tick). */
function PeopleGlyph({ rows }: { rows: { label: string; value: number }[] }) {
  const on = rows[0]?.value ?? 0;
  const usual = rows.find((r) => /usually/i.test(r.label))?.value ?? rows[1]?.value ?? 0;
  return (
    <span className="inline-flex items-baseline gap-1 text-[11px] text-muted">
      <span className="num font-semibold text-ink-2">{on}</span> on · usual <span className="num text-ink-2">{usual}</span>
    </span>
  );
}

/** Price changes that worked (Track record): each with its before → after picture when we have one. */
export function PriceWins({ items }: { items: { key: string; title: string; monthly: number; evidence: WatchItem["evidence"] }[] }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((p) => {
        const f = followOf(p.evidence);
        return (
          <li key={p.key} className="px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-medium text-ink">{p.title}</span>
              {p.monthly > 0 && <span className="num shrink-0 text-sm font-semibold text-ink">+{whole(p.monthly)}<span className="text-xs font-normal text-muted">/mo</span></span>}
            </div>
            {f && <div className="mt-3"><FollowSlope f={f} small /></div>}
          </li>
        );
      })}
    </ul>
  );
}
