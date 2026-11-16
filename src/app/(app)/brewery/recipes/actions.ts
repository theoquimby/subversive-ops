"use server";

import { BREW_LINE_KINDS, BREW_UNITS, HOP_USES } from "@/domain/brewMath";
import { requireUser } from "@/server/auth";
import { createBrewIngredient, duplicateBrewRecipe, removeBrewRecipe, saveBrewRecipe, setBrewingPrice, type BrewCatalogIngredient } from "@/server/services/brewRecipes";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const n = (min: number, max: number) => z.number().finite().min(min).max(max);
const opt = (min: number, max: number) => n(min, max).nullable();

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
  targetOg: z.number().finite().min(1).max(1.2).nullable(),
  targetFg: z.number().finite().min(0.98).max(1.2).nullable(),
  notes: z.string().max(4000).nullable(),
  lines: z.array(lineSchema).max(200),
});

export type BrewRecipeInput = z.infer<typeof recipeSchema>;

const refresh = (id?: string) => {
  revalidatePath("/brewery/recipes");
  if (id) revalidatePath(`/brewery/recipes/${id}`);
  revalidatePath("/kegs/demand");
};

export async function saveBrewRecipeAction(id: string | null, input: BrewRecipeInput): Promise<{ error?: string; id?: string }> {
  await requireUser("MANAGER");
  const parsed = recipeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const res = await saveBrewRecipe(id, { id, ...parsed.data, lines: parsed.data.lines as Parameters<typeof saveBrewRecipe>[1]["lines"] });
  if ("error" in res) return res;
  refresh(res.id);
  return { id: res.id };
}

export async function duplicateBrewRecipeAction(id: string): Promise<{ error?: string; id?: string }> {
  await requireUser("MANAGER");
  const res = await duplicateBrewRecipe(id);
  if ("error" in res) return res;
  refresh();
  return { id: res.id };
}

export async function removeBrewRecipeAction(id: string): Promise<{ error?: string; deleted?: boolean; archived?: boolean }> {
  await requireUser("MANAGER");
  const res = await removeBrewRecipe(id);
  refresh(id);
  return res;
}

export async function createBrewIngredientAction(name: string, kind: string, unit: string): Promise<BrewCatalogIngredient | { error: string }> {
  await requireUser("MANAGER");
  const k = z.enum(BREW_LINE_KINDS as [string, ...string[]]).safeParse(kind);
  if (!k.success) return { error: "Unknown kind of line." };
  const res = await createBrewIngredient(String(name ?? ""), k.data as (typeof BREW_LINE_KINDS)[number], String(unit ?? ""));
  if (!("error" in res)) {
    revalidatePath("/ingredients");
    revalidatePath("/brewery/recipes");
  }
  return res;
}

/** A price typed in the Brewing ingredient prices table: "$1.10" per lb (or per package, per gallon). Empty does nothing. */
export async function setBrewingPriceAction(ingredientId: string, raw: string, unit: string, supplierId: string | null): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = String(raw ?? "").replace(/[$,\s]/g, "");
  if (v === "") return {};
  const price = Number(v);
  if (!Number.isFinite(price) || price <= 0) return { error: "Enter a price above $0." };
  if (price > 100_000) return { error: "That price looks too high." };
  if (!(BREW_UNITS as readonly string[]).includes(unit)) return { error: "Unknown unit." };
  const res = await setBrewingPrice(ingredientId, price, unit, supplierId || null);
  if (res.error) return res;
  refresh();
  revalidatePath("/ingredients");
  revalidatePath("/menu");
  return {};
}
