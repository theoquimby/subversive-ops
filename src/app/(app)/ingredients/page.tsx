import { cx, EmptyState, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { usableCostPerBase } from "@/domain/costing";
import { toBase } from "@/domain/units";
import { DISPLAY_UNIT, perDisplayUnit } from "@/lib/units-display";
import { requireUser } from "@/server/auth";
import { buildContext, loadCostingSnapshot } from "@/server/services/costing";
import { countUnitsFor, loadCountableIngredients, storageAreas } from "@/server/services/inventory";
import { estimatedOnHandAll, loadPars } from "@/server/services/planning";
import { IngredientsTable, type IngredientRow } from "./ingredients-table";
import { RestoreIngredientButton } from "./archive-buttons";
import { archivedLabel, baseName } from "@/domain/archiveName";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { HelpZone } from "@/components/help";
import { pendingSuggestions } from "@/server/services/learned";
import { LearnedStockSuggestions } from "../settings/learned-cards";

export const metadata = { title: "Ingredients" };

export default async function IngredientsPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  await requireUser("MANAGER");
  const { q = "", show } = await searchParams;
  const showArchived = show === "archived";
  const [snap, ingredients, stock, pars, archived, areas, learned] = await Promise.all([
    loadCostingSnapshot(),
    loadCountableIngredients(),
    estimatedOnHandAll(),
    loadPars(),
    db.ingredient.findMany({ where: { active: false }, select: { id: true, name: true, category: true }, orderBy: { name: "asc" } }),
    storageAreas(),
    pendingSuggestions(),
  ]);
  const today = businessToday();
  const ctx = buildContext(snap, today);
  const recipesUsing = new Map<string, Set<string>>();
  for (const r of snap.recipes) for (const l of r.lines) if (l.ingredientId) { const set = recipesUsing.get(l.ingredientId) ?? new Set(); set.add(r.name); recipesUsing.set(l.ingredientId, set); }
  const products = await db.supplierProduct.findMany({ where: { active: true, ingredientId: { not: null } }, select: { id: true, ingredientId: true, description: true, sku: true, packText: true, purchaseUnit: true, supplier: { select: { name: true } } } });
  const productsOf = new Map<string, typeof products>();
  for (const p of products) productsOf.set(p.ingredientId!, [...(productsOf.get(p.ingredientId!) ?? []), p]);
  const archivedList = archived.filter((i) => !q || baseName(i.name).toLowerCase().includes(q.toLowerCase()));
  const rows: IngredientRow[] = ingredients.map((i) => {
    const c = ctx.ingredients.get(i.id)!;
    const cost = perDisplayUnit(usableCostPerBase(c), c.baseUnit);
    const { units, conversions } = countUnitsFor(i);
    let perUnit = 1;
    try {
      perUnit = toBase(1, units[0], c.baseUnit, conversions);
    } catch {}
    const st = stock.get(i.id);
    const par = pars[i.id];
    const prefHist = i.preferredProductId ? snap.priceHistory.get(i.preferredProductId) ?? [] : [];
    return {
      id: i.id,
      name: i.name,
      category: i.category,
      storage: i.storageArea,
      cost,
      costUnit: DISPLAY_UNIT[c.baseUnit].unit,
      yieldPct: Math.round(c.yieldPct * 1000) / 10,
      bufferPct: Math.round(i.safetyPct.toNumber() * 100),
      units,
      countUnit: units[0],
      onHand: st?.known ? st.qty / perUnit : null,
      countedOn: st?.known ? st.countedOn ?? null : null,
      par: par == null ? null : Math.round((par / perUnit) * 100) / 100,
      hasSupplier: !!i.preferredProduct,
      recipes: [...(recipesUsing.get(i.id) ?? [])].sort(),
      products: (productsOf.get(i.id) ?? []).map((p) => ({ id: p.id, supplier: p.supplier.name, description: p.description, sku: p.sku, pack: p.packText, unit: p.purchaseUnit, preferred: p.id === i.preferredProductId })),
      history: prefHist.filter((h) => h.date <= today).slice(-24),
    };
  });

  return (
    <>
      <PageHeader
        help="ingredients.page"
        title="Ingredients"
        description="Click any cell to edit — Enter moves down, Tab across, and you can paste a column from a spreadsheet. Click a row’s name area for its products, prices and recipes."
        actions={<LinkButton href="/ingredients/new" variant="primary">New ingredient</LinkButton>}
      />
      {(archived.length > 0 || showArchived) && (
        <div className="-mt-4 mb-4 flex justify-end">
          <Link
            href={showArchived ? "/ingredients" : "/ingredients?show=archived"}
            className={cx("relative rounded-full px-3 py-1 text-sm after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']", showArchived ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}
          >
            {showArchived ? "← All ingredients" : <>Archived <span className="num ml-1">{archived.length}</span></>}
          </Link>
        </div>
      )}
      {showArchived ? (
        archivedList.length === 0 ? (
          <EmptyState title="Nothing archived">Archived ingredients show up here so you can bring them back.</EmptyState>
        ) : (
          <HelpZone id="ingredients.archived"><Table>
            <thead>
              <tr>
                <Th>Ingredient</Th>
                <Th className="hidden sm:table-cell">Category</Th>
                <Th className="hidden sm:table-cell">Archived</Th>
                <Th align="right"><span className="sr-only">Restore</span></Th>
              </tr>
            </thead>
            <tbody>
              {archivedList.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <div className="font-medium">{baseName(i.name)}</div>
                    <div className="text-xs text-muted sm:hidden">{i.category}{archivedLabel(i.name) ? ` · archived ${archivedLabel(i.name)}` : ""}</div>
                  </Td>
                  <Td className="hidden text-muted sm:table-cell">{i.category}</Td>
                  <Td className="hidden text-muted sm:table-cell">{archivedLabel(i.name) ?? "—"}</Td>
                  <Td align="right" className="py-2"><RestoreIngredientButton id={i.id} name={baseName(i.name)} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table></HelpZone>
        )
      ) : (
        <>
          <LearnedStockSuggestions pars={learned.pars} buffers={learned.buffers} />
          <IngredientsTable rows={rows} areas={areas} />
        </>
      )}
    </>
  );
}
