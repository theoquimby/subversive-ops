import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { loadCostingSnapshot, priceAsOf } from "@/server/services/costing";
import { businessToday } from "@/server/services/sales";
import { ManualPrices } from "./manual-prices";

export const metadata = { title: "Update prices" };

export default async function UpdatePricesPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  await requireUser("MANAGER");
  const suppliers = await db.supplier.findMany({ where: { active: true }, orderBy: [{ kind: "desc" }, { name: "asc" }], select: { id: true, name: true } });
  const { supplier: asked } = await searchParams;
  const supplier = suppliers.some((s) => s.id === asked) ? asked : suppliers[0]?.id;
  const today = businessToday();
  const [products, snap] = await Promise.all([
    supplier ? db.supplierProduct.findMany({ where: { supplierId: supplier, active: true }, include: { ingredient: { select: { name: true } } }, orderBy: { description: "asc" } }) : [],
    loadCostingSnapshot(),
  ]);
  const rows = products.map((p) => {
    const hist = snap.priceHistory.get(p.id);
    return { id: p.id, description: p.description, ingredient: p.ingredient?.name ?? null, unit: p.purchaseUnit, price: priceAsOf(hist, today), since: hist?.filter((h) => h.date <= today).at(-1)?.date ?? null };
  });

  return (
    <>
      <PageHeader help="prices.manual" title="Update prices by hand" description="For local suppliers and anything not on a price sheet. Only changed prices are saved, and what you type is kept when you switch supplier." back={{ href: "/prices", label: "Prices" }} />
      {/* Not keyed by supplier: typed prices stay in place while switching. */}
      <ManualPrices suppliers={suppliers} supplierId={supplier} rows={rows} today={today} />
    </>
  );
}
