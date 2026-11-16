import "server-only";
import { Prisma } from "@prisma/client";
import { mapBackup, matchBeer, previewBackup, tanksFromBackup, type ImportPreview, type MappedBackup } from "@/domain/brewImport";
import { parseISODate } from "@/domain/dates";
import { db } from "../db";

/**
 * Import from Brew Manager's backup file. Re-importing the same file (or a
 * newer one) updates what came in last time instead of adding copies: recipes
 * and brews are matched on `sourceKey` = "brewmanager:<their id>".
 */

const D = (n: number, places: number) => new Prisma.Decimal(n.toFixed(places));
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const day = (iso: string | null) => (iso ? parseISODate(iso) : null);

export async function previewBrewManagerImport(json: unknown): Promise<{ error: string } | { preview: ImportPreview }> {
  const mapped = mapBackup(json);
  if (!mapped.ok) return { error: mapped.error };
  const d = mapped.data;
  const [beers, recipes, batches, tanks] = await Promise.all([
    db.beer.findMany({ select: { id: true, name: true } }),
    db.brewRecipe.findMany({ where: { sourceKey: { in: d.recipes.map((r) => r.sourceKey) } }, select: { sourceKey: true } }),
    db.brewBatch.findMany({ where: { sourceKey: { in: d.batches.map((b) => b.sourceKey) } }, select: { sourceKey: true } }),
    db.tank.findMany({ select: { name: true } }),
  ]);
  return {
    preview: previewBackup(d, {
      beers,
      existingRecipeKeys: recipes.map((r) => r.sourceKey!),
      existingBatchKeys: batches.map((b) => b.sourceKey!),
      tanks,
    }),
  };
}

export interface BrewImportResult {
  recipesCreated: number;
  recipesUpdated: number;
  batchesCreated: number;
  batchesUpdated: number;
  stays: number;
  tanksCreated: string[];
  linkedBeers: number;
  unmatchedRecipes: string[];
  unmatchedBrews: string[];
}

type LineCarry = { ingredientId: string | null; potentialPpg: Prisma.Decimal | null; colorL: Prisma.Decimal | null; alphaPct: Prisma.Decimal | null; attenuationPct: Prisma.Decimal | null; minutes: number | null };

export async function runBrewManagerImport(json: unknown): Promise<{ error: string } | { result: BrewImportResult }> {
  const mapped = mapBackup(json);
  if (!mapped.ok) return { error: mapped.error };
  const d: MappedBackup = mapped.data;
  if (!d.recipes.length && !d.batches.length) return { error: "There's nothing to import in this file." };

  const result = await db.$transaction(
    async (tx) => {
      const [beers, ingredients, allRecipes, tanks, codes] = await Promise.all([
        tx.beer.findMany({ select: { id: true, name: true } }),
        tx.ingredient.findMany({ where: { active: true }, select: { id: true, name: true } }),
        tx.brewRecipe.findMany({ select: { id: true, name: true, sourceKey: true, beerId: true, status: true, batchBbl: true, boilMinutes: true, extra: true, lines: true } }),
        tx.tank.findMany({ select: { id: true, name: true, sort: true } }),
        tx.brewBatch.findMany({ select: { code: true, sourceKey: true } }),
      ]);
      const ingByName = new Map(ingredients.map((i) => [norm(i.name), i.id]));
      const recipeBySource = new Map(allRecipes.filter((r) => r.sourceKey).map((r) => [r.sourceKey!, r]));
      const takenNames = new Map(allRecipes.map((r) => [norm(r.name), r.id]));
      const out: BrewImportResult = { recipesCreated: 0, recipesUpdated: 0, batchesCreated: 0, batchesUpdated: 0, stays: 0, tanksCreated: [], linkedBeers: 0, unmatchedRecipes: [], unmatchedBrews: [] };

      // ---- Recipes
      const recipeIdBySource = new Map<string, { id: string; beerId: string | null }>();
      for (const [k, r] of recipeBySource) recipeIdBySource.set(k, { id: r.id, beerId: r.beerId });
      for (const r of d.recipes) {
        const existing = recipeBySource.get(r.sourceKey);
        const beer = matchBeer(r.name, beers);
        if (beer) out.linkedBeers++;
        else out.unmatchedRecipes.push(r.name);

        // A different recipe already uses the name: keep both, marking this one.
        let name = r.name;
        const owner = takenNames.get(norm(name));
        if (owner && owner !== existing?.id) {
          name = `${r.name} (Brew Manager)`;
          if (takenNames.has(norm(name)) && takenNames.get(norm(name)) !== existing?.id) name = `${r.name} (Brew Manager ${r.sourceKey.split(":")[1]})`;
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
        const data = {
          name,
          style: r.style,
          batchBbl: r.batchBbl != null ? D(r.batchBbl, 2) : (existing?.batchBbl ?? D(7, 2)),
          boilMinutes: r.boilMinutes ?? existing?.boilMinutes ?? 60,
          targetOg: r.targetOg == null ? null : D(r.targetOg, 3),
          targetFg: r.targetFg == null ? null : D(r.targetFg, 3),
          notes: r.notes,
          extra: { ...(existing?.extra && typeof existing.extra === "object" && !Array.isArray(existing.extra) ? (existing.extra as Prisma.JsonObject) : {}), ...r.extra } as Prisma.InputJsonValue,
        };
        if (existing) {
          await tx.brewRecipeLine.deleteMany({ where: { recipeId: existing.id } });
          await tx.brewRecipe.update({
            where: { id: existing.id },
            // Only an archive in Brew Manager changes the status here, so "in development" in Ops sticks.
            data: { ...data, status: r.status === "archived" ? "archived" : existing.status, beerId: existing.beerId ?? beer?.id ?? null, lines: { create: lines } },
          });
          if (norm(existing.name) !== norm(name)) takenNames.delete(norm(existing.name));
          takenNames.set(norm(name), existing.id);
          recipeIdBySource.set(r.sourceKey, { id: existing.id, beerId: existing.beerId ?? beer?.id ?? null });
          out.recipesUpdated++;
        } else {
          const created = await tx.brewRecipe.create({ data: { ...data, status: r.status, sourceKey: r.sourceKey, beerId: beer?.id ?? null, lines: { create: lines } } });
          takenNames.set(norm(name), created.id);
          recipeIdBySource.set(r.sourceKey, { id: created.id, beerId: created.beerId });
          out.recipesCreated++;
        }
      }

      // ---- Tanks the brews sat in
      const tankId = new Map(tanks.map((t) => [norm(t.name), t.id]));
      let sort = tanks.reduce((m, t) => Math.max(m, t.sort), 0);
      for (const t of tanksFromBackup(d)) {
        if (tankId.has(norm(t.name))) continue;
        const created = await tx.tank.create({ data: { name: t.name, kind: t.kind, capacityBbl: D(t.capacityBbl ?? 7, 2), sort: ++sort, notes: "Added by the Brew Manager import. Check its size." } });
        tankId.set(norm(t.name), created.id);
        out.tanksCreated.push(t.name);
      }

      // ---- Brews and their time in each tank
      const usedCodes = new Set(codes.map((c) => c.code));
      const batchBySource = new Map(codes.filter((c) => c.sourceKey).map((c) => [c.sourceKey!, c.code]));
      const existingBatches = new Map((await tx.brewBatch.findMany({ where: { sourceKey: { in: d.batches.map((b) => b.sourceKey) } }, select: { id: true, sourceKey: true, extra: true } })).map((b) => [b.sourceKey!, b]));
      for (const b of d.batches) {
        const recipe = b.recipeSourceKey ? recipeIdBySource.get(b.recipeSourceKey) : undefined;
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
          og: b.og == null ? null : D(b.og, 3),
          fg: b.fg == null ? null : D(b.fg, 3),
          notes: b.notes,
          extra: { ...(existing?.extra && typeof existing.extra === "object" && !Array.isArray(existing.extra) ? (existing.extra as Prisma.JsonObject) : {}), ...b.extra, style: b.style } as Prisma.InputJsonValue,
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
  return { result };
}
