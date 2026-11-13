import { Badge, Card, PageHeader } from "@/components/ui";
import { toISODate } from "@/domain/dates";
import { creditItems, creditRequestText, findDuplicate } from "@/domain/invoiceMatch";
import { money, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { env } from "@/server/env";
import { currentApproval } from "@/domain/invoiceHistory";
import { candidateOrders, loadHistory, loadInvoice, loadTolerance, pendingPriceChanges, STATUS_META } from "@/server/services/invoices";
import { InvoiceStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteInvoice, HeaderFields, InvoiceActions, InvoiceHistory, LinesGrid } from "./detail-client";
import { InvoiceViewer } from "./viewer";

export const metadata = { title: "Invoice" };

const BUSINESS = "Subversive";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("MANAGER");
  const { id } = await params;
  const inv = await loadInvoice(id);
  if (!inv) notFound();

  const [tolerance, hasImage, products, orders, siblings, priceChanges, history] = await Promise.all([
    loadTolerance(),
    db.invoice.count({ where: { id, image: { not: null } } }),
    db.supplierProduct.findMany({ where: { supplierId: inv.supplierId }, select: { id: true, sku: true, description: true, active: true, ingredient: { select: { name: true } } }, orderBy: { description: "asc" } }),
    candidateOrders(),
    db.invoice.findMany({ where: { supplierId: inv.supplierId, invoiceNumber: { not: null } }, select: { id: true, invoiceNumber: true, invoiceDate: true } }),
    pendingPriceChanges(inv),
    loadHistory(id),
  ]);
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: env.BUSINESS_TIMEZONE });
  const standing = currentApproval(history);
  const events = history.map((e) => ({ ...e, when: when(e.at), statusLabel: e.status && e.status in STATUS_META ? STATUS_META[e.status as InvoiceStatus].label : undefined }));

  const date = toISODate(inv.invoiceDate);
  const locked = inv.status === "APPROVED";
  const meta = STATUS_META[inv.status];
  const duplicate = findDuplicate(inv.invoiceNumber, siblings, inv.id);

  const lines = inv.lines.map((l) => ({
    id: l.id,
    sku: l.sku,
    description: l.description,
    qty: l.qty.toNumber(),
    unitPrice: l.unitPrice.toNumber(),
    expectedQty: num(l.expectedQty),
    expectedPrice: num(l.expectedPrice),
    status: l.status,
    productId: l.supplierProductId,
    productName: l.product ? l.product.ingredient?.name ?? l.product.description : null,
    unit: l.product?.purchaseUnit ?? null,
  }));
  const linesTotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const total = num(inv.total);
  const gap = total == null ? null : Math.round((total - linesTotal) * 100) / 100;

  const credits = creditItems(lines, tolerance);
  const credit = credits.length ? creditRequestText({ supplierName: inv.supplier.name, invoiceNumber: inv.invoiceNumber, invoiceDate: date, items: credits, senderName: user.name, business: BUSINESS }) : null;

  const billed = new Set(lines.map((l) => l.productId).filter(Boolean));
  const notBilled = (inv.order?.lines ?? []).filter((l) => !billed.has(l.supplierProductId) && (num(l.receivedQty) ?? l.qty.toNumber()) > 0);
  const flagged = lines.filter((l) => l.status !== "OK").length;

  const orderOptions = [
    { value: "", label: "No order" },
    ...orders.filter((o) => o.supplierId === inv.supplierId || o.id === inv.orderId).map((o) => ({ value: o.id, label: `Delivery ${shortDate(o.deliveryDate)}`, hint: o.status === "RECEIVED" ? "Received" : "Sent" })),
  ];
  if (inv.order && !orderOptions.some((o) => o.value === inv.order!.id)) orderOptions.push({ value: inv.order.id, label: `Delivery ${shortDate(toISODate(inv.order.deliveryDate))}`, hint: inv.order.status === "DRAFT" ? "Draft" : "" });

  return (
    <>
      <PageHeader
        title={<>{inv.supplier.name}{inv.invoiceNumber && <span className="font-normal text-muted"> · #{inv.invoiceNumber}</span>}</>}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <span className="num">{shortDate(date)}</span>
            {inv.order && <>· <Link href={`/ordering/po/${inv.order.id}`} className="hover:text-ink hover:underline">Order for {shortDate(toISODate(inv.order.deliveryDate))}</Link></>}
            {inv.extractedBy === "claude" && <span>· read by Claude</span>}
          </span>
        }
        back={{ href: "/invoices", label: "Invoices" }}
        actions={
          <InvoiceActions
            id={inv.id}
            status={inv.status}
            statusLabel={meta.label}
            flagged={flagged}
            priceChanges={priceChanges}
            invoiceDate={date}
            credit={credit && { ...credit, count: credits.length, email: inv.supplier.email }}
          />
        }
      />

      {duplicate && (
        <Card className="mb-5 border-warn/40 bg-warn-bg/40 p-4 text-sm">
          <span className="font-medium text-warn">Possible duplicate.</span> <Link href={`/invoices/${duplicate.id}`} className="underline">Invoice #{duplicate.invoiceNumber}</Link> from {inv.supplier.name} ({shortDate(toISODate(duplicate.invoiceDate))}) has the same number. Check it isn&apos;t being paid twice.
        </Card>
      )}
      {locked && (
        <Card className="mb-5 p-4 text-sm text-ink-2">
          {standing ? (
            <>
              {standing.action === "auto-approved" ? "Auto-approved as a clean three-way match" : <>Approved by <span className="font-medium text-ink">{standing.by}</span></>} on {when(standing.at)}
              {standing.note && standing.action === "approved" && <> · &ldquo;{standing.note}&rdquo;</>}. Reopen it to make changes; the approval stays in the history.
            </>
          ) : (
            <>
              Approved by <span className="font-medium text-ink">{inv.approvedBy}</span>
              {inv.approvedAt && <> on {inv.approvedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: env.BUSINESS_TIMEZONE })}</>}. Reopen it to make changes.
            </>
          )}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className={hasImage ? "h-[24rem] sm:h-[32rem] xl:sticky xl:top-6 xl:h-[calc(100dvh-8rem)]" : "xl:sticky xl:top-6 xl:h-[calc(100dvh-8rem)]"}>
          <InvoiceViewer src={hasImage ? `/invoices/${inv.id}/image` : null} type={inv.imageType} invoiceId={inv.id} locked={locked} />
        </div>

        <div className="min-w-0 space-y-6">
          <HeaderFields id={inv.id} locked={locked} invoiceNumber={inv.invoiceNumber} invoiceDate={date} total={total} orderId={inv.orderId ?? ""} orderOptions={orderOptions} />

          <LinesGrid
            invoiceId={inv.id}
            locked={locked}
            lines={lines}
            hasOrder={Boolean(inv.order)}
            products={products.map((p) => ({ value: p.id, label: p.ingredient?.name ?? p.description, hint: `#${p.sku}${p.ingredient?.name ? ` · ${p.description}` : ""}${p.active ? "" : " · inactive"}` }))}
          />

          <Card className="divide-y divide-border text-sm">
            <Row label="Lines total" value={money(linesTotal)} />
            <Row label="Invoice total" value={money(total)} />
            {gap != null && Math.abs(gap) > 0.05 && <Row label={gap > 0 ? "Not covered by lines" : "Lines exceed total"} value={money(Math.abs(gap))} tone="warn" />}
            {credit && <Row label="Credit to request" value={money(credit.total)} tone="bad" />}
          </Card>

          {notBilled.length > 0 && (
            <div>
              <h2 className="mb-2 text-[0.95rem] font-semibold">On the order but not billed</h2>
              <Card className="divide-y divide-border text-sm">
                {notBilled.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 truncate">{l.product.description} <span className="text-muted">#{l.product.sku}</span></span>
                    <span className="num shrink-0 text-muted">{num(l.receivedQty) ?? l.qty.toNumber()} {l.product.purchaseUnit} {l.receivedQty != null ? "received" : "ordered"}</span>
                  </div>
                ))}
              </Card>
              <p className="mt-2 text-xs text-muted">Fine if it comes on a separate invoice — otherwise check whether a line was read wrong.</p>
            </div>
          )}

          <InvoiceHistory events={events} />

          {!locked && <div className="pt-4"><DeleteInvoice id={inv.id} /></div>}
        </div>
      </div>
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className={tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-muted"}>{label}</span>
      <span className={`num font-medium ${tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : ""}`}>{value}</span>
    </div>
  );
}
