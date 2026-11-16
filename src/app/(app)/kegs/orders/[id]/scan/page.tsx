import { PageHeader, Section } from "@/components/ui";
import { transitLabel } from "@/domain/kegOrders";
import { requireUser } from "@/server/auth";
import { orderScanPage } from "@/server/services/kegOrders";
import { notFound } from "next/navigation";
import { DueBadge } from "../../bits";
import { OrderNotes } from "../../order-client";
import { OrderScanner } from "../../order-scan";

export const metadata = { title: "Scan kegs for an order" };

/** Fill an order by scanning: open to staff as well as managers. */
export default async function OrderScanPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const o = await orderScanPage(id);
  if (!o) notFound();
  const manager = me.role === "MANAGER";
  const back = manager ? { href: `/kegs/orders/${o.id}`, label: `Order ${o.number}` } : { href: "/kegs", label: "Kegs" };

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        help="kegs.orders.scan"
        title={`Order ${o.number} · ${o.account}`}
        back={back}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{transitLabel(o.transit)}</span>
            {o.status === "OPEN" && <DueBadge dueOn={o.dueOn} today={o.today} />}
          </span>
        }
      />
      <OrderScanner orderId={o.id} initial={{ status: o.status, lines: o.lines, progress: o.progress }} done={back} />
      <Section title="Notes" description="Anyone can add one." className="mt-8">
        <OrderNotes orderId={o.id} notes={o.notes} />
      </Section>
    </div>
  );
}
