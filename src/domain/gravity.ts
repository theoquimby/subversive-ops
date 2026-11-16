/**
 * Gravity in degrees Plato or specific gravity. Everything is stored as
 * specific gravity (4 decimals); the brewery picks which one it reads and types
 * (Setting "brewery.gravityUnit", Plato unless changed).
 *
 * - °P → SG: SG = 1 + P ÷ (258.6 − 0.879 × P), the formula Brew Manager uses.
 * - SG → °P: its exact inverse, P = 258.6 × (SG − 1) ÷ (1 + 0.879 × (SG − 1)),
 *   so a reading typed in Plato comes back as the same Plato. Within 0.1 °P of
 *   the ASBC polynomial over normal brewing gravities.
 * - ABV, standard: (OG − FG) × 131.25. Alternate: (76.08 × (OG − FG) ÷ (1.775 − OG)) × (FG ÷ 0.794).
 */

export type GravityUnit = "plato" | "sg";
export const GRAVITY_UNITS: GravityUnit[] = ["plato", "sg"];
export const GRAVITY_UNIT_KEY = "brewery.gravityUnit";
export const DEFAULT_GRAVITY_UNIT: GravityUnit = "plato";
export const isGravityUnit = (s: unknown): s is GravityUnit => s === "plato" || s === "sg";
export const gravityUnitOf = (s: unknown): GravityUnit => (isGravityUnit(s) ? s : DEFAULT_GRAVITY_UNIT);
export const GRAVITY_UNIT_LABEL: Record<GravityUnit, string> = { plato: "°P", sg: "SG" };

/** Highest Plato and SG the app accepts (anything above is a typo). */
export const MAX_PLATO = 40;
export const MIN_SG = 0.98;
export const MAX_SG = 1.2;

export function platoToSg(p: number): number {
  return 1 + p / (258.6 - 0.879 * p);
}

export function sgToPlato(sg: number): number {
  const x = sg - 1;
  return (258.6 * x) / (1 + 0.879 * x);
}

/** Specific gravity kept to the 4 decimals the database stores. */
export const roundSg = (sg: number) => Math.round(sg * 10000) / 10000;

/** A gravity to read: "15.5 °P" or "1.063". Empty for nothing. */
export function formatGravity(sg: number | null | undefined, unit: GravityUnit, opts: { label?: boolean } = {}): string {
  if (sg == null || !Number.isFinite(sg)) return "";
  if (unit === "sg") return sg.toFixed(3);
  const p = sgToPlato(sg);
  const text = (Math.abs(p) < 0.05 ? 0 : p).toFixed(1);
  return opts.label === false ? text : `${text} °P`;
}

/** What goes back into an input in the chosen unit: "15.5" or "1.063" (more places only when they mean something). */
export function gravityInputText(sg: number | null | undefined, unit: GravityUnit): string {
  if (sg == null || !Number.isFinite(sg)) return "";
  if (unit === "sg") return String(Number(sg.toFixed(4)));
  return String(Number(sgToPlato(sg).toFixed(1)));
}

/**
 * Read a typed gravity as specific gravity. "15.5P", "15.5 °P" and "15.5 plato"
 * are always Plato; "1.063" (three or four places after "1.") and "1.063 SG" are always
 * specific gravity; a plain number is read in the chosen unit, except that a
 * number that can only be one of them is read as that one ("12" with SG chosen is
 * Plato; "1.05" with Plato chosen stays 1.05 °P). Null when it isn't a gravity.
 */
export function parseGravity(text: string | number | null | undefined, unit: GravityUnit): number | null {
  if (text == null) return null;
  const s = String(text).trim().toLowerCase().replace(/,/g, ".").replace(/\s+/g, "");
  if (!s) return null;
  const m = /^(-?\d*\.?\d+)(°?p|°?plato|sg)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2] ?? "";
  const asPlato = (p: number) => (p >= 0 && p <= MAX_PLATO ? roundSg(platoToSg(p)) : null);
  const asSg = (g: number) => (g >= MIN_SG && g <= MAX_SG ? roundSg(g) : null);
  if (suffix === "sg") return asSg(n);
  if (suffix) return asPlato(n);
  if (/^[01]\.\d{3,4}$/.test(m[1])) return asSg(n);
  if (unit === "sg") return n >= MIN_SG && n <= MAX_SG ? asSg(n) : asPlato(n);
  return asPlato(n);
}

/** ABV the usual way: (OG − FG) × 131.25, in percent. */
export function abvStandard(og: number, fg: number): number {
  return (og - fg) * 131.25;
}

/** The alternate ABV Brew Manager shows, better for strong beers: (76.08 × (OG − FG) ÷ (1.775 − OG)) × (FG ÷ 0.794). */
export function abvAlternate(og: number, fg: number): number {
  return ((76.08 * (og - fg)) / (1.775 - og)) * (fg / 0.794);
}

/** Both ABVs from two typed gravities, or null while either isn't a gravity or FG isn't below OG. */
export function abvFromText(ogText: string, fgText: string, unit: GravityUnit): { og: number; fg: number; standard: number; alternate: number } | null {
  const og = parseGravity(ogText, unit);
  const fg = parseGravity(fgText, unit);
  if (og == null || fg == null || !(og > fg)) return null;
  return { og, fg, standard: abvStandard(og, fg), alternate: abvAlternate(og, fg) };
}
