import "server-only";
import { Prisma } from "@prisma/client";
import { isProfileKey, LEAD_REFS_KEY, profileDays, type LeadRef } from "@/domain/brewDay";
import {
  detectBrewManagerFile,
  mapAppData,
  mapBackup,
  matchBeer,
  matchName,
  previewAppData,
  previewBackup,
  recipeKeyAliases,
  resolveSchedule,
  tanksFromBackup,
  type AppImportContext,
  type AppImportPreview,
  type ImportPreview,
  type MappedAppData,
  type MappedBackup,
  type MappedRecipe,
} from "@/domain/brewImport";
import { daysBetween, parseISODate, type ISODate } from "@/domain/dates";
import { nextBatchCode, planBrew, stayIntervals } from "@/domain/tankPlan";
import type { LinkSummary } from "@/domain/brewIngredientLink";
import { db } from "../db";
import { linkBrewIngredients } from "./brewIngredientLink";
import { asDate, loadPlan } from "./brewery";
import { businessToday } from "./sales";

/**
 * Import from Brew Manager: its backup file (recipes and brews) or its app data
 * (recipes, development beers, the brew schedule, tanks, suppliers' lead times).
 * Importing again updates what came in last time instead of adding copies:
 * everything is matched on `sourceKey` ("brewmanager:<id>" from the backup;
 * "brewmanager:recipe:<id>", "brewmanager:dev:<id>", "brewmanager:sched:<id>"
 * from the app data; a recipe's two keys are the same recipe).
 */

const D = (n: number, places: number) => new Prisma.Decimal(n.toFixed(places));
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const day = (iso: string | null) => (iso ? parseISODate(iso) : null);
const asObj = (v: unknown): Prisma.JsonObject => (v && typeof v === "object" && !Array.isArray(v) ? (v as Prisma.JsonObject) : {});
/** Note on tanks the backup import made up (size guessed from the brews). */
const GUESSED_TANK_NOTE = "Added by the Brew Manager import. Check its size.";

export interface AppImportOptions {
  includePast: boolean;
  /** Schedule name → recipe choice ("file:<sourceKey>" | "ops:<id>"), for names with no recipe found */
  picks: Record<string, string>;
}

export type AnyImportPreview = (ImportPreview & { kind: "backup" }) | AppImportPreview;

export async function previewBrewManagerImport(json: unknown, opts: AppImportOptions = { includePast: false, picks: {} }): Promise<{ error: string } | { preview: AnyImportPreview }> {
  const kind = detectBrewManagerFile(json);
  if (kind === "app") {
    const mapped = mapAppData(json);
    if (!mapped.ok) return { error: mapped.error };
    return { preview: previewAppData(mapped.data, await appContext(mapped.data, opts)) };
  }
  const mapped = mapBackup(json);
  if (!mapped.ok) return { error: mapped.error };
  const d = mapped.data;
  const [beers, recipes, batches, tanks] = await Promise.all([
    db.beer.findMany({ select: { id: true, name: true } }),
    db.brewRecipe.findMany({ where: { sourceKey: { in: d.recipes.flatMap((r) => recipeKeyAliases(r.sourceKey)) } }, select: { sourceKey: true } }),
    db.brewBatch.findMany({ where: { sourceKey: { in: d.batches.map((b) => b.sourceKey) } }, select: { sourceKey: true } }),
    db.tank.findMany({ select: { name: true } }),
  ]);
  // A recipe brought in from the app data counts as already here.
  const existingRecipeKeys = recipes.flatMap((r) => recipeKeyAliases(r.sourceKey!));
  return { preview: { kind: "backup", ...previewBackup(d, { beers, existingRecipeKeys, existingBatchKeys: batches.map((b) => b.sourceKey!), tanks }) } };
}

export interface BrewImportResult {
  kind: "backup";
  recipesCreated: number;
  recipesUpdated: number;
  batchesCreated: number;
  batchesUpdated: number;
  stays: number;
  tanksCreated: string[];
  linkedBeers: number;
  unmatchedRecipes: string[];
  unmatchedBrews: string[];
  /** Recipe lines linked to ingredients after the import (null if that failed: Link them on Recipes) */
  links: LinkSummary | null;
}

export interface AppImportResult {
  kind: "app";
  recipesCreated: number;
  recipesUpdated: number;
  devCreated: number;
  devUpdated: number;
  tanksCreated: string[];
  tanksUpdated: string[];
  suppliersCreated: string[];
  suppliersUpdated: string[];
  plannedCreated: number;
  plannedUpdated: number;
  /** Brewed in Ops since the last import: left alone */
  plannedLeft: number;
  /** Planned brews put in tanks on the schedule, and those no tank was free for */
  placed: number;
  notPlaced: string[];
  /** Recipes that got a timing profile from the schedule */
  profilesSet: string[];
  linkedBeers: number;
  firstPlanned: ISODate | null;
  /** Recipe lines linked to ingredients after the import (null if that failed: Link them on Recipes) */
  links: LinkSummary | null;
}

export type AnyImportResult = BrewImportResult | AppImportResult;

export async function runBrewManagerImport(json: unknown, opts: AppImportOptions = { includePast: false, picks: {} }): Promise<{ error: string } | { result: AnyImportResult }> {
  const kind = detectBrewManagerFile(json);
  if (kind === "app") {
    const mapped = mapAppData(json);
    if (!mapped.ok) return { error: mapped.error };
    const { recipeIds, ...result } = await runAppImport(mapped.data, opts);
    return { result: { ...result, links: await linkAfterImport(recipeIds) } };
  }
  const mapped = mapBackup(json);
  if (!mapped.ok) return { error: mapped.error };
  if (!mapped.data.recipes.length && !mapped.data.batches.length) return { error: "There's nothing to import in this file." };
  const { recipeIds, ...result } = await runBackupImport(mapped.data);
  return { result: { ...result, links: await linkAfterImport(recipeIds) } };
}

/** Link the imported recipes' lines to ingredients. The import is already saved, so a failure here only leaves the lines for the Link them button on Recipes. */
async function linkAfterImport(recipeIds: string[]): Promise<LinkSummary | null> {
  try {
    return await linkBrewIngredients({ recipeIds });
  } catch (e) {
    console.error("Linking imported recipe lines to ingredients failed", e);
    return null;
  }
}

// ---- Recipes (both files) ----------------------------------------------------------------

type Tx = Prisma.TransactionClient;
type LineCarry = { ingredientId: string | null; potentialPpg: Prisma.Decimal | null; colorL: Prisma.Decimal | null; alphaPct: Prisma.Decimal | null; attenuationPct: Prisma.Decimal | null; minutes: number | null };
type RecipeRef = { id: string; beerId: string | null; name: string; profile: string | null; batchBbl: number; fermentDays: number; conditionDays: number };

interface RecipeUpsert {
  created: number;
  updated: number;
  devCreated: number;
  devUpdated: number;
  linkedBeers: number;
  unmatched: string[];
  /** By the file's sourceKey */
  bySource: Map<string, RecipeRef>;
}

const recipeSelect = { id: true, name: true, sourceKey: true, beerId: true, status: true, batchBbl: true, boilMinutes: true, extra: true, lines: true, targetMt: true, targetBk: true, targetKo: true, strikeF: true, mashF: true, mashMinutes: true, artworkDone: true, profile: true, fermentDays: true, conditionDays: true } as const;

async function upsertRecipes(tx: Tx, recipes: MappedRecipe[], beers: { id: string; name: string }[], loose: boolean): Promise<RecipeUpsert> {
  const [ingredients, allRecipes] = await Promise.all([
    tx.ingredient.findMany({ where: { active: true }, select: { id: true, name: true } }),
    tx.brewRecipe.findMany({ select: recipeSelect }),
  ]);
  const ingByName = new Map(ingredients.map((i) => [norm(i.name), i.id]));
  const recipeBySource = new Map(allRecipes.filter((r) => r.sourceKey).map((r) => [r.sourceKey!, r]));
  const takenNames = new Map(allRecipes.map((r) => [norm(r.name), r.id]));
  const out: RecipeUpsert = { created: 0, updated: 0, devCreated: 0, devUpdated: 0, linkedBeers: 0, unmatched: [], bySource: new Map() };
  const findBeer = (name: string) => (loose ? (matchName(name, beers)?.item ?? null) : matchBeer(name, beers));

  for (const r of recipes) {
    // The same recipe from the other file has the other key: update that one.
    const existing = recipeKeyAliases(r.sourceKey).map((k) => recipeBySource.get(k)).find(Boolean);
    const beer = findBeer(r.name);
    if (beer) out.linkedBeers++;
    else if (r.status !== "dev") out.unmatched.push(r.name);

    // A different recipe already uses the name: keep both, marking this one.
    let name = r.name;
    const owner = takenNames.get(norm(name));
    if (owner && owner !== existing?.id) {
      name = `${r.name} (Brew Manager)`;
      if (takenNames.has(norm(name)) && takenNames.get(norm(name)) !== existing?.id) name = `${r.name} (Brew Manager ${r.sourceKey.split(":").pop()})`;
    }

    // Keep what was added in Ops on the last import's lines (ingredient matches, extract, colour, alpha).
    const carry = new Map<string, LineCarry>();
    for (const l of existing?.lines ?? []) carry.set(`${l.kind}|${norm(l.name)}`, l);
    const lines = r.lines.map((l, i) => {
      const c = carry.get(`${l.kind}|${norm(l.name)}`);
      return {
        kind: l.kind,
        name: l.name.slice(0, 160),
        ingredientId: c?.ingredientId ?? ingByName.get(norm(l.name)) ?? null,
        qty: D(l.qty, 4),
        unit: l.unit,
        potentialPpg: c?.potentialPpg ?? null,
        colorL: c?.colorL ?? null,
        alphaPct: c?.alphaPct ?? null,
        use: l.use,
        minutes: l.minutes ?? (l.kind === "hop" && l.use === "dryhop" ? (c?.minutes ?? null) : null),
        attenuationPct: c?.attenuationPct ?? null,
        sort: i,
      };
    });
    const dec = (v: number | null, places: number, cur: Prisma.Decimal | null | undefined) => (v != null ? D(v, places) : (cur ?? null));
    const data = {
      name,
      style: r.style,
      batchBbl: r.batchBbl != null ? D(r.batchBbl, 2) : (existing?.batchBbl ?? D(7, 2)),
      boilMinutes: r.boilMinutes ?? existing?.boilMinutes ?? 60,
      targetOg: r.targetOg == null ? null : D(r.targetOg, 4),
      targetFg: r.targetFg == null ? null : D(r.targetFg, 4),
      // Brew-day targets: what Brew Manager has, else what's already here.
      targetMt: dec(r.targetMt, 4, existing?.targetMt),
      targetBk: dec(r.targetBk, 4, existing?.targetBk),
      targetKo: dec(r.targetKo, 4, existing?.targetKo),
      strikeF: dec(r.strikeF, 1, existing?.strikeF),
      mashF: dec(r.mashF, 1, existing?.mashF),
      mashMinutes: r.mashMinutes ?? existing?.mashMinutes ?? null,
      artworkDone: (existing?.artworkDone ?? false) || r.artworkDone === true,
      notes: r.notes,
      extra: { ...asObj(existing?.extra), ...r.extra } as Prisma.InputJsonValue,
    };
    let ref: RecipeRef;
    if (existing) {
      await tx.brewRecipeLine.deleteMany({ where: { recipeId: existing.id } });
      // Only an archive in Brew Manager changes the status here, so "in development" or "live" set in Ops sticks.
      const saved = await tx.brewRecipe.update({
        where: { id: existing.id },
        data: { ...data, status: r.status === "archived" ? "archived" : existing.status, beerId: existing.beerId ?? beer?.id ?? null, lines: { create: lines } },
      });
      if (norm(existing.name) !== norm(name)) takenNames.delete(norm(existing.name));
      takenNames.set(norm(name), existing.id);
      ref = { id: saved.id, beerId: saved.beerId, name: saved.name, profile: saved.profile, batchBbl: saved.batchBbl.toNumber(), fermentDays: saved.fermentDays, conditionDays: saved.conditionDays };
      if (r.status === "dev") out.devUpdated++;
      else out.updated++;
    } else {
      const created = await tx.brewRecipe.create({ data: { ...data, status: r.status, sourceKey: r.sourceKey, beerId: beer?.id ?? null, lines: { create: lines } } });
      takenNames.set(norm(name), created.id);
      ref = { id: created.id, beerId: created.beerId, name: created.name, profile: created.profile, batchBbl: created.batchBbl.toNumber(), fermentDays: created.fermentDays, conditionDays: created.conditionDays };
      if (r.status === "dev") out.devCreated++;
      else out.created++;
    }
    out.bySource.set(r.sourceKey, ref);
  }
  return out;
}

// ---- The backup ---------------------------------------------------------------------------

async function runBackupImport(d: MappedBackup): Promise<BrewImportResult & { recipeIds: string[] }> {
  return db.$transaction(
    async (tx) => {
      const [beers, tanks, codes] = await Promise.all([
        tx.beer.findMany({ select: { id: true, name: true } }),
        tx.tank.findMany({ select: { id: true, name: true, sort: true } }),
        tx.brewBatch.findMany({ select: { code: true, sourceKey: true } }),
      ]);
      const recipes = await upsertRecipes(tx, d.recipes, beers, false);
      const out: BrewImportResult & { recipeIds: string[] } = {
        kind: "backup",
        recipeIds: [...new Set([...recipes.bySource.values()].map((r) => r.id))],
        links: null,
        recipesCreated: recipes.created,
        recipesUpdated: recipes.updated,
        batchesCreated: 0,
        batchesUpdated: 0,
        stays: 0,
        tanksCreated: [],
        linkedBeers: recipes.linkedBeers,
        unmatchedRecipes: recipes.unmatched,
        unmatchedBrews: [],
      };
      // Brews point at the backup's recipe keys; a recipe from the app data has the other key.
      const recipeFor = async (key: string | null) => {
        if (!key) return undefined;
        const hit = recipes.bySource.get(key);
        if (hit) return hit;
        const r = await tx.brewRecipe.findFirst({ where: { sourceKey: { in: recipeKeyAliases(key) } }, select: { id: true, beerId: true } });
        return r ?? undefined;
      };

      // ---- Tanks the brews sat in
      const tankId = new Map(tanks.map((t) => [norm(t.name), t.id]));
      let sort = tanks.reduce((m, t) => Math.max(m, t.sort), 0);
      for (const t of tanksFromBackup(d)) {
        if (tankId.has(norm(t.name))) continue;
        const created = await tx.tank.create({ data: { name: t.name, kind: t.kind, capacityBbl: D(t.capacityBbl ?? 7, 2), sort: ++sort, notes: GUESSED_TANK_NOTE } });
        tankId.set(norm(t.name), created.id);
        out.tanksCreated.push(t.name);
      }

      // ---- Brews and their time in each tank
      const usedCodes = new Set(codes.map((c) => c.code));
      const batchBySource = new Map(codes.filter((c) => c.sourceKey).map((c) => [c.sourceKey!, c.code]));
      const existingBatches = new Map(
        (await tx.brewBatch.findMany({ where: { sourceKey: { in: d.batches.map((b) => b.sourceKey) } }, select: { id: true, sourceKey: true, extra: true, brewLog: true } })).map((b) => [b.sourceKey!, b]),
      );
      for (const b of d.batches) {
        const recipe = await recipeFor(b.recipeSourceKey);
        const beer = matchBeer(b.beerName, beers);
        if (!beer && !recipe?.beerId) out.unmatchedBrews.push(b.beerName);
        const existing = existingBatches.get(b.sourceKey);
        const data = {
          recipeId: recipe?.id ?? null,
          beerId: beer?.id ?? recipe?.beerId ?? null,
          status: b.status,
          plannedOn: day(b.plannedOn),
          brewedOn: day(b.brewedOn),
          packagedOn: day(b.packagedOn),
          bbl: b.bbl == null ? null : D(b.bbl, 2),
          og: b.og == null ? null : D(b.og, 4),
          fg: b.fg == null ? null : D(b.fg, 4),
          halfKegs: b.halfKegs,
          sixthKegs: b.sixthKegs,
          cases: b.cases,
          co2Vols: b.co2Vols == null ? null : D(b.co2Vols, 2),
          notes: b.notes,
          extra: { ...asObj(existing?.extra), ...b.extra, style: b.style } as Prisma.InputJsonValue,
          // A brew-day log written in Ops is never replaced by Brew Manager's.
          ...(b.brewLog && !existing?.brewLog ? { brewLog: b.brewLog as unknown as Prisma.InputJsonValue } : {}),
        };
        let batchId: string;
        if (existing) {
          await tx.brewBatch.update({ where: { id: existing.id }, data });
          await tx.tankStay.deleteMany({ where: { batchId: existing.id } });
          batchId = existing.id;
          out.batchesUpdated++;
        } else {
          let code = batchBySource.get(b.sourceKey) ?? b.code;
          for (let n = 2; usedCodes.has(code); n++) code = `${b.code}-${n}`;
          usedCodes.add(code);
          batchId = (await tx.brewBatch.create({ data: { ...data, code, sourceKey: b.sourceKey } })).id;
          out.batchesCreated++;
        }
        const stays = b.stays.flatMap((s) => {
          const t = tankId.get(norm(s.tank));
          return t ? [{ tankId: t, batchId, start: parseISODate(s.start), end: day(s.end), planned: false }] : [];
        });
        if (stays.length) await tx.tankStay.createMany({ data: stays });
        out.stays += stays.length;
      }
      out.unmatchedBrews = [...new Set(out.unmatchedBrews)];
      return out;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

// ---- The app data -------------------------------------------------------------------------

async function appContext(d: MappedAppData, opts: AppImportOptions): Promise<AppImportContext> {
  const [beers, opsRecipes, batches, tanks, suppliers] = await Promise.all([
    db.beer.findMany({ select: { id: true, name: true } }),
    db.brewRecipe.findMany({ select: { id: true, name: true, sourceKey: true }, orderBy: { name: "asc" } }),
    db.brewBatch.findMany({ where: { sourceKey: { in: d.schedule.map((s) => s.sourceKey) } }, select: { sourceKey: true, status: true } }),
    db.tank.findMany({ select: { name: true, capacityBbl: true, notes: true } }),
    db.supplier.findMany({ select: { name: true } }),
  ]);
  return {
    today: businessToday(),
    includePast: opts.includePast,
    picks: opts.picks,
    beers,
    opsRecipes,
    batches: batches.map((b) => ({ sourceKey: b.sourceKey!, status: b.status })),
    tanks: tanks.map((t) => ({ name: t.name, capacityBbl: t.capacityBbl.toNumber(), guessed: (t.notes ?? "").includes(GUESSED_TANK_NOTE) })),
    suppliers,
  };
}

async function runAppImport(d: MappedAppData, opts: AppImportOptions): Promise<AppImportResult & { recipeIds: string[] }> {
  const ctx = await appContext(d, opts);
  const today = ctx.today;
  const toPlace: { id: string; name: string; brewOn: ISODate; bbl: number; fermentDays: number; conditionDays: number }[] = [];

  const out = await db.$transaction(
    async (tx) => {
      const beers = await tx.beer.findMany({ select: { id: true, name: true } });
      const res: AppImportResult & { recipeIds: string[] } = {
        kind: "app",
        recipeIds: [],
        links: null,
        recipesCreated: 0,
        recipesUpdated: 0,
        devCreated: 0,
        devUpdated: 0,
        tanksCreated: [],
        tanksUpdated: [],
        suppliersCreated: [],
        suppliersUpdated: [],
        plannedCreated: 0,
        plannedUpdated: 0,
        plannedLeft: 0,
        placed: 0,
        notPlaced: [],
        profilesSet: [],
        linkedBeers: 0,
        firstPlanned: null,
      };

      // ---- Tanks, with where each stands
      const tanks = await tx.tank.findMany({ select: { id: true, name: true, sort: true, zone: true, capacityBbl: true, notes: true } });
      const tankBy = new Map(tanks.map((t) => [norm(t.name), t]));
      let sort = tanks.reduce((m, t) => Math.max(m, t.sort), 0);
      for (const t of d.tanks) {
        const cur = tankBy.get(norm(t.name));
        if (!cur) {
          await tx.tank.create({ data: { name: t.name, kind: t.kind, capacityBbl: D(t.capacityBbl ?? 7, 2), sort: ++sort, zone: t.zone, layoutRow: t.layoutRow, layoutCol: t.layoutCol, notes: t.capacityBbl == null ? GUESSED_TANK_NOTE : null } });
          res.tanksCreated.push(t.name);
          continue;
        }
        const guessed = (cur.notes ?? "").includes(GUESSED_TANK_NOTE);
        const patch: Prisma.TankUpdateInput = {};
        if (!cur.zone && t.zone) Object.assign(patch, { zone: t.zone, layoutRow: t.layoutRow, layoutCol: t.layoutCol });
        if (guessed && t.capacityBbl != null) Object.assign(patch, { capacityBbl: D(t.capacityBbl, 2), notes: (cur.notes ?? "").replace(GUESSED_TANK_NOTE, "").trim() || null });
        if (Object.keys(patch).length) {
          await tx.tank.update({ where: { id: cur.id }, data: patch });
          res.tanksUpdated.push(cur.name);
        }
      }

      // ---- Recipes and development beers
      const recipes = await upsertRecipes(tx, d.recipes, beers, true);
      res.recipeIds = [...new Set([...recipes.bySource.values()].map((r) => r.id))];
      Object.assign(res, { recipesCreated: recipes.created, recipesUpdated: recipes.updated, devCreated: recipes.devCreated, devUpdated: recipes.devUpdated, linkedBeers: recipes.linkedBeers });

      // ---- Brewery suppliers and what their lead time counts back from
      const refs: Record<string, LeadRef> = {};
      for (const s of d.suppliers) {
        const cur = await tx.supplier.findFirst({ where: { name: { equals: s.name, mode: "insensitive" } }, select: { id: true, name: true } });
        if (cur) {
          await tx.supplier.update({ where: { id: cur.id }, data: { leadTimeDays: s.leadDays, department: "brewery" } });
          refs[cur.id] = s.ref;
          res.suppliersUpdated.push(cur.name);
        } else {
          const created = await tx.supplier.create({ data: { name: s.name, kind: "LOCAL", leadTimeDays: s.leadDays, department: "brewery", notes: "Added by the Brew Manager import." } });
          refs[created.id] = s.ref;
          res.suppliersCreated.push(s.name);
        }
      }
      if (Object.keys(refs).length) {
        const cur = await tx.setting.findUnique({ where: { key: LEAD_REFS_KEY } });
        let merged: Record<string, unknown> = {};
        try {
          merged = asObj(cur ? JSON.parse(cur.value) : {});
        } catch {
          merged = {};
        }
        const value = JSON.stringify({ ...merged, ...refs });
        await tx.setting.upsert({ where: { key: LEAD_REFS_KEY }, create: { key: LEAD_REFS_KEY, value }, update: { value } });
      }

      // ---- The schedule: planned brews
      const rows = resolveSchedule(d, ctx);
      const bySource = new Map(d.schedule.map((s) => [s.sourceKey, s]));
      const existing = new Map((await tx.brewBatch.findMany({ where: { sourceKey: { in: d.schedule.map((s) => s.sourceKey) } }, select: { id: true, sourceKey: true, status: true, plannedOn: true, extra: true, stays: { select: { id: true } } } })).map((b) => [b.sourceKey!, b]));
      const codes = (await tx.brewBatch.findMany({ select: { code: true } })).map((c) => c.code);
      const opsRecipe = new Map<string, RecipeRef>();
      const recipeOf = async (ref: string | null): Promise<RecipeRef | null> => {
        if (!ref) return null;
        if (ref.startsWith("file:")) return recipes.bySource.get(ref.slice(5)) ?? null;
        if (!ref.startsWith("ops:")) return null;
        const id = ref.slice(4);
        if (!opsRecipe.has(id)) {
          const r = await tx.brewRecipe.findUnique({ where: { id }, select: { id: true, beerId: true, name: true, profile: true, batchBbl: true, fermentDays: true, conditionDays: true } });
          if (!r) return null;
          opsRecipe.set(id, { ...r, batchBbl: r.batchBbl.toNumber() });
        }
        return opsRecipe.get(id)!;
      };
      const profiled = new Set<string>();
      for (const row of rows) {
        const s = bySource.get(row.sourceKey)!;
        const cur = existing.get(row.sourceKey);
        if (row.state === "brewed") {
          res.plannedLeft++;
          continue;
        }
        if (!row.included) continue;
        const recipe = await recipeOf(row.recipeRef);
        const beerId = recipe?.beerId ?? (matchName(s.beerName, beers)?.item.id ?? null);
        const f = s.forecast;
        const bm = { id: row.sourceKey.split(":").pop(), beer: s.beerName, style: s.style, abv: s.abv, profile: s.profile, forecast: f };
        const data = {
          recipeId: recipe?.id ?? null,
          beerId,
          plannedOn: asDate(s.brewDate),
          dryHopOn: f?.dryHop ? asDate(f.dryHop) : null,
          tapOn: f ? asDate(f.tap) : null,
          tapLocked: s.locked,
          lockedReason: s.lockedReason,
        };
        const bbl = recipe?.batchBbl ?? 7;
        let id: string;
        let place = false;
        if (cur) {
          const moved = cur.plannedOn?.toISOString().slice(0, 10) !== s.brewDate;
          await tx.brewBatch.update({ where: { id: cur.id }, data: { ...data, extra: { ...asObj(cur.extra), brewManager: bm } as Prisma.InputJsonValue } });
          if (moved) await tx.tankStay.deleteMany({ where: { batchId: cur.id, planned: true } });
          id = cur.id;
          place = moved || cur.stays.length === 0;
          res.plannedUpdated++;
        } else {
          const code = nextBatchCode(s.brewDate, codes);
          codes.push(code);
          id = (await tx.brewBatch.create({ data: { ...data, code, status: "PLANNED", bbl: D(bbl, 2), sourceKey: row.sourceKey, extra: { brewManager: bm } as Prisma.InputJsonValue } })).id;
          place = true;
          res.plannedCreated++;
        }
        if (!res.firstPlanned || s.brewDate < res.firstPlanned) res.firstPlanned = s.brewDate;
        // A recipe with no timing profile takes the one its brews are scheduled under.
        if (recipe && !recipe.profile && s.profile && isProfileKey(s.profile) && !profiled.has(recipe.id)) {
          const pd = profileDays(d.profiles[s.profile]);
          await tx.brewRecipe.update({ where: { id: recipe.id }, data: { profile: s.profile, dryHopDay: pd.dryHopDay, tapDay: pd.tapDay, fermentDays: pd.fermentDays, conditionDays: pd.conditionDays } });
          recipe.profile = s.profile;
          recipe.fermentDays = pd.fermentDays;
          recipe.conditionDays = pd.conditionDays;
          profiled.add(recipe.id);
          res.profilesSet.push(recipe.name);
        }
        // Past brews are a record of what was planned: no tanks for them.
        if (place && s.brewDate >= today) {
          toPlace.push({
            id,
            name: `${s.beerName} on ${s.brewDate}`,
            brewOn: s.brewDate,
            bbl,
            fermentDays: f ? Math.max(1, daysBetween(s.brewDate, f.brite)) : (recipe?.fermentDays ?? 14),
            conditionDays: f ? Math.max(0, daysBetween(f.brite, f.pkg)) : (recipe?.conditionDays ?? 7),
          });
        }
      }
      return res;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  // ---- Tanks for the planned brews, in date order, each around the ones before it.
  if (toPlace.length) {
    const plan = await loadPlan(today, 30);
    const busy = stayIntervals(plan.stays, plan.tanks, plan.planBatches, today)
      .filter((x) => !toPlace.some((p) => p.id === x.batchId))
      .map((x) => ({ tankId: x.tankId, start: x.start, end: x.end }));
    for (const p of toPlace.sort((a, b) => a.brewOn.localeCompare(b.brewOn))) {
      const fit = planBrew({ brewOn: p.brewOn, bbl: p.bbl, fermentDays: p.fermentDays, conditionDays: p.conditionDays, tanks: plan.tanks, busy });
      if (!fit.ok) {
        out.notPlaced.push(p.name);
        continue;
      }
      const stays = [
        { tankId: fit.fermenter.tankId, batchId: p.id, start: asDate(fit.fermenter.start), end: asDate(fit.fermenter.end), planned: true },
        ...(fit.brite ? [{ tankId: fit.brite.tankId, batchId: p.id, start: asDate(fit.brite.start), end: asDate(fit.brite.end), planned: true }] : []),
      ];
      await db.tankStay.createMany({ data: stays });
      busy.push({ tankId: fit.fermenter.tankId, start: fit.fermenter.start, end: fit.fermenter.end });
      if (fit.brite) busy.push({ tankId: fit.brite.tankId, start: fit.brite.start, end: fit.brite.end });
      out.placed++;
    }
  }
  return out;
}
