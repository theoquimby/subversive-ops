import { HelpZone } from "@/components/help";
import { cx, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { loadCostingSnapshot, priceAsOf } from "@/server/services/costing";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { ManualPrices } from "./manual-prices";

export const metadata = { title: "Update prices" };

export default async function UpdatePricesPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  await requireUser("MANAGER");
  const suppliers = await db.supplier.findMany({ where: { active: true }, orderBy: [{ kind: "desc" }, { name: "asc" }] });
  const { supplier = suppliers[0]?.id } = await searchParams;
  const today = businessToday();
  const [products, snap] = await Promise.all([
    db.supplierProduct.findMany({ where: { supplierId: supplier, active: true }, include: { ingredient: { select: { name: true } } }, orderBy: { description: "asc" } }),
    loadCostingSnapshot(),
  ]);
  const rows = products.map((p) => {
    const hist = snap.priceHistory.get(p.id);
    return { id: p.id, description: p.description, ingredient: p.ingredient?.name ?? null, unit: p.purchaseUnit, price: priceAsOf(hist, today), since: hist?.filter((h) => h.date <= today).at(-1)?.date ?? null };
  });

  return (
    <>
      <PageHeader help="prices.manual" title="Update prices by hand" description="For local suppliers and anything not on a price sheet. Only changed prices are saved." back={{ href: "/prices", label: "Prices" }} />
      <HelpZone id="prices.manual.suppliers" className="mb-5 flex flex-wrap gap-2">
        {suppliers.map((s) => (
          <Link key={s.id} href={`/prices/update?supplier=${s.id}`} className={cx("rounded-full px-3 py-1 text-sm", s.id === supplier ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>
            {s.name}
          </Link>
        ))}
      </HelpZone>
      <ManualPrices key={supplier} rows={rows} today={today} />
    </>
  );
}
