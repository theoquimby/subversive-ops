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
import { copyName, prepStubYield } from "@/domain/recipeEntry";
import { STANDARD_UNITS_BY_BASE, standardUnit } from "@/domain/units";
import { everydayUnit } from "@/domain/quickAdd";

// Every message here is shown to the person saving, so each one says what to fix.
const lineSchema = z.object({
  ingredientId: z.string().nullable(),
  subRecipeId: z.string().nullable(),
  qty: z.number({ error: "Every line needs an amount." }).positive("Every line needs an amount more than 0."),
  unit: z.string({ error: "Every line needs a unit." }).min(1, "Every line needs a unit."),
});

const recipeSchema = z.object({
  name: z.string({ error: "Give the recipe a name." }).trim().min(1, "Give the recipe a name.").max(120, "That name is too long. Keep it under 120 letters."),
  kind: z.enum(["MENU", "PREP", "MODIFIER"], { error: "Pick a type: menu item, add-on or prep recipe." }),
  category: z.string().trim().max(80, "That category is too long.").default("Food"),
  menuPrice: z.number({ error: "Menu price must be a number, or leave it blank." }).nonnegative("Menu price can't be below $0.").nullable(),
  yieldQty: z.number({ error: "Type how much one batch makes." }).positive("Batch yield must be more than 0."),
  yieldUnit: z.string().min(1, "Pick the batch yield's unit."),
  yieldBase: z.enum(["g", "ml", "each"], { error: "Pick the batch yield's unit." }),
  targetFoodCostPct: z.number({ error: "Target food cost must be a number, or leave it blank for the default." }).min(0, "Target food cost must be between 0 and 100%.").max(1, "Target food cost must be between 0 and 100%.").nullable(),
  notes: z.string().max(4000, "Notes are too long. Keep them under 4,000 letters.").nullable(),
  lines: z.array(lineSchema).max(200, "That's more than 200 lines. Split it into prep recipes."),
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

const newIngredientSchema = z.object({ name: z.string().trim().min(1).max(120), unit: z.string().trim().max(20), base: z.enum(["g", "ml", "each"]).optional() });

/**
 * "New ingredient" from a recipe's quick add: when what's typed isn't on the
 * ingredient list yet. Measured by weight, volume or count from the unit typed
 * ("2 oz pepper jack" is weighed), or as picked (`base`) when no unit was typed. It has no price until one is added on Prices
 * or its own page; an ingredient of that name that already exists is used instead.
 */
export async function createIngredientForRecipe(input: z.input<typeof newIngredientSchema>): Promise<{ error?: string; ingredient?: { id: string; name: string; baseUnit: "g" | "ml" | "each"; units: string[] }; unit?: string }> {
  await requireUser("MANAGER");
  const p = newIngredientSchema.safeParse(input);
  if (!p.success) return { error: "Type a name for the ingredient." };
  const name = p.data.name.charAt(0).toUpperCase() + p.data.name.slice(1);
  const std = p.data.unit ? standardUnit(p.data.unit) : null;
  const existing = await db.ingredient.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, include: { conversions: true } });
  const ing = existing ?? (await db.ingredient.create({ data: { name, baseUnit: std?.base ?? p.data.base ?? "each" }, include: { conversions: true } }));
  const units = [...STANDARD_UNITS_BY_BASE[ing.baseUnit], ...ing.conversions.map((c) => c.unit)];
  revalidatePath("/ingredients");
  // Keep the unit typed when it fits; a count word like "slices" becomes "each" on a new count ingredient.
  const unit = std && std.base === ing.baseUnit ? p.data.unit : everydayUnit(units);
  return { ingredient: { id: ing.id, name: ing.name, baseUnit: ing.baseUnit, units }, unit };
}

const newPrepSchema = z.object({ name: z.string().trim().min(1).max(120), unit: z.string().trim().max(20) });

/**
 * "New prep recipe" from a recipe's quick add: aioli, pickles, a dough made here.
 * Starts as one batch measured the way the line was typed (see prepStubYield),
 * with no ingredients yet; fill it in later on its own page. A prep recipe of
 * that name that already exists is used instead.
 */
export async function createPrepForRecipe(input: z.input<typeof newPrepSchema>): Promise<{ error?: string; recipe?: { id: string; name: string; baseUnit: "g" | "ml" | "each"; units: string[]; yieldQty: number; yieldUnit: string }; unit?: string }> {
  await requireUser("MANAGER");
  const p = newPrepSchema.safeParse(input);
  if (!p.success) return { error: "Type a name for the prep recipe." };
  const name = p.data.name.charAt(0).toUpperCase() + p.data.name.slice(1);
  const existing = await db.recipe.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing && (!existing.active || existing.kind !== "PREP")) {
    return { error: `There's already ${existing.active ? (existing.kind === "MENU" ? "a menu item" : "an add-on") : "an archived recipe"} called ${existing.name}. Pick it from the list, or use another name.` };
  }
  const y = prepStubYield(p.data.unit);
  const recipe = existing ?? (await db.recipe.create({ data: { name, kind: "PREP", category: "Prep", yieldQty: new Prisma.Decimal(y.yieldQty), yieldUnit: y.yieldUnit, yieldBase: y.yieldBase } }));
  revalidatePath("/menu");
  revalidatePath("/prep", "layout");
  const units = STANDARD_UNITS_BY_BASE[recipe.yieldBase];
  const typed = p.data.unit && standardUnit(p.data.unit)?.base === recipe.yieldBase ? p.data.unit : units[0];
  return { recipe: { id: recipe.id, name: recipe.name, baseUnit: recipe.yieldBase, units, yieldQty: recipe.yieldQty.toNumber(), yieldUnit: recipe.yieldUnit }, unit: typed };
}

/** Copy a recipe with all its lines as "… (copy)". Square links, counts and prep settings stay with the original. */
async function copyRecipe(id: string): Promise<{ id: string; name: string } | null> {
  const r = await db.recipe.findUnique({ where: { id }, include: { lines: { orderBy: { sort: "asc" } } } });
  if (!r) return null;
  const taken = new Set((await db.recipe.findMany({ where: { name: { startsWith: baseName(r.name).replace(/\s*\(copy(?: \d+)?\)\s*$/i, ""), mode: "insensitive" } }, select: { name: true } })).map((x) => x.name.toLowerCase()));
  const name = copyName(baseName(r.name), (n) => taken.has(n.toLowerCase()));
  const copy = await db.recipe.create({
    data: {
      name, kind: r.kind, category: r.category, menuPrice: r.menuPrice, yieldQty: r.yieldQty, yieldUnit: r.yieldUnit, yieldBase: r.yieldBase, targetFoodCostPct: r.targetFoodCostPct, notes: r.notes,
      lines: { create: r.lines.map((l) => ({ ingredientId: l.ingredientId, subRecipeId: l.subRecipeId, qty: l.qty, unit: l.unit, sort: l.sort })) },
    },
    select: { id: true, name: true },
  });
  return copy;
}

/** Duplicate one recipe (from its editor) and open the copy. */
export async function duplicateRecipe(id: string): Promise<{ error?: string; id?: string; name?: string }> {
  await requireUser("MANAGER");
  const p = z.string().min(1).max(64).safeParse(id);
  if (!p.success) return { error: "Save the recipe first, then duplicate it." };
  const copy = await copyRecipe(p.data);
  if (!copy) return { error: "That recipe isn't there any more." };
  revalidatePath("/menu");
  return copy;
}

/** Duplicate several recipes (Menu costs table). */
export async function duplicateRecipes(ids: string[]): Promise<BulkResult> {
  await requireUser("MANAGER");
  const p = bulkIds.safeParse(ids);
  if (!p.success) return { error: "Pick at least one recipe." };
  if (p.data.length > 50) return { error: "Duplicate up to 50 at a time." };
  const made: string[] = [];
  for (const id of p.data) {
    const copy = await copyRecipe(id);
    if (copy) made.push(copy.name);
  }
  revalidatePath("/menu");
  if (!made.length) return { error: "Those recipes aren't there any more." };
  return { message: made.length === 1 ? `Made ${made[0]}.` : `Made ${made.length} copies, each named “(copy)”.` };
}
