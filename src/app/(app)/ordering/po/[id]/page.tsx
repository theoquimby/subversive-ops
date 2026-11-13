import { Badge, Button, Card, Input, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { toISODate } from "@/domain/dates";
import { dayDate, money } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { loadOrder, orderAsText } from "@/server/services/orders";
import { notFound } from "next/navigation";
import { deleteDraft, markSent, receiveOrder } from "../../actions";
import { CopyButton } from "./copy-button";
import { HelpTip } from "@/components/help";

export const metadata = { title: "Order" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const o = await loadOrder(id);
  if (!o) notFound();
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
            {o.status === "DRAFT" && <form action={markSent.bind(null, o.id)} className="flex items-center gap-2"><HelpTip id="ordering.po" /><Button variant="primary">Mark as sent</Button></form>}
          </>
        }
      />

      <form action={receiveOrder.bind(null, o.id)}>
        <Table>
          <thead>
            <tr><Th>Item</Th><Th align="right">Ordered</Th>{o.status !== "DRAFT" && <Th align="right">Received</Th>}<Th align="right">Unit price</Th><Th align="right">Total</Th></tr>
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
                <Td align="right">{money(l.unitPrice?.toNumber())}</Td>
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
