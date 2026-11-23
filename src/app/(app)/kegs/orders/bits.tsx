import { Badge, Table, Td, Th, Tr } from "@/components/ui";
import type { ISODate } from "@/domain/dates";
import { dueTone, progressLabel, transitLabel, type KegOrderStatus } from "@/domain/kegOrders";
import { kegSizeInfo } from "@/domain/kegs";
import { businessDateOf, shortDate } from "@/lib/format";
import type { OrderRow } from "@/server/services/kegOrders";
import Link from "next/link";

/** "2 × Subversive IPA 1/2 bbl, 1 × Catskill Stout 1/6 bbl" */
export const linesSummary = (lines: { beer: string; sizeId: string; quantity: number }[]) => lines.map((l) => `${l.quantity} × ${l.beer} ${kegSizeInfo(l.sizeId).short}`).join(", ");

/** When an order is due: a plain date, "Today", or "Overdue" with the date it was due. */
export function DueBadge({ dueOn, today }: { dueOn: ISODate | null; today: ISODate }) {
  if (!dueOn) return <span className="text-muted">No date</span>;
  const d = dueTone(dueOn, today);
  if (d.kind === "today") return <Badge tone="warn">Today</Badge>;
  if (d.kind === "overdue") return <Badge tone="bad">Overdue · {shortDate(dueOn)}</Badge>;
  return <span className="whitespace-nowrap text-ink-2">{shortDate(dueOn)}</span>;
}

export function OrderStatusBadge({ status, short }: { status: KegOrderStatus; short?: boolean }) {
  return status === "FULFILLED" ? (short ? <Badge tone="warn">Fulfilled short</Badge> : <Badge tone="good">Fulfilled</Badge>) : status === "CANCELLED" ? <Badge>Cancelled</Badge> : <Badge>Open</Badge>;
}

/**
 * Orders as rows that open the order. Open orders show when they're due and
 * how far along they are; finished ones show the day they were closed.
 * `account={false}` leaves the account's name out (on that account's own page).
 */
export function OrderTable({ rows, today, closed, account = true }: { rows: OrderRow[]; today: ISODate; closed?: boolean; account?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Order</Th>
          <Th className="hidden md:table-cell">Kegs</Th>
          <Th>{closed ? "Closed" : "Date"}</Th>
          <Th align="right">Sent</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => {
          const summary = linesSummary(o.lines);
          return (
            <Tr key={o.id}>
              <Td className="py-0">
                <Link href={`/kegs/orders/${o.id}`} className="block py-3 hover:underline">
                  <span className="block font-medium">{account ? o.account : `Order ${o.number}`}</span>
                  <span className="block text-xs text-muted">{account ? `Order ${o.number} · ` : ""}{transitLabel(o.transit)}</span>
                  <span className="block text-xs text-muted md:hidden">{summary}</span>
                </Link>
              </Td>
              <Td className="hidden text-ink-2 md:table-cell">{summary}</Td>
              <Td className="whitespace-nowrap">
                {closed ? <span className="text-ink-2">{o.closedAt ? shortDate(businessDateOf(o.closedAt)) : "—"}</span> : <DueBadge dueOn={o.dueOn} today={today} />}
              </Td>
              <Td align="right" className="whitespace-nowrap">
                {o.status === "CANCELLED" ? <Badge>Cancelled</Badge> : o.status === "OPEN" && o.progress.complete ? <Badge tone="good">All {o.progress.sent} sent</Badge> : <span className={o.progress.sent ? "" : "text-muted"}>{progressLabel(o.progress)}</span>}
                {o.status === "CANCELLED" && o.progress.sent > 0 && <span className="block text-xs text-muted">{progressLabel(o.progress)} went out</span>}
                {o.status === "FULFILLED" && !o.progress.complete && <span className="block text-xs font-medium text-warn">Closed with {o.progress.remaining} not sent</span>}
                {o.short > 0 && <span className="block text-xs text-warn">{o.short} to fill</span>}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
