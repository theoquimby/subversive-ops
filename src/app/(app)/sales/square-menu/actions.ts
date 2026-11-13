"use server";

import { planRecipesFromSquare } from "@/domain/squareMenu";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { loadSquareMenu } from "@/server/services/square-menu";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Result = { error?: string; message?: string };

const refresh = () => {
  revalidatePath("/sales/square-menu");
  revalidatePath("/sales");
  revalidatePath("/menu");
};

const pairs = z.array(z.object({ squareId: z.string().min(1).max(128), recipeId: z.string().min(1).max(64) })).min(1).max(1000);

/** Link Square items to the suggested recipes. */
export async function acceptSuggestions(input: z.input<typeof pairs>): Promise<Result> {
  await requireUser("MANAGER");
  const p = pairs.safeParse(input);
  if (!p.success) return { error: "Nothing to accept." };
  const recipes = new Set((await db.recipe.findMany({ where: { id: { in: p.data.map((x) => x.recipeId) } }, select: { id: true } })).map((r) => r.id));
  const ok = p.data.filter((x) => recipes.has(x.recipeId));
  await db.$transaction(ok.map((x) => db.squareMapping.updateMany({ where: { squareId: x.squareId }, data: { recipeId: x.recipeId, ignored: false } })));
  refresh();
  return { message: `Linked ${ok.length} item${ok.length === 1 ? "" : "s"}.` };
}

const ids = z.array(z.string().min(1).max(128)).min(1).max(1000);

/** Create menu recipes (add-ons for modifiers) named after the Square items, with Square's price and category, and link them. */
export async function createRecipesFromSquare(input: string[]): Promise<Result> {
  await requireUser("MANAGER");
  const p = ids.safeParse(input);
  if (!p.success) return { error: "Pick at least one item." };
  const [{ items }, existing] = await Promise.all([loadSquareMenu(), db.recipe.findMany({ select: { id: true, name: true, kind: true } })]);
  const wanted = new Set(p.data);
  const plan = planRecipesFromSquare(items.filter((i) => wanted.has(i.squareId) && !i.recipeId), existing);
  try {
    await db.$transaction(async (tx) => {
      for (const d of plan.create) {
        const r = await tx.recipe.create({
          data: { name: d.name, kind: d.kind, category: d.category, menuPrice: d.menuPrice != null ? new Prisma.Decimal(d.menuPrice.toFixed(2)) : null },
        });
        await tx.squareMapping.updateMany({ where: { squareId: { in: d.squareIds } }, data: { recipeId: r.id, ignored: false } });
      }
      for (const l of plan.link) await tx.squareMapping.updateMany({ where: { squareId: { in: l.squareIds } }, data: { recipeId: l.recipeId, ignored: false } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "A recipe with one of those names was just added. Reload and try again." };
    throw e;
  }
  refresh();
  const linked = plan.link.reduce((s, l) => s + l.squareIds.length, 0);
  return { message: `Created ${plan.create.length} recipe${plan.create.length === 1 ? "" : "s"}${linked ? ` and linked ${linked} to recipes you already had` : ""}. Add ingredients from Menu costs.` };
}

/** Mark Square items as having no recipe (drinks bought in, merch, gift cards). */
export async function ignoreItems(input: string[]): Promise<Result> {
  await requireUser("MANAGER");
  const p = ids.safeParse(input);
  if (!p.success) return { error: "Pick at least one item." };
  const r = await db.squareMapping.updateMany({ where: { squareId: { in: p.data }, recipeId: null }, data: { ignored: true } });
  refresh();
  return { message: `Ignored ${r.count} item${r.count === 1 ? "" : "s"}.` };
}

const prices = z.array(z.object({ recipeId: z.string().min(1).max(64), price: z.number().min(0).max(100_000) })).min(1).max(1000);

/** Set recipe menu prices to what Square charges. */
export async function applySquarePrices(input: z.input<typeof prices>): Promise<Result> {
  await requireUser("MANAGER");
  const p = prices.safeParse(input);
  if (!p.success) return { error: "Nothing to update." };
  const byRecipe = new Map(p.data.map((x) => [x.recipeId, x.price]));
  await db.$transaction([...byRecipe].map(([id, price]) => db.recipe.updateMany({ where: { id }, data: { menuPrice: new Prisma.Decimal(price.toFixed(2)) } })));
  refresh();
  return { message: `Updated ${byRecipe.size} price${byRecipe.size === 1 ? "" : "s"}.` };
}
