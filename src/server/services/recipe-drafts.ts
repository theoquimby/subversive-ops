import "server-only";

/**
 * Recipe drafts: proposed ingredient lines waiting for Max to accept, edit or
 * discard. Nothing here touches a recipe until `acceptDraft`.
 *
 * Drafts come from the Square menu, from empty recipes, from photos of recipe
 * cards and from pasted text. With a Claude key they're written by Claude
 * against the ingredients Max actually buys; without one, the similar-recipe
 * heuristic (domain/recipeDraft.ts) and the text parser do the work.
 */

import { usableCostPerBase, recipeYieldInBase } from "@/domain/costing";
import {
  AiDraft, Draft, DraftItem, DraftKind, DraftTarget, ExampleRecipe, ItemIndex,
  draftFromSimilar, indexItems, newIngredientCategory, parseRecipeText, resolveAiDraft, similarRecipes,
} from "@/domain/recipeDraft";
import { STANDARD_UNITS_BY_BASE, type BaseUnit } from "@/domain/units";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { claudeJSON, claudeReady, CLAUDE_NOT_SET_UP, fileBlock } from "../integrations/claude";
import { db } from "../db";
import { buildContext, loadCostingSnapshot, safeCost } from "./costing";
import { targetFoodCost } from "./insights";
import { businessToday, squareCatalogMeta } from "./sales";
import { readSettingJSON, writeSettingJSON } from "./square";
import { loadSquareMenu } from "./square-menu";

export const DRAFTS_KEY = "recipeDrafts.pending";
const MAX_STORED = 300;
/** Square items / recipes drafted per request. */
export const MAX_PER_RUN = 60;
const AI_BATCH = 6;

export interface StoredDraft extends Draft {
  id: string;
  createdAt: string;
  /** Where it came from, for the card header: "Square item", "Photo", "Pasted text", "Empty recipe". */
  source: string;
  /** Fill this recipe (empty shell) and/or link these Square items on accept. */
  target: { recipeId: string | null; squareIds: string[] };
}

export const AI_OFF_NOTE = "Drafts copy your most similar recipes. Turn on AI features (Settings → Connections) to also read Square descriptions, photos of recipe cards and messy notes.";

// ---- Catalog: what lines can use, and recipes to learn from -------------------------

export interface DraftContext {
  items: DraftItem[];
  examples: ExampleRecipe[];
  ix: ItemIndex;
  defaultTarget: number;
}

export async function loadDraftContext(): Promise<DraftContext> {
  const snap = await loadCostingSnapshot();
  const ctx = buildContext(snap, businessToday());
  const items: DraftItem[] = [
    ...snap.ingredients.map((i): DraftItem => {
      const c = ctx.ingredients.get(i.id)!;
      return {
        key: `i:${i.id}`,
        name: i.name,
        kind: "ingredient",
        category: i.category,
        baseUnit: c.baseUnit,
        conversions: c.conversions,
        units: [...STANDARD_UNITS_BY_BASE[c.baseUnit], ...c.conversions.map((x) => x.unit)],
        costPerBase: usableCostPerBase(c),
      };
    }),
    ...snap.recipes
      .filter((r) => r.kind === "PREP")
      .map((r): DraftItem => {
        const cr = ctx.recipes.get(r.id)!;
        const cost = safeCost(ctx, r.id);
        let perBase: number | null = null;
        try {
          perBase = "error" in cost ? null : cost.totalCost / recipeYieldInBase(cr);
        } catch {}
        return { key: `r:${r.id}`, name: r.name, kind: "recipe", category: r.category, baseUnit: cr.yieldBase, conversions: [], units: STANDARD_UNITS_BY_BASE[cr.yieldBase], costPerBase: perBase };
      }),
  ];
  const examples: ExampleRecipe[] = snap.recipes
    .filter((r) => r.lines.length > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as DraftKind,
      category: r.category,
      menuPrice: r.menuPrice?.toNumber() ?? null,
      yieldQty: r.yieldQty.toNumber(),
      yieldUnit: r.yieldUnit,
      lines: r.lines.map((l) => ({ itemKey: l.ingredientId ? `i:${l.ingredientId}` : `r:${l.subRecipeId}`, qty: l.qty.toNumber(), unit: l.unit })),
    }));
  return { items, examples, ix: indexItems(items, examples), defaultTarget: await targetFoodCost() };
}

// ---- Store ---------------------------------------------------------------------------

export const loadDrafts = async () => Object.values((await readSettingJSON<Record<string, StoredDraft>>(DRAFTS_KEY)) ?? {}).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

async function storeDrafts(list: Omit<StoredDraft, "id" | "createdAt">[]): Promise<StoredDraft[]> {
  const cur = (await readSettingJSON<Record<string, StoredDraft>>(DRAFTS_KEY)) ?? {};
  // A new draft for the same recipe / Square item replaces the old one.
  for (const d of list) {
    for (const [id, old] of Object.entries(cur)) {
      if ((d.target.recipeId && old.target.recipeId === d.target.recipeId) || d.target.squareIds.some((s) => old.target.squareIds.includes(s))) delete cur[id];
    }
  }
  const now = new Date().toISOString();
  const made = list.map((d, i) => ({ ...d, id: `d${Date.now().toString(36)}${i.toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: now }));
  for (const d of made) cur[d.id] = d;
  const kept = Object.values(cur).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_STORED);
  await writeSettingJSON(DRAFTS_KEY, Object.fromEntries(kept.map((d) => [d.id, d])));
  return made;
}

export async function removeDrafts(ids: string[]) {
  const cur = (await readSettingJSON<Record<string, StoredDraft>>(DRAFTS_KEY)) ?? {};
  let n = 0;
  for (const id of ids) if (cur[id]) { delete cur[id]; n++; }
  await writeSettingJSON(DRAFTS_KEY, cur);
  return n;
}

// ---- Claude --------------------------------------------------------------------------

const aiLine = z.object({
  item: z.string().describe("Exact name from the ingredient list, or a short plain name for something new"),
  isNew: z.boolean().describe("true only when nothing on the list fits"),
  qty: z.number(),
  unit: z.string().describe("One of the units listed for that item (oz, fl oz, each, slice, lb, bbl…)"),
  note: z.string().describe("Short reason or what to check; empty if obvious"),
});
const aiDraft = z.object({
  ref: z.string().describe("The ref of the dish this answers (or 'card 1', 'card 2' for photos/text)"),
  name: z.string(),
  kind: z.enum(["MENU", "MODIFIER", "PREP"]),
  category: z.string(),
  yieldQty: z.number().describe("PREP only: what one batch makes; 1 for menu items"),
  yieldUnit: z.string().describe("PREP only: unit of the batch yield (qt, gal, l, lb, each, bbl, hl); 'each' for menu items"),
  lines: z.array(aiLine),
  notes: z.string().describe("Method or anything worth keeping, short; empty if none"),
});
const aiBatch = z.object({ drafts: z.array(aiDraft) });

const SYSTEM = `You cost recipes for Subversive, a brewery taproom and kitchen in Catskill, NY (burgers, sandwiches, salads, wings, house sauces, and beer brewed on site).
Write ingredient lines per ONE serving for menu items and add-ons, and per batch for prep recipes (sauces, dressings, beer).
Rules:
- Use ingredient and prep-recipe names exactly as written in the list whenever one fits (prefer a house prep recipe like a sauce over its raw parts). Set isNew=true only when nothing fits, and name the new thing plainly ("Cascade hops", "Pilsner malt").
- Use a unit listed for that item. Portions should be realistic for a pub kitchen; follow the house recipes shown as examples (same buns, sauces, sides, packaging).
- Beer recipes are PREP with the batch size as yield in bbl (or hl): grain in lb, hops in oz or g, yeast in each (packs) or g, water treatment in g.
- Don't invent allergen claims. Don't add garnish you can't see or infer.
- If you can't read a line in a photo, leave it out and say so in notes.`;

function catalogText(ctx: DraftContext) {
  const items = ctx.items.filter((i) => !/clean|suppl|test/i.test(i.category));
  return items.map((i) => `- ${i.name} [${i.kind === "recipe" ? "prep recipe" : i.category}; units: ${[...new Set([...i.conversions.map((c) => c.unit), ...i.units])].slice(0, 8).join(", ")}]`).join("\n");
}

function exampleText(ctx: DraftContext, recipes: ExampleRecipe[]) {
  return recipes.map((r) => `${r.name} (${r.kind === "PREP" ? `prep, makes ${r.yieldQty} ${r.yieldUnit}` : r.category}):\n${r.lines.map((l) => `  ${l.qty} ${l.unit} ${ctx.ix.byKey.get(l.itemKey)?.name ?? "?"}`).join("\n")}`).join("\n\n");
}

type Json = typeof claudeJSON;
async function askClaude(ctx: DraftContext, content: Parameters<Json>[0]["content"], examples: ExampleRecipe[], json: Json = claudeJSON) {
  return json({
    schema: aiBatch,
    system: `${SYSTEM}\n\nIngredients and prep recipes Max buys or makes:\n${catalogText(ctx)}\n\nHouse recipes to follow:\n${exampleText(ctx, examples)}`,
    content,
    effort: "medium",
  });
}

const exampleUnion = (ctx: DraftContext, targets: DraftTarget[], cap = 14) => {
  const seen = new Map<string, ExampleRecipe>();
  for (const t of targets) for (const n of similarRecipes(t, ctx.examples, 3)) seen.set(n.recipe.id, n.recipe);
  for (const r of ctx.examples) if (seen.size < 6) seen.set(r.id, r);
  return [...seen.values()].slice(0, cap);
};

// ---- Drafting -------------------------------------------------------------------------

export type Pending = { target: DraftTarget; recipeId: string | null; squareIds: string[]; source: string };

/**
 * Heuristic for everyone; Claude on top when a key is set. A batch Claude
 * can't do keeps its heuristic drafts (and the error is reported once).
 */
export async function draftAll(ctx: DraftContext, pending: Pending[], deps: { ready?: () => Promise<boolean>; json?: Json } = {}): Promise<{ drafts: Omit<StoredDraft, "id" | "createdAt">[]; ai: boolean; aiError: string | null }> {
  const heuristic = pending.map((p) => draftFromSimilar(p.target, ctx.examples, ctx.ix));
  const out = pending.map((p, i) => ({ ...heuristic[i], source: p.source, target: { recipeId: p.recipeId, squareIds: p.squareIds } }));
  if (!(await (deps.ready ?? claudeReady)())) return { drafts: out, ai: false, aiError: null };
  let aiError: string | null = null;
  const batches: number[][] = [];
  for (let i = 0; i < pending.length; i += AI_BATCH) batches.push(pending.slice(i, i + AI_BATCH).map((_, j) => i + j));
  for (let b = 0; b < batches.length; b += 3) {
    await Promise.all(batches.slice(b, b + 3).map(async (idx) => {
      const targets = idx.map((i) => pending[i].target);
      const list = idx.map((i) => {
        const t = pending[i].target;
        return [`ref: T${i}`, `name: ${t.name}`, `kind: ${t.kind}`, t.category && `Square category: ${t.category}`, t.price != null && `price: $${t.price.toFixed(2)}`, t.description && `description: ${t.description}`, t.modifiers?.length && `modifier lists: ${t.modifiers.join(", ")}`].filter(Boolean).join("\n");
      }).join("\n\n");
      const r = await askClaude(ctx, [`Draft a recipe for each of these dishes from the Square menu. Answer with one draft per ref.\n\n${list}`], exampleUnion(ctx, targets), deps.json);
      if (!r.ok) { aiError = r.error; return; }
      for (const d of r.data.drafts) {
        const i = Number(d.ref.replace(/^T/, ""));
        if (!idx.includes(i)) continue;
        const h = heuristic[i];
        const resolved = resolveAiDraft(d as AiDraft, ctx.ix, "ai", { name: h.name, kind: h.kind, category: h.category, menuPrice: h.menuPrice, basis: h.basis });
        if (resolved.lines.length) out[i] = { ...resolved, source: pending[i].source, target: out[i].target };
      }
    }));
  }
  return { drafts: out, ai: true, aiError };
}

export interface DraftRunResult { made: number; skipped: number; ai: boolean; note: string | null }

const summary = (made: number, skipped: number, ai: boolean, aiError: string | null): DraftRunResult => ({
  made,
  skipped,
  ai,
  note: aiError ? `${aiError} The rest were drafted from similar recipes.` : ai ? null : AI_OFF_NOTE,
});

/** Draft recipes for Square items (unlinked, or linked to a recipe with no lines). */
export async function draftForSquareItems(squareIds: string[]): Promise<DraftRunResult> {
  const [{ items }, meta, ctx, recipes] = await Promise.all([
    loadSquareMenu(),
    squareCatalogMeta(),
    loadDraftContext(),
    db.recipe.findMany({ where: { active: true }, select: { id: true, name: true, kind: true, _count: { select: { lines: true } } } }),
  ]);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const wanted = new Set(squareIds);
  const groups = new Map<string, Pending>();
  let skipped = 0;
  for (const it of items.filter((i) => wanted.has(i.squareId) && !i.deleted)) {
    const linked = it.recipeId ? byId.get(it.recipeId) : null;
    if (linked && linked._count.lines > 0) { skipped++; continue; }
    const kind: DraftKind = linked ? (linked.kind as DraftKind) : it.squareType === "MODIFIER" ? "MODIFIER" : "MENU";
    const name = linked?.name ?? it.baseName;
    const key = linked ? `r:${linked.id}` : `${kind}:${name.trim().toLowerCase()}`;
    const g = groups.get(key);
    if (g) { g.squareIds.push(it.squareId); continue; }
    const m = meta[it.squareId];
    groups.set(key, {
      target: { name, kind, category: it.category, price: it.price, description: m?.description ?? null, modifiers: m?.modifiers ?? [], excludeRecipeId: linked?.id ?? null },
      recipeId: linked?.id ?? null,
      squareIds: [it.squareId],
      source: "Square item",
    });
  }
  const pending = [...groups.values()].slice(0, MAX_PER_RUN);
  skipped += groups.size - pending.length;
  const { drafts, ai, aiError } = await draftAll(ctx, pending);
  await storeDrafts(drafts);
  return summary(drafts.length, skipped, ai, aiError);
}

/** Draft lines for recipes that have none yet (shells made from Square). */
export async function draftForRecipes(recipeIds: string[]): Promise<DraftRunResult> {
  const [ctx, recipes, meta] = await Promise.all([
    loadDraftContext(),
    db.recipe.findMany({ where: { id: { in: recipeIds }, active: true }, include: { _count: { select: { lines: true } }, squareMaps: { select: { squareId: true } } } }),
    squareCatalogMeta(),
  ]);
  const empty = recipes.filter((r) => r._count.lines === 0);
  const pending: Pending[] = empty.slice(0, MAX_PER_RUN).map((r) => {
    const m = r.squareMaps.map((s) => meta[s.squareId]).find((x) => x?.description) ?? meta[r.squareMaps[0]?.squareId ?? ""];
    return {
      target: { name: r.name, kind: r.kind as DraftKind, category: r.category, price: r.menuPrice?.toNumber() ?? m?.price ?? null, description: m?.description ?? null, modifiers: m?.modifiers ?? [], excludeRecipeId: r.id },
      recipeId: r.id,
      squareIds: [],
      source: "Empty recipe",
    };
  });
  const { drafts, ai, aiError } = await draftAll(ctx, pending);
  await storeDrafts(drafts);
  return summary(drafts.length, recipes.length - pending.length, ai, aiError);
}

/** A recipe typed in Notes / an email / a brewing sheet. Claude when on, else the parser. */
export async function draftFromText(text: string, recipeId: string | null): Promise<DraftRunResult & { ids: string[] }> {
  const ctx = await loadDraftContext();
  const shell = recipeId ? await db.recipe.findUnique({ where: { id: recipeId }, select: { id: true, name: true, kind: true, category: true, menuPrice: true } }) : null;
  const base = shell ? { name: shell.name, kind: shell.kind as DraftKind, category: shell.category, menuPrice: shell.menuPrice?.toNumber() ?? null } : undefined;
  const parsed = parseRecipeText(text, ctx.ix, base ? { name: base.name, kind: base.kind } : {});
  let drafts: Draft[] = [parsed];
  let ai = false;
  let aiError: string | null = null;
  if (await claudeReady()) {
    ai = true;
    const r = await askClaude(ctx, [`Turn this into recipe draft(s). It may be one recipe or several; it may be a brewing sheet.\n\n---\n${text.slice(0, 20000)}\n---`], exampleUnion(ctx, [{ name: parsed.name, kind: parsed.kind }]));
    if (r.ok && r.data.drafts.length) drafts = r.data.drafts.slice(0, base ? 1 : 10).map((d) => resolveAiDraft(d as AiDraft, ctx.ix, "ai", base));
    else if (!r.ok) aiError = r.error;
  }
  const made = await storeDrafts(drafts.map((d) => ({ ...d, ...(base ? { menuPrice: base.menuPrice } : {}), source: "Pasted text", target: { recipeId: shell?.id ?? null, squareIds: [] } })));
  return { ...summary(made.length, 0, ai, aiError), note: aiError ? `${aiError} Read with the simple parser instead.` : null, ids: made.map((d) => d.id) };
}

/** Photos of recipe cards or brewing sheets (needs Claude). */
export async function draftFromPhotos(files: { bytes: Uint8Array; type: string }[], recipeId: string | null): Promise<{ error: string } | (DraftRunResult & { ids: string[] })> {
  if (!(await claudeReady())) return { error: `Reading photos needs AI. ${CLAUDE_NOT_SET_UP} Until then, type or paste the recipe instead.` };
  const ctx = await loadDraftContext();
  const shell = recipeId ? await db.recipe.findUnique({ where: { id: recipeId }, select: { id: true, name: true, kind: true, category: true, menuPrice: true } }) : null;
  const base = shell ? { name: shell.name, kind: shell.kind as DraftKind, category: shell.category, menuPrice: shell.menuPrice?.toNumber() ?? null } : undefined;
  const blocks = files.map((f) => fileBlock(f.bytes, f.type)).filter((b): b is NonNullable<typeof b> => b != null);
  if (!blocks.length) return { error: "Upload photos (JPEG/PNG) or a PDF." };
  const r = await askClaude(ctx, [...blocks, `These ${blocks.length > 1 ? `${blocks.length} images are pages of` : "image is"} handwritten or printed recipe card(s) or a brewing sheet. Read every recipe (one draft each; a recipe continued across pages is one draft). Keep the quantities as written; for a batch recipe give the batch yield.${base ? ` It's the recipe for "${base.name}".` : ""}`], exampleUnion(ctx, []));
  if (!r.ok) return { error: r.error };
  if (!r.data.drafts.length) return { error: "Couldn't find a recipe in that photo. Try a closer, straighter shot." };
  const drafts = r.data.drafts.slice(0, base ? 1 : 10).map((d) => resolveAiDraft(d as AiDraft, ctx.ix, "photo", base));
  const made = await storeDrafts(drafts.map((d) => ({ ...d, source: blocks.length > 1 ? `${blocks.length} photos` : "Photo", target: { recipeId: shell?.id ?? null, squareIds: [] } })));
  return { made: made.length, skipped: 0, ai: true, note: null, ids: made.map((d) => d.id) };
}

// ---- Accept ---------------------------------------------------------------------------

export interface AcceptInput {
  name: string;
  kind: DraftKind;
  category: string;
  menuPrice: number | null;
  yieldQty: number;
  yieldUnit: string;
  yieldBase: BaseUnit;
  notes: string | null;
  lines: { itemKey: string | null; newName: string | null; newBaseUnit: BaseUnit | null; qty: number; unit: string }[];
}

/**
 * Save a (possibly edited) draft as a recipe: fills the empty recipe it was
 * made for, or creates one (and links the Square items). New-ingredient lines
 * create the ingredient without a price.
 */
export async function acceptDraft(id: string, input: AcceptInput): Promise<{ error: string } | { recipeId: string; created: number }> {
  const all = (await readSettingJSON<Record<string, StoredDraft>>(DRAFTS_KEY)) ?? {};
  const d = all[id];
  if (!d) return { error: "That draft is gone — it was accepted or discarded already." };
  const lines = input.lines.filter((l) => l.qty > 0 && (l.itemKey || l.newName?.trim()));
  if (!lines.length) return { error: "Add at least one line, or discard the draft." };
  const prep = input.kind === "PREP";
  try {
    const res = await db.$transaction(async (tx) => {
      let created = 0;
      const resolved: { ingredientId: string | null; subRecipeId: string | null; qty: Prisma.Decimal; unit: string; sort: number }[] = [];
      for (const [i, l] of lines.entries()) {
        let ingredientId: string | null = null;
        let subRecipeId: string | null = null;
        if (l.itemKey?.startsWith("i:")) ingredientId = l.itemKey.slice(2);
        else if (l.itemKey?.startsWith("r:")) subRecipeId = l.itemKey.slice(2);
        else {
          const name = l.newName!.trim().slice(0, 120);
          const found = await tx.ingredient.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
          if (found) ingredientId = found.id;
          else {
            const ing = await tx.ingredient.create({ data: { name, baseUnit: l.newBaseUnit ?? "each", category: newIngredientCategory(name, input), storageArea: /brew/i.test(input.category) ? "Brewery" : "Dry storage", notes: "Added from a recipe draft — link a supplier product to price it." } });
            ingredientId = ing.id;
            created++;
          }
        }
        resolved.push({ ingredientId, subRecipeId, qty: new Prisma.Decimal(l.qty), unit: l.unit, sort: i });
      }
      const data = {
        kind: input.kind,
        category: input.category.trim() || (prep ? "Prep" : "Food"),
        menuPrice: prep || input.menuPrice == null ? null : new Prisma.Decimal(input.menuPrice.toFixed(2)),
        yieldQty: new Prisma.Decimal(prep ? input.yieldQty : 1),
        yieldUnit: prep ? input.yieldUnit : "each",
        yieldBase: prep ? input.yieldBase : ("each" as const),
        ...(input.notes ? { notes: input.notes.slice(0, 2000) } : {}),
      };
      let recipeId = d.target.recipeId;
      if (recipeId) {
        const r = await tx.recipe.findUnique({ where: { id: recipeId }, include: { _count: { select: { lines: true } } } });
        if (!r || !r.active) recipeId = null;
        else if (r._count.lines > 0) throw new DraftError(`${r.name} already has ingredients. Open it to change them, or discard this draft.`);
      }
      const name = input.name.trim();
      if (!recipeId) {
        const same = await tx.recipe.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, include: { _count: { select: { lines: true } } } });
        if (same && (same._count.lines > 0 || !same.active)) throw new DraftError(`There's already a recipe called "${same.name}". Rename this draft first.`);
        recipeId = same?.id ?? null;
      }
      if (resolved.some((l) => l.subRecipeId && l.subRecipeId === recipeId)) throw new DraftError("A recipe can't contain itself.");
      const saved = recipeId
        ? await tx.recipe.update({ where: { id: recipeId }, data: { ...data, name, lines: { create: resolved } } })
        : await tx.recipe.create({ data: { ...data, name, lines: { create: resolved } } });
      if (d.target.squareIds.length) await tx.squareMapping.updateMany({ where: { squareId: { in: d.target.squareIds }, recipeId: null }, data: { recipeId: saved.id, ignored: false } });
      return { recipeId: saved.id, created };
    });
    await removeDrafts([id]);
    return res;
  } catch (e) {
    if (e instanceof DraftError) return { error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "A recipe or ingredient with that name already exists. Rename it and try again." };
    throw e;
  }
}

class DraftError extends Error {}
