import { HelpTip } from "@/components/help";
import { cx, EmptyState, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { ordersList } from "@/server/services/kegOrders";
import { Plus } from "lucide-react";
import { BeerDot, sizeShort } from "../bits";
import { OrderTable } from "./bits";
import { OrderSearch } from "./order-search";

export const metadata = { title: "Keg orders" };

export default async function KegOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const q = String(sp.q ?? "").trim().slice(0, 80);
  const r = await ordersList(q);
  const newOrder = <LinkButton href="/kegs/orders/new" variant="primary" className="h-10 sm:h-9"><Plus className="size-4" /> New order</LinkButton>;
  const toFill = r.availability.reduce((s, a) => s + a.preordered, 0);

  return (
    <>
      <PageHeader
        help="kegs.orders"
        title="Orders"
        back={{ href: "/kegs", label: "Kegs" }}
        description="Kegs your wholesale accounts have asked for. Fill an order by scanning each keg as it leaves, and the app checks it's the right beer and size."
        actions={newOrder}
      />

      {(r.openTotal > 0 || r.closed.length > 0 || q) && <div className="mb-6 max-w-md"><OrderSearch initial={q} /></div>}

      <Section title="Open orders" description={r.open.length ? "The soonest first. Tap one to see it, change it or scan its kegs." : undefined}>
        {r.open.length === 0 ? (
          q ? (
            <p className="text-sm text-muted">No open order matches “{q}”.</p>
          ) : (
            <EmptyState title="No open orders" action={newOrder}>When an account asks for kegs, make an order: who it&apos;s for, when, and how many of each beer and size. Then scan the kegs out against it.</EmptyState>
          )
        ) : (
          <OrderTable rows={r.open} today={r.today} />
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
            <tbody>
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
            </tbody>
          </Table>
        )}
      </Section>

      {(r.closed.length > 0 || q) && (
        <Section title="Recently fulfilled or cancelled" description={r.closed.length ? (q ? "The latest that match." : "The latest first.") : undefined}>
          {r.closed.length === 0 ? <p className="text-sm text-muted">No finished order matches “{q}”.</p> : <OrderTable rows={r.closed} today={r.today} closed />}
        </Section>
      )}
    </>
  );
}
