import { ShowMore } from "@/components/show-more";
import { cx, Dot, type Tone } from "@/components/ui";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

/**
 * Pieces of the Kegs home: the fleet as one proportional bar, and the short
 * list of things that need someone. Server components; no state.
 */

export interface FleetPart {
  key: string;
  label: string;
  count: number;
  href: string;
  /** CSS colour and opacity for this part of the bar. */
  fill: string;
  opacity?: number;
}

/** Every keg in service as one bar, split by where it is. Each part and its number link to those kegs. */
export function FleetBar({ parts }: { parts: FleetPart[] }) {
  const total = parts.reduce((s, p) => s + p.count, 0);
  const shown = parts.filter((p) => p.count > 0);
  return (
    <div>
      <div className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${total} kegs in service: ${parts.map((p) => `${p.count} ${p.label.toLowerCase()}`).join(", ")}`}>
        {shown.length === 0 ? <div className="h-full w-full bg-surface-2" /> : shown.map((p) => (
          <Link key={p.key} href={p.href} title={`${p.count} ${p.label.toLowerCase()}`} aria-hidden tabIndex={-1} className="h-full min-w-1.5 transition-opacity duration-120 hover:opacity-80" style={{ flexGrow: p.count, flexBasis: 0, background: p.fill, opacity: p.opacity ?? 1 }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-5">
        {parts.map((p) => (
          <Link key={p.key} href={p.href} className="group min-w-0 rounded-md outline-offset-4">
            <dt className="flex items-center gap-1.5 text-xs text-muted">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: p.fill, opacity: p.opacity ?? 1 }} />
              <span className="truncate group-hover:text-ink">{p.label}</span>
            </dt>
            <dd className={cx("num mt-0.5 text-xl font-semibold tracking-tight", p.count === 0 && "text-muted")}>{p.count}</dd>
          </Link>
        ))}
      </dl>
    </div>
  );
}

export interface NeedsItem {
  key: string;
  tone: Tone;
  title: string;
  detail?: string;
  href: string;
}

/** What needs someone, most urgent first: one line each, the whole row a link. A long list shows the first few. */
export function NeedsList({ items, limit = 6 }: { items: NeedsItem[]; limit?: number }) {
  return (
    <ShowMore as="ul" limit={limit} noun={["thing", "things"]} className="divide-y divide-border rounded-xl border border-border bg-surface">
      {items.map((i) => (
        <li key={i.key}>
          <Link href={i.href} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors duration-120 hover:bg-surface-2/60 active:bg-surface-2">
            <Dot tone={i.tone} />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 block text-sm font-medium text-pretty sm:line-clamp-1">{i.title}</span>
              {i.detail && <span className="block truncate text-xs text-muted">{i.detail}</span>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" />
          </Link>
        </li>
      ))}
    </ShowMore>
  );
}
