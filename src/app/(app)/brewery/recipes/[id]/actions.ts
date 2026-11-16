"use server";

import { BREW_LINE_KINDS, BREW_UNITS, HOP_USES } from "@/domain/brewMath";
import { requireUser } from "@/server/auth";
import { saveBrewRecipe } from "@/server/services/brewRecipes";
import { followRecipeBeer } from "@/server/services/breweryWrite";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/** Saving from the recipe editor: the recipe, its lines, and its brew-day targets and timing. */

const n = (min: number, max: number) => z.number().finite().min(min).max(max);
const opt = (min: number, max: number) => n(min, max).nullable();
const gravity = (what: string) => z.number().finite().min(0.98, `${what} isn't a gravity.`).max(1.2, `${what} isn't a gravity.`).nullable();

const lineSchema = z.object({
  id: z.string().nullable(),
  kind: z.enum(BREW_LINE_KINDS as [string, ...string[]]),
  name: z.string().trim().min(1, "Every line needs a name.").max(160),
  ingredientId: z.string().nullable(),
  qty: n(0, 1_000_000),
  unit: z.string().refine((u) => (BREW_UNITS as readonly string[]).includes(u), "Pick a unit for every line."),
  potentialPpg: opt(0, 50),
  colorL: opt(0, 2000),
  alphaPct: opt(0, 40),
  use: z.enum(HOP_USES as [string, ...string[]]).nullable(),
  minutes: opt(0, 600),
  attenuationPct: opt(0, 100),
});

const processSchema = z.object({
  targetMt: gravity("The MT target"),
  targetBk: gravity("The BK target"),
  targetKo: gravity("The KO target"),
  strikeF: z.number().finite().min(32, "Strike temperature in °F, like 165.").max(215, "Strike temperature in °F, like 165.").nullable(),
  mashF: z.number().finite().min(32, "Mash temperature in °F, like 152.").max(215, "Mash temperature in °F, like 152.").nullable(),
  mashMinutes: opt(0, 1440),
  profile: z.string().max(20).nullable(),
  dryHopDay: opt(0, 365),
  tapDay: opt(0, 400),
  artworkDone: z.boolean(),
});

const recipeSchema = z.object({
  name: z.string().trim().min(1, "Name the recipe.").max(120),
  style: z.string().trim().max(80).nullable(),
  status: z.enum(["live", "dev", "archived"]),
  beerId: z.string().nullable(),
  batchBbl: z.number().finite().gt(0, "Batch size must be more than 0 bbl.").max(1000),
  efficiencyPct: n(1, 100),
  boilMinutes: n(0, 600),
  fermentDays: n(0, 365),
  conditionDays: n(0, 365),
  targetOg: gravity("The target OG"),
  targetFg: gravity("The target FG"),
  notes: z.string().max(4000).nullable(),
  lines: z.array(lineSchema).max(200),
  process: processSchema,
});

export type RecipeEditorInput = z.input<typeof recipeSchema>;

export async function saveRecipeEditorAction(id: string | null, input: RecipeEditorInput): Promise<{ error?: string; id?: string }> {
  await requireUser("MANAGER");
  const parsed = recipeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const res = await saveBrewRecipe(id, { id, ...parsed.data, lines: parsed.data.lines as Parameters<typeof saveBrewRecipe>[1]["lines"] });
  if ("error" in res) return res;
  // Planned brews of this recipe pour as its beer.
  await followRecipeBeer(res.id);
  revalidatePath("/brewery/recipes");
  revalidatePath(`/brewery/recipes/${res.id}`);
  revalidatePath("/brewery/brew");
  revalidatePath("/kegs/demand");
  return { id: res.id };
}
