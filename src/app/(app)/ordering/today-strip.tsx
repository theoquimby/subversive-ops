"use client";

import { Button, cx, LinkButton } from "@/components/ui";
import { capPerKind, clock, todayCounts, type TodayItem } from "@/domain/orderingBoard";
import { dayDate, money } from "@/lib/format";
import { CalendarClock, FileText, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { draftOrders } from "./actions";
import { Countdown } from "./countdown";

/** `items`: linked products (no Draft button without any). */
export type TodayEntry = TodayItem & { at: number | null; items: number };

const ICON = { deadline: CalendarClock, draft: FileText, checkin: PackageCheck, arriving: Truck } as const;

const when = (d: string, today: string, tomorrow: string) => (d === today ? "today" : d === tomorrow ? "tomorrow" : dayDate(d));
const summary = (i: TodayItem) => [i.total != null ? money(i.total) : null, i.lines != null ? `${i.lines} line${i.lines === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");

/** One deadline: Build order (the builder) or Draft (the suggested order, saved as a draft in one tap). */
function DraftNow({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button size="sm" className="h-10 sm:h-8" disabled={pending} title="Save the suggested order as a draft" onClick={() => start(async () => {
        setError(null);
        const r = await draftOrders([supplierId]);
        if (r.error) setError(r.error);
        else if (r.orderIds?.[0]) router.push(`/ordering/po/${r.orderIds[0]}`);
        else router.refresh();
      })}>{pending ? "Drafting…" : "Draft"}</Button>
      {error && <p role="alert" className="max-w-56 text-xs text-bad">{error}</p>}
    </>
  );
}

function Tile({ i, today, tomorrow }: { i: TodayEntry; today: string; tomorrow: string }) {
  const Icon = ICON[i.kind];
  const title =
    i.kind === "deadline" ? <>Order by {clock(i.deadline!.cutoffTime)} {when(i.deadline!.cutoffDate, today, tomorrow)}</>
    : i.kind === "draft" ? <>Draft to send{i.deadline ? <> by {clock(i.deadline.cutoffTime)} {when(i.deadline.cutoffDate, today, tomorrow)}</> : null}</>
    : i.kind === "checkin" ? (i.late ? <>Was due {dayDate(i.deliveryDate)}</> : <>Arrives today</>)
    : <>Arrives tomorrow</>;
  const sub = i.kind === "deadline" || i.kind === "checkin" && i.late ? `for ${dayDate(i.deliveryDate)}` : i.kind === "draft" ? [`for ${dayDate(i.deliveryDate)}`, summary(i)].filter(Boolean).join(" · ") : summary(i);
  const href = i.orderId ? `/ordering/po/${i.orderId}` : `/ordering/${i.supplierId}`;
  return (
    <li className="flex min-w-0 items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
      <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg", i.kind === "deadline" ? "bg-warn-bg text-warn" : i.kind === "checkin" ? (i.late ? "bg-bad-bg text-bad" : "bg-good-bg text-good") : "bg-surface-2 text-ink-2")}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={href} className="truncate font-medium text-ink hover:underline">{i.supplierName}</Link>
          {i.at != null && <Countdown at={i.at} />}
        </div>
        <div className="num truncate text-xs text-muted"><span className="text-ink-2">{title}</span>{sub && <> · {sub}</>}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {i.kind === "deadline" ? (
          <>
            <LinkButton href={href} size="sm" variant="primary" className="h-10 sm:h-8" data-tour="ordering.supplier-card"><span className="sm:hidden">Build</span><span className="hidden sm:inline">Build order</span></LinkButton>
            {i.items > 0 && <span className="hidden sm:contents"><DraftNow supplierId={i.supplierId} /></span>}
          </>
        ) : (
          <LinkButton href={href} size="sm" variant={i.kind === "arriving" ? "ghost" : "primary"} className="h-10 sm:h-8">
            {i.kind === "draft" ? <><span className="sm:hidden">Send</span><span className="hidden sm:inline">Review &amp; send</span></> : i.kind === "checkin" ? "Check in" : "Open"}
          </LinkButton>
        )}
      </div>
    </li>
  );
}

/** What needs doing now: deadlines in the next 48 hours, drafts to send, trucks to check in and tomorrow's. */
export function TodayStrip({ items, today, tomorrow, nextUp }: { items: TodayEntry[]; today: string; tomorrow: string; nextUp?: { name: string; supplierId: string; at: number | null; label: string } | null }) {
  const [all, setAll] = useState(false);
  const c = todayCounts(items);
  const head = [
    c.deadline && `${c.deadline} deadline${c.deadline === 1 ? "" : "s"} soon`,
    c.draft && `${c.draft} draft${c.draft === 1 ? "" : "s"} to send`,
    c.checkin && `${c.checkin} to check in`,
    c.arriving && `${c.arriving} arriving tomorrow`,
  ].filter(Boolean).join(" · ");
  const first = capPerKind(items);
  const shown = all ? items : first;
  return (
    <section aria-labelledby="ordering-today" className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="ordering-today" className="text-[0.95rem] font-semibold text-ink">Today</h2>
        <span className="text-sm text-muted">{items.length ? head : "Nothing needs you right now."}</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm text-muted">
          No deadlines in the next 48 hours, no drafts waiting and nothing to check in.
          {nextUp && <> Next deadline: <Link href={`/ordering/${nextUp.supplierId}`} className="text-ink-2 hover:underline">{nextUp.name}</Link>, {nextUp.label} {nextUp.at != null && <Countdown at={nextUp.at} quiet />}</>}
        </div>
      ) : (
        <>
          <ul className="grid overflow-hidden rounded-xl border border-border bg-surface lg:grid-cols-2 lg:[&>li:nth-last-child(2):nth-child(odd)]:border-b-0 lg:[&>li:nth-child(odd)]:border-r">
            {shown.map((i) => <Tile key={i.key} i={i} today={today} tomorrow={tomorrow} />)}
          </ul>
          {items.length > first.length && (
            <Button size="sm" variant="ghost" className="mt-2 h-10 sm:h-8" onClick={() => setAll((a) => !a)} aria-expanded={all}>
              {all ? "Show fewer" : `Show ${items.length - first.length} more`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
