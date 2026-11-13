"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

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
  await db.recipe.update({ where: { id }, data: { active: false, name: `${(await db.recipe.findUniqueOrThrow({ where: { id } })).name} (archived ${Date.now()})` } });
  revalidatePath("/menu");
  redirect("/menu");
}
