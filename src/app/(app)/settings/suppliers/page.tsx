import { PageHeader } from "@/components/ui";
import { cutoffRule } from "@/domain/ordering";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { loadCutoffRules } from "@/server/services/planning";
import { getLearned, pendingSuggestions, refreshLearned } from "@/server/services/learned";
import { after } from "next/server";
import { SupplierSuggestionList } from "../learned-cards";
import { SuppliersTable } from "./suppliers-table";

export const metadata = { title: "Suppliers" };

export default async function SuppliersSettingsPage() {
  await requireUser("MANAGER");
  const snapshot = await getLearned().catch(() => null);
  // Delivery days and deadlines are worked out nightly; before the first night, work them out now (after the page is sent).
  if (!snapshot) after(() => refreshLearned().then(() => undefined, () => undefined));
  const [suppliers, cutoffs, learned] = await Promise.all([
    db.supplier.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { products: true } } } }),
    loadCutoffRules(),
    pendingSuggestions(snapshot),
  ]);
  const rows = suppliers.map((s) => ({
    id: s.id, name: s.name, kind: s.kind, email: s.email, leadTimeDays: s.leadTimeDays, minOrder: num(s.minOrder), deliveryDays: s.deliveryDays, active: s.active, notes: s.notes,
    products: s._count.products, cutoff: cutoffRule(cutoffs[s.id], s.leadTimeDays),
  }));
  return (
    <div className="max-w-5xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} help="settings.suppliers" title="Suppliers" description="Delivery days and lead time decide when each order is due and how many days it covers. Tap a supplier for cutoffs, auto-drafts and notes." />
      <SupplierSuggestionList list={learned.suppliers} />
      <SuppliersTable rows={rows} />
    </div>
  );
}
