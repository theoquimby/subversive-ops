import { HelpTip } from "@/components/help";
import { ShowMore } from "@/components/show-more";
import { cx, EmptyState, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { businessDateOf } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { ordersList, type OrderRow } from "@/server/services/kegOrders";
import { Plus } from "lucide-react";
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
  const r = await ordersList();
  const newOrder = <LinkButton href="/kegs/orders/new" variant="primary" className="h-10 sm:h-9"><Plus className="size-4" /> New order</LinkButton>;
  const toFill = r.availability.reduce((s, a) => s + a.preordered, 0);
  const rows = [...r.open, ...r.closed].map(listRow);

  return (
    <>
      <PageHeader
        help="kegs.orders"
        title="Orders"
        back={{ href: "/kegs", label: "Kegs" }}
        description="Kegs your wholesale accounts have asked for. Fill an order by scanning each keg as it leaves, and the app checks it's the right beer and size."
        actions={newOrder}
      />

      <Section
        title="Every order"
        description={rows.length ? `${r.open.length} open, the soonest first; finished ones under their own tabs, the latest first.${r.closedTotal > r.closed.length ? ` The latest ${r.closed.length} of ${r.closedTotal} finished orders.` : ""} Tap one to see it, change it or scan its kegs.` : undefined}
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
