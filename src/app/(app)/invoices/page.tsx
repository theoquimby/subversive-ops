import { HelpZone } from "@/components/help";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { toISODate } from "@/domain/dates";
import { creditItems } from "@/domain/invoiceMatch";
import { money, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { autoApproveEnabled, listInvoices, loadTolerance, STATUS_META } from "@/server/services/invoices";
import { InvoiceStatus } from "@prisma/client";
import { Camera, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { AutoApproveCell, InvoiceFilters, ToleranceCells } from "./list-client";

export const metadata = { title: "Invoices" };

const STATUSES = Object.keys(STATUS_META) as InvoiceStatus[];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; supplier?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const status = sp.status === "OPEN" || STATUSES.includes(sp.status as InvoiceStatus) ? (sp.status as InvoiceStatus | "OPEN") : undefined;
  const [invoices, all, suppliers, tolerance, autoApprove] = await Promise.all([
    listInvoices({ status, supplierId: sp.supplier }),
    db.invoice.findMany({ select: { status: true, lines: { select: { qty: true, unitPrice: true, expectedQty: true, expectedPrice: true, description: true, sku: true } } } }),
    db.supplier.findMany({ where: { invoices: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    loadTolerance(),
    autoApproveEnabled(),
  ]);

  const open = all.filter((i) => i.status !== "APPROVED");
  const issues = open.filter((i) => i.status !== "MATCHED");
  const owed = open.reduce(
    (s, i) => s + creditItems(i.lines.map((l) => ({ description: l.description, sku: l.sku, qty: l.qty.toNumber(), unitPrice: l.unitPrice.toNumber(), expectedQty: num(l.expectedQty), expectedPrice: num(l.expectedPrice) })), tolerance).reduce((a, c) => a + c.amount, 0),
    0,
  );
  const filtered = Boolean(status || sp.supplier);

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

      <Section
        help="invoices.list"
        title={filtered ? "Matching invoices" : "All invoices"}
        actions={all.length > 0 ? <InvoiceFilters status={status ?? ""} supplier={sp.supplier ?? ""} suppliers={suppliers} statuses={[{ value: "OPEN", label: "Not approved" }, ...STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))]} /> : undefined}
      >
        {invoices.length === 0 ? (
          filtered ? (
            <EmptyState title="No invoices match" action={<LinkButton href="/invoices">Clear filters</LinkButton>}>Try another status or supplier.</EmptyState>
          ) : (
            <EmptyState title="No invoices yet" action={<LinkButton href="/invoices/new" variant="primary">Add the first invoice</LinkButton>}>
              Take a photo of a delivery invoice, or type it in. Each line is checked against the order and its check-in.
            </EmptyState>
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th className="hidden sm:table-cell">Number</Th>
                <Th className="hidden sm:table-cell">Date</Th>
                <Th className="hidden md:table-cell">Order</Th>
                <Th>Status</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const meta = STATUS_META[i.status];
                const total = num(i.total) ?? i.lines.reduce((s, l) => s + l.qty.toNumber() * l.unitPrice.toNumber(), 0);
                const flagged = i.lines.filter((l) => l.status !== "OK").length;
                return (
                  <Tr key={i.id} className="relative">
                    <Td>
                      <Link href={`/invoices/${i.id}`} className="font-medium after:absolute after:inset-0 hover:underline">{i.supplier.name}</Link>
                      <div className="text-xs text-muted sm:hidden">{i.invoiceNumber ? `#${i.invoiceNumber} · ` : ""}{shortDate(toISODate(i.invoiceDate))}</div>
                    </Td>
                    <Td className="num hidden text-ink-2 sm:table-cell">{i.invoiceNumber ?? <span className="text-muted">—</span>}</Td>
                    <Td className="num hidden sm:table-cell">{shortDate(toISODate(i.invoiceDate))}</Td>
                    <Td className="hidden md:table-cell">
                      {i.order ? (
                        <Link href={`/ordering/po/${i.order.id}`} className="relative z-10 text-ink-2 hover:text-ink hover:underline">Delivery {shortDate(toISODate(i.order.deliveryDate))}</Link>
                      ) : (
                        <span className="text-muted">Not linked</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {i.status !== "APPROVED" && i.status !== "MATCHED" && flagged > 0 && <span className="ml-1.5 hidden text-xs text-muted lg:inline">{flagged} {flagged === 1 ? "line" : "lines"}</span>}
                    </Td>
                    <Td align="right">{money(total)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
