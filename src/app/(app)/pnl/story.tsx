/**
 * Server-rendered pieces of the P&L story: the change chips, the notes in
 * plain English and the figures for the sales → profit bridge.
 */

import { cx } from "@/components/ui";
import { HelpTip } from "@/components/help";
import type { Finding } from "@/components/chapter";
import type { Bridge, StoryNote } from "@/domain/pnlStory";
import { TYPICAL_COST_SHARE } from "@/domain/pnlStory";
import { dayDate, money, pct, shortDate } from "@/lib/format";
import { ArrowDownRight, ArrowUpRight, CalendarHeart, CreditCard, Minus, Tag, Target, TrendingDown, TrendingUp, Users, UtensilsCrossed, type LucideIcon } from "lucide-react";
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
  fees: CreditCard,
  discounts: Tag,
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
    case "fees":
      return <>Card fees were <b className="font-medium text-ink">{pct(n.pct, 1)} of sales</b> ({whole(n.fees)}), {pts(n.pct - n.prevPct)} {n.pct > n.prevPct ? "higher" : "lower"} than {n.label} ({pct(n.prevPct, 1)}).</>;
    case "discounts":
      return <>Comps &amp; discounts came to <b className="font-medium text-ink">{whole(n.amount)}</b>, {pct(n.pct, 1)} of what items rang up at, against {whole(n.prevAmount)} ({pct(n.prevPct, 1)}) {n.label}{n.top && n.top.amount > 0 ? <>. The biggest was {n.top.name} at {whole(n.top.amount)}</> : null}.</>;
    case "forecast":
      return <>Sales came in <b className="font-medium text-ink">{pctAbs(n.change)} {n.change < 0 ? "under" : "over"}</b> what the forecast expected ({whole(n.actual)} vs {whole(n.forecast)}).</>;
  }
}

/** A note as a finding: a short heading, the sentence behind it, what to do, and the chapter it lives in. */
export function noteFinding(n: StoryNote): { id: string; point: Finding } {
  const ptsWord = (a: number, b: number) => `${Math.abs((a - b) * 100).toFixed(1)} points ${a > b ? "higher" : "lower"}`;
  switch (n.kind) {
    case "sales":
      return { id: "moved-sales", point: { tone: "neutral", title: n.prev ? (Math.abs(n.prev.change) < 0.005 ? `Sales were level with ${n.prev.label}` : `Sales were ${upDown(n.prev.change)} ${pctAbs(n.prev.change)} on ${n.prev.label}`) : `Sales were ${whole(n.sales)}`, detail: plainNote(n), action: null } };
    case "labor":
      return { id: "moved-labor", point: { tone: n.tone, title: `Labor was ${ptsWord(n.pct, n.prevPct)} than ${n.label}`, detail: plainNote(n), action: n.tone === "warn" ? "Trim the quietest shifts on next week's schedule." : null } };
    case "food":
      return { id: "moved-food", point: { tone: n.tone, title: `Food cost ran ${ptsWord(n.pct, n.prevPct)} than ${n.label}`, detail: plainNote(n), action: n.tone === "warn" ? "Menu costs shows which dishes cost more to make." : null } };
    case "bestDay":
      return { id: "days", point: { tone: "neutral", title: `Best day: ${dayDate(n.date)}, with ${whole(n.sales)}`, detail: plainNote(n), action: null } };
    case "lossDays":
      return { id: "days", point: { tone: "warn", title: n.days.length === 1 ? `${dayDate(n.days[0].date)} lost money` : `${n.days.length} days lost money`, detail: plainNote(n), action: "Check what was on the schedule those days against what came in." } };
    case "forecast":
      return { id: "moved-forecast", point: { tone: n.tone === "good" ? "good" : "neutral", title: `Sales came in ${pctAbs(n.change)} ${n.change < 0 ? "under" : "over"} the forecast`, detail: plainNote(n), action: null } };
    case "fees":
      return { id: "moved-fees", point: { tone: n.tone, title: `Card fees were ${pct(n.pct, 1)} of sales, ${ptsWord(n.pct, n.prevPct)} than ${n.label}`, detail: plainNote(n), action: null } };
    case "discounts":
      return { id: "moved-discounts", point: { tone: n.tone, title: `Comps and discounts came to ${whole(n.amount)}`, detail: plainNote(n), action: n.tone === "warn" ? "Comps & discounts, further down, shows who rang them up and why." : null } };
  }
}

/** noteText as plain words, for a chapter's line. */
function plainNote(n: StoryNote): string {
  switch (n.kind) {
    case "sales": {
      const parts = [n.prev && (Math.abs(n.prev.change) < 0.005 ? `level with ${n.prev.label}` : `${upDown(n.prev.change)} ${pctAbs(n.prev.change)} on ${n.prev.label}`), n.year && `${upDown(n.year.change)} ${pctAbs(n.year.change)} on ${n.year.label}`].filter(Boolean);
      return `Sales were ${whole(n.sales)}${parts.length ? `, ${parts.join(" and ")}` : ""}.`;
    }
    case "labor": {
      const why =
        Math.abs(n.laborChange) < 0.05
          ? `Sales were ${pctAbs(n.salesChange)} ${n.salesChange < 0 ? "lower" : "higher"} while labor cost stayed about the same (${whole(n.labor)})`
          : `Sales ${n.salesChange < 0 ? "fell" : "rose"} ${pctAbs(n.salesChange)} while labor cost ${n.laborChange < 0 ? "fell" : "rose"} ${pctAbs(n.laborChange)}${n.hoursChange != null && Math.abs(n.hoursChange) >= 0.02 ? ` on ${pctAbs(n.hoursChange)} ${n.hoursChange < 0 ? "fewer" : "more"} hours` : ""}`;
      return `${pct(n.pct, 1)} of sales against ${pct(n.prevPct, 1)}. ${why}.`;
    }
    case "food":
      return `${pct(n.pct, 1)} against ${pct(n.prevPct, 1)}, on items linked to a recipe.`;
    case "bestDay":
      return `${pct(n.share, 0)} of the period's sales came in that day.`;
    case "lossDays": {
      const [w] = n.days;
      if (n.days.length === 1) return `It lost ${whole(w.loss)} once food, drink and labor were paid: ${whole(w.sales)} in sales against ${whole(w.labor)} of labor.`;
      return `Once food, drink and labor were paid (${n.days.map((d) => shortDate(d.date)).join(", ")}). The worst was ${dayDate(w.date)}, down ${whole(w.loss)}.`;
    }
    case "fees":
      return `${whole(n.fees)} in card fees, against ${pct(n.prevPct, 1)} of sales ${n.label}.`;
    case "discounts":
      return `${pct(n.pct, 1)} of what items rang up at, against ${whole(n.prevAmount)} (${pct(n.prevPct, 1)}) ${n.label}${n.top && n.top.amount > 0 ? `. The biggest was ${n.top.name} at ${whole(n.top.amount)}` : ""}.`;
    case "forecast":
      return `${whole(n.actual)} against a forecast of ${whole(n.forecast)}.`;
  }
}

/**
 * Two or three figures side by side as bars on one scale: this period in its
 * money colour, the comparisons in grey, with the figure at the end of each.
 */
export function CompareBars({ rows, format }: { rows: { label: string; value: number; color?: string; target?: boolean }[]; format: (n: number) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-x-3 sm:grid-cols-[11rem_1fr]">
          <span className={cx("truncate text-sm", r.color ? "font-medium text-ink" : "text-ink-2")}>{r.label.charAt(0).toUpperCase() + r.label.slice(1)}</span>
          <span className="flex min-w-0 items-center gap-2">
            {r.target ? (
              <span aria-hidden className="h-2.5 min-w-[2px] rounded-r-[4px] border border-dashed border-border-strong" style={{ width: `calc((100% - 4.5rem) * ${(Math.abs(r.value) / max).toFixed(4)})` }} />
            ) : (
              <span aria-hidden className="h-2.5 min-w-[2px] rounded-r-[4px]" style={{ width: `calc((100% - 4.5rem) * ${(Math.abs(r.value) / max).toFixed(4)})`, background: r.color ?? "var(--border-strong)" }} />
            )}
            <span className={cx("num text-sm whitespace-nowrap", r.color ? "font-semibold text-ink" : "text-ink-2")}>{format(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
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

/**
 * Waterfall steps from a bridge: what items rang up at and the comps &
 * discounts off it (when Square has them), net sales, costs taken off, card
 * fees, profit, then fixed costs when set.
 */
export function bridgeSteps(b: Bridge, opts: { hours: number; feeNote?: string }): BridgeStep[] {
  const steps: BridgeStep[] = [];
  if (b.discounts > 0) {
    steps.push({ key: "gross", label: "Before discounts", value: b.grossSales, from: 0, to: b.grossSales, total: true });
    steps.push({ key: "discounts", label: "Comps & discounts", value: b.discounts, from: b.grossSales, to: b.sales, note: `${pct(b.grossSales > 0 ? b.discounts / b.grossSales : 0, 1)} of what items rang up at; already out of net sales` });
  }
  steps.push({ key: "sales", label: "Net sales", value: b.sales, from: 0, to: b.sales, total: true });
  let at = b.sales;
  if (b.cogs > 0 || !b.estimated) steps.push({ key: "cogs", label: "Food & drink cost", value: b.cogs, from: at, to: (at -= b.cogs) });
  if (b.estimated) steps.push({ key: "est", label: "Not-linked items", value: b.cogsEstimate, from: at, to: (at -= b.cogsEstimate), note: `Estimated at a typical ${pct(TYPICAL_COST_SHARE, 0)} of their ${whole(b.cogsEstimate / TYPICAL_COST_SHARE)} in sales` });
  // No timecards is "not in", never a $0 cost.
  if (b.labor <= 0) steps.push({ key: "labor", label: "Labor", value: 0, from: at, to: at, missing: true, note: "No timecards for these days, so profit reads high" });
  else steps.push({ key: "labor", label: "Labor", value: b.labor, from: at, to: (at -= b.labor), note: opts.hours > 0 ? `${Math.round(opts.hours).toLocaleString("en-US")} hours, incl. employer taxes` : undefined });
  if (b.fees !== 0) steps.push({ key: "fees", label: <span className="inline-flex items-center gap-1">Card fees <HelpTip id="pnl.fees" /></span>, value: b.fees, from: at, to: (at -= b.fees), note: opts.feeNote });
  steps.push({ key: "profit", label: "Profit before overhead", value: b.profit, from: 0, to: b.profit, total: true });
  if (b.fixed != null && b.afterFixed != null) {
    steps.push({ key: "fixed", label: "Rent & fixed costs", value: b.fixed, from: b.profit, to: b.afterFixed });
    steps.push({ key: "after", label: "After fixed costs", value: b.afterFixed, from: 0, to: b.afterFixed, total: true });
  }
  return steps;
}
