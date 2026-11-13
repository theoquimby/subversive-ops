import { LineChart } from "@/components/line-chart";
import { Card, PageHeader, Section } from "@/components/ui";
import { usableCostPerBase } from "@/domain/costing";
import { STANDARD_UNITS_BY_BASE } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { buildContext, costHistory, ingredientCostSource, loadCostingSnapshot, safeCost } from "@/server/services/costing";
import { targetFoodCost } from "@/server/services/insights";
import { businessToday } from "@/server/services/sales";
import { notFound } from "next/navigation";
import { RecipeEditor, type EditorCatalog, type EditorRecipe } from "./recipe-editor";
import { recipeYieldInBase } from "@/domain/costing";
import { HelpTip, HelpZone } from "@/components/help";
import { allergensForRecipe } from "@/server/services/allergens";
import { allergenLabel } from "@/domain/allergens";
import Link from "next/link";

export default async function RecipePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const { kind } = await searchParams;
  const isNew = id === "new";
  const snap = await loadCostingSnapshot();
  const today = businessToday();
  const ctx = buildContext(snap, today);
  const recipe = isNew ? null : snap.recipes.find((r) => r.id === id);
  if (!isNew && !recipe) notFound();

  // Where each ingredient's cost comes from: the supplier product and the price used.
  const sources = new Map(snap.ingredients.map((i) => [i.id, ingredientCostSource(snap, i, today)] as const));
  const productIds = [...sources.values()].flatMap((x) => (x ? [x.productId] : []));
  const products = new Map(
    (await db.supplierProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, description: true, packText: true, purchaseUnit: true, supplier: { select: { name: true } } } })).map((p) => [p.id, p]),
  );

  // Everything the editor needs to recalculate cost live as lines change.
  const catalog: EditorCatalog = {
    ingredients: snap.ingredients.map((i) => {
      const c = ctx.ingredients.get(i.id)!;
      const pref = i.products.find((p) => p.id === i.preferredProductId) ?? i.products[0];
      return {
        id: i.id,
        name: i.name,
        baseUnit: c.baseUnit,
        costPerUsableBase: usableCostPerBase(c),
        conversions: c.conversions,
        units: [...STANDARD_UNITS_BY_BASE[c.baseUnit], ...c.conversions.map((x) => x.unit)],
        packQtyBase: num(pref?.packQtyBase),
        source: (() => {
          const src = sources.get(i.id);
          const p = src && products.get(src.productId);
          return src && p ? { supplier: p.supplier.name, sku: p.sku, description: p.description, pack: p.packText, purchaseUnit: p.purchaseUnit, price: src.price, date: src.date } : null;
        })(),
      };
    }),
    recipes: snap.recipes
      .filter((r) => r.kind === "PREP" && r.id !== id)
      .map((r) => {
        const cr = ctx.recipes.get(r.id)!;
        const cost = safeCost(ctx, r.id);
        let perBase: number | null = null;
        try {
          perBase = "error" in cost ? null : cost.totalCost / recipeYieldInBase(cr);
        } catch {}
        return { id: r.id, name: r.name, baseUnit: cr.yieldBase, costPerBase: perBase, units: STANDARD_UNITS_BY_BASE[cr.yieldBase], batchCost: "error" in cost ? null : cost.totalCost, yieldQty: cr.yieldQty, yieldUnit: cr.yieldUnit };
      }),
    defaultTarget: await targetFoodCost(),
  };

  const initial: EditorRecipe = recipe
    ? {
        id: recipe.id,
        name: recipe.name,
        kind: recipe.kind,
        category: recipe.category,
        menuPrice: num(recipe.menuPrice),
        yieldQty: recipe.yieldQty.toNumber(),
        yieldUnit: recipe.yieldUnit,
        yieldBase: recipe.yieldBase,
        targetFoodCostPct: num(recipe.targetFoodCostPct),
        notes: recipe.notes,
        lines: recipe.lines.map((l) => ({ key: l.id, ingredientId: l.ingredientId, subRecipeId: l.subRecipeId, qty: l.qty.toNumber(), unit: l.unit })),
      }
    : {
        id: null,
        name: "",
        kind: kind === "PREP" || kind === "MODIFIER" ? kind : "MENU",
        category: kind === "PREP" ? "Prep" : "Food",
        menuPrice: null,
        yieldQty: 1,
        yieldUnit: "each",
        yieldBase: "each",
        targetFoodCostPct: null,
        notes: null,
        lines: [],
      };

  const history = recipe ? costHistory(snap, recipe.id, today, 26) : [];
  const allergens = recipe ? await allergensForRecipe(recipe.id) : null;

  return (
    <>
      <PageHeader help="menu.editor" title={recipe?.name ?? "New recipe"} back={{ href: `/menu?kind=${initial.kind}`, label: "Menu costs" }} />
      {/* Remount after a save so the editor starts clean from what was stored (line ids change on save). */}
      <RecipeEditor key={JSON.stringify(initial)} initial={initial} catalog={catalog} />
      {recipe && allergens && (
        <Section
          help="menu.allergens"
          title={<span className="inline-flex items-center gap-1.5">Allergens <HelpTip id="menu.allergens" /></span>}
          description="Rolled up from the ingredients, including sub-recipes. Tag ingredients on their page."
          actions={recipe.kind !== "PREP" ? <Link href="/menu/allergens" className="text-sm text-muted hover:text-ink">Allergen chart →</Link> : undefined}
        >
          <Card className="p-4" data-tour="menu.allergens">
            {allergens.allergens.length === 0 ? (
              <p className="text-sm text-muted">No allergens tagged on any ingredient in this recipe. That only means nothing is tagged — check each ingredient before telling a guest it&apos;s free of anything.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {allergens.allergens.map((a) => (
                  <li key={a} className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
                    <span className="font-medium">{allergenLabel(a)}</span>
                    <span className="text-muted"> · {(allergens.sources[a] ?? []).join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>
      )}
      {recipe && (
        <HelpZone id="menu.editor.history" tour="menu.history">
        <Section title="Plate cost over time" description="Weekly, last six months — recalculated from price history">
          <Card className="p-4">
            <LineChart points={history.map((h) => ({ x: h.date, y: h.cost }))} ariaLabel={`${recipe.name} cost over the last six months`} />
          </Card>
        </Section>
        </HelpZone>
      )}
    </>
  );
}
