"use server";

import { standardUnit } from "@/domain/units";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import {
  acceptDraft, draftForRecipes, draftForSquareItems, draftFromPhotos, draftFromText, loadDrafts, MAX_PER_RUN, removeDrafts,
  type AcceptInput, type DraftRunResult, type StoredDraft,
} from "@/server/services/recipe-drafts";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Result = { error?: string; message?: string; ids?: string[] };

const refresh = () => {
  revalidatePath("/menu");
  revalidatePath("/menu/drafts");
  revalidatePath("/sales/square-menu");
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const runMessage = (r: DraftRunResult, what: string): Result => {
  if (!r.made) return { error: r.skipped ? `Nothing to draft — ${r.skipped === 1 ? "that one already has" : "those already have"} ingredients.` : "Nothing to draft." };
  const parts = [`Drafted ${plural(r.made, what)}${r.ai ? " with Claude" : ""}.`];
  if (r.skipped) parts.push(`Skipped ${r.skipped} (already costed${r.made >= MAX_PER_RUN ? `, or over ${MAX_PER_RUN} at a time` : ""}).`);
  if (r.note) parts.push(r.note);
  return { message: parts.join(" ") };
};

const ids = z.array(z.string().min(1).max(128)).min(1).max(1000);

/** Draft recipes for Square items (from the Square items table). */
export async function draftSquareItems(input: string[]): Promise<Result> {
  await requireUser("MANAGER");
  const p = ids.safeParse(input);
  if (!p.success) return { error: "Pick at least one item." };
  const r = await draftForSquareItems(p.data);
  refresh();
  return runMessage(r, "recipe");
}

/** Draft lines for empty recipes; no ids = every recipe with no lines yet. */
export async function draftEmptyRecipes(input?: string[]): Promise<Result> {
  await requireUser("MANAGER");
  let list = input ?? [];
  if (!input) list = (await db.recipe.findMany({ where: { active: true, lines: { none: {} } }, select: { id: true }, orderBy: { name: "asc" } })).map((r) => r.id);
  const p = ids.safeParse(list);
  if (!p.success) return { error: "No empty recipes to draft." };
  const r = await draftForRecipes(p.data);
  refresh();
  return runMessage(r, "recipe");
}

const textSchema = z.object({ text: z.string().trim().min(3, "Paste or type the recipe first.").max(30000, "That's too long — paste one recipe at a time."), recipeId: z.string().max(64).nullable() });

/** A recipe pasted from Notes / an email / a brewing sheet. */
export async function readRecipeText(text: string, recipeId: string | null): Promise<Result> {
  await requireUser("MANAGER");
  const p = textSchema.safeParse({ text, recipeId });
  if (!p.success) return { error: p.error.issues[0].message };
  const r = await draftFromText(p.data.text, p.data.recipeId);
  refresh();
  return { ...runMessage(r, "recipe"), ids: r.ids };
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

/** Photos of recipe cards or brewing sheets (one or more pages). */
export async function readRecipePhotos(form: FormData): Promise<Result> {
  await requireUser("MANAGER");
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 8);
  if (!files.length) return { error: "Choose at least one photo." };
  if (files.some((f) => f.size > MAX_PHOTO_BYTES)) return { error: "One of those is over 8 MB. Try a regular photo instead of a scan." };
  if (files.some((f) => !ACCEPTED.includes(f.type))) return { error: "Upload photos (JPEG/PNG) or a PDF." };
  const recipeId = String(form.get("recipeId") ?? "") || null;
  const r = await draftFromPhotos(await Promise.all(files.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), type: f.type }))), recipeId);
  if ("error" in r) return { error: r.error };
  refresh();
  return { ...runMessage(r, "recipe"), ids: r.ids };
}

const lineSchema = z.object({
  itemKey: z.string().regex(/^[ir]:.+$/).nullable(),
  newName: z.string().trim().max(120).nullable(),
  newBaseUnit: z.enum(["g", "ml", "each"]).nullable(),
  qty: z.number().finite().nonnegative(),
  unit: z.string().trim().min(1).max(32),
});
const acceptSchema = z.object({
  name: z.string().trim().min(1, "Give the recipe a name.").max(120),
  kind: z.enum(["MENU", "MODIFIER", "PREP"]),
  category: z.string().trim().max(80),
  menuPrice: z.number().finite().nonnegative().nullable(),
  yieldQty: z.number().finite().positive("Batch yield must be more than 0."),
  yieldUnit: z.string().trim().min(1).max(16),
  notes: z.string().max(4000).nullable(),
  lines: z.array(lineSchema).max(200),
});

function toAccept(input: z.infer<typeof acceptSchema>): AcceptInput {
  return { ...input, yieldBase: standardUnit(input.yieldUnit)?.base ?? "each", lines: input.lines.map((l) => ({ ...l, newName: l.newName || null })) };
}

/** Save one reviewed draft as a recipe. */
export async function acceptRecipeDraft(id: string, input: z.input<typeof acceptSchema>): Promise<Result & { recipeId?: string }> {
  await requireUser("MANAGER");
  const p = acceptSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const r = await acceptDraft(String(id), toAccept(p.data));
  if ("error" in r) return { error: r.error };
  refresh();
  revalidatePath("/ingredients");
  return { message: `Saved ${p.data.name}${r.created ? ` and added ${plural(r.created, "new ingredient")} (no price yet)` : ""}.`, recipeId: r.recipeId };
}

const fromStored = (d: StoredDraft): AcceptInput => toAccept({
  name: d.name, kind: d.kind, category: d.category, menuPrice: d.menuPrice, yieldQty: d.yieldQty, yieldUnit: d.yieldUnit, notes: d.notes,
  lines: d.lines.map((l) => ({ itemKey: l.itemKey, newName: l.newName ?? null, newBaseUnit: l.newBaseUnit ?? null, qty: l.qty, unit: l.unit })),
});

/** Accept several drafts as they are. */
export async function acceptRecipeDrafts(input: string[]): Promise<Result> {
  await requireUser("MANAGER");
  const p = ids.safeParse(input);
  if (!p.success) return { error: "Nothing to accept." };
  const all = new Map((await loadDrafts()).map((d) => [d.id, d]));
  let ok = 0;
  const failed: string[] = [];
  for (const id of p.data) {
    const d = all.get(id);
    if (!d) continue;
    const r = await acceptDraft(id, fromStored(d));
    if ("error" in r) failed.push(d.name);
    else ok++;
  }
  refresh();
  revalidatePath("/ingredients");
  if (!ok && failed.length) return { error: `Couldn't save ${failed.slice(0, 3).join(", ")} — open each to fix it.` };
  return { message: `Saved ${plural(ok, "recipe")}.${failed.length ? ` ${failed.length} need a look: ${failed.slice(0, 3).join(", ")}.` : ""}` };
}

/** Throw drafts away (recipes are untouched). */
export async function discardRecipeDrafts(input: string[]): Promise<Result> {
  await requireUser("MANAGER");
  const p = ids.safeParse(input);
  if (!p.success) return { error: "Nothing to discard." };
  const n = await removeDrafts(p.data);
  refresh();
  return { message: `Discarded ${plural(n, "draft")}.` };
}
