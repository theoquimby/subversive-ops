/**
 * Server-rendered pieces of the P&L story: the change chips, the notes in
 * plain English and the figures for the sales → profit bridge.
 */

import { cx } from "@/components/ui";
import type { Bridge, StoryNote } from "@/domain/pnlStory";
import { TYPICAL_COST_SHARE } from "@/domain/pnlStory";
import { dayDate, money, pct, shortDate } from "@/lib/format";
import { ArrowDownRight, ArrowUpRight, CalendarHeart, Minus, Target, TrendingDown, TrendingUp, Users, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { BridgeStep } from "./story-charts";

const whole = (n: number) => money(n, { whole: true });
const signedMoney = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${whole(Math.abs(n))}`;
const pts = (n: number) => `${Math.abs(n * 100).toFixed(1)} points`;
const pctAbs = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;

/**
 * A change against an earlier period: arrow + amount + what it's against.
 * `goodWhenUp` sets the color: profit up is good, labor % up is not.
 */
export function Delta({ value, format, label, goodWhenUp = true, flatBelow = 0, compact }: { value: number | null; format: (n: number) => string; label: ReactNode; goodWhenUp?: boolean; flatBelow?: number; /** Hide the label on phones (a caption names the comparison). */ compact?: boolean }) {
  if (value == null || !isFinite(value)) return null;
  const flat = Math.abs(value) <= flatBelow;
  const up = value > 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-[0.8rem] text-muted">
      <span className={cx("num inline-flex shrink-0 items-center gap-0.5 font-medium", good == null ? "text-ink-2" : good ? "text-good" : "text-bad")}>
        <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
        {flat ? "flat" : format(value)}
      </span>
      <span className={cx("truncate", compact && "max-sm:hidden")}>{label}</span>
    </span>
  );
}

export const fmt = {
  money: (n: number) => signedMoney(n),
  pts: (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)} pts`,
  pct: (n: number) => `${n > 0 ? "+" : "−"}${pctAbs(n)}`,
};

/** "the same days last week" → "same days last week" for short chips. */
export const chipLabel = (label: string) => `vs ${label.replace(/^the /, "")}`;

const NOTE_ICON: Record<StoryNote["kind"], LucideIcon> = {
  sales: TrendingUp,
  labor: Users,
  food: UtensilsCrossed,
  bestDay: CalendarHeart,
  lossDays: TrendingDown,
  forecast: Target,
};

const upDown = (n: number) => (n >= 0 ? "up" : "down");

function noteText(n: StoryNote): ReactNode {
  switch (n.kind) {
    case "sales": {
      const parts = [n.prev && `${upDown(n.prev.change)} ${pctAbs(n.prev.change)} on ${n.prev.label}`, n.year && `${upDown(n.year.change)} ${pctAbs(n.year.change)} on ${n.year.label}`].filter(Boolean);
      return <>Sales were <b className="font-medium text-ink">{whole(n.sales)}</b>{parts.length ? `, ${parts.join(" and ")}` : ""}.</>;
    }
    case "labor": {
      const dir = n.pct > n.prevPct ? "higher" : "lower";
      const why =
        Math.abs(n.laborChange) < 0.05
          ? `sales were ${pctAbs(n.salesChange)} ${n.salesChange < 0 ? "lower" : "higher"} while labor cost stayed about the same (${whole(n.labor)})`
          : `sales ${n.salesChange < 0 ? "fell" : "rose"} ${pctAbs(n.salesChange)} while labor cost ${n.laborChange < 0 ? "fell" : "rose"} ${pctAbs(n.laborChange)}${n.hoursChange != null && Math.abs(n.hoursChange) >= 0.02 ? ` on ${pctAbs(n.hoursChange)} ${n.hoursChange < 0 ? "fewer" : "more"} hours` : ""}`;
      return <>Labor was <b className="font-medium text-ink">{pts(n.pct - n.prevPct)} {dir}</b> than {n.label} ({pct(n.pct, 1)} vs {pct(n.prevPct, 1)}): {why}.</>;
    }
    case "food":
      return <>Food cost ran <b className="font-medium text-ink">{pts(n.pct - n.prevPct)} {n.pct > n.prevPct ? "higher" : "lower"}</b> than {n.label} ({pct(n.pct, 1)} vs {pct(n.prevPct, 1)}) on items linked to a recipe.</>;
    case "bestDay":
      return <>Best day: <b className="font-medium text-ink">{dayDate(n.date)}</b> with {whole(n.sales)}, {pct(n.share, 0)} of sales.</>;
    case "lossDays": {
      const [w] = n.days;
      if (n.days.length === 1) return <><b className="font-medium text-ink">{dayDate(w.date)}</b> lost {whole(w.loss)} once food, drink and labor were paid: {whole(w.sales)} in sales against {whole(w.labor)} of labor.</>;
      return <><b className="font-medium text-ink">{n.days.length} days</b> lost money once food, drink and labor were paid ({n.days.map((d) => shortDate(d.date)).join(", ")}). The worst was {dayDate(w.date)}, down {whole(w.loss)}.</>;
    }
    case "forecast":
      return <>Sales came in <b className="font-medium text-ink">{pctAbs(n.change)} {n.change < 0 ? "under" : "over"}</b> what the forecast expected ({whole(n.actual)} vs {whole(n.forecast)}).</>;
  }
}

const toneDot: Record<StoryNote["tone"], string> = { good: "bg-good-bg text-good", warn: "bg-warn-bg text-warn", neutral: "bg-surface-2 text-ink-2" };

export function StoryNotes({ notes }: { notes: StoryNote[] }) {
  return (
    <ul className="divide-y divide-border">
      {notes.map((n, i) => {
        const Icon = n.kind === "sales" && n.prev && n.prev.change < 0 ? TrendingDown : NOTE_ICON[n.kind];
        return (
          <li key={i} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <span aria-hidden className={cx("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", toneDot[n.tone])}>
              <Icon className="size-3.5" strokeWidth={2} />
            </span>
            <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-2">{noteText(n)}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** Waterfall steps from a bridge: sales, costs taken off, profit, then fixed costs when set. */
export function bridgeSteps(b: Bridge, opts: { hours: number }): BridgeStep[] {
  const steps: BridgeStep[] = [{ key: "sales", label: "Net sales", value: b.sales, from: 0, to: b.sales, total: true }];
  let at = b.sales;
  steps.push({ key: "cogs", label: "Food & drink cost", value: b.cogs, from: at, to: (at -= b.cogs) });
  if (b.estimated) steps.push({ key: "est", label: "Not-linked items", value: b.cogsEstimate, from: at, to: (at -= b.cogsEstimate), note: `Estimated at a typical ${pct(TYPICAL_COST_SHARE, 0)} of their ${whole(b.cogsEstimate / TYPICAL_COST_SHARE)} in sales` });
  steps.push({ key: "labor", label: "Labor", value: b.labor, from: at, to: (at -= b.labor), note: opts.hours > 0 ? `${Math.round(opts.hours).toLocaleString("en-US")} hours, incl. employer taxes` : undefined });
  steps.push({ key: "profit", label: "Profit before overhead", value: b.profit, from: 0, to: b.profit, total: true });
  if (b.fixed != null && b.afterFixed != null) {
    steps.push({ key: "fixed", label: "Rent & fixed costs", value: b.fixed, from: b.profit, to: b.afterFixed });
    steps.push({ key: "after", label: "After fixed costs", value: b.afterFixed, from: 0, to: b.afterFixed, total: true });
  }
  return steps;
}
