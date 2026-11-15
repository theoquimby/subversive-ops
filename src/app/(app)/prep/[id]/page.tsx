import { PageHeader } from "@/components/ui";
import { recipeYieldInBase } from "@/domain/costing";
import { prepStep } from "@/domain/prep";
import { requireUser } from "@/server/auth";
import { prepRecipe } from "@/server/services/prep";
import { notFound } from "next/navigation";
import { RecipeScaler } from "./scaler";

export const metadata = { title: "Prep recipe" };

export default async function PrepRecipePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ make?: string; day?: string }> }) {
  const me = await requireUser();
  const [{ id }, { make, day }] = await Promise.all([params, searchParams]);
  const r = await prepRecipe(id);
  if (!r || r.kind !== "PREP") notFound();
  let batchBase = 0;
  try {
    batchBase = recipeYieldInBase({ id: r.id, name: r.name, yieldQty: r.yieldQty, yieldUnit: r.yieldUnit, yieldBase: r.yieldBase, menuPrice: null, lines: [] });
  } catch {
    batchBase = 0;
  }
  const unit = r.settings.unit!;
  const step = prepStep(r.settings.rounding, batchBase, unit);
  const asked = Number(make);
  const initial = Number.isFinite(asked) && asked > 0 ? asked : batchBase || unit.baseQty;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader help="prep.recipe" back={{ href: day ? `/prep?day=${day}` : "/prep", label: "Prep list" }} title={r.name} description={me.role === "MANAGER" ? "Scaled to the amount you're making. Edit the recipe itself on Menu costs." : "Scaled to the amount you're making."} />
      <RecipeScaler
        yieldQty={r.yieldQty}
        yieldUnit={r.yieldUnit}
        batchBase={batchBase}
        unit={unit}
        step={step}
        initial={initial}
        lines={r.lines}
        notes={r.notes}
        editHref={me.role === "MANAGER" ? `/menu/${r.id}` : null}
      />
    </div>
  );
}
