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
  itemKey: z.string().regex(/^[ir]:.+$/, "A line points at something that isn't on the list. Pick its item again.").nullable(),
  newName: z.string().trim().max(120, "A new ingredient's name is too long. Keep it under 120 letters.").nullable(),
  newBaseUnit: z.enum(["g", "ml", "each"], { error: "Pick weight, volume or count for each new ingredient." }).nullable(),
  qty: z.number({ error: "Every line needs an amount." }).finite("Every line needs an amount.").nonnegative("Amounts can't be below 0."),
  unit: z.string({ error: "Every line needs a unit." }).trim().min(1, "Every line needs a unit.").max(32, "A unit name is too long."),
});
const acceptSchema = z.object({
  name: z.string({ error: "Give the recipe a name." }).trim().min(1, "Give the recipe a name.").max(120, "That name is too long. Keep it under 120 letters."),
  kind: z.enum(["MENU", "MODIFIER", "PREP"], { error: "Pick a type: menu item, add-on or prep recipe." }),
  category: z.string().trim().max(80, "That category is too long."),
  menuPrice: z.number({ error: "Menu price must be a number, or leave it blank." }).finite("Menu price must be a number, or leave it blank.").nonnegative("Menu price can't be below $0.").nullable(),
  yieldQty: z.number({ error: "Type how much one batch makes." }).finite("Type how much one batch makes.").positive("Batch yield must be more than 0."),
  yieldUnit: z.string().trim().min(1, "Pick the batch yield's unit.").max(16),
  notes: z.string().max(4000, "Notes are too long.").nullable(),
  lines: z.array(lineSchema).max(200, "That's more than 200 lines. Split it into prep recipes."),
});

/** A draft as edited on its card: what Accept saves. */
export type DraftEdit = z.input<typeof acceptSchema>;

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

const fromStored = (d: StoredDraft): z.input<typeof acceptSchema> => ({
  name: d.name, kind: d.kind, category: d.category, menuPrice: d.menuPrice, yieldQty: d.yieldQty, yieldUnit: d.yieldUnit, notes: d.notes,
  lines: d.lines.map((l) => ({ itemKey: l.itemKey, newName: l.newName ?? null, newBaseUnit: l.newBaseUnit ?? null, qty: l.qty, unit: l.unit })),
});

const manySchema = z.array(z.object({ id: z.string().min(1).max(128), input: z.unknown().optional() })).min(1).max(1000);

/**
 * Accept several drafts at once, each as it stands on its card (with any edits
 * made there); a draft sent without edits is saved as stored. `ids` in the
 * result are the drafts that were saved; the rest keep their edits on screen.
 */
export async function acceptRecipeDrafts(input: { id: string; input?: DraftEdit }[]): Promise<Result> {
  await requireUser("MANAGER");
  const p = manySchema.safeParse(input);
  if (!p.success) return { error: "Nothing to accept." };
  const all = new Map((await loadDrafts()).map((d) => [d.id, d]));
  const done: string[] = [];
  const failed: string[] = [];
  for (const { id, input: edit } of p.data) {
    const d = all.get(id);
    if (!d) continue;
    const parsed = acceptSchema.safeParse(edit ?? fromStored(d));
    const name = parsed.success ? parsed.data.name : d.name;
    if (!parsed.success) { failed.push(`${name} (${parsed.error.issues[0].message.replace(/\.$/, "").toLowerCase()})`); continue; }
    const r = await acceptDraft(id, toAccept(parsed.data));
    if ("error" in r) failed.push(name);
    else done.push(id);
  }
  refresh();
  revalidatePath("/ingredients");
  const named = failed.slice(0, 3).join(", ");
  if (!done.length && failed.length) return { error: `Couldn't save ${named}. Fix ${failed.length === 1 ? "it" : "each one"} on its card and press Accept.` };
  return { ids: done, message: `Saved ${plural(done.length, "recipe")}.${failed.length ? ` ${failed.length} still need a look: ${named}.` : ""}` };
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
