/**
 * Brew Manager backup → Ops brewing recipes, brews and tank stays.
 *
 * Brew Manager (the head brewer's own app) writes a backup from
 * Settings → Backup → Export backup JSON: `{ recipes, batches, exportedAt }`.
 * Only recipes and batches are in it (not its schedule, development beers or stock).
 *
 * Recipe: { id, name, style, batch ("7-8" bbl), abv, boilTime ("1hr"), strike, mashTemp,
 *   mashDur, mtP, bkP, koP, ogP, fgP (gravity targets in °Plato), archived?,
 *   grains: [{ o: maltster, t: malt, a: "750lb" }],
 *   hops: [{ n: variety, s: supplier, a: "2lb", ti: "60 min" | "KO" | "DH" | "Whirlpool", ty: "bittering" | "aroma" | "dry hop" }],
 *   yeastSup, yeastStrain, yeastAmt, notes }
 * Batch: { id, beer, style, currentTank, tankPath ("FV2 → FV4 → BBT1"), brewDate, vol (bbl),
 *   og, fg, targetFg (°P), yeast, notes, status ("brewing" | "fermenting" | "conditioning" |
 *   "brite" | "packaged"), gravReadings, timeline [{ ev, date, note }], brite, briteDate,
 *   pkgDate, pkgHalf, pkgSixth, pkgCans, pkgCo2, pkgNotes, recipe (a copy, or null),
 *   brewLog, forecast, abvOverride }
 *
 * Everything is optional here: a missing field is left empty, never guessed silently.
 */

import { brewUnit, type BrewLineKind, type BrewUnit, type HopUse } from "./brewMath";
import { standardUnit } from "./units";

export const SOURCE_PREFIX = "brewmanager:";
/** Largest backup file the import accepts */
export const MAX_BACKUP_BYTES = 5_000_000;

export type ImportBrewStatus = "PLANNED" | "FERMENTING" | "CONDITIONING" | "PACKAGED" | "DUMPED";
export type ImportTankKind = "FERMENTER" | "BRITE" | "OTHER";
type ISODate = string;

export interface MappedLine {
  kind: BrewLineKind;
  name: string;
  qty: number;
  unit: BrewUnit;
  use: HopUse | null;
  minutes: number | null;
  /** The amount as written, when it couldn't be read */
  raw: string | null;
}

export interface MappedRecipe {
  sourceKey: string;
  name: string;
  style: string | null;
  status: "live" | "archived";
  batchBbl: number | null;
  boilMinutes: number | null;
  targetOg: number | null;
  targetFg: number | null;
  notes: string | null;
  extra: { brewManager: Record<string, unknown> };
  lines: MappedLine[];
}

export interface MappedStay {
  tank: string;
  start: ISODate;
  end: ISODate | null;
}

export interface MappedBatch {
  sourceKey: string;
  code: string;
  beerName: string;
  style: string | null;
  recipeSourceKey: string | null;
  status: ImportBrewStatus;
  brewedOn: ISODate | null;
  packagedOn: ISODate | null;
  plannedOn: ISODate | null;
  bbl: number | null;
  og: number | null;
  fg: number | null;
  notes: string | null;
  extra: { brewManager: Record<string, unknown> };
  stays: MappedStay[];
}

export interface MappedBackup {
  recipes: MappedRecipe[];
  batches: MappedBatch[];
  exportedAt: string | null;
  warnings: string[];
  /** Amounts that couldn't be read, as written */
  unknownUnits: string[];
}

// ---- Small readers ------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const strOrNull = (v: unknown) => str(v) || null;
const numOf = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v).replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

const RANGE = /^(\d+(?:\.\d+)?)\s*(?:[-–]|to)\s*(\d+(?:\.\d+)?)$/i;

/** "770lb", "5.5 lbs", "400-700lb" (midpoint), "500g", "2 pouches", "1 cup" (→ ml). Null when it can't be read. */
export function parseAmount(text: string): { qty: number; unit: BrewUnit; range: boolean } | null {
  const m = /^\s*(\d+(?:\.\d+)?)(?:\s*(?:[-–]|to)\s*(\d+(?:\.\d+)?))?\s*([a-zA-Z#][a-zA-Z .]*?)\s*$/.exec(text ?? "");
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  const qty = (lo + hi) / 2;
  const range = hi !== lo;
  const unitText = m[3].trim();
  const u = brewUnit(unitText);
  if (u) return { qty, unit: u, range };
  // Kitchen measures: cups, tablespoons, quarts… become ml (or g).
  const s = standardUnit(unitText);
  if (s && s.base !== "each") return { qty: round(qty * s.factor), unit: s.base === "g" ? "g" : "ml", range };
  return null;
}

/** °Plato → specific gravity: SG = 1 + P ÷ (258.6 − (P ÷ 258.2 × 227.1)). Null when empty or not positive. */
export function platoToSg(p: unknown): number | null {
  const n = numOf(p);
  if (n == null || !(n > 0) || n > 60) return null;
  return 1 + n / (258.6 - (n / 258.2) * 227.1);
}

/** "8", "7-8" (midpoint), 9 → barrels. */
export function parseBbl(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const s = str(v).replace(/bbl|barrels?/i, "").trim();
  const r = RANGE.exec(s);
  if (r) return (Number(r[1]) + Number(r[2])) / 2;
  const n = numOf(s);
  return n != null && n > 0 ? n : null;
}

/** "1hr", "1.5hr", "60min", "90" → minutes. */
export function parseBoilMinutes(v: unknown): number | null {
  const s = str(v).toLowerCase();
  if (!s) return null;
  const h = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/.exec(s);
  if (h) return Math.round(Number(h[1]) * 60);
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  return m ? Math.round(Number(m[1])) : null;
}

/** When a hop goes in, from Brew Manager's time ("60 min", "KO", "DH", "Whirlpool") and type ("bittering", "aroma", "dry hop"). */
export function hopTiming(ti: string, ty: string, boilMinutes: number): { use: HopUse; minutes: number | null; guessed: boolean } {
  const t = (ti ?? "").trim();
  const y = (ty ?? "").trim().toLowerCase();
  if (/\bdh\b|dry|\bfv\b/i.test(t) || (!t && /dry/.test(y))) return { use: "dryhop", minutes: null, guessed: false };
  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour)\b/i.exec(t);
  if (hours) return { use: "boil", minutes: Math.round(Number(hours[1]) * 60), guessed: false };
  const range = /(\d+)\s*[-–]\s*(\d+)\s*min/i.exec(t);
  if (range) return { use: "boil", minutes: Math.round((Number(range[1]) + Number(range[2])) / 2), guessed: false };
  if (/whirl|\bwp\b|\bko\b|knock|flame/i.test(t)) {
    const m = /(\d+)\s*min/i.exec(t);
    return { use: "whirlpool", minutes: m ? Number(m[1]) : null, guessed: false };
  }
  if (/first\s*wort|fwh/i.test(t)) return { use: "firstwort", minutes: null, guessed: false };
  if (/mash/i.test(t)) return { use: "mash", minutes: null, guessed: false };
  const min = /(\d+)\s*(?:m|min|mins|minutes)?\b/i.exec(t);
  if (min) return { use: "boil", minutes: Number(min[1]), guessed: false };
  if (/boil/i.test(t) || /bitter/.test(y)) return { use: "boil", minutes: boilMinutes, guessed: false };
  if (/aroma|flavou?r|whirl/.test(y)) return { use: "whirlpool", minutes: null, guessed: false };
  return { use: "boil", minutes: boilMinutes, guessed: true };
}

export function tankKind(name: string): ImportTankKind {
  if (/^\s*fv|ferment/i.test(name)) return "FERMENTER";
  if (/^\s*b?bt|brite|bright/i.test(name)) return "BRITE";
  return "OTHER";
}

/** Brew Manager stage → Ops brew status. "conditioning" is still in the fermenter there; "brite" is in a brite tank. */
export function brewStatusFor(status: string): ImportBrewStatus | null {
  switch ((status ?? "").trim().toLowerCase()) {
    case "brewing":
    case "fermenting":
    case "conditioning":
      return "FERMENTING";
    case "brite":
    case "ready":
      return "CONDITIONING";
    case "packaged":
      return "PACKAGED";
    default:
      return null;
  }
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function matchBeer<T extends { name: string }>(name: string, beers: T[]): T | null {
  const n = norm(name ?? "");
  if (!n) return null;
  return beers.find((b) => norm(b.name) === n) ?? null;
}

function isoDate(v: unknown): ISODate | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = str(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}` ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

// ---- Recipes ------------------------------------------------------------------------

function mapRecipe(r: Obj, warnings: string[], unknown: Set<string>): Omit<MappedRecipe, "name"> & { name: string } | null {
  const name = str(r.name);
  const id = str(r.id);
  if (!name || !id) {
    warnings.push(name ? `Recipe "${name}" has no id, so it was skipped.` : "A recipe with no name was skipped.");
    return null;
  }
  const boil = parseBoilMinutes(r.boilTime);
  const lines: MappedLine[] = [];
  const amount = (text: unknown, what: string, fallback: BrewUnit): { qty: number; unit: BrewUnit; raw: string | null } => {
    const raw = str(text);
    if (!raw) {
      warnings.push(`${name}: ${what} has no amount.`);
      return { qty: 0, unit: fallback, raw: null };
    }
    const a = parseAmount(raw);
    if (!a) {
      unknown.add(raw);
      warnings.push(`${name}: couldn't read "${raw}" for ${what}; it's in as 0 to fill in.`);
      return { qty: 0, unit: fallback, raw };
    }
    if (a.range) warnings.push(`${name}: ${what} is a range ("${raw}"); the middle, ${round(a.qty, 2)} ${a.unit}, is used.`);
    return { qty: round(a.qty), unit: a.unit, raw: null };
  };

  for (const g of Array.isArray(r.grains) ? r.grains : []) {
    if (!isObj(g)) continue;
    const malt = str(g.t);
    if (!malt) continue;
    const maltster = str(g.o);
    const lineName = maltster ? `${malt}, ${maltster}` : malt;
    lines.push({ kind: "grain", name: lineName, ...amount(g.a, lineName, "lb"), use: null, minutes: null });
  }
  for (const h of Array.isArray(r.hops) ? r.hops : []) {
    if (!isObj(h)) continue;
    const variety = str(h.n);
    if (!variety) continue;
    const supplier = str(h.s);
    const lineName = supplier ? `${variety}, ${supplier}` : variety;
    const a = amount(h.a, lineName, "lb");
    // Not a hop if it isn't weighed by weight and isn't a known hop measure: keep it as "other" (spices etc).
    const isWeight = ["lb", "oz", "kg", "g"].includes(a.unit);
    if (!isWeight && a.qty > 0) {
      lines.push({ kind: "other", name: lineName, ...a, use: null, minutes: null });
      continue;
    }
    const t = hopTiming(str(h.ti), str(h.ty), boil ?? 60);
    if (t.guessed) warnings.push(`${name}: no time for ${lineName}; counted as a full-boil addition.`);
    lines.push({ kind: "hop", name: lineName, ...a, use: t.use, minutes: t.minutes });
  }
  const strain = str(r.yeastStrain);
  if (strain) {
    const sup = str(r.yeastSup);
    const lineName = sup ? `${strain}, ${sup}` : strain;
    const rawAmt = str(r.yeastAmt);
    const a = rawAmt ? amount(rawAmt, lineName, "pkg") : { qty: 0, unit: "pkg" as BrewUnit, raw: null };
    lines.push({ kind: "yeast", name: lineName, ...a, use: null, minutes: null });
  }

  const og = platoToSg(r.ogP) ?? platoToSg(r.koP);
  return {
    sourceKey: `${SOURCE_PREFIX}${id}`,
    name: name.slice(0, 120),
    style: strOrNull(r.style),
    status: r.archived === true ? "archived" : "live",
    batchBbl: parseBbl(r.batch),
    boilMinutes: boil,
    targetOg: og == null ? null : round(og, 3),
    targetFg: platoToSg(r.fgP) == null ? null : round(platoToSg(r.fgP)!, 3),
    notes: strOrNull(r.notes),
    extra: {
      brewManager: {
        id: r.id,
        abv: str(r.abv) || null,
        batch: str(r.batch) || null,
        strike: numOf(r.strike),
        mashTemp: numOf(r.mashTemp),
        mashDur: numOf(r.mashDur),
        plato: { mt: str(r.mtP), bk: str(r.bkP), ko: str(r.koP), og: str(r.ogP), fg: str(r.fgP) },
        yeastSupplier: str(r.yeastSup) || null,
        yeastAmount: str(r.yeastAmt) || null,
      },
    },
    lines,
  };
}

// ---- Batches ------------------------------------------------------------------------

/** Each tank the batch sat in, from its tank path and the dated moves in its timeline. */
function staysFor(b: Obj, status: ImportBrewStatus, label: string, warnings: string[]): MappedStay[] {
  const path = (str(b.tankPath) || str(b.currentTank))
    .split(/→|->/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!path.length) return [];
  const brewed = isoDate(b.brewDate);
  if (!brewed) {
    warnings.push(`${label}: no brew date, so its time in ${path.join(", ")} isn't on the schedule.`);
    return [];
  }
  const moves = (Array.isArray(b.timeline) ? b.timeline : [])
    .filter(isObj)
    .filter((e) => e.ev === "transfer" || e.ev === "brite")
    .map((e) => ({ date: isoDate(e.date), dest: /(?:→|->)\s*([^\s·]+)/.exec(str(e.note))?.[1] ?? "" }))
    .filter((m): m is { date: string; dest: string } => !!m.date && !!m.dest);
  const brite = isoDate(b.briteDate);
  let briteUsed = false;
  let ptr = 0;
  const stays: MappedStay[] = [];
  path.forEach((tank, i) => {
    let start = brewed;
    if (i > 0) {
      const at = moves.findIndex((m, j) => j >= ptr && m.dest.toLowerCase() === tank.toLowerCase());
      if (at >= 0) {
        start = moves[at].date;
        ptr = at + 1;
      } else if (brite && !briteUsed && tankKind(tank) === "BRITE") {
        start = brite;
        briteUsed = true;
      } else {
        start = stays[i - 1].start;
        warnings.push(`${label}: no date for the move into ${tank}; it starts the day of the move before.`);
      }
      if (start < stays[i - 1].start) start = stays[i - 1].start;
    }
    stays.push({ tank, start, end: null });
  });
  const packaged = isoDate(b.pkgDate);
  stays.forEach((s, i) => {
    const next = stays[i + 1];
    if (next) s.end = next.start;
    else if (status === "PACKAGED") s.end = packaged && packaged >= s.start ? packaged : s.start;
  });
  return stays;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 4) || "X";

function mapBatch(b: Obj, recipeKeyByName: Map<string, string>, warnings: string[]): MappedBatch | null {
  const id = str(b.id);
  const beer = str(b.beer);
  if (!id || !beer) {
    warnings.push(beer ? `Brew of ${beer} has no id, so it was skipped.` : "A brew with no beer name was skipped.");
    return null;
  }
  const brewed = isoDate(b.brewDate);
  const label = `${beer}${brewed ? ` brewed ${brewed}` : ""}`;
  const rawStatus = str(b.status);
  let status = brewStatusFor(rawStatus);
  if (!status) {
    warnings.push(`${label}: unknown stage "${rawStatus || "none"}", taken as fermenting.`);
    status = "FERMENTING";
  }
  const copy = isObj(b.recipe) ? b.recipe : null;
  const recipeSourceKey = copy && str(copy.id) ? `${SOURCE_PREFIX}${str(copy.id)}` : (recipeKeyByName.get(norm(beer)) ?? null);
  const fg = platoToSg(b.fg);
  const og = platoToSg(b.og);
  const forecast = isObj(b.forecast) ? b.forecast : null;
  return {
    sourceKey: `${SOURCE_PREFIX}${id}`,
    code: brewed ? `BM-${brewed.slice(2, 4)}${brewed.slice(5, 7)}${brewed.slice(8, 10)}-${initials(beer)}` : `BM-${id.slice(-8)}`,
    beerName: beer.slice(0, 120),
    style: strOrNull(b.style),
    recipeSourceKey,
    status,
    brewedOn: brewed,
    packagedOn: status === "PACKAGED" ? isoDate(b.pkgDate) : null,
    plannedOn: forecast ? isoDate(forecast.brewDay) : null,
    bbl: parseBbl(b.vol),
    og: og == null ? null : round(og, 3),
    fg: fg == null ? null : round(fg, 3),
    notes: strOrNull(b.notes),
    extra: {
      brewManager: {
        id: b.id,
        stage: rawStatus || null,
        tankPath: str(b.tankPath) || null,
        targetFgPlato: str(b.targetFg) || null,
        yeast: str(b.yeast) || null,
        abvOverride: b.abvOverride ?? null,
        gravReadings: Array.isArray(b.gravReadings) ? b.gravReadings : [],
        timeline: Array.isArray(b.timeline) ? b.timeline : [],
        forecast: forecast ?? null,
        packaged: { half: str(b.pkgHalf) || null, sixth: str(b.pkgSixth) || null, cans: str(b.pkgCans) || null, co2: str(b.pkgCo2) || null, notes: str(b.pkgNotes) || null },
        brewLog: b.brewLog ?? null,
      },
    },
    stays: staysFor(b, status, label, warnings),
  };
}

// ---- The whole file -----------------------------------------------------------------

export function mapBackup(json: unknown): { ok: true; data: MappedBackup } | { ok: false; error: string } {
  if (!isObj(json)) return { ok: false, error: "This isn't a Brew Manager backup. In Brew Manager, open Settings and press Export backup JSON, then upload that file." };
  const rawRecipes = json.recipes;
  const rawBatches = json.batches;
  if (!Array.isArray(rawRecipes) && !Array.isArray(rawBatches)) return { ok: false, error: "This file has no recipes or batches in it. Is it the backup from Brew Manager's Settings?" };
  if ((Array.isArray(rawRecipes) ? rawRecipes.length : 0) > 2000 || (Array.isArray(rawBatches) ? rawBatches.length : 0) > 10000) return { ok: false, error: "That's more recipes or batches than one brewery's backup holds. Check the file." };

  const warnings: string[] = [];
  const unknown = new Set<string>();
  const recipes: MappedRecipe[] = [];
  const seenNames = new Map<string, number>();
  const seenKeys = new Set<string>();
  for (const r of Array.isArray(rawRecipes) ? rawRecipes : []) {
    if (!isObj(r)) continue;
    const m = mapRecipe(r, warnings, unknown);
    if (!m) continue;
    if (seenKeys.has(m.sourceKey)) {
      warnings.push(`Recipe "${m.name}" appears twice with the same id; the second copy was skipped.`);
      continue;
    }
    seenKeys.add(m.sourceKey);
    const n = (seenNames.get(norm(m.name)) ?? 0) + 1;
    seenNames.set(norm(m.name), n);
    if (n > 1) m.name = `${m.name} (${n})`;
    recipes.push(m);
  }

  const recipeKeyByName = new Map<string, string>();
  for (const r of recipes) if (!recipeKeyByName.has(norm(r.name))) recipeKeyByName.set(norm(r.name), r.sourceKey);

  const batches: MappedBatch[] = [];
  const codes = new Map<string, number>();
  const batchKeys = new Set<string>();
  for (const b of Array.isArray(rawBatches) ? rawBatches : []) {
    if (!isObj(b)) continue;
    const m = mapBatch(b, recipeKeyByName, warnings);
    if (!m || batchKeys.has(m.sourceKey)) continue;
    batchKeys.add(m.sourceKey);
    const n = (codes.get(m.code) ?? 0) + 1;
    codes.set(m.code, n);
    if (n > 1) m.code = `${m.code}-${n}`;
    batches.push(m);
  }

  return { ok: true, data: { recipes, batches, exportedAt: str(json.exportedAt) || null, warnings, unknownUnits: [...unknown] } };
}

// ---- Preview ------------------------------------------------------------------------

export interface ImportPreview {
  recipes: number;
  newRecipes: number;
  updatedRecipes: number;
  lines: number;
  batches: number;
  newBatches: number;
  stays: number;
  tanks: { name: string; kind: ImportTankKind; exists: boolean; capacityBbl: number | null }[];
  beerMatches: { recipe: string; beer: string }[];
  unmatchedRecipes: string[];
  unknownUnits: string[];
  warnings: string[];
  exportedAt: string | null;
}

/** Tanks the brews sat in, with a size from the brews (or their recipe's batch size). */
export function tanksFromBackup(data: MappedBackup): { name: string; kind: ImportTankKind; capacityBbl: number | null }[] {
  const recipeBbl = new Map(data.recipes.map((r) => [r.sourceKey, r.batchBbl]));
  const out = new Map<string, { name: string; kind: ImportTankKind; capacityBbl: number | null; fromBatch: boolean }>();
  for (const b of data.batches) {
    for (const s of b.stays) {
      const key = s.tank.toLowerCase();
      const cur = out.get(key) ?? { name: s.tank, kind: tankKind(s.tank), capacityBbl: null, fromBatch: false };
      if (b.bbl != null) {
        cur.capacityBbl = cur.fromBatch ? Math.max(cur.capacityBbl ?? 0, b.bbl) : b.bbl;
        cur.fromBatch = true;
      } else if (!cur.fromBatch) {
        const rb = b.recipeSourceKey ? recipeBbl.get(b.recipeSourceKey) : null;
        if (rb != null) cur.capacityBbl = Math.max(cur.capacityBbl ?? 0, rb);
      }
      out.set(key, cur);
    }
  }
  return [...out.values()].map(({ name, kind, capacityBbl }) => ({ name, kind, capacityBbl }));
}

export function previewBackup(
  data: MappedBackup,
  ctx: { beers: { id?: string; name: string }[]; existingRecipeKeys: string[]; existingBatchKeys: string[]; tanks: { name: string }[] },
): ImportPreview {
  const rk = new Set(ctx.existingRecipeKeys);
  const bk = new Set(ctx.existingBatchKeys);
  const tankNames = new Set(ctx.tanks.map((t) => t.name.trim().toLowerCase()));
  const beerMatches: { recipe: string; beer: string }[] = [];
  const unmatchedRecipes: string[] = [];
  for (const r of data.recipes) {
    const b = matchBeer(r.name, ctx.beers);
    if (b) beerMatches.push({ recipe: r.name, beer: b.name });
    else unmatchedRecipes.push(r.name);
  }
  return {
    recipes: data.recipes.length,
    newRecipes: data.recipes.filter((r) => !rk.has(r.sourceKey)).length,
    updatedRecipes: data.recipes.filter((r) => rk.has(r.sourceKey)).length,
    lines: data.recipes.reduce((s, r) => s + r.lines.length, 0),
    batches: data.batches.length,
    newBatches: data.batches.filter((b) => !bk.has(b.sourceKey)).length,
    stays: data.batches.reduce((s, b) => s + b.stays.length, 0),
    tanks: tanksFromBackup(data).map((t) => ({ ...t, exists: tankNames.has(t.name.toLowerCase()) })),
    beerMatches,
    unmatchedRecipes,
    unknownUnits: data.unknownUnits,
    warnings: data.warnings,
    exportedAt: data.exportedAt,
  };
}
