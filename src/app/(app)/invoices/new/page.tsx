import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { claudeConfigured } from "@/server/integrations/claude";
import { candidateOrders } from "@/server/services/invoices";
import { businessToday } from "@/server/services/sales";
import { NewInvoice } from "./new-invoice";

export const metadata = { title: "Add invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ supplier?: string; order?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const [suppliers, orders] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    candidateOrders(),
  ]);
  return (
    <>
      <PageHeader title="Add invoice" description="Take a photo or upload the PDF, check the lines, and save. It's matched against the order straight away." back={{ href: "/invoices", label: "Invoices" }} />
      <NewInvoice suppliers={suppliers} orders={orders} today={businessToday()} canRead={claudeConfigured()} initialSupplierId={sp.supplier ?? null} initialOrderId={sp.order ?? null} />
    </>
  );
}
