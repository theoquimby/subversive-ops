import { Badge, Button, Card, LinkButton, PageHeader } from "@/components/ui";
import { toISODate } from "@/domain/dates";
import { dayDate, money } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { loadOrder, orderAsText } from "@/server/services/orders";
import { notFound } from "next/navigation";
import { deleteDraft } from "../../actions";
import { OrderLines } from "./order-lines";
import { CopyButton } from "./copy-button";
import { HelpTip, HelpZone } from "@/components/help";
import { markOrderSent } from "./actions";
import { SendToSupplier } from "./send-panel";
import { poDelivery } from "@/server/email/outbound";
import { purchaseOrderSubject } from "@/server/email/templates/purchase-order";
import { emailReady, type DeliveryEvent } from "@/server/integrations/email";
import { emailForUser } from "@/server/services/notify";
import { relativeTime } from "@/lib/format";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { currentPrices, linePrice, orderTotal } from "../../estimate";
import { orderToSend } from "@/server/services/orderPlacing";
import { markOrderPlaced } from "../../../my/ordering/actions";
import { PlaceOrder } from "../../place-order";

const DELIVERY: Partial<Record<DeliveryEvent, { label: string; tone: "good" | "warn" | "bad" | "neutral" }>> = {
  queued: { label: "Sending", tone: "neutral" },
  scheduled: { label: "Sending", tone: "neutral" },
  sent: { label: "Sent", tone: "neutral" },
  delivered: { label: "Delivered", tone: "good" },
  opened: { label: "Opened", tone: "good" },
  clicked: { label: "Opened", tone: "good" },
  delivery_delayed: { label: "Delayed", tone: "warn" },
  bounced: { label: "Bounced", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
  complained: { label: "Marked as spam", tone: "bad" },
};

export const metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ merged?: string }> }) {
  const session = await requireUser("MANAGER");
  const { id } = await params;
  const { merged } = await searchParams;
  const o = await loadOrder(id);
  if (!o) notFound();
  // A draft can take any of the supplier's items.
  const catalog = o.status === "DRAFT" ? await db.supplierProduct.findMany({ where: { supplierId: o.supplierId, active: true }, select: { id: true, sku: true, description: true, purchaseUnit: true, ingredient: { select: { name: true } } }, orderBy: { description: "asc" } }) : [];
  const [delivery, myEmail, invoices, prices, toSend, canEmail, addPrices] = await Promise.all([
    poDelivery(o.id),
    emailForUser(session.userId),
    db.invoice.findMany({ where: { orderId: o.id }, select: { id: true, total: true, invoiceNumber: true } }),
    currentPrices(o.lines.filter((l) => l.unitPrice == null).map((l) => l.supplierProductId), businessToday()),
    orderToSend(o.id),
    emailReady(),
    currentPrices(catalog.map((p) => p.id), businessToday()),
  ]);
  // "3-2": the builder added to this draft instead of making a second one (3 lines changed, 2 added).
  const mergedCounts = merged && /^\d+-\d+$/.test(merged) ? merged.split("-").map(Number) : null;
  const sendBy = toSend?.prefs.sendBy ?? "email";
  const sent = delivery.record;
  const status = delivery.status ? DELIVERY[delivery.status] : null;
  const priced = o.lines.map((l) => ({ supplierProductId: l.supplierProductId, qty: l.qty.toNumber(), unitPrice: l.unitPrice?.toNumber() ?? null }));
  const invoiced = orderTotal(priced, prices, invoices.map((i) => i.total?.toNumber() ?? null));
  const text = orderAsText(o);
  const mailto = o.supplier.email ? `mailto:${o.supplier.email}?subject=${encodeURIComponent(`Order for ${toISODate(o.deliveryDate)}`)}&body=${encodeURIComponent(text)}` : null;

  return (
    <>
      <PageHeader
        help="ordering.po"
        title={`${o.supplier.name}`}
        description={<>Delivery {dayDate(toISODate(o.deliveryDate))} · <Badge tone={o.status === "RECEIVED" ? "good" : o.status === "SENT" ? "warn" : "neutral"}>{o.status === "DRAFT" ? "Draft" : o.status === "SENT" ? "Sent" : "Received"}</Badge></>}
        back={{ href: "/ordering", label: "Ordering" }}
        actions={
          <>
            <CopyButton text={text} label="Copy as text" />
            <LinkButton href={`/ordering/po/${o.id}/csv`} prefetch={false}>Download spreadsheet</LinkButton>
            {mailto && o.status === "DRAFT" && <LinkButton href={mailto}>Email</LinkButton>}
            {o.status === "DRAFT" && <form action={markOrderSent.bind(null, o.id)} className="flex items-center gap-2"><HelpTip id="ordering.po" /><Button>Mark as sent</Button></form>}
            {o.status !== "RECEIVED" && (
              <SendToSupplier
                id={o.id}
                supplierName={o.supplier.name}
                supplierEmail={o.supplier.email}
                myEmail={myEmail}
                emailReady={canEmail}
                subject={purchaseOrderSubject(toISODate(o.deliveryDate))}
                text={text}
                mailto={mailto}
                isDraft={o.status === "DRAFT"}
                items={o.lines.length}
                secondary={sendBy !== "email"}
              />
            )}
            {/* The main button follows how this supplier takes orders (Settings → Suppliers, or the Ordering side panel). */}
            {o.status === "DRAFT" && toSend && sendBy !== "email" && (
              <PlaceOrder
                orderId={o.id}
                supplierName={o.supplier.name}
                deliveryDate={toSend.deliveryDate}
                lines={toSend.lines}
                sendBy={sendBy}
                phone={toSend.prefs.phone}
                portal={toSend.prefs.portal}
                portalUrl={toSend.prefs.portalUrl}
                supplierEmail={o.supplier.email}
                from={toSend.from}
                minsToCutoff={toSend.cutoff?.mins ?? null}
                onPlaced={markOrderPlaced}
              />
            )}
          </>
        }
      />

      {mergedCounts && o.status === "DRAFT" && (
        <Card role="status" className="mb-4 px-4 py-3 text-sm">
          You already had a draft for this delivery, so the order went into it instead of making a second one
          {mergedCounts[0] + mergedCounts[1] > 0 ? `: ${[mergedCounts[0] && `${mergedCounts[0]} item${mergedCounts[0] === 1 ? "" : "s"} changed`, mergedCounts[1] && `${mergedCounts[1]} added`].filter(Boolean).join(", ")}.` : ". Nothing on it changed."}
        </Card>
      )}

      {o.status === "DRAFT" && toSend?.cutoff && toSend.cutoff.mins <= 0 && (
        <Card role="alert" className="mb-4 border-warn/30 bg-warn-bg px-4 py-3 text-sm text-warn">The order cutoff for this delivery has passed. Call or text {o.supplier.name} to check they can still take it before sending.</Card>
      )}

      {o.status !== "DRAFT" && (sent || o.sentAt) && (
        <HelpZone id="ordering.po.sent" className="mb-4"><Card className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
          {sent?.emailId ? (
            <>
              <span>Emailed to <span className="font-medium">{sent.to}</span>{sent.cc.length > 0 && <span className="text-muted"> · cc {sent.cc.join(", ")}</span>}</span>
              <span className="text-muted">by {sent.byName} · {relativeTime(new Date(sent.at))}</span>
              {status && <Badge tone={status.tone}>{status.label}</Badge>}
              {delivery.status === "bounced" && <span className="w-full text-xs text-bad">The supplier&apos;s email system refused it. Check the address, or call the order in.</span>}
            </>
          ) : (
            <span className="text-muted">{sent?.to ? `Placed by ${sent.to}` : "Marked as sent"}{sent ? ` · ${sent.byName}` : ""} · {relativeTime(sent ? new Date(sent.at) : o.sentAt)}</span>
          )}
        </Card></HelpZone>
      )}

      <OrderLines
        orderId={o.id}
        status={o.status}
        invoiced={invoiced.invoiced ? { total: invoiced.total, links: invoices.map((i) => ({ id: i.id, label: i.invoiceNumber ? `invoice #${i.invoiceNumber}` : "invoice" })) } : null}
        addOptions={catalog.map((p) => ({ value: p.id, label: p.ingredient?.name ?? p.description, hint: `${p.description} · #${p.sku}${addPrices.has(p.id) ? ` · ${money(addPrices.get(p.id)!)}/${p.purchaseUnit}` : ""}` }))}
        lines={o.lines.map((l, idx) => {
          const p = linePrice(priced[idx], prices);
          return {
            id: l.id,
            supplierProductId: l.supplierProductId,
            name: l.product.ingredient?.name ?? l.product.description,
            detail: `${l.product.description} · #${l.product.sku}`,
            unit: l.product.purchaseUnit,
            qty: l.qty.toNumber(),
            suggestedQty: l.suggestedQty.toNumber(),
            received: l.receivedQty?.toNumber() ?? null,
            price: p.price,
            estimated: p.estimated,
          };
        })}
      />

      {o.status === "DRAFT" && (
        <form action={deleteDraft.bind(null, o.id)} className="mt-8"><Button variant="danger" size="sm">Delete draft</Button></form>
      )}
      {o.status === "RECEIVED" && <Card className="mt-6 p-4 text-sm text-muted">Checked in. Received quantities are added to estimated stock until the next count. Got something wrong? Reopen it, fix the amounts and check it in again.</Card>}
    </>
  );
}
