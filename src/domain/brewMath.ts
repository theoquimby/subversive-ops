/**
 * Brewing maths: gravity, alcohol, bitterness, colour and scaling, from the
 * standard published formulas. US units inside (pounds, ounces, US gallons;
 * one US beer barrel = 31 gallons). Pure and shared by the browser (the
 * recipe editor recomputes as you type) and the server, so both always agree.
 *
 * - Gravity: points = Σ(lb × ppg) × efficiency ÷ gallons; OG = 1 + points / 1000.
 *   Kettle sugars (an "adjunct" line with an extract value) count in full: no mash, so no efficiency.
 * - Final gravity: OG − (OG − 1) × apparent attenuation (75% when no yeast says otherwise).
 * - ABV = (OG − FG) × 131.25.
 * - IBU: Tinseth. Utilisation = 1.65 × 0.000125^(boil gravity − 1) × (1 − e^(−0.04 × minutes)) ÷ 4.15;
 *   IBU = utilisation × alpha × oz × 7490 ÷ gallons. The OG stands in for the boil gravity.
 *   First-wort hops count as boiling for the whole boil. Whirlpool hops get half the
 *   utilisation of the same minutes in the boil (the wort is below boiling); 20 minutes if
 *   none given. Dry and mash hops add nothing.
 * - Colour: Morey. MCU = Σ(lb × °L) ÷ gallons; SRM = 1.4922 × MCU^0.6859.
 */

export const GAL_PER_BBL = 31;
export const G_PER_LB = 453.59237;
export const OZ_PER_LB = 16;
export const ML_PER_GAL = 3785.411784;
export const DEFAULT_ATTENUATION_PCT = 75;
export const ABV_FACTOR = 131.25;
export const WHIRLPOOL_UTILISATION_FACTOR = 0.5;
export const DEFAULT_WHIRLPOOL_MINUTES = 20;
/** Tinseth: mg/L of alpha acid from 1 oz of 100% alpha hops in 1 US gallon. */
export const TINSETH_MG_PER_L = 7490;

export const BREW_UNITS = ["lb", "oz", "kg", "g", "gal", "l", "ml", "pkg", "each"] as const;
export type BrewUnit = (typeof BREW_UNITS)[number];
export const MASS_UNITS: BrewUnit[] = ["lb", "oz", "kg", "g"];
export const VOLUME_UNITS: BrewUnit[] = ["gal", "l", "ml"];
export const COUNT_UNITS: BrewUnit[] = ["pkg", "each"];

export type BrewLineKind = "grain" | "hop" | "yeast" | "adjunct" | "water" | "other";
export const BREW_LINE_KINDS: BrewLineKind[] = ["grain", "hop", "yeast", "adjunct", "water", "other"];
export type HopUse = "boil" | "firstwort" | "whirlpool" | "dryhop" | "mash";
export const HOP_USES: HopUse[] = ["boil", "firstwort", "whirlpool", "dryhop", "mash"];

const ALIASES: Record<string, BrewUnit> = {
  lb: "lb", lbs: "lb", "#": "lb", pound: "lb", pounds: "lb",
  oz: "oz", ozs: "oz", ounce: "oz", ounces: "oz",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gr: "g", gram: "g", grams: "g",
  gal: "gal", gals: "gal", gallon: "gal", gallons: "gal",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  pkg: "pkg", pkgs: "pkg", pack: "pkg", packs: "pkg", package: "pkg", packages: "pkg", packet: "pkg", packets: "pkg", pouch: "pkg", pouches: "pkg", sachet: "pkg", sachets: "pkg", bag: "pkg", bags: "pkg", brick: "pkg", bricks: "pkg",
  each: "each", ea: "each", ct: "each", pc: "each", pcs: "each",
};

/** The unit a recipe line means ("lbs", "#", "Pounds" → lb), or null if it isn't one we know. */
export function brewUnit(raw: string): BrewUnit | null {
  const u = raw.trim().toLowerCase().replace(/\.$/, "");
  return ALIASES[u] ?? null;
}

export function unitDimension(unit: string): "mass" | "volume" | "count" | null {
  const u = brewUnit(unit);
  if (!u) return null;
  return MASS_UNITS.includes(u) ? "mass" : VOLUME_UNITS.includes(u) ? "volume" : "count";
}

const LB_PER: Partial<Record<BrewUnit, number>> = { lb: 1, oz: 1 / OZ_PER_LB, kg: 1000 / G_PER_LB, g: 1 / G_PER_LB };
const GAL_PER: Partial<Record<BrewUnit, number>> = { gal: 1, l: 1000 / ML_PER_GAL, ml: 1 / ML_PER_GAL };

/** Weight in pounds, or null when the unit isn't a weight. */
export function toPounds(qty: number, unit: string): number | null {
  const u = brewUnit(unit);
  const f = u ? LB_PER[u] : undefined;
  return f == null ? null : qty * f;
}

export function toOunces(qty: number, unit: string): number | null {
  const lb = toPounds(qty, unit);
  return lb == null ? null : lb * OZ_PER_LB;
}

/** Volume in US gallons, or null when the unit isn't a volume. */
export function toGallons(qty: number, unit: string): number | null {
  const u = brewUnit(unit);
  const f = u ? GAL_PER[u] : undefined;
  return f == null ? null : qty * f;
}

/** `qty` of one unit in another of the same kind (weight, volume or count); null across kinds. */
export function convertBrewQty(qty: number, from: string, to: string): number | null {
  const a = brewUnit(from);
  const b = brewUnit(to);
  if (!a || !b) return null;
  if (LB_PER[a] != null && LB_PER[b] != null) return (qty * LB_PER[a]!) / LB_PER[b]!;
  if (GAL_PER[a] != null && GAL_PER[b] != null) return (qty * GAL_PER[a]!) / GAL_PER[b]!;
  if (COUNT_UNITS.includes(a) && COUNT_UNITS.includes(b)) return qty;
  return null;
}

const pos = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

export function batchGallons(bbl: number): number {
  return pos(bbl) * GAL_PER_BBL;
}

// ---- Grain defaults ----------------------------------------------------------------

/**
 * Typical extract (ppg) and colour (°L) for a fermentable, from its name. Used only
 * when a line has no value of its own, and the page says when it did.
 */
const DEFAULTS: { test: RegExp; ppg: number; colorL: number; label: string }[] = [
  { test: /sugar|dextrose|sucrose|candi|corn syrup|maltodextrin/i, ppg: 46, colorL: 0, label: "sugar" },
  { test: /honey/i, ppg: 35, colorL: 2, label: "honey" },
  { test: /roast|black|patent|carafa/i, ppg: 25, colorL: 500, label: "roasted grain" },
  { test: /chocolate|choc\b/i, ppg: 28, colorL: 350, label: "chocolate malt" },
  { test: /crystal|caramel|\bcara|\bC\d{2,3}\b/i, ppg: 34, colorL: 40, label: "crystal malt" },
  { test: /flaked|oat|rice|corn|maize/i, ppg: 33, colorL: 1, label: "flaked grain" },
  { test: /munich/i, ppg: 37, colorL: 9, label: "Munich malt" },
  { test: /vienna/i, ppg: 37, colorL: 4, label: "Vienna malt" },
  { test: /wheat/i, ppg: 38, colorL: 2, label: "wheat malt" },
  { test: /pils|pilsner|lager malt/i, ppg: 37, colorL: 1.8, label: "pilsner malt" },
];
const BASE_DEFAULT = { ppg: 37, colorL: 3, label: "base malt" };

export function grainDefaults(name: string): { ppg: number; colorL: number; label: string } {
  const d = DEFAULTS.find((x) => x.test.test(name));
  return d ? { ppg: d.ppg, colorL: d.colorL, label: d.label } : BASE_DEFAULT;
}

// ---- Gravity ------------------------------------------------------------------------

export interface BrewLineInput {
  kind: BrewLineKind;
  name: string;
  qty: number;
  unit: string;
  potentialPpg?: number | null;
  colorL?: number | null;
  alphaPct?: number | null;
  use?: HopUse | null;
  minutes?: number | null;
  attenuationPct?: number | null;
}

/** Grain lines are mashed (efficiency applies); adjunct lines with an extract value are kettle sugars (counted in full). */
const isMashed = (l: BrewLineInput) => l.kind === "grain";
const isKettleSugar = (l: BrewLineInput) => l.kind === "adjunct" && pos(l.potentialPpg) > 0;

export function gravityPoints(lines: BrewLineInput[], gallons: number, efficiencyPct: number): { points: number; perLine: number[]; defaulted: number[] } {
  const gal = pos(gallons);
  const eff = Math.min(pos(efficiencyPct), 100) / 100;
  const perLine: number[] = [];
  const defaulted: number[] = [];
  lines.forEach((l, i) => {
    let p = 0;
    if (gal > 0 && (isMashed(l) || isKettleSugar(l))) {
      const lb = pos(toPounds(l.qty, l.unit));
      let ppg = pos(l.potentialPpg);
      if (isMashed(l) && ppg === 0) {
        ppg = grainDefaults(l.name).ppg;
        defaulted.push(i);
      }
      p = (lb * ppg * (isMashed(l) ? eff : 1)) / gal;
    }
    perLine.push(p);
  });
  return { points: perLine.reduce((s, x) => s + x, 0), perLine, defaulted };
}

export const sgFromPoints = (points: number) => 1 + pos(points) / 1000;
export const pointsFromSg = (sg: number) => Math.max(0, (sg - 1) * 1000);

export function finalGravity(og: number, attenuationPct: number): number {
  const att = Math.min(Math.max(Number.isFinite(attenuationPct) ? attenuationPct : 0, 0), 100) / 100;
  return 1 + (pointsFromSg(og) * (1 - att)) / 1000;
}

export function abv(og: number, fg: number): number {
  return Math.max(0, (og - fg) * ABV_FACTOR);
}

// ---- Bitterness ---------------------------------------------------------------------

export function tinsethUtilisation(boilGravity: number, minutes: number): number {
  const t = pos(minutes);
  if (t === 0) return 0;
  const bigness = 1.65 * Math.pow(0.000125, Math.max(0, boilGravity - 1));
  const time = (1 - Math.exp(-0.04 * t)) / 4.15;
  return bigness * time;
}

/** IBU one hop addition gives, in `gallons` of wort at `boilGravity`, with a `boilMinutes` boil. */
export function hopIbu(h: Pick<BrewLineInput, "qty" | "unit" | "alphaPct" | "use" | "minutes">, gallons: number, boilGravity: number, boilMinutes: number): number {
  const gal = pos(gallons);
  const oz = pos(toOunces(h.qty, h.unit));
  const alpha = pos(h.alphaPct) / 100;
  if (gal === 0 || oz === 0 || alpha === 0) return 0;
  const use = h.use ?? "boil";
  let util = 0;
  if (use === "boil") util = tinsethUtilisation(boilGravity, h.minutes ?? 0);
  else if (use === "firstwort") util = tinsethUtilisation(boilGravity, boilMinutes);
  else if (use === "whirlpool") util = WHIRLPOOL_UTILISATION_FACTOR * tinsethUtilisation(boilGravity, h.minutes == null ? DEFAULT_WHIRLPOOL_MINUTES : h.minutes);
  return (util * alpha * oz * TINSETH_MG_PER_L) / gal;
}

// ---- Colour -------------------------------------------------------------------------

export function mcu(lines: BrewLineInput[], gallons: number): { mcu: number; defaulted: number[] } {
  const gal = pos(gallons);
  const defaulted: number[] = [];
  if (gal === 0) return { mcu: 0, defaulted };
  let sum = 0;
  lines.forEach((l, i) => {
    if (l.kind !== "grain" && l.kind !== "adjunct") return;
    let c = l.colorL;
    if (c == null || !Number.isFinite(c)) {
      if (l.kind !== "grain") return;
      c = grainDefaults(l.name).colorL;
      defaulted.push(i);
    }
    sum += pos(toPounds(l.qty, l.unit)) * Math.max(0, c);
  });
  return { mcu: sum / gal, defaulted };
}

export function srmFromMcu(m: number): number {
  return m > 0 ? 1.4922 * Math.pow(m, 0.6859) : 0;
}

/** Approximate beer colour for SRM 1–40 (lighter and darker clamp to the ends). */
const SRM_HEX = [
  "#FFE699", "#FFD878", "#FFCA5A", "#FFBF42", "#FBB123", "#F8A600", "#F39C00", "#EA8F00", "#E58500", "#DE7C00",
  "#D77200", "#CF6900", "#CB6200", "#C35900", "#BB5100", "#B54C00", "#B04500", "#A63E00", "#A13700", "#9B3200",
  "#952D00", "#8E2900", "#882300", "#821E00", "#7B1A00", "#771900", "#701400", "#6A0E00", "#660D00", "#5E0B00",
  "#5A0A02", "#600903", "#520907", "#4C0505", "#470606", "#440607", "#3F0708", "#3B0607", "#3A070B", "#36080A",
];

export function srmHex(srm: number): string {
  const i = Math.min(40, Math.max(1, Math.round(Number.isFinite(srm) ? srm : 1)));
  return SRM_HEX[i - 1];
}

// ---- Scaling ------------------------------------------------------------------------

/** An amount for a `toBbl` batch when the recipe is written for `fromBbl`. Unchanged if either size isn't positive. */
export function scaleQty(qty: number, fromBbl: number, toBbl: number): number {
  if (!(fromBbl > 0) || !(toBbl > 0) || fromBbl === toBbl) return qty;
  return (qty * toBbl) / fromBbl;
}

export function scaleLines<T extends { qty: number }>(lines: T[], fromBbl: number, toBbl: number): T[] {
  return lines.map((l) => ({ ...l, qty: scaleQty(l.qty, fromBbl, toBbl) }));
}

// ---- Everything at once -------------------------------------------------------------

export interface RecipeStatsInput {
  batchBbl: number;
  efficiencyPct: number;
  boilMinutes: number;
  lines: BrewLineInput[];
}

export interface LineStats {
  /** Gravity points this line adds */
  points: number;
  /** Share of the grain bill by weight (grain lines), 0–1 */
  gristPct: number | null;
  /** IBU this hop line adds */
  ibu: number;
  defaultedPpg: boolean;
  defaultedColor: boolean;
}

export interface RecipeStats {
  gallons: number;
  og: number;
  fg: number;
  abv: number;
  ibu: number;
  srm: number;
  colorHex: string;
  attenuationPct: number;
  attenuationAssumed: boolean;
  grainLb: number;
  lines: LineStats[];
  /** Plain sentences about what was assumed */
  notes: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function recipeStats(r: RecipeStatsInput): RecipeStats {
  const gallons = batchGallons(r.batchBbl);
  const grav = gravityPoints(r.lines, gallons, r.efficiencyPct);
  const og = sgFromPoints(grav.points);
  const yeastAtt = r.lines.filter((l) => l.kind === "yeast" && pos(l.attenuationPct) > 0).map((l) => l.attenuationPct!);
  const attenuationPct = yeastAtt.length ? Math.max(...yeastAtt) : DEFAULT_ATTENUATION_PCT;
  const fg = finalGravity(og, attenuationPct);
  const ibus = r.lines.map((l) => (l.kind === "hop" ? hopIbu(l, gallons, og, r.boilMinutes) : 0));
  const color = mcu(r.lines, gallons);
  const srm = srmFromMcu(color.mcu);
  const grainLb = r.lines.reduce((s, l) => s + (l.kind === "grain" ? pos(toPounds(l.qty, l.unit)) : 0), 0);
  const lines: LineStats[] = r.lines.map((l, i) => ({
    points: grav.perLine[i],
    gristPct: l.kind === "grain" && grainLb > 0 ? pos(toPounds(l.qty, l.unit)) / grainLb : null,
    ibu: ibus[i],
    defaultedPpg: grav.defaulted.includes(i),
    defaultedColor: color.defaulted.includes(i),
  }));

  const notes: string[] = [];
  if (grav.defaulted.length) notes.push(`${plural(grav.defaulted.length, "grain")} without an extract value: a typical one for the kind of grain is used.`);
  if (color.defaulted.length) notes.push(`${plural(color.defaulted.length, "grain")} without a colour: a typical one for the kind of grain is used.`);
  const noAlpha = r.lines.filter((l) => l.kind === "hop" && (l.use ?? "boil") !== "dryhop" && (l.use ?? "boil") !== "mash" && pos(l.qty) > 0 && !(pos(l.alphaPct) > 0)).length;
  if (noAlpha) notes.push(`${plural(noAlpha, "hop")} without an alpha acid %: ${noAlpha === 1 ? "it adds" : "they add"} no bitterness until one is entered.`);
  const unweighable = r.lines.filter((l) => (l.kind === "grain" || l.kind === "hop") && pos(l.qty) > 0 && toPounds(l.qty, l.unit) == null).length;
  if (unweighable) notes.push(`${plural(unweighable, "grain or hop line", "grain or hop lines")} not in a weight (lb, oz, kg, g), so left out of the numbers.`);
  if (r.lines.length && !yeastAtt.length && grav.points > 0) notes.push(`No yeast attenuation given: ${DEFAULT_ATTENUATION_PCT}% is assumed.`);

  return {
    gallons,
    og,
    fg,
    abv: abv(og, fg),
    ibu: ibus.reduce((s, x) => s + x, 0),
    srm,
    colorHex: srmHex(srm),
    attenuationPct,
    attenuationAssumed: !yeastAtt.length,
    grainLb,
    lines,
    notes,
  };
}
