"use server";

import { kegSize, planDraftBeer, pourRecipeName } from "@/domain/draftBeer";
import { REVENUE_CLASSES } from "@/domain/revenueClass";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { undoBatch, writeLinks, type LinkWrite } from "@/server/services/linking";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDraftBeer } from "../../menu/draft-beer/actions";

export type LinkResult = { error?: string; message?: string; batch?: string };

const refresh = () => {
  revalidatePath("/sales/link");
  revalidatePath("/sales");
  revalidatePath("/sales/square-menu");
  revalidatePath("/menu");
  revalidatePath("/");
  revalidatePath("/pnl");
};

const classes = REVENUE_CLASSES.map((c) => c.value) as [string, ...string[]];
const state = z.object({
  recipeId: z.string().min(1).max(64).nullable(),
  ignored: z.boolean(),
  unitCost: z.number().min(0).max(10_000).nullable(),
  costClass: z.enum(classes).nullable(),
});
const writesSchema = z.array(z.object({ squareId: z.string().min(1).max(128), to: state })).min(1).max(1000);

const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

/** Link, leave out, or set a bought-in cost for Square items. Logged as one batch for Undo. */
export async function applyLinks(input: z.input<typeof writesSchema>): Promise<LinkResult> {
  const user = await requireUser("MANAGER");
  const p = writesSchema.safeParse(input);
  if (!p.success) return { error: "Nothing to change." };
  if (p.data.some((w) => [w.to.recipeId != null, w.to.ignored, w.to.unitCost != null].filter(Boolean).length > 1)) return { error: "Pick one: a recipe, a cost each, or leave it out." };
  const ids = p.data.flatMap((w) => (w.to.recipeId ? [w.to.recipeId] : []));
  if (ids.length) {
    const preps = await db.recipe.count({ where: { id: { in: ids }, kind: "PREP" } });
    if (preps) return { error: "Sold items link to a menu recipe or add-on, not a prep recipe." };
  }
  const r = await writeLinks(p.data as LinkWrite[], user.name);
  refresh();
  if (!r.changed) return { message: "Nothing changed." };
  return { message: r.changed === 1 ? `Saved ${r.names[0]}.` : `Saved ${items(r.changed)}.`, batch: r.batch };
}

/** Put a batch of link changes back the way they were. */
export async function undoLinks(batch: string): Promise<LinkResult> {
  await requireUser("MANAGER");
  if (!z.string().min(1).max(64).safeParse(batch).success) return { error: "Nothing to undo." };
  const r = await undoBatch(batch);
  refresh();
  if (!r.restored && !r.skipped) return { message: "Already undone." };
  return { message: `Undone${r.restored > 1 ? ` (${items(r.restored)})` : ""}.${r.skipped ? ` ${items(r.skipped)} changed since, left as is.` : ""}` };
}

const newRecipe = z.object({
  name: z.string().trim().min(1, "Name the recipe.").max(120),
  kind: z.enum(["MENU", "MODIFIER"]),
  category: z.string().trim().max(80),
  menuPrice: z.number().min(0).max(10_000).nullable(),
});

/** Create a menu recipe (or add-on) from a Square item, link it, and return its id so the builder can open. */
export async function createRecipeForItem(squareId: string, input: z.input<typeof newRecipe>): Promise<LinkResult & { recipeId?: string }> {
  const user = await requireUser("MANAGER");
  const p = newRecipe.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const m = await db.squareMapping.findUnique({ where: { squareId }, select: { squareId: true } });
  if (!m) return { error: "That Square item is gone. Reload." };
  const clash = await db.recipe.findUnique({ where: { name: p.data.name }, select: { id: true, kind: true, active: true } });
  if (clash) return { error: `There's already a recipe called “${p.data.name}”. Pick it from the list instead, or use another name.` };
  const recipe = await db.recipe.create({
    data: { name: p.data.name, kind: p.data.kind, category: p.data.category || (p.data.kind === "MODIFIER" ? "Add-ons" : "Food"), menuPrice: p.data.menuPrice == null ? null : new Prisma.Decimal(p.data.menuPrice.toFixed(2)) },
  });
  const r = await writeLinks([{ squareId, to: { recipeId: recipe.id, ignored: false, unitCost: null, costClass: null } }], user.name);
  refresh();
  return { message: `Created ${recipe.name} and linked it. Add its ingredients next.`, batch: r.batch, recipeId: recipe.id };
}

const beerSchema = z.object({
  beer: z.string().trim().min(1, "Name the beer.").max(80),
  kegSizeId: z.string(),
  kegCost: z.number().positive("Enter what a keg costs."),
  yieldPct: z.number().gt(0).max(1),
  pours: z.array(z.object({ label: z.string().trim().min(1).max(40), oz: z.number().positive().max(128), price: z.number().min(0).nullable(), squareIds: z.array(z.string().min(1).max(128)).min(1).max(50) })).min(1).max(8),
});

/**
 * Cost a beer's pours from its keg (Draft beer: keg ingredient + one recipe per
 * pour) and link every Square pour to its recipe, logged as one batch.
 */
export async function costBeerPours(input: z.input<typeof beerSchema>): Promise<LinkResult> {
  const user = await requireUser("MANAGER");
  const p = beerSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const f = p.data;
  if (!kegSize(f.kegSizeId)) return { error: "Pick a keg size." };
  const plan = planDraftBeer({ beer: f.beer, kegSizeId: f.kegSizeId, kegCost: f.kegCost, yieldPct: f.yieldPct, pours: f.pours.map((x) => ({ label: x.label, oz: x.oz, price: x.price })) });
  if ("error" in plan) return plan;
  // Recipes first (no Square links), then every link through the log so Undo works.
  const made = await createDraftBeer({ beer: f.beer, kegSizeId: f.kegSizeId, kegCost: f.kegCost, yieldPct: f.yieldPct, supplierId: null, pours: f.pours.map((x) => ({ label: x.label, oz: x.oz, price: x.price, squareId: null })) });
  if ("error" in made) return { error: made.error };
  const recipes = await db.recipe.findMany({ where: { name: { in: f.pours.map((x) => pourRecipeName(f.beer, x.label)) } }, select: { id: true, name: true } });
  const byName = new Map(recipes.map((r) => [r.name, r.id]));
  const writes: LinkWrite[] = f.pours.flatMap((x) => {
    const id = byName.get(pourRecipeName(f.beer, x.label));
    return id ? x.squareIds.map((squareId) => ({ squareId, to: { recipeId: id, ignored: false, unitCost: null, costClass: null } })) : [];
  });
  const r = await writeLinks(writes, user.name);
  // These Square items pour this beer: link them to it (when the beer is on the Kegs list and they aren't linked yet).
  const beer = await db.beer.findFirst({ where: { name: { equals: f.beer.trim(), mode: "insensitive" } }, select: { id: true } });
  if (beer) await db.squareMapping.updateMany({ where: { squareId: { in: f.pours.flatMap((x) => x.squareIds) }, beerId: null }, data: { beerId: beer.id } });
  refresh();
  revalidatePath("/menu/draft-beer");
  return { message: `${f.beer}: ${f.pours.length} pour${f.pours.length === 1 ? "" : "s"} costed, ${items(r.changed)} linked.`, batch: r.batch };
}

/** The Recipe cell on the Square items table: same as setSquareMapping, but logged so it can be undone. */
export async function setLinkFromGrid(squareId: string, value: string): Promise<{ error?: string } | void> {
  const user = await requireUser("MANAGER");
  if (!z.string().min(1).max(128).safeParse(squareId).success || value.length > 64) return { error: "Can't save that." };
  const cur = await db.squareMapping.findUnique({ where: { squareId }, select: { unitCost: true, costClass: true } });
  if (!cur) return { error: "That Square item is gone. Reload." };
  if (value && value !== "__ignore") {
    const r = await db.recipe.findUnique({ where: { id: value }, select: { kind: true } });
    if (!r) return { error: "That recipe is gone. Reload." };
    if (r.kind === "PREP") return { error: "Pick a menu recipe or add-on." };
  }
  // Clearing the cell on a bought-in item keeps its cost each; picking a recipe or Ignore replaces it.
  const keepCost = value === "" && cur.unitCost != null;
  await writeLinks([{ squareId, to: value === "__ignore" ? { recipeId: null, ignored: true, unitCost: null, costClass: null } : { recipeId: value || null, ignored: false, unitCost: keepCost ? cur.unitCost!.toNumber() : null, costClass: keepCost ? (cur.costClass as never) : null } }], user.name);
  refresh();
}
