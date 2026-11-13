import { LineChart } from "@/components/line-chart";
import { Card, PageHeader, Section } from "@/components/ui";
import { usableCostPerBase } from "@/domain/costing";
import { STANDARD_UNITS_BY_BASE } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { num } from "@/server/db";
import { buildContext, costHistory, loadCostingSnapshot, safeCost } from "@/server/services/costing";
import { targetFoodCost } from "@/server/services/insights";
import { businessToday } from "@/server/services/sales";
import { notFound } from "next/navigation";
import { RecipeEditor, type EditorCatalog, type EditorRecipe } from "./recipe-editor";
import { recipeYieldInBase } from "@/domain/costing";

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
        return { id: r.id, name: r.name, baseUnit: cr.yieldBase, costPerBase: perBase, units: STANDARD_UNITS_BY_BASE[cr.yieldBase] };
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

  return (
    <>
      <PageHeader title={recipe?.name ?? "New recipe"} back={{ href: `/menu?kind=${initial.kind}`, label: "Menu costs" }} />
      <RecipeEditor initial={initial} catalog={catalog} />
      {recipe && (
        <Section title="Plate cost over time" description="Weekly, last six months — recalculated from price history">
          <Card className="p-4">
            <LineChart points={history.map((h) => ({ x: h.date, y: h.cost }))} ariaLabel={`${recipe.name} cost over the last six months`} />
          </Card>
        </Section>
      )}
    </>
  );
}
