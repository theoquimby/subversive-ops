import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { candidateOrders, readerReady } from "@/server/services/invoices";
import { businessToday } from "@/server/services/sales";
import { NewInvoice } from "./new-invoice";

export const metadata = { title: "Add invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ supplier?: string; order?: string; kind?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const [suppliers, orders] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    candidateOrders(),
  ]);
  return (
    <>
      <PageHeader help="invoices.page" title={sp.kind === "receipt" ? "Add a receipt" : "Add invoice"} description={sp.kind === "receipt" ? "Snap the receipt, check the lines, and save. Approving it sends the prices to costing." : "Snap every page (or upload the PDF), check the lines, and save. It's matched against the order straight away."} back={{ href: "/invoices", label: "Invoices" }} />
      <NewInvoice suppliers={suppliers} orders={orders} today={businessToday()} canRead={await readerReady()} initialSupplierId={sp.supplier ?? null} initialOrderId={sp.order ?? null} initialMode={sp.kind === "receipt" ? "receipt" : "invoice"} />
    </>
  );
}
