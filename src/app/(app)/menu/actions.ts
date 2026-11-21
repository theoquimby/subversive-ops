"use server";

import { pingWebsite } from "@/server/services/website";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { shortDate } from "@/lib/format";
import { businessToday } from "@/server/services/sales";
import { archivedName, baseName } from "@/domain/archiveName";

const lineSchema = z.object({
  ingredientId: z.string().nullable(),
  subRecipeId: z.string().nullable(),
  qty: z.number().positive(),
  unit: z.string().min(1),
});

const recipeSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: z.enum(["MENU", "PREP", "MODIFIER"]),
  category: z.string().trim().default("Food"),
  menuPrice: z.number().nonnegative().nullable(),
  yieldQty: z.number().positive(),
  yieldUnit: z.string().min(1),
  yieldBase: z.enum(["g", "ml", "each"]),
  targetFoodCostPct: z.number().min(0).max(1).nullable(),
  notes: z.string().nullable(),
  lines: z.array(lineSchema),
});

export type RecipeInput = z.infer<typeof recipeSchema>;

export async function saveRecipe(id: string | null, input: RecipeInput): Promise<{ error?: string; id?: string }> {
  await requireUser("MANAGER");
  const parsed = recipeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const r = parsed.data;
  if (r.lines.some((l) => (l.ingredientId ? 1 : 0) + (l.subRecipeId ? 1 : 0) !== 1)) return { error: "Every line needs an ingredient or a prep recipe." };
  if (id && r.lines.some((l) => l.subRecipeId === id)) return { error: "A recipe can't contain itself." };

  const data = {
    name: r.name,
    kind: r.kind,
    category: r.category || "Food",
    menuPrice: r.menuPrice == null ? null : new Prisma.Decimal(r.menuPrice),
    yieldQty: new Prisma.Decimal(r.kind === "PREP" ? r.yieldQty : 1),
    yieldUnit: r.kind === "PREP" ? r.yieldUnit : "each",
    yieldBase: r.kind === "PREP" ? r.yieldBase : ("each" as const),
    targetFoodCostPct: r.targetFoodCostPct == null ? null : new Prisma.Decimal(r.targetFoodCostPct),
    notes: r.notes,
  };
  const lines = r.lines.map((l, i) => ({ ingredientId: l.ingredientId, subRecipeId: l.subRecipeId, qty: new Prisma.Decimal(l.qty), unit: l.unit, sort: i }));

  try {
    const saved = await db.$transaction(async (tx) => {
      if (id) {
        await tx.recipeLine.deleteMany({ where: { recipeId: id } });
        return tx.recipe.update({ where: { id }, data: { ...data, lines: { create: lines } } });
      }
      return tx.recipe.create({ data: { ...data, lines: { create: lines } } });
    });
    revalidatePath("/menu");
    pingWebsite("menu");
    revalidatePath("/");
    return { id: saved.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "A recipe with that name already exists." };
    throw e;
  }
}

export async function archiveRecipe(id: string) {
  await requireUser("MANAGER");
  const usedIn = await db.recipeLine.count({ where: { subRecipeId: id, recipe: { active: true } } });
  if (usedIn > 0) return { error: `Used in ${usedIn} other recipe${usedIn > 1 ? "s" : ""} — remove it there first.` };
  const recipe = await db.recipe.findUniqueOrThrow({ where: { id } });
  if (!recipe.active) return { error: "Already archived." };
  // Names are unique across active and archived recipes, so park the old name under a readable suffix.
  const label = shortDate(businessToday());
  let name = archivedName(recipe.name, label);
  for (let n = 2; await db.recipe.findUnique({ where: { name }, select: { id: true } }); n++) name = archivedName(recipe.name, label, n);
  await db.recipe.update({ where: { id }, data: { active: false, name } });
  revalidatePath("/menu");
  pingWebsite("menu");
  redirect(`/menu?kind=${recipe.kind}`);
}

export async function restoreRecipe(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const recipe = await db.recipe.findUnique({ where: { id } });
  if (!recipe) return { error: "That recipe no longer exists." };
  if (recipe.active) return {};
  const name = baseName(recipe.name);
  const clash = await db.recipe.findUnique({ where: { name }, select: { id: true } });
  if (clash && clash.id !== id) return { error: `There's already a recipe called "${name}". Rename it first, then restore this one.` };
  await db.recipe.update({ where: { id }, data: { active: true, name } });
  revalidatePath("/menu");
  pingWebsite("menu");
  revalidatePath("/");
  return {};
}

// ---- Bulk actions (Menu costs table) -----------------------------------------------------

const bulkIds = z.array(z.string().min(1).max(64)).min(1).max(1000);
type BulkResult = { error?: string; message?: string };
const recipesWord = (n: number) => `${n} recipe${n === 1 ? "" : "s"}`;

/** Category or target food cost % on several recipes. Target blank = use the default. */
export async function bulkSetRecipes(ids: string[], field: "category" | "targetFoodCostPct", raw: string): Promise<BulkResult> {
  await requireUser("MANAGER");
  const p = bulkIds.safeParse(ids);
  if (!p.success) return { error: "Pick at least one recipe." };
  const value = raw.trim();
  if (field === "category") {
    if (!value || value.length > 80) return { error: "Type a category." };
    await db.recipe.updateMany({ where: { id: { in: p.data } }, data: { category: value } });
  } else {
    const n = value === "" ? null : Number(value.replace(/%$/, ""));
    if (n != null && (!Number.isFinite(n) || n <= 0 || n >= 100)) return { error: "Enter 1–99%, or leave blank for the default." };
    await db.recipe.updateMany({ where: { id: { in: p.data } }, data: { targetFoodCostPct: n == null ? null : new Prisma.Decimal(n / 100) } });
  }
  revalidatePath("/", "layout");
  return { message: `Updated ${recipesWord(p.data.length)}.` };
}

/** Archive several recipes. Prep recipes still used inside others are skipped. */
export async function archiveRecipes(ids: string[]): Promise<BulkResult> {
  await requireUser("MANAGER");
  const p = bulkIds.safeParse(ids);
  if (!p.success) return { error: "Pick at least one recipe." };
  const label = shortDate(businessToday());
  let done = 0;
  const kept: string[] = [];
  for (const id of p.data) {
    const recipe = await db.recipe.findUnique({ where: { id } });
    if (!recipe?.active) continue;
    if (await db.recipeLine.count({ where: { subRecipeId: id, recipe: { active: true } } })) { kept.push(recipe.name); continue; }
    let name = archivedName(recipe.name, label);
    for (let n = 2; await db.recipe.findUnique({ where: { name }, select: { id: true } }); n++) name = archivedName(recipe.name, label, n);
    await db.recipe.update({ where: { id }, data: { active: false, name } });
    done++;
  }
  revalidatePath("/menu");
  pingWebsite("menu");
  revalidatePath("/");
  if (!done && kept.length) return { error: `Still used inside other recipes: ${kept.slice(0, 3).join(", ")}.` };
  return { message: `Archived ${recipesWord(done)}.${kept.length ? ` Kept ${kept.length} used inside other recipes.` : ""}` };
}

const newIngredientSchema = z.object({ name: z.string().trim().min(1).max(120), unit: z.string().trim().max(20) });

/**
 * "New ingredient" from a recipe's quick add: when what's typed isn't on the
 * ingredient list yet. Measured by weight, volume or count from the unit typed
 * ("2 oz pepper jack" is weighed). It has no price until one is added on Prices
 * or its own page; an ingredient of that name that already exists is used instead.
 */
export async function createIngredientForRecipe(input: z.input<typeof newIngredientSchema>): Promise<{ error?: string; ingredient?: { id: string; name: string; baseUnit: "g" | "ml" | "each"; units: string[] }; unit?: string }> {
  await requireUser("MANAGER");
  const p = newIngredientSchema.safeParse(input);
  if (!p.success) return { error: "Type a name for the ingredient." };
  const { standardUnit, STANDARD_UNITS_BY_BASE } = await import("@/domain/units");
  const name = p.data.name.charAt(0).toUpperCase() + p.data.name.slice(1);
  const std = p.data.unit ? standardUnit(p.data.unit) : null;
  const existing = await db.ingredient.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, include: { conversions: true } });
  const ing = existing ?? (await db.ingredient.create({ data: { name, baseUnit: std?.base ?? "each" }, include: { conversions: true } }));
  const units = [...STANDARD_UNITS_BY_BASE[ing.baseUnit], ...ing.conversions.map((c) => c.unit)];
  revalidatePath("/ingredients");
  // Keep the unit typed when it fits; a count word like "slices" becomes "each" on a new count ingredient.
  const unit = std && std.base === ing.baseUnit ? p.data.unit : units[0];
  return { ingredient: { id: ing.id, name: ing.name, baseUnit: ing.baseUnit, units }, unit };
}
