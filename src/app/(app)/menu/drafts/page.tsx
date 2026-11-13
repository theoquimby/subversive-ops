import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { claudeReady } from "@/server/integrations/claude";
import { db } from "@/server/db";
import { AI_OFF_NOTE, loadDraftContext, loadDrafts } from "@/server/services/recipe-drafts";
import { DraftReview, type ReviewCatalog } from "./draft-review";

export const metadata = { title: "Recipe drafts" };

export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  await requireUser("MANAGER");
  const { for: forId } = await searchParams;
  const [ctx, drafts, ai, empty, forRecipe] = await Promise.all([
    loadDraftContext(),
    loadDrafts(),
    claudeReady(),
    db.recipe.count({ where: { active: true, lines: { none: {} } } }),
    forId ? db.recipe.findUnique({ where: { id: forId }, select: { id: true, name: true } }) : null,
  ]);
  const catalog: ReviewCatalog = {
    items: ctx.items
      .filter((i) => !/clean|suppl|test/i.test(i.category))
      .map((i) => ({ key: i.key, name: i.name, kind: i.kind, baseUnit: i.baseUnit, units: [...new Set([...i.conversions.map((c) => c.unit), ...i.units])], conversions: i.conversions, costPerBase: i.costPerBase })),
    defaultTarget: ctx.defaultTarget,
  };
  // Recipes a draft fills: its current target % (else the default).
  const targets = Object.fromEntries(
    (await db.recipe.findMany({ where: { id: { in: drafts.flatMap((d) => (d.target.recipeId ? [d.target.recipeId] : [])) } }, select: { id: true, targetFoodCostPct: true } }))
      .map((r) => [r.id, r.targetFoodCostPct?.toNumber() ?? null]),
  );

  return (
    <>
      <PageHeader
        help="menu.drafts"
        back={{ href: "/menu", label: "Menu costs" }}
        title="Recipe drafts"
        description="Suggested ingredient lines with an estimated plate cost. Nothing is saved until you accept a draft — edit any line first, or discard it."
      />
      <DraftReview drafts={drafts} catalog={catalog} ai={ai} aiNote={ai ? null : AI_OFF_NOTE} emptyRecipes={empty} forRecipe={forRecipe} targets={targets} />
    </>
  );
}
