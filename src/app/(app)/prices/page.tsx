import { LinkButton, PageHeader } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { loadCostingSnapshot, priceAsOf } from "@/server/services/costing";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { GridCell } from "@/components/grid";
import { savePriceAlertThreshold } from "./actions";
import { spikeThreshold } from "@/server/services/notify";
import { HelpZone } from "@/components/help";
import { PricesTable, type PriceRow } from "./prices-table";

export const metadata = { title: "Prices" };

export default async function PricesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser("MANAGER");
  const { show } = await searchParams;
  const hiddenView = show === "hidden";
  const today = businessToday();
  const monthAgo = addDays(today, -30);
  const [products, ingredients, imports, snap, threshold, hiddenCount] = await Promise.all([
    db.supplierProduct.findMany({
      where: { active: !hiddenView },
      include: { supplier: { select: { id: true, name: true } }, ingredient: { select: { id: true, name: true, category: true, storageArea: true } } },
      orderBy: [{ supplier: { name: "asc" } }, { description: "asc" }],
    }),
    db.ingredient.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.priceImport.findMany({ orderBy: { createdAt: "desc" }, take: 1, include: { supplier: { select: { name: true } } } }),
    loadCostingSnapshot(),
    spikeThreshold(),
    db.supplierProduct.count({ where: { active: false } }),
  ]);
  const usedIn = new Map<string, number>();
  for (const r of snap.recipes) for (const l of r.lines) if (l.ingredientId) usedIn.set(l.ingredientId, (usedIn.get(l.ingredientId) ?? 0) + 1);

  const rows: PriceRow[] = products.map((p) => {
    const hist = (snap.priceHistory.get(p.id) ?? []).filter((h) => h.date <= today);
    const now = priceAsOf(hist, today);
    const then = priceAsOf(hist, monthAgo);
    const change = now != null && then ? (now - then) / then : null;
    return {
      id: p.id,
      description: p.description,
      sku: p.sku,
      supplierId: p.supplier.id,
      supplier: p.supplier.name,
      packText: p.packText,
      purchaseUnit: p.purchaseUnit,
      packQtyBase: num(p.packQtyBase),
      ingredientId: p.ingredient?.id ?? null,
      ingredient: p.ingredient?.name ?? null,
      category: p.ingredient?.category ?? null,
      storage: p.ingredient?.storageArea ?? null,
      usedIn: p.ingredient ? usedIn.get(p.ingredient.id) ?? 0 : 0,
      price: now,
      change: change != null && Math.abs(change) >= 0.0005 ? change : null,
      since: hist.at(-1)?.date ?? null,
      history: hist.slice(-24),
    };
  });

  return (
    <>
      <PageHeader
        help="prices.page"
        title={hiddenView ? "Hidden products" : "Prices"}
        back={hiddenView ? { href: "/prices", label: "Prices" } : undefined}
        description={hiddenView ? "Products you've hidden. They stay out of ordering and price lists until you restore them." : imports[0] ? `Last import: ${imports[0].supplier.name}, ${relativeTime(imports[0].createdAt)}` : "Every price change is kept, so plate costs can be compared over time."}
        actions={
          hiddenView ? undefined : (
            <>
              {hiddenCount > 0 && <LinkButton href="/prices?show=hidden" variant="ghost">Hidden <span className="num text-muted">{hiddenCount}</span></LinkButton>}
              <LinkButton href="/prices/update">Update by hand</LinkButton>
              <LinkButton href="/prices/import" variant="primary" data-tour="prices.import-button">Import price sheet</LinkButton>
            </>
          )
        }
      />

      <PricesTable rows={rows} ingredients={ingredients.map((i) => ({ value: i.id, label: i.name }))} hiddenView={hiddenView} today={today} />

      {!hiddenView && (
        <HelpZone id="prices.alert" className="mt-6 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>Alert managers when a price goes up by</span>
          <GridCell grid="price-alert" col="threshold" type="number" suffix="%" value={Math.round(threshold * 1000) / 10} onSave={savePriceAlertThreshold} ariaLabel="Price alert threshold, percent" className="w-20" />
          <span>or more. <Link href="/settings/notifications" className="underline decoration-border-strong underline-offset-2 hover:text-ink">Choose how you hear about it</Link>.</span>
        </HelpZone>
      )}
    </>
  );
}
