import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { brewCatalog, brewRecipeData, type BrewRecipeData } from "@/server/services/brewRecipes";
import { notFound } from "next/navigation";
import { BrewRecipeEditor } from "./editor";

export const metadata = { title: "Brewing recipe" };

const BLANK: BrewRecipeData = {
  id: null,
  name: "",
  style: null,
  status: "dev",
  beerId: null,
  batchBbl: 7,
  efficiencyPct: 72,
  boilMinutes: 60,
  fermentDays: 14,
  conditionDays: 7,
  targetOg: null,
  targetFg: null,
  notes: null,
  lines: [],
};

export default async function BrewRecipePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const isNew = id === "new";
  const [recipe, catalog] = await Promise.all([isNew ? null : brewRecipeData(id), brewCatalog()]);
  if (!isNew && !recipe) notFound();
  const initial: BrewRecipeData = recipe ?? BLANK;
  const fromBrewManager = recipe?.sourceKey?.startsWith("brewmanager:") ?? false;
  return (
    <>
      <PageHeader
        help="brewery.recipes.editor"
        title={recipe?.name ?? "New recipe"}
        back={{ href: "/brewery/recipes", label: "Recipes" }}
        description={fromBrewManager ? "Imported from Brew Manager. Importing again updates it; what you add here (ingredient matches, extract, colour, alpha) is kept." : undefined}
      />
      {/* Remount after a save so the editor starts clean from what was stored. */}
      <BrewRecipeEditor key={JSON.stringify(initial)} initial={initial} catalog={catalog} brews={recipe?.brews ?? 0} />
    </>
  );
}
