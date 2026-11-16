import { Card, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { progressLabel, transitLabel } from "@/domain/kegOrders";
import { displayCode } from "@/domain/kegs";
import { businessDateTime, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { orderFormContext, orderPage } from "@/server/services/kegOrders";
import { ScanLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sizeShort } from "../../bits";
import { DueBadge, OrderStatusBadge } from "../bits";
import { OrderDetails, OrderFinish, OrderLines, OrderNotes } from "../order-client";

export const metadata = { title: "Keg order" };

export default async function KegOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const o = await orderPage(id);
  if (!o) notFound();
  const open = o.status === "OPEN";
  const ctx = open ? await orderFormContext({ accountId: o.account.id, beerIds: o.lines.map((l) => l.beerId) }) : null;
  const p = o.progress;

  return (
    <>
      <PageHeader
        help="kegs.orders.order"
        title={`Order ${o.number} · ${o.account.name}`}
        back={{ href: "/kegs/orders", label: "Orders" }}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <OrderStatusBadge status={o.status} />
            <span>{transitLabel(o.transit)}</span>
            {open && <DueBadge dueOn={o.dueOn} today={o.today} />}
            <span className="num">{progressLabel(p)} sent</span>
          </span>
        }
      />

      {!open && (
        <Card className="mb-8 p-4 text-sm text-ink-2">
          {o.status === "FULFILLED"
            ? `Fulfilled ${o.fulfilledAt ? businessDateTime(o.fulfilledAt) : ""}${o.fulfilledByName ? ` by ${o.fulfilledByName}` : ""}, with ${progressLabel(p)}.`
            : `Cancelled ${o.cancelledAt ? businessDateTime(o.cancelledAt) : ""}${o.cancelledByName ? ` by ${o.cancelledByName}` : ""}.${p.sent ? ` ${p.sent} keg${p.sent === 1 ? "" : "s"} had already gone out and stayed out.` : ""}`}
          {" "}Nothing on it can change now, but notes can still be added.
        </Card>
      )}

      {open && (
        <div className="mb-8 space-y-3">
          {o.warning && <p role="status" className="rounded-xl border border-warn/25 bg-warn-bg px-4 py-3 text-sm font-medium text-warn">{o.warning}</p>}
          {!p.complete && (
            <LinkButton href={`/kegs/orders/${o.id}/scan`} variant="primary" size="lg" className="h-14 w-full rounded-2xl text-base sm:w-auto sm:px-8">
              <ScanLine className="size-5" /> Scan kegs for this order
            </LinkButton>
          )}
          {p.complete && <p className="text-sm text-ink-2">Every keg on this order has gone out. Mark it fulfilled to close it.</p>}
          <OrderFinish orderId={o.id} progress={p} />
        </div>
      )}

      <div className="grid gap-x-8 lg:grid-cols-2">
        <Section title="Kegs wanted" description={open ? "Change how many in place. A line that already has kegs out keeps its beer and size." : undefined}>
          <OrderLines order={o} beers={ctx?.beers ?? []} />
        </Section>

        {open && ctx ? (
          <Section title="Details" description="Each one saves as you change it.">
            <OrderDetails order={o} accounts={ctx.accounts} />
          </Section>
        ) : (
          <Section title="Details">
            <Card className="divide-y divide-border text-sm">
              <div className="grid grid-cols-[7rem_1fr] gap-2 px-4 py-2.5"><span className="text-muted">Account</span><Link href={`/kegs/accounts/${o.account.id}`} className="hover:underline">{o.account.name}</Link></div>
              <div className="grid grid-cols-[7rem_1fr] gap-2 px-4 py-2.5"><span className="text-muted">Delivery or pickup</span><span>{transitLabel(o.transit)}</span></div>
              <div className="grid grid-cols-[7rem_1fr] gap-2 px-4 py-2.5"><span className="text-muted">Date</span><span className={o.dueOn ? "" : "text-muted"}>{o.dueOn ? shortDate(o.dueOn) : "No date"}</span></div>
              <div className="grid grid-cols-[7rem_1fr] gap-2 px-4 py-2.5"><span className="text-muted">Made</span><span className="text-ink-2">{businessDateTime(o.createdAt)}{o.createdByName ? ` by ${o.createdByName}` : ""}</span></div>
            </Card>
          </Section>
        )}
      </div>

      <Section title="Kegs sent on this order" description={o.kegs.length ? "Each keg scanned out for it, the latest first. Tap a code to open the keg." : undefined}>
        {o.kegs.length === 0 ? (
          <p className="text-sm text-muted">{open ? "No keg has been scanned for this order yet." : "No keg was scanned for this order."}</p>
        ) : (
          <Table>
            <thead><tr><Th>Keg</Th><Th className="hidden sm:table-cell">Beer</Th><Th className="hidden sm:table-cell">Size</Th><Th className="hidden md:table-cell">Scanned by</Th><Th align="right">When</Th></tr></thead>
            <tbody>
              {o.kegs.map((k) => (
                <Tr key={k.id}>
                  <Td className="py-0">
                    <Link href={`/kegs/k/${k.code}`} className="block py-3 hover:underline">
                      <span className="num font-medium whitespace-nowrap">{displayCode(k.code)}</span> <span className="text-xs whitespace-nowrap text-muted sm:hidden">{sizeShort(k.sizeId)}</span>
                      <span className="block text-xs text-muted sm:hidden">{k.beer}{k.userName ? ` · ${k.userName}` : ""}</span>
                    </Link>
                  </Td>
                  <Td className="hidden text-ink-2 sm:table-cell">{k.beer}</Td>
                  <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{sizeShort(k.sizeId)}</Td>
                  <Td className="hidden text-ink-2 md:table-cell">{k.userName ?? "—"}</Td>
                  <Td align="right" className="whitespace-nowrap text-muted">{businessDateTime(k.at)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {o.lines.some((l) => l.unscanned > 0) && <p className="mt-2 text-xs text-muted">{o.lines.reduce((s, l) => s + l.unscanned, 0)} more marked as delivered without scanning; those kegs aren&apos;t listed here.</p>}
      </Section>

      <Section title="Notes" description="Anyone can add one. They stay with the order.">
        <OrderNotes orderId={o.id} notes={o.notes} />
      </Section>
    </>
  );
}
