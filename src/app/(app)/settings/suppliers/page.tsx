import { PageHeader } from "@/components/ui";
import { cutoffRule } from "@/domain/ordering";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { loadCutoffRules } from "@/server/services/planning";
import { SuppliersTable } from "./suppliers-table";

export const metadata = { title: "Suppliers" };

export default async function SuppliersSettingsPage() {
  await requireUser("MANAGER");
  const [suppliers, cutoffs] = await Promise.all([
    db.supplier.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { products: true } } } }),
    loadCutoffRules(),
  ]);
  const rows = suppliers.map((s) => ({
    id: s.id, name: s.name, kind: s.kind, email: s.email, leadTimeDays: s.leadTimeDays, minOrder: num(s.minOrder), deliveryDays: s.deliveryDays, active: s.active, notes: s.notes,
    products: s._count.products, cutoff: cutoffRule(cutoffs[s.id], s.leadTimeDays),
  }));
  return (
    <div className="max-w-5xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Suppliers" description="Delivery days and lead time decide when each order is due and how many days it covers. Tap a supplier for cutoffs, auto-drafts and notes." />
      <SuppliersTable rows={rows} />
    </div>
  );
}
