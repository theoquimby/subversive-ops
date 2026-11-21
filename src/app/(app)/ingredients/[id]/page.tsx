import { LineChart } from "@/components/line-chart";
import { Badge, Card, PageHeader, Section } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { formatBase, STANDARD_UNITS_BY_BASE, type BaseUnit } from "@/domain/units";
import { money, shortDate } from "@/lib/format";
import { toISODate } from "@/domain/dates";
import { DISPLAY_UNIT } from "@/lib/units-display";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { loadCostingSnapshot, priceAsOf } from "@/server/services/costing";
import { businessToday } from "@/server/services/sales";
import { countUnitsFor } from "@/server/services/inventory";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IngredientForm } from "./ingredient-form";
import { HelpTip, HelpZone } from "@/components/help";
import { AllergenChips } from "./allergen-chips";
import { AddPack } from "./add-pack";
import { AddPrice } from "./add-price";
import { AddUnitForm, PackForm, RemoveUnitButton } from "./unit-forms";

export default async function IngredientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const isNew = id === "new";
  const [ing, categories, areas, allProducts, suppliers] = await Promise.all([
    isNew ? null : db.ingredient.findUnique({
      where: { id },
      include: {
        conversions: { orderBy: { unit: "asc" } },
        products: { include: { supplier: true, prices: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 1 } } },
        recipeLines: { include: { recipe: { select: { id: true, name: true, active: true } } } },
      },
    }),
    db.ingredient.findMany({ distinct: ["category"], select: { category: true } }),
    db.ingredient.findMany({ distinct: ["storageArea"], select: { storageArea: true } }),
    isNew ? [] : db.supplierProduct.findMany({ where: { active: true, OR: [{ ingredientId: null }, { ingredientId: { not: id } }] }, select: { id: true, sku: true, description: true, packText: true, supplier: { select: { name: true } }, ingredient: { select: { name: true } } }, orderBy: { description: "asc" } }),
    isNew ? [] : db.supplier.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!isNew && !ing) notFound();

  const base = (ing?.baseUnit ?? "g") as BaseUnit;
  const packUnits = [...STANDARD_UNITS_BY_BASE[base], ...(ing?.conversions.map((c) => c.unit) ?? [])];
  const units = ing ? countUnitsFor({ ...ing, products: ing.products.filter((p) => p.active) }).units : [...STANDARD_UNITS_BY_BASE[base]];
  const form = {
    id: ing?.id ?? null,
    name: ing?.name ?? "",
    category: ing?.category ?? "Other",
    storageArea: ing?.storageArea ?? "Dry storage",
    baseUnit: base,
    yieldPct: Math.round((ing?.yieldPct.toNumber() ?? 1) * 1000) / 10,
    safetyPct: Math.round((ing?.safetyPct.toNumber() ?? 0.15) * 100),
    countUnit: ing?.countUnit ?? "",
    notes: ing?.notes ?? "",
  };

  if (!ing) {
    return (
      <>
        <PageHeader title="New ingredient" back={{ href: "/ingredients", label: "Ingredients" }} />
        <Card className="max-w-xl p-5"><IngredientForm v={form} units={units} categories={categories.map((c) => c.category)} areas={areas.map((a) => a.storageArea)} /></Card>
      </>
    );
  }

  // Cost history per display unit (e.g. $/lb) from the preferred product.
  const snap = await loadCostingSnapshot();
  const today = businessToday();
  const preferred = ing.products.find((p) => p.id === ing.preferredProductId) ?? ing.products[0];
  const disp = DISPLAY_UNIT[base];
  const history = preferred?.packQtyBase
    ? Array.from({ length: 27 }, (_, k) => {
        const date = addDays(today, -7 * (26 - k));
        const price = priceAsOf(snap.priceHistory.get(preferred.id), date);
        return { x: date, y: price == null ? null : (price / preferred.packQtyBase!.toNumber()) * disp.factor };
      })
    : [];
  const recipes = [...new Map(ing.recipeLines.filter((l) => l.recipe.active).map((l) => [l.recipe.id, l.recipe])).values()];

  // Drill-down: what was actually invoiced and ordered for this ingredient lately.
  const [invoiceLines, orderLines] = await Promise.all([
    db.invoiceLine.findMany({
      where: { product: { ingredientId: ing.id } },
      orderBy: [{ invoice: { invoiceDate: "desc" } }, { id: "asc" }],
      take: 12,
      include: { invoice: { select: { id: true, invoiceDate: true, invoiceNumber: true, supplier: { select: { name: true } } } }, product: { select: { purchaseUnit: true } } },
    }),
    db.purchaseOrderLine.findMany({
      where: { product: { ingredientId: ing.id }, qty: { gt: 0 } },
      orderBy: [{ order: { deliveryDate: "desc" } }, { id: "asc" }],
      take: 12,
      include: { order: { select: { id: true, deliveryDate: true, status: true, supplier: { select: { name: true } } } }, product: { select: { purchaseUnit: true } } },
    }),
  ]);
  const LINE_FLAG: Record<string, string> = { PRICE: "Price changed", QTY: "Qty short", PRICE_QTY: "Price and qty", UNMATCHED: "Not on order" };
  const ORDER_STATUS: Record<string, string> = { DRAFT: "Draft", SENT: "Sent", RECEIVED: "Received" };

  return (
    <>
      <PageHeader help="ingredients.detail" title={ing.name} description={`${ing.category} · ${ing.storageArea}`} back={{ href: "/ingredients", label: "Ingredients" }} />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="min-w-0 space-y-6 lg:col-span-3">
          <Section help="ingredients.boughtAs" title={<span className="inline-flex items-center gap-1.5">Bought as <HelpTip id="ingredients.boughtAs" /></span>} description="Supplier products linked to this ingredient: every pack it comes in. The one marked “Sets cost” prices recipes." className="mb-0">
            {ing.products.length === 0 ? (
              <Card>
                <AddPrice ingredientId={ing.id} name={ing.name} units={packUnits} defaultUnit={base === "g" ? "lb" : base === "ml" ? "gal" : "each"} suppliers={suppliers.map((x) => x.name)} />
                {allProducts.length > 0 && (
                  <div className="border-t border-border">
                    <AddPack ingredientId={ing.id} products={allProducts.map((p) => ({ id: p.id, label: `${p.description}${p.packText ? ` · ${p.packText}` : ""}`, hint: `${p.supplier.name} #${p.sku}${p.ingredient ? ` · now on ${p.ingredient.name}` : ""}` }))} placeholder="Or link a product you already have…" />
                  </div>
                )}
              </Card>
            ) : (
              <Card className="divide-y divide-border">
                {ing.products.map((p) => {
                  const isPreferred = p.id === (ing.preferredProductId ?? ing.products[0].id);
                  const price = num(p.prices[0]?.price);
                  const pack = num(p.packQtyBase);
                  return (
                    <div key={p.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium break-words">
                            {p.description}
                            {isPreferred && ing.products.length > 1 && <Badge tone="good">Sets cost</Badge>}
                          </div>
                          <div className="mt-0.5 text-xs text-muted">{p.supplier.name} · #{p.sku}{p.packText ? ` · ${p.packText}` : ""}</div>
                        </div>
                        <div className="num text-right">
                          <div className="text-sm font-medium">{money(price)} <span className="font-normal text-muted">/ {p.purchaseUnit}</span></div>
                          {price != null && pack ? <div className="text-xs text-muted">{money((price / pack) * disp.factor)} / {disp.unit}</div> : null}
                        </div>
                      </div>
                      <PackForm ingredientId={ing.id} productId={p.id} purchaseUnit={p.purchaseUnit} amount={pack ? Number((pack / (base === "g" ? 453.59237 : base === "ml" ? 3785.411784 : 1)).toFixed(3)) : null} defaultUnit={base === "g" ? "lb" : base === "ml" ? "gal" : "each"} units={packUnits} hasPack={!!pack} isPreferred={isPreferred} />
                    </div>
                  );
                })}
                <AddPack ingredientId={ing.id} products={allProducts.map((p) => ({ id: p.id, label: `${p.description}${p.packText ? ` · ${p.packText}` : ""}`, hint: `${p.supplier.name} #${p.sku}${p.ingredient ? ` · now on ${p.ingredient.name}` : ""}` }))} />
              </Card>
            )}
          </Section>

          <Section help="ingredients.history" title={`Cost per ${disp.unit}`} description="Last six months" className="mb-0">
            <Card className="p-4"><LineChart points={history} ariaLabel={`${ing.name} cost per ${disp.unit}`} /></Card>
          </Section>

          <Section help="ingredients.drilldown" title={<span className="inline-flex items-center gap-1.5">Recent invoices and orders <HelpTip id="ingredients.drilldown" /></span>} description="What was actually billed and ordered — tap one to open it." className="mb-0">
            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="divide-y divide-border" data-tour="ingredients.invoiceLines">
                <div className="px-4 py-2.5 text-[0.75rem] font-medium text-muted">Invoice lines</div>
                {invoiceLines.length === 0 ? <p className="px-4 py-3 text-sm text-muted">None yet.</p> : invoiceLines.map((l) => (
                  <Link key={l.id} href={`/invoices/${l.invoice.id}`} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                    <span className="min-w-0">
                      <span className="block truncate">{shortDate(toISODate(l.invoice.invoiceDate))} · {l.invoice.supplier.name}</span>
                      <span className="block truncate text-xs text-muted">{l.invoice.invoiceNumber ? `#${l.invoice.invoiceNumber}` : "No number"}{LINE_FLAG[l.status] ? <> · <span className="text-warn">{LINE_FLAG[l.status]}</span></> : null}</span>
                    </span>
                    <span className="num shrink-0 text-right">
                      <span className="block">{money(l.unitPrice.toNumber())}<span className="text-muted"> / {l.product?.purchaseUnit ?? "unit"}</span></span>
                      <span className="block text-xs text-muted">× {Number(l.qty.toNumber().toFixed(2))}{l.expectedPrice && Math.abs(l.expectedPrice.toNumber() - l.unitPrice.toNumber()) >= 0.005 ? ` · was ${money(l.expectedPrice.toNumber())}` : ""}</span>
                    </span>
                  </Link>
                ))}
              </Card>
              <Card className="divide-y divide-border">
                <div className="px-4 py-2.5 text-[0.75rem] font-medium text-muted">Order lines</div>
                {orderLines.length === 0 ? <p className="px-4 py-3 text-sm text-muted">None yet.</p> : orderLines.map((l) => (
                  <Link key={l.id} href={`/ordering/po/${l.order.id}`} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                    <span className="min-w-0">
                      <span className="block truncate">{shortDate(toISODate(l.order.deliveryDate))} · {l.order.supplier.name}</span>
                      <span className="block text-xs text-muted">{ORDER_STATUS[l.order.status]}{l.receivedQty != null && Math.abs(l.receivedQty.toNumber() - l.qty.toNumber()) >= 0.005 ? <> · <span className="text-warn">got {Number(l.receivedQty.toNumber().toFixed(2))}</span></> : null}</span>
                    </span>
                    <span className="num shrink-0 text-right">
                      <span className="block">{Number(l.qty.toNumber().toFixed(2))} {l.product.purchaseUnit}</span>
                      {l.unitPrice && <span className="block text-xs text-muted">{money(l.unitPrice.toNumber())} / {l.product.purchaseUnit}</span>}
                    </span>
                  </Link>
                ))}
              </Card>
            </div>
          </Section>

          <Section help="ingredients.customUnits" title={<span className="inline-flex items-center gap-1.5">Custom units <HelpTip id="ingredients.customUnits" /></span>} description={`For recipes and counts — e.g. 1 slice = 21 g. Base unit is ${base}.`} className="mb-0">
            <Card className="divide-y divide-border">
              {ing.conversions.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>1 {c.unit} <span className="text-muted">=</span> <span className="num">{formatBase(c.baseQty.toNumber(), base)}</span></span>
                  <RemoveUnitButton ingredientId={ing.id} conversionId={c.id} unit={c.unit} usedBy={ing.recipeLines.filter((l) => l.recipe.active && l.unit.trim().toLowerCase() === c.unit.trim().toLowerCase()).length} />
                </div>
              ))}
              <AddUnitForm ingredientId={ing.id} base={base} units={STANDARD_UNITS_BY_BASE[base]} />
            </Card>
          </Section>
        </div>

        <div className="min-w-0 space-y-6 lg:col-span-2">
          <HelpZone id="ingredients.settings"><Card className="p-5"><IngredientForm v={form} units={units} categories={categories.map((c) => c.category)} areas={areas.map((a) => a.storageArea)} /></Card></HelpZone>
          <HelpZone id="ingredients.allergens"><Card className="p-5" data-tour="ingredients.allergens">
            <h2 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold">Allergens <HelpTip id="ingredients.allergens" /></h2>
            <AllergenChips ingredientId={ing.id} initial={ing.allergens} />
          </Card></HelpZone>
          <HelpZone id="ingredients.usedIn"><Card className="p-5">
            <h2 className="text-sm font-semibold">Used in</h2>
            {recipes.length === 0 ? <p className="mt-2 text-sm text-muted">No recipes yet.</p> : (
              <ul className="mt-2 space-y-1.5 text-sm">{recipes.map((r) => <li key={r.id}><Link href={`/menu/${r.id}`} className="hover:underline">{r.name}</Link></li>)}</ul>
            )}
          </Card></HelpZone>
        </div>
      </div>
    </>
  );
}
