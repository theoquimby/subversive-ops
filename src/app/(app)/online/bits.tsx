import { cx, Dot, LinkButton } from "@/components/ui";
import { ONLINE_RANGES, type Channel, type Delta, type ListingViewMetric, type LookItem, type OnlineRangeId, type SourceState, type Span } from "@/domain/online";
import { shortDate } from "@/lib/format";
import { ArrowDownRight, ArrowUpRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Pieces shared by the Online pages (Overview, Google listing, Instagram, Facebook). Server
 * components; no state. The colours here follow the thing, never its rank:
 * the page's hue for Google, greys for everything people do on their own.
 */

export const n0 = (n: number) => Math.round(n).toLocaleString("en-US");

export interface Fill {
  fill: string;
  opacity: number;
}

/** Website visits by channel: the hue for search and maps, greys for the rest. */
export const CHANNEL_FILL: Record<Channel, Fill> = {
  "google-search": { fill: "var(--area)", opacity: 0.92 },
  "google-listing": { fill: "var(--area)", opacity: 0.55 },
  "search-other": { fill: "var(--area)", opacity: 0.28 },
  direct: { fill: "var(--ink)", opacity: 0.72 },
  social: { fill: "var(--ink-2)", opacity: 0.58 },
  email: { fill: "var(--ink-2)", opacity: 0.42 },
  listings: { fill: "var(--ink-2)", opacity: 0.3 },
  other: { fill: "color-mix(in oklab, var(--ink) 16%, var(--surface))", opacity: 1 },
};

/** The two places a listing is shown, and the two sides of "what they did next". */
export const MAPS_FILL: Fill = { fill: "var(--area)", opacity: 0.88 };
export const SEARCH_FILL: Fill = { fill: "var(--ink-2)", opacity: 0.55 };
export const LISTING_FILL: Fill = MAPS_FILL;
export const WEBSITE_FILL: Fill = { fill: "var(--ink-2)", opacity: 0.55 };
/** Instagram and the Facebook Page, where they share a step. Each bar is also named, so the tint isn't the only cue. */
export const INSTAGRAM_FILL: Fill = { fill: "var(--area)", opacity: 0.45 };
export const FACEBOOK_FILL: Fill = { fill: "var(--ink-2)", opacity: 0.28 };

export const VIEW_FILL: Record<ListingViewMetric, Fill> = {
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: { fill: "var(--area)", opacity: 0.9 },
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: { fill: "var(--area)", opacity: 0.45 },
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: { fill: "var(--ink-2)", opacity: 0.7 },
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: { fill: "var(--ink-2)", opacity: 0.3 },
};

/** 7 days · 28 days · 3 months · 12 months, as links that keep the page where it is. */
export function RangeChips({ base, range }: { base: string; range: OnlineRangeId }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period">
      {ONLINE_RANGES.map((r) => (
        <Link
          key={r.id}
          href={r.id === "28d" ? base : `${base}?range=${r.id}`}
          scroll={false}
          aria-current={r.id === range ? "true" : undefined}
          className={cx("inline-flex h-10 items-center rounded-full border px-3 text-sm whitespace-nowrap sm:h-8", r.id === range ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}

/** "Oct 18 – Nov 14" */
export const spanText = (s: Span) => `${shortDate(s.from)} – ${shortDate(s.to)}`;

/** The change against the period before, in words. Colour only when it is bigger than normal ups and downs. */
export function Change({ d, period, compact }: { d: Delta; period: string; compact?: boolean }) {
  if (d.trend == null) return <span className="text-muted">{compact ? "" : "Nothing earlier to compare with yet"}</span>;
  if (d.trend === "new") return <span className="text-muted">{compact ? "new" : `None in the ${period} before`}</span>;
  const points = d.change == null ? 0 : Math.round(Math.abs(d.change) * 100);
  const size = d.change == null || points === 0 ? "" : `${d.change >= 0 ? "+" : "−"}${points}%`;
  if (d.trend === "same") return <span className="text-muted">{compact ? size || "no change" : `About the same${size ? ` (${size})` : ""}`}</span>;
  const up = d.trend === "up";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx("inline-flex items-center gap-0.5 font-medium", up ? "text-good" : "text-bad")}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="num">{size}</span>
      {!compact && <span className="font-normal text-muted">&nbsp;vs the {period} before</span>}
    </span>
  );
}

/** What a block says while its source isn't connected, is waiting, or failed to load. */
export function Notice({ state, bare }: { state: SourceState; /** Inside a card of its own: no dashed frame. */ bare?: boolean }) {
  return (
    <div className={cx(!bare && "rounded-lg border border-dashed border-border-strong px-4 py-3.5")}>
      <div className="text-sm font-medium text-ink">{state.title}</div>
      <p className="mt-1 max-w-prose text-sm text-pretty text-muted">{state.body}</p>
      {state.href && state.action && (
        <LinkButton href={state.href} size="sm" variant="secondary" className="mt-3 h-10 sm:h-8">
          {state.action}
        </LinkButton>
      )}
    </div>
  );
}

export interface BarPart {
  key: string;
  label: string;
  value: number;
  fill: Fill;
}

/** A whole split into its parts as one proportional bar, with each part's number and share beneath it. */
export function PartsBar({ parts, what, columns = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" }: { parts: BarPart[]; what: string; columns?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  const share = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : "—");
  return (
    <div>
      <div className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${n0(total)} ${what}: ${parts.map((p) => `${n0(p.value)} ${p.label}`).join(", ")}`}>
        {shown.length === 0 ? <div className="h-full w-full bg-surface-2" /> : shown.map((p) => <div key={p.key} title={`${p.label}: ${n0(p.value)} (${share(p.value)})`} className="h-full min-w-1.5" style={{ flexGrow: p.value, flexBasis: 0, background: p.fill.fill, opacity: p.fill.opacity }} />)}
      </div>
      <dl className={cx("mt-3 grid gap-x-4 gap-y-3", columns)}>
        {parts.map((p) => (
          <div key={p.key} className="min-w-0">
            <dt className="flex items-start gap-1.5 text-xs leading-snug text-muted">
              <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full" style={{ background: p.fill.fill, opacity: p.fill.opacity }} />
              <span className="min-w-0 text-pretty">{p.label}</span>
            </dt>
            <dd className={cx("num mt-0.5 flex items-baseline gap-1.5 text-lg font-semibold tracking-tight", p.value === 0 && "text-muted")}>
              {n0(p.value)}
              <span className="text-xs font-normal text-muted">{share(p.value)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A coloured square and a name, for a chart with more than one series. */
export function SquareKey({ items }: { items: { label: string; fill: Fill }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: i.fill.fill, opacity: i.fill.opacity }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * One measure of a small-multiples card: what it counts and its total on the
 * left, its trend on the right (underneath on a phone). `children` is the
 * chart, or a notice while the source isn't ready.
 */
export function MeasureRow({ icon, title, counts, value, change, note, children, id }: { icon?: ReactNode; title: ReactNode; counts: string; value?: ReactNode; change?: ReactNode; note?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div id={id} className="grid scroll-mt-24 gap-x-6 gap-y-3 p-4 sm:p-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {icon && <span aria-hidden className="shrink-0 text-area [&>svg]:size-4">{icon}</span>}
          <span className="min-w-0">{title}</span>
        </h3>
        <p className="mt-0.5 text-xs text-pretty text-muted">{counts}</p>
        {value != null && <div className="num mt-2 text-[1.6rem] leading-tight font-semibold tracking-tight">{value}</div>}
        {change && <div className="mt-0.5 text-xs">{change}</div>}
        {note && <div className="mt-2 text-xs text-pretty text-muted">{note}</div>}
      </div>
      <div className="min-w-0 self-center">{children}</div>
    </div>
  );
}

/** Things the numbers show that are worth a look, most serious first: one line each, the whole row a link. */
export function LookList({ items }: { items: LookItem[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {items.map((i) => (
        <li key={i.key}>
          <Link href={i.href} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-120 hover:bg-surface-2/60 active:bg-surface-2">
            <Dot tone={i.tone} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-pretty">{i.title}</span>
              <span className="line-clamp-2 block text-xs text-pretty text-muted">{i.detail}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A quiet link at the foot of a card to the page that has the detail. */
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline sm:min-h-0">
      {children} <ChevronRight className="size-3.5" aria-hidden />
    </Link>
  );
}
