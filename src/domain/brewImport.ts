/**
 * Brew Manager → Ops: brewing recipes, brews and tank stays from its backup;
 * recipes, development beers, the brew schedule, tanks and suppliers' lead times
 * from its app data (see "Brew Manager's app data" below).
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

import {
  BREW_PROFILES,
  forecastDates,
  isLeadRef,
  isProfileKey,
  newBrewLog,
  readBrewLog,
  readProfiles,
  STAGE_FIELDS,
  type BrewLog,
  type BrewProfile,
  type Forecast,
  type LeadRef,
  type ProfileKey,
  type StageId,
} from "./brewDay";
import { brewUnit, type BrewLineKind, type BrewUnit, type HopUse } from "./brewMath";
import { platoToSg as platoToSgExact } from "./gravity";
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
  status: "live" | "dev" | "archived";
  batchBbl: number | null;
  boilMinutes: number | null;
  targetOg: number | null;
  targetFg: number | null;
  /** Brew-day targets: mash tun, boil kettle and knock-out gravity (SG), strike and mash °F, mash minutes */
  targetMt: number | null;
  targetBk: number | null;
  targetKo: number | null;
  strikeF: number | null;
  mashF: number | null;
  mashMinutes: number | null;
  /** Development beers only: label artwork finished */
  artworkDone: boolean | null;
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
  /** Brew Manager's brew-day log, in Ops' shape */
  brewLog: BrewLog | null;
  halfKegs: number | null;
  sixthKegs: number | null;
  cases: number | null;
  co2Vols: number | null;
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

/** °Plato as Brew Manager writes it ("15.5", 15.5) → specific gravity (SG = 1 + P ÷ (258.6 − 0.879 × P)). Null when empty or not positive. */
export function platoToSg(p: unknown): number | null {
  const n = numOf(p);
  if (n == null || !(n > 0) || n > 60) return null;
  return platoToSgExact(n);
}

const sg4 = (p: unknown) => {
  const g = platoToSg(p);
  return g == null ? null : round(g, 4);
};
const posNum = (v: unknown, max: number) => {
  const n = numOf(v);
  return n != null && n > 0 && n <= max ? n : null;
};

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

/** Grain, hop and yeast lines from Brew Manager's grains / hops / yeast fields (recipes and development beers alike). */
function mapLines(r: Obj, name: string, boil: number | null, warnings: string[], unknown: Set<string>): MappedLine[] {
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
  // Recipes have a strain (and supplier, amount); development beers one line of yeast text.
  const strain = str(r.yeastStrain) || str(r.yeast);
  if (strain) {
    const sup = str(r.yeastSup);
    const lineName = (sup ? `${strain}, ${sup}` : strain).slice(0, 160);
    const rawAmt = str(r.yeastAmt);
    const a = rawAmt ? amount(rawAmt, lineName, "pkg") : { qty: 0, unit: "pkg" as BrewUnit, raw: null };
    lines.push({ kind: "yeast", name: lineName, ...a, use: null, minutes: null });
  }
  return lines;
}

function mapRecipe(r: Obj, warnings: string[], unknown: Set<string>, prefix = SOURCE_PREFIX): MappedRecipe | null {
  const name = str(r.name);
  const id = str(r.id);
  if (!name || !id) {
    warnings.push(name ? `Recipe "${name}" has no id, so it was skipped.` : "A recipe with no name was skipped.");
    return null;
  }
  const boil = parseBoilMinutes(r.boilTime);
  const lines = mapLines(r, name, boil, warnings, unknown);
  const mashMinutes = posNum(r.mashDur, 1440);
  return {
    sourceKey: `${prefix}${id}`,
    name: name.slice(0, 120),
    style: strOrNull(r.style),
    status: r.archived === true ? "archived" : "live",
    batchBbl: parseBbl(r.batch),
    boilMinutes: boil,
    // No OG target: the knock-out gravity stands in.
    targetOg: sg4(r.ogP) ?? sg4(r.koP),
    targetFg: sg4(r.fgP),
    targetMt: sg4(r.mtP),
    targetBk: sg4(r.bkP),
    targetKo: sg4(r.koP),
    strikeF: posNum(r.strike, 215),
    mashF: posNum(r.mashTemp, 215),
    mashMinutes: mashMinutes == null ? null : Math.round(mashMinutes),
    artworkDone: null,
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

/** Brew Manager's stage names and fields → Ops' brew-day log fields (gravities in °P there, SG here). */
const BM_STAGES: { bm: string; id: StageId; fields: Record<string, string> }[] = [
  { bm: "Mash", id: "mash", fields: { strike: "strikeF", mashTemp: "mashF", mtPlato: "mtSg", ph: "ph", startTime: "startTime", strikeVol: "strikeBbl" } },
  { bm: "Lauter/Sparge", id: "lauter", fields: { bkPlato: "bkSg", spargeTemp: "spargeF", preboilVol: "preboilBbl", runoffTime: "runoffMin" } },
  { bm: "Boil", id: "boil", fields: { boilStart: "boilStart", koPlato: "koSg", ogPlato: "ogSg", postboilVol: "postboilBbl" } },
  { bm: "Fermentation", id: "ferment", fields: { pitchTemp: "pitchF", fermTemp: "fermF" } },
  { bm: "Packaging", id: "package", fields: { finalFg: "fgSg", halfKegs: "halfKegs", sixthKegs: "sixthKegs", cans: "cases", co2: "co2Vols" } },
];

/** Brew Manager's brew-day log ({ stages: { Mash: {...}, ... } }) as an Ops brew-day log, finished on the brew day. Null when nothing was written down. */
export function brewLogFromBrewManager(raw: unknown, brewedOn: ISODate | null): BrewLog | null {
  const stages = isObj(raw) && isObj(raw.stages) ? raw.stages : null;
  if (!stages) return null;
  const at = `${brewedOn ?? "1970-01-01"}T12:00:00.000Z`;
  const values: Record<string, Record<string, unknown>> = {};
  const notes: Record<string, string> = {};
  let any = false;
  for (const s of BM_STAGES) {
    const sd = isObj(stages[s.bm]) ? (stages[s.bm] as Obj) : null;
    if (!sd) continue;
    const kinds = new Map(STAGE_FIELDS[s.id].map((f) => [f.key, f.kind]));
    values[s.id] = {};
    for (const [from, to] of Object.entries(s.fields)) {
      const v = sd[from];
      if (v == null || v === "") continue;
      values[s.id][to] = kinds.get(to) === "gravity" ? sg4(v) : kinds.get(to) === "time" ? str(v) : numOf(v);
    }
    if (str(sd.notes)) notes[s.id] = str(sd.notes);
  }
  const log = readBrewLog({ ...newBrewLog(new Date(at)), stage: "ferment", finishedAt: at, values, notes });
  if (!log) return null;
  for (const s of BM_STAGES) if (Object.keys(log.values[s.id]).length || log.notes[s.id]) any = true;
  return any ? log : null;
}

const intOrNull = (v: unknown) => {
  const n = numOf(v);
  return n != null && n >= 0 && n < 100000 ? Math.round(n) : null;
};

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
  const forecast = isObj(b.forecast) ? b.forecast : null;
  const co2 = numOf(b.pkgCo2);
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
    og: sg4(b.og),
    fg: sg4(b.fg),
    notes: strOrNull(b.notes),
    brewLog: brewLogFromBrewManager(b.brewLog, brewed),
    halfKegs: intOrNull(b.pkgHalf),
    sixthKegs: intOrNull(b.pkgSixth),
    cases: intOrNull(b.pkgCans),
    co2Vols: co2 != null && co2 > 0 && co2 < 10 ? co2 : null,
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

// ---- Brew Manager's app data ------------------------------------------------------------
//
// brewmanager-app-data.json is made from Brew Manager's own page (its built-in data plus
// what it keeps): { source: "brewmanager-app-file", tanks: [{ id, size, kind }], recipes,
// devbeers: [{ id, name, style, abv, status, grains, hops, yeast, notes, artworkDone }],
// schedule: [{ id, beer, brewDate, style, abv, profile, locked, lockedReason? }],
// profiles: { hazy: { label, dryHop?, fvTransfer?, brite, pkg, tap, briteDay, pkgDay }, … },
// supplierLeadTimes: { "<supplier>": { leadDays, ref: "brew" | "dryHop" | "pkg" } } }.

export const APP_DATA_SOURCE = "brewmanager-app-file";
export const RECIPE_PREFIX = `${SOURCE_PREFIX}recipe:`;
export const DEV_PREFIX = `${SOURCE_PREFIX}dev:`;
export const SCHED_PREFIX = `${SOURCE_PREFIX}sched:`;

export type BrewManagerFileKind = "app" | "backup";

/** Which of Brew Manager's two files this is: the app data (schedule, development beers, tanks) or the backup (recipes and brews). */
export function detectBrewManagerFile(json: unknown): BrewManagerFileKind | null {
  if (!isObj(json)) return null;
  if (json.source === APP_DATA_SOURCE) return "app";
  if (!Array.isArray(json.batches) && ["schedule", "devbeers", "tanks", "supplierLeadTimes", "profiles"].some((k) => k in json)) return "app";
  if (Array.isArray(json.recipes) || Array.isArray(json.batches)) return "backup";
  return null;
}

/** One recipe's keys in either file: the backup's "brewmanager:<id>" and the app data's "brewmanager:recipe:<id>". */
export function recipeKeyAliases(key: string): string[] {
  if (key.startsWith(RECIPE_PREFIX)) return [key, `${SOURCE_PREFIX}${key.slice(RECIPE_PREFIX.length)}`];
  const rest = key.startsWith(SOURCE_PREFIX) ? key.slice(SOURCE_PREFIX.length) : "";
  if (rest && !rest.includes(":")) return [key, `${RECIPE_PREFIX}${rest}`];
  return [key];
}

/** Brew Manager's floor plan (renderFloorPlan): where each tank stands. Column 0 of the front row is the brewhouse. */
export const FLOOR_PLAN: Record<string, { zone: string; row: number; col: number }> = {
  BBT1: { zone: "Back wall", row: 0, col: 0 },
  BBT2: { zone: "Back wall", row: 0, col: 1 },
  FV1: { zone: "Back wall", row: 0, col: 2 },
  FV2: { zone: "Back wall", row: 0, col: 3 },
  FV3: { zone: "Back wall", row: 0, col: 4 },
  FV4: { zone: "Back wall", row: 1, col: 4 },
  FV5: { zone: "Back wall", row: 2, col: 4 },
  FV6: { zone: "Front", row: 0, col: 1 },
  BBT3: { zone: "Front", row: 0, col: 2 },
  FV7: { zone: "Separate room", row: 0, col: 0 },
  FV8: { zone: "Separate room", row: 0, col: 1 },
};

export interface MappedAppTank {
  name: string;
  kind: ImportTankKind;
  capacityBbl: number | null;
  zone: string | null;
  layoutRow: number | null;
  layoutCol: number | null;
}

export interface MappedPlanned {
  sourceKey: string;
  beerName: string;
  style: string | null;
  abv: string | null;
  brewDate: ISODate;
  profile: ProfileKey | null;
  forecast: Forecast | null;
  locked: boolean;
  lockedReason: string | null;
}

export interface MappedSupplierLead {
  name: string;
  leadDays: number;
  ref: LeadRef;
}

export interface MappedAppData {
  /** Recipes, then development beers (status "dev") */
  recipes: MappedRecipe[];
  tanks: MappedAppTank[];
  schedule: MappedPlanned[];
  profiles: Record<ProfileKey, BrewProfile>;
  suppliers: MappedSupplierLead[];
  warnings: string[];
  unknownUnits: string[];
}

function mapDevBeer(d: Obj, warnings: string[], unknown: Set<string>): MappedRecipe | null {
  const name = str(d.name);
  const id = str(d.id);
  if (!name || !id) {
    warnings.push(name ? `Development beer "${name}" has no id, so it was skipped.` : "A development beer with no name was skipped.");
    return null;
  }
  return {
    sourceKey: `${DEV_PREFIX}${id}`,
    name: name.slice(0, 120),
    style: strOrNull(d.style),
    status: "dev",
    batchBbl: null,
    boilMinutes: null,
    targetOg: null,
    targetFg: null,
    targetMt: null,
    targetBk: null,
    targetKo: null,
    strikeF: null,
    mashF: null,
    mashMinutes: null,
    artworkDone: d.artworkDone === true,
    notes: strOrNull(d.notes),
    extra: { brewManager: { id: d.id, devBeer: true, abv: str(d.abv) || null, devStatus: str(d.status) || null } },
    lines: mapLines(d, name, null, warnings, unknown),
  };
}

export function mapAppData(json: unknown): { ok: true; data: MappedAppData } | { ok: false; error: string } {
  if (detectBrewManagerFile(json) !== "app" || !isObj(json)) return { ok: false, error: "This isn't Brew Manager's app data file. Upload brewmanager-app-data.json." };
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  if (arr(json.recipes).length > 2000 || arr(json.schedule).length > 5000 || arr(json.devbeers).length > 2000 || arr(json.tanks).length > 200) return { ok: false, error: "That's more than one brewery's app data holds. Check the file." };
  const warnings: string[] = [];
  const unknown = new Set<string>();

  const tanks: MappedAppTank[] = [];
  const tankNames = new Set<string>();
  for (const t of arr(json.tanks)) {
    if (!isObj(t)) continue;
    const name = str(t.id) || str(t.name);
    if (!name || tankNames.has(name.toLowerCase())) continue;
    tankNames.add(name.toLowerCase());
    const given = str(t.kind).toUpperCase();
    const spot = FLOOR_PLAN[name.toUpperCase()];
    tanks.push({
      name: name.slice(0, 40),
      kind: given === "FERMENTER" || given === "BRITE" || given === "OTHER" ? given : tankKind(name),
      capacityBbl: posNum(t.size, 1000),
      zone: spot?.zone ?? null,
      layoutRow: spot?.row ?? null,
      layoutCol: spot?.col ?? null,
    });
  }

  const recipes: MappedRecipe[] = [];
  const seenNames = new Map<string, number>();
  const seenKeys = new Set<string>();
  const add = (m: MappedRecipe | null) => {
    if (!m || seenKeys.has(m.sourceKey)) return;
    seenKeys.add(m.sourceKey);
    const n = (seenNames.get(norm(m.name)) ?? 0) + 1;
    seenNames.set(norm(m.name), n);
    if (n > 1) m.name = `${m.name} (${n})`;
    recipes.push(m);
  };
  for (const r of arr(json.recipes)) if (isObj(r)) add(mapRecipe(r, warnings, unknown, RECIPE_PREFIX));
  for (const d of arr(json.devbeers)) if (isObj(d)) add(mapDevBeer(d, warnings, unknown));

  const profiles: Record<ProfileKey, BrewProfile> = { ...BREW_PROFILES, ...readProfiles(json.profiles) };
  const schedule: MappedPlanned[] = [];
  const schedKeys = new Set<string>();
  for (const s of arr(json.schedule)) {
    if (!isObj(s)) continue;
    const id = str(s.id);
    const beer = str(s.beer);
    const brewDate = isoDate(s.brewDate);
    if (!id || !beer || !brewDate) {
      warnings.push(beer ? `Planned brew of ${beer} has no ${id ? "brew date" : "id"}, so it was skipped.` : "A planned brew with no beer name was skipped.");
      continue;
    }
    if (schedKeys.has(id)) continue;
    schedKeys.add(id);
    const rawProfile = str(s.profile).toLowerCase();
    const profile = isProfileKey(rawProfile) ? rawProfile : null;
    if (rawProfile && !profile) warnings.push(`${beer} on ${brewDate}: unknown timing profile "${rawProfile}", so no dry-hop or release date.`);
    schedule.push({
      sourceKey: `${SCHED_PREFIX}${id}`,
      beerName: beer.slice(0, 120),
      style: strOrNull(s.style),
      abv: strOrNull(s.abv),
      brewDate,
      profile,
      forecast: profile ? forecastDates(brewDate, profiles[profile]) : null,
      locked: s.locked === true,
      lockedReason: s.locked === true ? (strOrNull(s.lockedReason)?.slice(0, 200) ?? null) : null,
    });
  }
  schedule.sort((a, b) => a.brewDate.localeCompare(b.brewDate));

  const suppliers: MappedSupplierLead[] = [];
  const leads = isObj(json.supplierLeadTimes) ? json.supplierLeadTimes : {};
  for (const [name, v] of Object.entries(leads)) {
    const n = name.trim().slice(0, 120);
    if (!n || !isObj(v)) continue;
    const days = numOf(v.leadDays);
    suppliers.push({ name: n, leadDays: days != null && days >= 0 && days <= 365 ? Math.round(days) : 7, ref: isLeadRef(v.ref) ? v.ref : "brew" });
  }

  if (!tanks.length && !recipes.length && !schedule.length && !suppliers.length) return { ok: false, error: "There's nothing in this file to import." };
  return { ok: true, data: { recipes, tanks, schedule, profiles, suppliers, warnings, unknownUnits: [...unknown] } };
}

// ---- Matching names --------------------------------------------------------------------

/** Lower case, no accents or punctuation: "Märzen" and "marzen" are the same. */
export const foldName = (s: string) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Short names on Brew Manager's schedule for its recipes. */
export const NAME_ALIASES: [string, string][] = [
  ["Marzen", "Mountain Marzen"],
  ["Golden Lime", "Golden Lime Lager"],
  ["Saison", "Saison / Farmhouse"],
  ["Verdant", "Verdant Voyage"],
];

/** Words that say what kind of beer, not which one: a match on these alone isn't a match. */
const GENERIC_WORDS = new Set(["ipa", "ale", "lager", "beer", "stout", "pale", "pils", "pilsner", "sour", "the", "special", "dry", "double", "hazy", "new", "york", "ny", "american", "irish", "imperial", "and", "of", "de"]);

/**
 * The item with this name: the same name (any case, accents, punctuation), then
 * a known alias, then the one item whose name holds all the name's words (or
 * the other way round), when exactly one does and the words say which beer.
 */
export function matchName<T extends { name: string }>(name: string, items: T[]): { item: T; how: "exact" | "alias" | "close" } | null {
  // "NY Nectar" is "New York Nectar": spell NY out on both sides before comparing.
  const fold = (x: string) => foldName(x).replace(/\bny\b/g, "new york");
  const f = fold(name);
  if (!f) return null;
  const exact = items.find((i) => fold(i.name) === f);
  if (exact) return { item: exact, how: "exact" };
  for (const [a, b] of NAME_ALIASES) {
    const [fa, fb] = [fold(a), fold(b)];
    const other = f === fa ? fb : f === fb ? fa : null;
    const hit = other ? items.find((i) => fold(i.name) === other) : undefined;
    if (hit) return { item: hit, how: "alias" };
  }
  const words = new Set(f.split(" "));
  const close = items.filter((i) => {
    const iw = new Set(fold(i.name).split(" ").filter(Boolean));
    const [small, big] = words.size <= iw.size ? [words, iw] : [iw, words];
    return small.size > 0 && [...small].every((w) => big.has(w)) && [...small].some((w) => !GENERIC_WORDS.has(w) && w.length > 2);
  });
  return close.length === 1 ? { item: close[0], how: "close" } : null;
}

// ---- Preview of the app data -----------------------------------------------------------

/** A recipe the schedule can point at: one from this file ("file:<sourceKey>") or one already in Ops ("ops:<id>"). */
export interface RecipeChoice {
  ref: string;
  name: string;
}

export interface AppImportContext {
  today: ISODate;
  includePast: boolean;
  /** For a schedule name with no recipe: the recipe picked (a RecipeChoice ref), or "" for none */
  picks: Record<string, string>;
  beers: { id?: string; name: string }[];
  opsRecipes: { id: string; name: string; sourceKey: string | null }[];
  /** Brews already in Ops from an earlier import of this file */
  batches: { sourceKey: string; status: string }[];
  tanks: { name: string; capacityBbl: number; guessed: boolean }[];
  suppliers: { name: string }[];
}

export interface ScheduleRow {
  sourceKey: string;
  beer: string;
  brewDate: ISODate;
  profile: ProfileKey | null;
  profileLabel: string | null;
  dryHopOn: ISODate | null;
  tapOn: ISODate | null;
  locked: boolean;
  lockedReason: string | null;
  past: boolean;
  /** Imported this time (future brews, or past ones when asked for, and not brewed in Ops since) */
  included: boolean;
  recipeRef: string | null;
  recipeName: string | null;
  how: "exact" | "alias" | "close" | "picked" | null;
  beerMatch: string | null;
  /** "new" here, "update" a planned brew from the last import, "brewed" in Ops since (left alone) */
  state: "new" | "update" | "brewed";
}

export interface AppImportPreview {
  kind: "app";
  tanks: (MappedAppTank & { exists: boolean; sizeFrom: number | null })[];
  recipes: number;
  newRecipes: number;
  updatedRecipes: number;
  devBeers: number;
  newDevBeers: number;
  lines: number;
  schedule: ScheduleRow[];
  scheduleCounts: { total: number; future: number; past: number; included: number; brewed: number };
  /** Schedule names (of brews being imported) with no recipe found */
  unmatched: string[];
  recipeChoices: RecipeChoice[];
  suppliers: (MappedSupplierLead & { exists: boolean })[];
  beerMatches: { recipe: string; beer: string }[];
  unmatchedRecipes: string[];
  warnings: string[];
  unknownUnits: string[];
}

/** Recipes the schedule can use: this file's (development beers too), then Ops recipes that didn't come from it. */
export function recipeChoices(data: MappedAppData, opsRecipes: AppImportContext["opsRecipes"]): RecipeChoice[] {
  const fileKeys = new Set(data.recipes.flatMap((r) => recipeKeyAliases(r.sourceKey)));
  const fileNames = new Set(data.recipes.map((r) => foldName(r.name)));
  return [
    ...data.recipes.map((r) => ({ ref: `file:${r.sourceKey}`, name: r.name })),
    ...opsRecipes.filter((r) => !(r.sourceKey && fileKeys.has(r.sourceKey)) && !fileNames.has(foldName(r.name))).map((r) => ({ ref: `ops:${r.id}`, name: r.name })),
  ];
}

/** Each planned brew with the recipe it brews (found by name, or picked), its beer, its dates and what importing does to it. */
export function resolveSchedule(data: MappedAppData, ctx: AppImportContext): ScheduleRow[] {
  const choices = recipeChoices(data, ctx.opsRecipes);
  const byRef = new Map(choices.map((c) => [c.ref, c]));
  const status = new Map(ctx.batches.map((b) => [b.sourceKey, b.status]));
  return data.schedule.map((s) => {
    const past = s.brewDate < ctx.today;
    const st = status.get(s.sourceKey);
    const state: ScheduleRow["state"] = st == null ? "new" : st === "PLANNED" ? "update" : "brewed";
    const found = matchName(s.beerName, choices);
    const pick = ctx.picks[s.beerName];
    let recipe: RecipeChoice | null = found?.item ?? null;
    let how: ScheduleRow["how"] = found?.how ?? null;
    if (!found && pick && byRef.has(pick)) {
      recipe = byRef.get(pick)!;
      how = "picked";
    }
    const beer = matchName(s.beerName, ctx.beers) ?? (recipe ? matchName(recipe.name, ctx.beers) : null);
    return {
      sourceKey: s.sourceKey,
      beer: s.beerName,
      brewDate: s.brewDate,
      profile: s.profile,
      profileLabel: s.profile ? data.profiles[s.profile].label : null,
      dryHopOn: s.forecast?.dryHop ?? null,
      tapOn: s.forecast?.tap ?? null,
      locked: s.locked,
      lockedReason: s.lockedReason,
      past,
      included: state !== "brewed" && (!past || ctx.includePast),
      recipeRef: recipe?.ref ?? null,
      recipeName: recipe?.name ?? null,
      how,
      beerMatch: beer?.item.name ?? null,
      state,
    };
  });
}

export function previewAppData(data: MappedAppData, ctx: AppImportContext): AppImportPreview {
  const opsKeys = new Set(ctx.opsRecipes.flatMap((r) => (r.sourceKey ? [r.sourceKey] : [])));
  const exists = (r: MappedRecipe) => recipeKeyAliases(r.sourceKey).some((k) => opsKeys.has(k));
  const recipes = data.recipes.filter((r) => r.status !== "dev");
  const devs = data.recipes.filter((r) => r.status === "dev");
  const tankBy = new Map(ctx.tanks.map((t) => [t.name.trim().toLowerCase(), t]));
  const supplierNames = new Set(ctx.suppliers.map((s) => s.name.trim().toLowerCase()));
  const schedule = resolveSchedule(data, ctx);
  const beerMatches: { recipe: string; beer: string }[] = [];
  const unmatchedRecipes: string[] = [];
  for (const r of recipes) {
    const b = matchName(r.name, ctx.beers);
    if (b) beerMatches.push({ recipe: r.name, beer: b.item.name });
    else if (r.status === "live") unmatchedRecipes.push(r.name);
  }
  return {
    kind: "app",
    tanks: data.tanks.map((t) => {
      const cur = tankBy.get(t.name.toLowerCase());
      return { ...t, exists: !!cur, sizeFrom: cur && cur.guessed && t.capacityBbl != null && Math.abs(cur.capacityBbl - t.capacityBbl) > 1e-9 ? cur.capacityBbl : null };
    }),
    recipes: recipes.length,
    newRecipes: recipes.filter((r) => !exists(r)).length,
    updatedRecipes: recipes.filter(exists).length,
    devBeers: devs.length,
    newDevBeers: devs.filter((r) => !exists(r)).length,
    lines: data.recipes.reduce((s, r) => s + r.lines.length, 0),
    schedule,
    scheduleCounts: {
      total: schedule.length,
      future: schedule.filter((s) => !s.past).length,
      past: schedule.filter((s) => s.past).length,
      included: schedule.filter((s) => s.included).length,
      brewed: schedule.filter((s) => s.state === "brewed").length,
    },
    unmatched: [...new Set(schedule.filter((s) => s.included && (!s.recipeRef || s.how === "picked")).map((s) => s.beer))],
    recipeChoices: recipeChoices(data, ctx.opsRecipes),
    suppliers: data.suppliers.map((s) => ({ ...s, exists: supplierNames.has(s.name.toLowerCase()) })),
    beerMatches,
    unmatchedRecipes,
    warnings: data.warnings,
    unknownUnits: data.unknownUnits,
  };
}
