import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { gravityUnit } from "@/server/services/brewDay";
import { BLANK_PROCESS, brewCatalog, brewRecipeData, type BrewRecipeData } from "@/server/services/brewRecipes";
import { notFound } from "next/navigation";
import { AbvCalculator, GravityUnitToggle } from "../../brew/gravity-bits";
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
  process: BLANK_PROCESS,
};

export default async function BrewRecipePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const isNew = id === "new";
  const [recipe, catalog, unit] = await Promise.all([isNew ? null : brewRecipeData(id), brewCatalog(), gravityUnit()]);
  if (!isNew && !recipe) notFound();
  const initial: BrewRecipeData = recipe ? { ...recipe, process: recipe.process } : BLANK;
  const source = recipe?.sourceKey ?? "";
  const fromBrewManager = source.startsWith("brewmanager:");
  return (
    <>
      <PageHeader
        help="brewery.recipes.editor"
        title={recipe?.name ?? "New recipe"}
        back={{ href: "/brewery/recipes", label: "Recipes" }}
        description={
          fromBrewManager
            ? `Imported from Brew Manager${source.startsWith("brewmanager:dev:") ? "'s development beers" : ""}. Importing again updates it; what you add here (ingredient matches, extract, colour, alpha) is kept.`
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GravityUnitToggle unit={unit} />
            <AbvCalculator unit={unit} og={initial.targetOg} fg={initial.targetFg} />
          </div>
        }
      />
      {/* Remount after a save so the editor starts clean from what was stored. A new gravity unit keeps unsaved edits. */}
      <BrewRecipeEditor key={JSON.stringify(initial)} initial={initial} catalog={catalog} brews={recipe?.brews ?? 0} unit={unit} batches={recipe?.batches ?? []} />
    </>
  );
}
