"use server";

import { isAllergen, normalizeAllergens } from "@/domain/allergens";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { revalidatePath } from "next/cache";

/** Set the full allergen list for an ingredient (unknown ids are dropped). */
export async function setIngredientAllergens(id: string, allergens: string[]): Promise<{ error?: string; allergens?: string[] }> {
  await requireUser("MANAGER");
  if (!allergens.every(isAllergen)) return { error: "Unknown allergen." };
  const next = normalizeAllergens(allergens);
  const ing = await db.ingredient.update({ where: { id }, data: { allergens: next }, select: { recipeLines: { select: { recipeId: true } } } }).catch(() => null);
  if (!ing) return { error: "That ingredient isn't there any more." };
  revalidatePath(`/ingredients/${id}`);
  revalidatePath("/menu/allergens");
  for (const r of new Set(ing.recipeLines.map((l) => l.recipeId))) revalidatePath(`/menu/${r}`);
  return { allergens: next };
}
