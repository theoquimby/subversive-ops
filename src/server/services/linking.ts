import "server-only";
import { addDays } from "@/domain/dates";
import { ML_PER_FL_OZ, ML_PER_GAL } from "@/domain/draftBeer";
import {
  beerGroups,
  classifyItem,
  coverage,
  defaultCostClass,
  isSettled,
  linkEffect,
  linkNameMatch,
  rankCandidates,
  safeToBulk,
  sameState,
  suggestUnitCost,
  suspicious,
  unitCostEffect,
  type BeerGroup,
  type Candidate,
  type Coverage,
  type Effect,
  type ItemKind,
  type LinkItem,
  type LinkRecipe,
  type LinkState,
} from "@/domain/linking";
import { cleanupPlan, isBackOnMenu, WEAK_NAME_MATCH, type CleanupPlan } from "@/domain/linkCleanup";
import { isRevenueClass, type RevenueClass } from "@/domain/revenueClass";
import { db, num } from "../db";
import { buildContext, loadCostingSnapshot, safeCost } from "./costing";
import { classSettings } from "./insights";
import { kegConfig } from "./kegs";
import { businessToday, squareCatalogMeta } from "./sales";
import { loadRejected } from "./square-menu";
import { readSettingJSON, writeSettingJSON } from "./square";

/**
 * The "Link your sales" assistant: every Square item that sold in the last 30
 * days with how it's linked, the best recipe for the ones that aren't, what a
 * link would cost, and links that look wrong. Also the link-change history.
 */

export const LINK_WINDOW_DAYS = 30;

// ---- Skipped for now, and links someone has looked at ------------------------------------------

/** Specials nobody wants to cost yet: Square id → the day they were skipped. */
const SKIPPED_KEY = "linking.skipped";
/** Links someone checked and said look right: Square id → the recipe they're right for. */
const CONFIRMED_KEY = "linking.confirmed";

export const loadSkipped = async () => (await readSettingJSON<Record<string, string>>(SKIPPED_KEY)) ?? {};
export const loadConfirmed = async () => (await readSettingJSON<Record<string, string>>(CONFIRMED_KEY)) ?? {};

export async function setSkipped(ids: string[], skip: boolean, today: string) {
  const cur = await loadSkipped();
  for (const id of ids) {
    if (skip) cur[id] = today;
    else delete cur[id];
  }
  await writeSettingJSON(SKIPPED_KEY, cur);
}

export async function confirmLinks(pairs: { squareId: string; recipeId: string }[]) {
  const cur = await loadConfirmed();
  for (const p of pairs) cur[p.squareId] = p.recipeId;
  await writeSettingJSON(CONFIRMED_KEY, cur);
}

export interface AssistantRow extends LinkItem {
  sales30: number;
  qty30: number;
  state: LinkState;
  recipeName: string | null;
  kind: ItemKind;
  /** Best recipes for an unlinked item, best first, each with its effect. */
  candidates: (Candidate & { effect: Effect; safe: boolean })[];
  /** Effect of the current link (linked items only). */
  effect: Effect | null;
  /** A starting point for a bought-in cost each. */
  unitCostHint: number | null;
  costClassHint: RevenueClass;
  deleted: boolean;
  /** Days it sold on in the last 30. */
  days30: number;
  /** Skipped for now (a special nobody wants to cost yet), and whether it's selling most weeks again. */
  skipped: boolean;
  backOnMenu: boolean;
  /** Why a link is worth a second look; empty when it isn't. */
  checkReasons: string[];
}

export interface BeerGroupView extends BeerGroup {
  /** What a keg costs, if the app already knows (a keg on Draft beer, or the beer's batch recipe). */
  kegCost: number | null;
  kegSizeId: string;
  yieldPct: number;
}

export interface HistoryEntry {
  id: string;
  batch: string;
  at: string;
  userName: string | null;
  squareId: string;
  squareName: string;
  before: string;
  after: string;
  undone: boolean;
}

export const stateOf = (m: { recipeId: string | null; ignored: boolean; unitCost: unknown; costClass: string | null }): LinkState => ({
  recipeId: m.recipeId,
  ignored: m.ignored,
  unitCost: num(m.unitCost as never),
  costClass: m.costClass && isRevenueClass(m.costClass) ? m.costClass : null,
});

/** One-line description of a stored link state (history rows). */
export function describeStored(v: unknown): string {
  const s = (v ?? {}) as { recipeName?: string | null; recipeId?: string | null; ignored?: boolean; unitCost?: number | null };
  if (s.ignored) return "Left out of sales";
  if (s.recipeId) return s.recipeName ?? "a recipe";
  if (s.unitCost != null) return `Bought in at $${Number(s.unitCost).toFixed(2)} each`;
  return "Not linked";
}

/** Recipes with today's cost per serving, for suggestions and the picker. */
export async function linkRecipes(): Promise<LinkRecipe[]> {
  const snap = await loadCostingSnapshot();
  const ctx = buildContext(snap, businessToday());
  return snap.recipes.map((r) => {
    const c = safeCost(ctx, r.id);
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      category: r.category,
      menuPrice: num(r.menuPrice),
      cost: "error" in c ? null : c.totalCost,
      incomplete: "error" in c ? true : c.incomplete,
      lines: r.lines.length,
    };
  });
}

export async function linkAssistant() {
  const today = businessToday();
  const from = addDays(today, -LINK_WINDOW_DAYS);
  const [mappings, meta, recipes, cls, beers, sales, rejected, history, cfg, kegs, skippedOn, confirmed] = await Promise.all([
    db.squareMapping.findMany({ select: { squareId: true, squareName: true, squareType: true, recipeId: true, ignored: true, unitCost: true, costClass: true, beerId: true, recipe: { select: { name: true } } } }),
    squareCatalogMeta(),
    linkRecipes(),
    classSettings(),
    // Each beer with the Square items linked to it (matched by id before name) and its keg ingredient.
    db.beer.findMany({ where: { active: true }, select: { id: true, name: true, squareNames: true, recipeId: true, ingredientId: true, squareItems: { select: { squareId: true } } } }).then((bs) => bs.map(({ squareItems, ...b }) => ({ ...b, squareIds: squareItems.map((s) => s.squareId) }))),
    db.dailySale.groupBy({ by: ["squareId"], _sum: { qty: true, netSales: true }, _count: { _all: true }, where: { date: { gte: new Date(`${from}T00:00:00Z`) } } }),
    loadRejected(),
    linkHistory(),
    kegConfig(),
    db.ingredient.findMany({
      where: { active: true, baseUnit: "ml", conversions: { some: { unit: "keg" } } },
      select: { id: true, name: true, yieldPct: true, conversions: { where: { unit: "keg" }, select: { baseQty: true } }, preferredProduct: { select: { prices: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 1, select: { price: true } } } } },
    }),
    loadSkipped(),
    loadConfirmed(),
  ]);
  const byId = new Map(sales.map((s) => [s.squareId, { qty: s._sum.qty?.toNumber() ?? 0, sales: s._sum.netSales?.toNumber() ?? 0, days: s._count._all }]));
  const recipeById = new Map(recipes.map((r) => [r.id, r]));

  const rows: AssistantRow[] = [];
  for (const m of mappings) {
    const x = meta[m.squareId];
    const s = byId.get(m.squareId);
    const item: LinkItem = { squareId: m.squareId, name: m.squareName, baseName: x?.baseName ?? m.squareName, modifier: m.squareType === "MODIFIER", category: x?.category ?? null, price: x?.price ?? null };
    const state = stateOf(m);
    const deleted = !!x?.deleted;
    const sold = s?.sales ?? 0;
    // Unlinked items that haven't sold don't move the numbers; they stay on the Square items table.
    if (!isSettled(state) && sold <= 0) continue;
    const kind = classifyItem(item, beers, cls.map).kind;
    let candidates: AssistantRow["candidates"] = [];
    let effect: Effect | null = null;
    if (!isSettled(state)) {
      candidates = rankCandidates(item, recipes, { rejected: new Set(rejected[m.squareId] ?? []), classMap: cls.map, limit: 4 }).map((c) => {
        const e = linkEffect(item, recipeById.get(c.recipeId)!);
        return { ...c, effect: e, safe: safeToBulk(c, e) };
      });
    } else if (state.recipeId) {
      const r = recipeById.get(state.recipeId);
      effect = r ? linkEffect(item, r) : null;
    } else if (state.unitCost != null) {
      effect = unitCostEffect(item, state.unitCost);
    }
    // A link worth a second look: the cost looks wrong for the price, or the names hardly agree
    // (how a wrong suggestion gets accepted). Once someone says it's right, it stays quiet.
    const checkReasons: string[] = [];
    const sure = state.recipeId ? confirmed[m.squareId] === state.recipeId : state.unitCost != null && confirmed[m.squareId] === "each";
    if (!state.ignored && !sure) {
      if (effect && suspicious(effect)) checkReasons.push("The cost looks wrong for the price");
      if (state.recipeId && m.recipe?.name && linkNameMatch(item, m.recipe.name) < WEAK_NAME_MATCH) checkReasons.push("The names don't match much");
    }
    const days30 = s?.days ?? 0;
    const wasSkipped = !isSettled(state) && !!skippedOn[m.squareId];
    rows.push({
      ...item,
      sales30: sold,
      qty30: s?.qty ?? 0,
      state,
      recipeName: m.recipe?.name ?? null,
      kind,
      candidates,
      effect,
      unitCostHint: suggestUnitCost(kind, item.price),
      costClassHint: state.costClass ?? defaultCostClass(kind, item, cls.map),
      deleted,
      days30,
      skipped: wasSkipped && !isBackOnMenu(days30),
      backOnMenu: wasSkipped && isBackOnMenu(days30),
      checkReasons,
    });
  }
  rows.sort((a, b) => b.sales30 - a.sales30 || a.name.localeCompare(b.name));

  // Keg cost per beer: the beer's linked keg ingredient's last price, else none (typed once per beer).
  // A Square name that isn't a beer yet can only find a keg ingredient by its "(keg)" name.
  const kegById = new Map(kegs.map((k) => [k.id, k]));
  const kegByName = new Map(kegs.map((k) => [k.name.toLowerCase(), k]));
  const unlinked = rows.filter((r) => !isSettled(r.state) && !r.skipped);
  const skipped = rows.filter((r) => r.skipped);
  const groups: BeerGroupView[] = beerGroups(unlinked, beers, cfg.pours).map((g) => {
    const beer = g.beerId ? beers.find((b) => b.id === g.beerId) : undefined;
    const k = beer ? (beer.ingredientId ? kegById.get(beer.ingredientId) : undefined) : kegByName.get(`${g.beer.trim()} (keg)`.toLowerCase());
    const ml = k?.conversions[0]?.baseQty.toNumber() ?? null;
    const sizeId = ml == null ? "half" : Math.abs(ml / ML_PER_GAL - 7.75) < 0.2 ? "quarter" : Math.abs(ml / ML_PER_GAL - 5.16) < 0.2 ? "sixtel" : Math.abs(ml / ML_PER_GAL - 31) < 0.3 ? "bbl" : Math.abs(ml / ML_PER_FL_OZ / 128 - 13.2) < 0.2 ? "euro50" : "half";
    return { ...g, kegCost: k?.preferredProduct?.prices[0]?.price.toNumber() ?? null, kegSizeId: sizeId, yieldPct: k ? k.yieldPct.toNumber() : 0.9 };
  });

  const cov: Coverage = coverage(rows.map((r) => ({ state: r.state, sales: r.sales30, skipped: r.skipped })));
  const flagged = rows.filter((r) => r.checkReasons.length > 0);
  const pours = new Set(groups.flatMap((g) => g.pours.map((p) => p.squareId)));
  const plan: CleanupPlan = cleanupPlan({
    items: unlinked.map((r) => ({ squareId: r.squareId, name: r.name, kind: r.kind, sales30: r.sales30, sure: !!r.candidates[0]?.safe, beer: pours.has(r.squareId) })),
    beers: groups.length,
    check: { items: flagged.length, dollars: flagged.reduce((s, r) => s + r.sales30, 0) },
    total: cov.total,
    linked: cov.linked,
    skipped: cov.skipped,
  });
  return {
    today,
    from,
    coverage: cov,
    plan,
    rows,
    unlinked,
    skipped,
    beerGroups: groups,
    flagged,
    recipes: recipes.filter((r) => r.kind !== "PREP").map((r) => ({ id: r.id, name: r.name, kind: r.kind, category: r.category, menuPrice: r.menuPrice, cost: r.cost, incomplete: r.incomplete, lines: r.lines })),
    history,
    neverSold: mappings.filter((m) => !isSettled(stateOf(m)) && !byId.get(m.squareId)?.sales && !meta[m.squareId]?.deleted).length,
  };
}

export type LinkAssistant = Awaited<ReturnType<typeof linkAssistant>>;

/** Coverage only (for small hints elsewhere). */
export async function linkCoverage(): Promise<Coverage> {
  const from = addDays(businessToday(), -LINK_WINDOW_DAYS);
  const [mappings, sales] = await Promise.all([
    db.squareMapping.findMany({ select: { squareId: true, recipeId: true, ignored: true, unitCost: true, costClass: true } }),
    db.dailySale.groupBy({ by: ["squareId"], _sum: { netSales: true }, where: { date: { gte: new Date(`${from}T00:00:00Z`) } } }),
  ]);
  const state = new Map(mappings.map((m) => [m.squareId, stateOf(m)]));
  return coverage(sales.map((s) => ({ state: state.get(s.squareId) ?? { recipeId: null, ignored: false, unitCost: null, costClass: null }, sales: s._sum.netSales?.toNumber() ?? 0 })));
}

export async function linkHistory(limit = 60): Promise<HistoryEntry[]> {
  const rows = await db.linkChange.findMany({ orderBy: { at: "desc" }, take: limit });
  return rows.map((r) => ({
    id: r.id,
    batch: r.batch,
    at: r.at.toISOString(),
    userName: r.userName,
    squareId: r.squareId,
    squareName: r.squareName,
    before: describeStored(r.before),
    after: describeStored(r.after),
    undone: !!r.undoneAt,
  }));
}

// ---- Writing links (every change logged, so it can be undone) ------------------------------

export interface LinkWrite {
  squareId: string;
  to: LinkState;
}

const stored = (s: LinkState, recipeName: string | null) => ({ recipeId: s.recipeId, recipeName: s.recipeId ? recipeName : null, ignored: s.ignored, unitCost: s.unitCost, costClass: s.costClass });

/**
 * Apply link changes in one transaction and log each one under a shared batch
 * id (undo puts the whole batch back). Changes to the same state are skipped.
 * Returns the batch id and how many items actually changed.
 */
export async function writeLinks(writes: LinkWrite[], userName: string | null): Promise<{ batch: string; changed: number; names: string[] }> {
  const batch = crypto.randomUUID();
  const ids = [...new Set(writes.map((w) => w.squareId))];
  const [current, recipes] = await Promise.all([
    db.squareMapping.findMany({ where: { squareId: { in: ids } }, select: { squareId: true, squareName: true, recipeId: true, ignored: true, unitCost: true, costClass: true, recipe: { select: { name: true } } } }),
    db.recipe.findMany({ where: { id: { in: writes.flatMap((w) => (w.to.recipeId ? [w.to.recipeId] : [])) } }, select: { id: true, name: true } }),
  ]);
  const cur = new Map(current.map((m) => [m.squareId, m]));
  const names = new Map(recipes.map((r) => [r.id, r.name]));
  const ops = [];
  const changedNames: string[] = [];
  const seen = new Set<string>();
  for (const w of writes) {
    const m = cur.get(w.squareId);
    if (!m || seen.has(w.squareId)) continue;
    seen.add(w.squareId);
    const before = stateOf(m);
    const to: LinkState = w.to.recipeId && !names.has(w.to.recipeId) ? { ...w.to, recipeId: null } : w.to;
    if (w.to.recipeId && !to.recipeId) continue; // recipe gone
    if (sameState(before, to)) continue;
    changedNames.push(m.squareName);
    ops.push(
      db.squareMapping.update({ where: { squareId: m.squareId }, data: { recipeId: to.recipeId, ignored: to.ignored, unitCost: to.unitCost == null ? null : to.unitCost.toFixed(2), costClass: to.costClass } }),
      db.linkChange.create({ data: { batch, userName, squareId: m.squareId, squareName: m.squareName, before: stored(before, m.recipe?.name ?? null), after: stored(to, to.recipeId ? names.get(to.recipeId) ?? null : null) } }),
    );
  }
  if (ops.length) await db.$transaction(ops);
  return { batch, changed: changedNames.length, names: changedNames };
}

/**
 * Undo a batch: each item goes back to how it was, but only if nobody has
 * changed it since (then it's left alone and counted as skipped).
 */
export async function undoBatch(batch: string): Promise<{ restored: number; skipped: number }> {
  const rows = await db.linkChange.findMany({ where: { batch, undoneAt: null } });
  if (!rows.length) return { restored: 0, skipped: 0 };
  const current = await db.squareMapping.findMany({ where: { squareId: { in: rows.map((r) => r.squareId) } }, select: { squareId: true, recipeId: true, ignored: true, unitCost: true, costClass: true } });
  const cur = new Map(current.map((m) => [m.squareId, stateOf(m)]));
  const asState = (v: unknown): LinkState => {
    const o = (v ?? {}) as Record<string, unknown>;
    return { recipeId: typeof o.recipeId === "string" ? o.recipeId : null, ignored: o.ignored === true, unitCost: typeof o.unitCost === "number" ? o.unitCost : null, costClass: typeof o.costClass === "string" && isRevenueClass(o.costClass) ? o.costClass : null };
  };
  const liveRecipes = new Set((await db.recipe.findMany({ where: { id: { in: rows.flatMap((r) => { const b = asState(r.before); return b.recipeId ? [b.recipeId] : []; }) } }, select: { id: true } })).map((r) => r.id));
  const ops = [];
  let skipped = 0;
  for (const r of rows) {
    const now = cur.get(r.squareId);
    if (!now || !sameState(now, asState(r.after))) {
      skipped++;
      continue;
    }
    const b = asState(r.before);
    if (b.recipeId && !liveRecipes.has(b.recipeId)) b.recipeId = null;
    ops.push(db.squareMapping.update({ where: { squareId: r.squareId }, data: { recipeId: b.recipeId, ignored: b.ignored, unitCost: b.unitCost == null ? null : b.unitCost.toFixed(2), costClass: b.costClass } }));
  }
  ops.push(db.linkChange.updateMany({ where: { batch, undoneAt: null }, data: { undoneAt: new Date() } }));
  await db.$transaction(ops);
  return { restored: ops.length - 1, skipped };
}
