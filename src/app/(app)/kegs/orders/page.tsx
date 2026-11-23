import { Verdict } from "@/components/chapter";
import { HelpTip } from "@/components/help";
import { ShowMore } from "@/components/show-more";
import { cx, EmptyState, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { businessDateOf } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { splitOutTooLong } from "@/domain/kegFleet";
import { fleetNeedsLook } from "@/server/services/kegFleet";
import { ordersList, type OrderRow } from "@/server/services/kegOrders";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { BeerDot, sizeShort } from "../bits";
import { linesSummary } from "./bits";
import { KegOrdersTable, type OrderListRow } from "./orders-table";

export const metadata = { title: "Keg orders" };

const listRow = (o: OrderRow): OrderListRow => ({
  id: o.id,
  number: o.number,
  accountId: o.accountId,
  account: o.account,
  transit: o.transit,
  dueOn: o.dueOn,
  status: o.status,
  createdOn: businessDateOf(o.createdAt),
  closedOn: o.closedAt ? businessDateOf(o.closedAt) : null,
  summary: linesSummary(o.lines),
  beers: [...new Set(o.lines.map((l) => l.beer))],
  kegs: o.lines.reduce((s, l) => s + l.quantity, 0),
  progress: o.progress,
  short: o.short,
});

export default async function KegOrdersPage() {
  await requireUser("MANAGER");
  const [r, look] = await Promise.all([ordersList(), fleetNeedsLook()]);
  const newOrder = <LinkButton href="/kegs/orders/new" variant="primary" className="h-10 sm:h-9"><Plus className="size-4" /> New order</LinkButton>;
  const toFill = r.availability.reduce((s, a) => s + a.preordered, 0);
  const rows = [...r.open, ...r.closed].map(listRow);
  // The verdict: what's due, and the empties that should have come back by now.
  const due = r.open.filter((o) => o.dueOn && o.dueOn <= r.today).length;
  const short = r.open.reduce((s, o) => s + o.short, 0);
  const { late, lost } = splitOutTooLong(look.out);
  const lateKegs = late.reduce((s, g) => s + g.kegs.length, 0);
  const lostKegs = lost.reduce((s, g) => s + g.kegs.length, 0);
  const overdueAccounts = new Set([...late, ...lost].map((g) => g.account)).size;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const dueWords = due ? `${plural(due, "order")} due today or late` : r.open.length ? "Nothing due today" : "No open orders";
  const backWords = lateKegs + lostKegs ? `${plural(lateKegs + lostKegs, "keg")} overdue back from ${plural(overdueAccounts, "account")}` : "every keg out is back on time";

  return (
    <>
      <PageHeader
        help="kegs.orders"
        title="Orders"
        description="Kegs your wholesale accounts have asked for. Fill an order by scanning each keg as it leaves, and the app checks it's the right beer and size."
        actions={newOrder}
      />

      <Verdict
        badge={{ tone: due || lateKegs + lostKegs ? "warn" : "good" }}
        title={`${dueWords}, and ${backWords}`}
        line={
          <>
            {due ? "Fill and scan those out first. " : ""}
            {lateKegs + lostKegs ? <>Ask for the empties on the next delivery{lostKegs ? `; ${plural(lostKegs, "keg has", "kegs have")} been out so long ${lostKegs === 1 ? "it's" : "they're"} probably lost` : ""}. <Link href="/kegs/fleet#look" className="inline-flex items-center gap-0.5 font-medium text-ink underline underline-offset-2">See which <ArrowRight className="size-3.5" /></Link></> : null}
          </>
        }
        stats={[
          { label: "Open orders", value: r.open.length, hint: due ? `${due} due today or late` : "None due today" },
          { label: "Kegs still to fill", value: short, tone: short ? "warn" : "neutral", hint: short ? "Not enough full kegs yet" : r.open.length ? "Every open order can be filled" : "No open orders" },
          { label: "Kegs overdue back", value: lateKegs + lostKegs, tone: lateKegs + lostKegs ? "warn" : "neutral", hint: lostKegs ? `${lostKegs} probably lost` : `Out more than ${look.overdueDays} days` },
        ]}
      />

      <Section
        title="Every order"
        description={rows.length ? `${r.open.length ? `${r.open.length} open, the soonest first; finished ones` : "None open; finished ones are"} under their own tabs, the latest first.${r.closedTotal > r.closed.length ? ` The latest ${r.closed.length} of ${r.closedTotal} finished orders.` : ""} Tap one to see it, change it or scan its kegs.` : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No orders yet" action={newOrder}>When an account asks for kegs, make an order: who it&apos;s for, when, and how many of each beer and size. Then scan the kegs out against it.</EmptyState>
        ) : (
          <KegOrdersTable rows={rows} today={r.today} hasOpen={r.open.length > 0} />
        )}
      </Section>

      <Section
        help="kegs.orders.availability"
        title={<span className="inline-flex items-center gap-1">Full kegs you can promise <HelpTip id="kegs.orders.availability" /></span>}
        description={r.availability.length ? `Full kegs by beer and size, against what open orders still need.${toFill ? ` ${toFill} keg${toFill === 1 ? "" : "s"} on order still ${toFill === 1 ? "needs" : "need"} filling.` : ""}` : undefined}
      >
        {r.availability.length === 0 ? (
          <p className="text-sm text-muted">No full kegs right now, and no open order is waiting for any.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Beer</Th>
                <Th className="hidden sm:table-cell">Size</Th>
                <Th align="right">Available</Th>
                <Th align="right">Reserved</Th>
                <Th align="right">Preordered</Th>
              </tr>
            </thead>
            <ShowMore as="tbody" limit={20} noun={["row", "rows"]}>
              {r.availability.map((a) => (
                <Tr key={`${a.beerId}-${a.sizeId}`}>
                  <Td>
                    <span className="flex items-center gap-2"><BeerDot color={a.color} /><span className="min-w-0">{a.beer}</span></span>
                    <span className="block pl-5 text-xs text-muted sm:hidden">{sizeShort(a.sizeId)}</span>
                  </Td>
                  <Td className="hidden whitespace-nowrap text-ink-2 sm:table-cell">{sizeShort(a.sizeId)}</Td>
                  <Td align="right" className={cx(a.available ? "font-medium" : "text-muted")}>{a.available}</Td>
                  <Td align="right" className={cx(!a.reserved && "text-muted")}>{a.reserved}</Td>
                  <Td align="right" className={cx(a.preordered ? "font-medium text-warn" : "text-muted")}>{a.preordered}</Td>
                </Tr>
              ))}
            </ShowMore>
          </Table>
        )}
      </Section>
    </>
  );
}
