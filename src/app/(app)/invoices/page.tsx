import { HelpZone } from "@/components/help";
import { Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { toISODate } from "@/domain/dates";
import { creditItems } from "@/domain/invoiceMatch";
import { money } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { autoApproveEnabled, listInvoices, loadTolerance, STATUS_META } from "@/server/services/invoices";
import { InvoiceStatus } from "@prisma/client";
import { Camera, FileSpreadsheet } from "lucide-react";
import { AutoApproveCell, ToleranceCells } from "./list-client";
import { InvoicesTable } from "./invoices-table";
import { SendWaiting } from "./quickbooks-client";
import { billStates, isQuickBooksConnected, pendingInvoices } from "@/server/services/quickbooks";

export const metadata = { title: "Invoices" };

const STATUSES = Object.keys(STATUS_META) as InvoiceStatus[];

export default async function InvoicesPage() {
  await requireUser("MANAGER");
  const [invoices, all, tolerance, autoApprove, qboConnected] = await Promise.all([
    listInvoices({ take: 5000 }),
    db.invoice.findMany({ select: { status: true, lines: { select: { qty: true, unitPrice: true, expectedQty: true, expectedPrice: true, description: true, sku: true } } } }),
    loadTolerance(),
    autoApproveEnabled(),
    isQuickBooksConnected(),
  ]);
  const [qboStates, qboWaiting] = qboConnected ? await Promise.all([billStates(invoices.filter((i) => i.status === "APPROVED").map((i) => i.id)), pendingInvoices()]) : [new Map(), []];

  const open = all.filter((i) => i.status !== "APPROVED");
  const issues = open.filter((i) => i.status !== "MATCHED");
  const owed = open.reduce(
    (s, i) => s + creditItems(i.lines.map((l) => ({ description: l.description, sku: l.sku, qty: l.qty.toNumber(), unitPrice: l.unitPrice.toNumber(), expectedQty: num(l.expectedQty), expectedPrice: num(l.expectedPrice) })), tolerance).reduce((a, c) => a + c.amount, 0),
    0,
  );

  return (
    <>
      <PageHeader
        help="invoices.page"
        title="Invoices"
        description="Snap a supplier invoice. It's checked against what you ordered and received, and price changes flow into costing."
        actions={
          <>
            <LinkButton href="/invoices/exports" size="lg"><FileSpreadsheet className="size-4" />Exports</LinkButton>
            <LinkButton href="/invoices/new" variant="primary" size="lg"><Camera className="size-4" />Add invoice</LinkButton>
          </>
        }
      />

      {all.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>[data-help-zone]>*]:h-full">
          <Stat help="invoices.toApprove" label="To approve" value={open.length} hint={`${all.length - open.length} approved`} />
          <Stat help="invoices.issues" label="With issues" value={issues.length} tone={issues.length ? "warn" : undefined} hint="price, quantity or unread lines" />
          <Stat help="invoices.owed" label="Credit to ask for" value={money(owed)} tone={owed > 0 ? "bad" : undefined} hint="short and overcharged lines" />
          <HelpZone id="invoices.tolerance"><Card className="p-5">
            <div className="text-[0.8rem] font-medium text-muted">Flag differences over</div>
            <ToleranceCells price={tolerance.price} qty={tolerance.qty} />
            <AutoApproveCell on={autoApprove} />
          </Card></HelpZone>
        </div>
      )}

      {qboWaiting.length > 0 && (
        <HelpZone id="invoices.quickbooks.waiting">
          <SendWaiting waiting={qboWaiting.length} />
        </HelpZone>
      )}

      {all.length === 0 ? (
        <EmptyState title="No invoices yet" action={<LinkButton href="/invoices/new" variant="primary">Add the first invoice</LinkButton>}>
          Take a photo of a delivery invoice, or type it in. Each line is checked against the order and its check-in.
        </EmptyState>
      ) : (
        <InvoicesTable
          statuses={[{ value: "OPEN", label: "Not approved" }, ...STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))]}
          rows={invoices.map((i) => ({
            id: i.id,
            supplierId: i.supplierId,
            supplier: i.supplier.name,
            number: i.invoiceNumber,
            date: toISODate(i.invoiceDate),
            orderId: i.order?.id ?? null,
            delivery: i.order ? toISODate(i.order.deliveryDate) : null,
            status: i.status,
            statusLabel: STATUS_META[i.status].label,
            tone: STATUS_META[i.status].tone,
            total: num(i.total) ?? i.lines.reduce((s, l) => s + l.qty.toNumber() * l.unitPrice.toNumber(), 0),
            flagged: i.lines.filter((l) => l.status !== "OK").length,
            qbo: qboStates.get(i.id) ?? null,
          }))}
        />
      )}
    </>
  );
}
