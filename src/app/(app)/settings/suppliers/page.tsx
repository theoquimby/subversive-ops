import { PageHeader } from "@/components/ui";
import { cadenceOf } from "@/domain/orderNeed";
import { cutoffRule } from "@/domain/ordering";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { loadCutoffRules } from "@/server/services/planning";
import { getLearned, pendingSuggestions, refreshLearned } from "@/server/services/learned";
import { loadSupplierPrefs, prefsOf, staffOrderers } from "@/server/services/supplierPrefs";
import Link from "next/link";
import { after } from "next/server";
import { SupplierSuggestionList } from "../learned-cards";
import { StaffOrderers } from "./staff-orderers";
import { SuppliersTable } from "./suppliers-table";

export const metadata = { title: "Suppliers" };

export default async function SuppliersSettingsPage() {
  await requireUser("MANAGER");
  const snapshot = await getLearned().catch(() => null);
  // Delivery days and deadlines are worked out nightly; before the first night, work them out now (after the page is sent).
  if (!snapshot) after(() => refreshLearned().then(() => undefined, () => undefined));
  const [suppliers, cutoffs, learned, prefs, users, orderers] = await Promise.all([
    db.supplier.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { products: true } } } }),
    loadCutoffRules(),
    pendingSuggestions(snapshot),
    loadSupplierPrefs(),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    staffOrderers(),
  ]);
  // Brewery suppliers are ordered from the Brewery: listed apart, not mixed into the kitchen's.
  const kitchen = suppliers.filter((s) => s.department !== "brewery");
  const brewery = suppliers.filter((s) => s.department === "brewery");
  const rows = kitchen.map((s) => ({
    id: s.id, name: s.name, kind: s.kind, email: s.email, leadTimeDays: s.leadTimeDays, minOrder: num(s.minOrder), deliveryDays: s.deliveryDays, active: s.active, notes: s.notes,
    products: s._count.products, cutoff: cutoffRule(cutoffs[s.id], s.leadTimeDays), cadence: cadenceOf(s.orderCadence), prefs: prefsOf(prefs, s.id),
  }));
  return (
    <div className="max-w-5xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} help="settings.suppliers" title="Suppliers" description="Delivery days and lead time decide when each order is due and how many days it covers. Tap a supplier for cutoffs, reminders, how it takes orders and notes." />
      <SupplierSuggestionList list={learned.suppliers} />
      <SuppliersTable rows={rows} people={users.map((u) => ({ id: u.id, name: u.name }))} />
      {brewery.length > 0 && (
        <details className="group mt-4 rounded-xl border border-border bg-surface">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm [&::-webkit-details-marker]:hidden">
            <span><span className="font-medium text-ink">Brewery suppliers, ordered from the Brewery</span><span className="text-muted"> · {brewery.length}</span></span>
            <span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span>
          </summary>
          <div className="border-t border-border px-4 py-3 text-sm">
            <p className="text-ink-2">{brewery.map((s) => s.name).join(", ")}.</p>
            <p className="mt-1 text-muted">They stay off kitchen ordering, counts and reminders. Order malt, hops and yeast on <Link href="/brewery/ordering" className="text-ink-2 underline underline-offset-2">Brewery → Ordering</Link>.</p>
          </div>
        </details>
      )}
      <StaffOrderers staff={users.filter((u) => u.role !== "MANAGER").map((u) => ({ id: u.id, name: u.name }))} value={orderers} />
    </div>
  );
}
