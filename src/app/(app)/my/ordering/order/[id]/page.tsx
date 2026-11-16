import { Card, PageHeader } from "@/components/ui";
import { dayDate } from "@/lib/format";
import { orderToSend } from "@/server/services/orderPlacing";
import { requireOrderer } from "@/server/services/supplierPrefs";
import { Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlaceOrder } from "../../../../ordering/place-order";
import { emailOrderToSupplier, markOrderPlaced } from "../../actions";

export const metadata = { title: "Send the order" };

/** Step 2 of the guided order: one button, the way this supplier takes orders. Then step 3: done. */
export default async function SendOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOrderer();
  const { id } = await params;
  const o = await orderToSend(id);
  if (!o) notFound();
  const sent = o.status !== "DRAFT";

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader help="ordering.staff" title={o.supplier.name} description={`For the ${dayDate(o.deliveryDate)} delivery.`} back={{ href: sent ? "/my/ordering" : `/my/ordering/${o.supplier.id}`, label: sent ? "Orders" : "Back to the numbers" }} />
      <ol className="mb-4 flex items-center gap-2 text-xs" aria-label="Steps">
        {["Check", "Send", "Done"].map((s, i) => {
          const at = sent ? 3 : 2;
          return (
            <li key={s} aria-current={i + 1 === at ? "step" : undefined} className={i + 1 === at ? "flex items-center gap-1.5 font-medium text-ink" : "flex items-center gap-1.5 text-muted"}>
              <span className={i + 1 <= at ? "flex size-5 items-center justify-center rounded-full border border-ink bg-primary text-[0.7rem] text-primary-ink" : "flex size-5 items-center justify-center rounded-full border border-border-strong text-[0.7rem]"}>{i + 1}</span>
              {s}
              {i < 2 && <span aria-hidden className="text-muted">—</span>}
            </li>
          );
        })}
      </ol>

      {sent ? (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-base font-semibold text-good"><Check className="size-5" />Sent</div>
          <p className="mt-1 text-sm text-muted">This order is on its way. Check it in when the truck comes.</p>
          <Link href="/my/ordering" className="mt-4 inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-ink">Back to orders</Link>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {o.lines.map((l) => (
                <li key={l.sku} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0">{l.name}<span className="block text-xs text-muted">#{l.sku}</span></span>
                  <span className="num shrink-0 font-medium">{Number(l.qty.toFixed(2))} {l.unit}</span>
                </li>
              ))}
            </ul>
          </Card>
          <div className="mt-5">
            <PlaceOrder
              orderId={o.id}
              supplierName={o.supplier.name}
              deliveryDate={o.deliveryDate}
              lines={o.lines}
              sendBy={o.prefs.sendBy}
              phone={o.prefs.phone}
              portal={o.prefs.portal}
              portalUrl={o.prefs.portalUrl}
              supplierEmail={o.supplier.email}
              from={o.from}
              minsToCutoff={o.cutoff?.mins ?? null}
              onPlaced={markOrderPlaced}
              onEmail={emailOrderToSupplier}
              doneHref="/my/ordering"
              className="h-12 w-full text-base"
            />
            <p className="mt-2 text-center text-xs text-muted">Nothing goes to {o.supplier.name} until you send it.</p>
          </div>
        </>
      )}
    </div>
  );
}
