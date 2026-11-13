import { Badge, Button, Card, Input, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { toISODate } from "@/domain/dates";
import { dayDate, money } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { loadOrder, orderAsText } from "@/server/services/orders";
import { notFound } from "next/navigation";
import { deleteDraft, receiveOrder } from "../../actions";
import { CopyButton } from "./copy-button";
import { HelpTip } from "@/components/help";
import { markOrderSent } from "./actions";
import { SendToSupplier } from "./send-panel";
import { poDelivery } from "@/server/email/outbound";
import { purchaseOrderSubject } from "@/server/email/templates/purchase-order";
import { emailConfigured, type DeliveryEvent } from "@/server/integrations/email";
import { emailForUser } from "@/server/services/notify";
import { relativeTime } from "@/lib/format";

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

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser("MANAGER");
  const { id } = await params;
  const o = await loadOrder(id);
  if (!o) notFound();
  const [delivery, myEmail] = await Promise.all([poDelivery(o.id), emailForUser(session.userId)]);
  const sent = delivery.record;
  const status = delivery.status ? DELIVERY[delivery.status] : null;
  const total = o.lines.reduce((s, l) => s + l.qty.toNumber() * (l.unitPrice?.toNumber() ?? 0), 0);
  const text = orderAsText(o);
  const receiving = o.status !== "RECEIVED";
  const mailto = o.supplier.email ? `mailto:${o.supplier.email}?subject=${encodeURIComponent(`Order for ${toISODate(o.deliveryDate)}`)}&body=${encodeURIComponent(text)}` : null;

  return (
    <>
      <PageHeader
        title={`${o.supplier.name}`}
        description={<>Delivery {dayDate(toISODate(o.deliveryDate))} · <Badge tone={o.status === "RECEIVED" ? "good" : o.status === "SENT" ? "warn" : "neutral"}>{o.status === "DRAFT" ? "Draft" : o.status === "SENT" ? "Sent" : "Received"}</Badge></>}
        back={{ href: "/ordering", label: "Ordering" }}
        actions={
          <>
            <CopyButton text={text} label="Copy as text" />
            <LinkButton href={`/ordering/po/${o.id}/csv`} prefetch={false}>Download CSV</LinkButton>
            {mailto && o.status === "DRAFT" && <LinkButton href={mailto}>Email</LinkButton>}
            {o.status === "DRAFT" && <form action={markOrderSent.bind(null, o.id)} className="flex items-center gap-2"><HelpTip id="ordering.po" /><Button>Mark as sent</Button></form>}
            {o.status !== "RECEIVED" && (
              <SendToSupplier
                id={o.id}
                supplierName={o.supplier.name}
                supplierEmail={o.supplier.email}
                myEmail={myEmail}
                emailReady={emailConfigured()}
                subject={purchaseOrderSubject(toISODate(o.deliveryDate))}
                text={text}
                mailto={mailto}
                isDraft={o.status === "DRAFT"}
                items={o.lines.length}
              />
            )}
          </>
        }
      />

      {o.status !== "DRAFT" && (sent || o.sentAt) && (
        <Card className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
          {sent?.emailId ? (
            <>
              <span>Emailed to <span className="font-medium">{sent.to}</span>{sent.cc.length > 0 && <span className="text-muted"> · cc {sent.cc.join(", ")}</span>}</span>
              <span className="text-muted">by {sent.byName} · {relativeTime(new Date(sent.at))}</span>
              {status && <Badge tone={status.tone}>{status.label}</Badge>}
              {delivery.status === "bounced" && <span className="w-full text-xs text-bad">The supplier&apos;s server rejected it. Check the address, or call the order in.</span>}
            </>
          ) : (
            <span className="text-muted">Marked as sent{sent ? ` by ${sent.byName}` : ""} · {relativeTime(sent ? new Date(sent.at) : o.sentAt)}</span>
          )}
        </Card>
      )}

      <form action={receiveOrder.bind(null, o.id)}>
        <Table>
          <thead>
            <tr><Th>Item</Th><Th align="right">Ordered</Th>{o.status !== "DRAFT" && <Th align="right">Received</Th>}<Th align="right" className="hidden sm:table-cell">Unit price</Th><Th align="right">Total</Th></tr>
          </thead>
          <tbody>
            {o.lines.map((l) => (
              <Tr key={l.id}>
                <Td><div className="font-medium">{l.product.ingredient?.name ?? l.product.description}</div><div className="text-xs text-muted">{l.product.description} · #{l.product.sku}</div></Td>
                <Td align="right">{l.qty.toNumber()} <span className="text-muted">{l.product.purchaseUnit}</span>{l.suggestedQty.toNumber() !== l.qty.toNumber() && <div className="text-xs text-muted">suggested {l.suggestedQty.toNumber()}</div>}</Td>
                {o.status !== "DRAFT" && (
                  <Td align="right">
                    {receiving ? <Input name={`received_${l.id}`} type="number" step="any" min={0} defaultValue={l.qty.toNumber()} className="num ml-auto h-8 w-20 text-right" aria-label="Received quantity" /> : l.receivedQty?.toNumber()}
                  </Td>
                )}
                <Td align="right" className="hidden sm:table-cell">{money(l.unitPrice?.toNumber())}</Td>
                <Td align="right">{money(l.qty.toNumber() * (l.unitPrice?.toNumber() ?? 0))}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm"><span className="text-muted">Estimated total</span> <span className="num font-semibold">{money(total)}</span></div>
          {o.status === "SENT" && <span className="flex items-center gap-2"><HelpTip id="ordering.po.receive" /><Button variant="primary">Check in delivery</Button></span>}
        </div>
      </form>

      {o.status === "DRAFT" && (
        <form action={deleteDraft.bind(null, o.id)} className="mt-8"><Button variant="danger" size="sm">Delete draft</Button></form>
      )}
      {o.status === "RECEIVED" && <Card className="mt-6 p-4 text-sm text-muted">Checked in. Received quantities are added to estimated stock until the next count.</Card>}
    </>
  );
}
