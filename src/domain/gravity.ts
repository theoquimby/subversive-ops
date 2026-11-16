/**
 * Gravity in the brewery's unit. Stored as specific gravity (4 decimals);
 * shown and typed in °Plato or SG.
 *
 * Minimal stand-in: the brew-day work owns this file and replaces it at
 * merge with the same names and signatures.
 */

export type GravityUnit = "plato" | "sg";

/** °Plato → specific gravity: 1 + P / (258.6 − 0.879 P). */
const platoToSg = (p: number) => 1 + p / (258.6 - 0.879 * p);
/** Specific gravity → °Plato (the inverse of the above). */
const sgToPlato = (sg: number) => (258.6 * (sg - 1)) / (1 + 0.879 * (sg - 1));

/** "12.5 °P" or "1.050". */
export function formatGravity(sg: number, unit: GravityUnit): string {
  return unit === "plato" ? `${sgToPlato(sg).toFixed(1)} °P` : sg.toFixed(3);
}

/** Typed gravity → specific gravity (4 decimals), or null when blank or unreadable. In °Plato, "1.012" (three decimals) is read as SG. */
export function parseGravity(text: string, unit: GravityUnit): number | null {
  const v = text.trim().replace(/°?\s*p(lato)?$/i, "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  let sg: number;
  if (unit === "plato" && !/^\d\.\d{3,4}$/.test(v)) sg = n >= 0 && n < 40 ? platoToSg(n) : NaN;
  else sg = n >= 2 && n < 200 ? 1 + n / 1000 : n;
  return sg >= 0.98 && sg <= 1.2 ? Math.round(sg * 10000) / 10000 : null;
}
