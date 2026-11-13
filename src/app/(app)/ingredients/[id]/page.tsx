import { LineChart } from "@/components/line-chart";
import { Badge, Button, Card, Input, PageHeader, Section, Select } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { formatBase, STANDARD_UNITS_BY_BASE, type BaseUnit } from "@/domain/units";
import { money } from "@/lib/format";
import { DISPLAY_UNIT } from "@/lib/units-display";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { loadCostingSnapshot, priceAsOf } from "@/server/services/costing";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addConversion, removeConversion, setPackSize, setPreferredProduct, unlinkProduct } from "../actions";
import { IngredientForm } from "./ingredient-form";

export default async function IngredientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const isNew = id === "new";
  const [ing, categories, areas] = await Promise.all([
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
  ]);
  if (!isNew && !ing) notFound();

  const base = (ing?.baseUnit ?? "g") as BaseUnit;
  const units = [...STANDARD_UNITS_BY_BASE[base], ...(ing?.conversions.map((c) => c.unit) ?? [])];
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

  return (
    <>
      <PageHeader title={ing.name} description={`${ing.category} · ${ing.storageArea}`} back={{ href: "/ingredients", label: "Ingredients" }} />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Section title="Bought as" description="Supplier products linked to this ingredient. The starred one sets the cost." className="mb-0">
            {ing.products.length === 0 ? (
              <Card className="p-5 text-sm text-muted">Not linked to any supplier product yet. Link one from <Link href="/prices?filter=unlinked" className="text-ink underline">Prices</Link>.</Card>
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
                          <div className="flex items-center gap-2 text-sm font-medium">
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
                      <form action={setPackSize.bind(null, p.id)} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted">1</span>
                        <Input name="purchaseUnit" defaultValue={p.purchaseUnit} className="h-8 w-20" aria-label="Purchase unit" />
                        <span className="text-muted">=</span>
                        <Input name="amount" type="number" step="any" min={0} defaultValue={pack ? Number((pack / (base === "g" ? 453.59237 : base === "ml" ? 3785.411784 : 1)).toFixed(3)) : ""} placeholder="?" className="num h-8 w-24 text-right" aria-label="Pack amount" />
                        <Select name="unit" defaultValue={base === "g" ? "lb" : base === "ml" ? "gal" : "each"} className="h-8 w-24" aria-label="Pack unit">
                          {units.map((u) => <option key={u}>{u}</option>)}
                        </Select>
                        <Button size="sm">Save pack</Button>
                        {!pack && <Badge tone="warn">Pack size needed for costing</Badge>}
                        <span className="ml-auto flex gap-1">
                          {!isPreferred && <Button size="sm" variant="ghost" formAction={setPreferredProduct.bind(null, ing.id, p.id)}>Use for cost</Button>}
                          <Button size="sm" variant="ghost" formAction={unlinkProduct.bind(null, ing.id, p.id)}>Unlink</Button>
                        </span>
                      </form>
                    </div>
                  );
                })}
              </Card>
            )}
          </Section>

          <Section title={`Cost per ${disp.unit}`} description="Last six months" className="mb-0">
            <Card className="p-4"><LineChart points={history} ariaLabel={`${ing.name} cost per ${disp.unit}`} /></Card>
          </Section>

          <Section title="Custom units" description={`For recipes and counts — e.g. 1 slice = 21 g. Base unit is ${base}.`} className="mb-0">
            <Card className="divide-y divide-border">
              {ing.conversions.map((c) => (
                <form key={c.id} action={removeConversion.bind(null, ing.id, c.id)} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>1 {c.unit} <span className="text-muted">=</span> <span className="num">{formatBase(c.baseQty.toNumber(), base)}</span></span>
                  <Button size="sm" variant="ghost">Remove</Button>
                </form>
              ))}
              <form action={addConversion.bind(null, ing.id)} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="text-muted">1</span>
                <Input name="unit" placeholder="slice" className="h-8 w-28" required aria-label="Unit name" />
                <span className="text-muted">=</span>
                <Input name="amount" type="number" step="any" min={0} placeholder="21" className="num h-8 w-24 text-right" required aria-label="Amount" />
                <Select name="amountUnit" defaultValue={base} className="h-8 w-24" aria-label="Amount unit">
                  {STANDARD_UNITS_BY_BASE[base].map((u) => <option key={u}>{u}</option>)}
                </Select>
                <Button size="sm">Add unit</Button>
              </form>
            </Card>
          </Section>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5"><IngredientForm v={form} units={units} categories={categories.map((c) => c.category)} areas={areas.map((a) => a.storageArea)} /></Card>
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Used in</h2>
            {recipes.length === 0 ? <p className="mt-2 text-sm text-muted">No recipes yet.</p> : (
              <ul className="mt-2 space-y-1.5 text-sm">{recipes.map((r) => <li key={r.id}><Link href={`/menu/${r.id}`} className="hover:underline">{r.name}</Link></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
