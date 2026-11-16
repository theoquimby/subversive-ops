/**
 * Which units an item can be counted in, and adding up a count typed in
 * several of them ("2 jug + 3 can").
 *
 * An item can be counted in:
 *  - every pack it's bought in, from any supplier: the case, and the piece
 *    inside it when the pack text says how many ("6/#10" → 6 pieces a case);
 *  - the item's own custom units ("1 jug = 3.3 l");
 *  - the standard units of its base (g → oz, lb, kg);
 *  - the standard units of the other dimension when we know a density, from a
 *    custom unit ("1 cup = 120 g") or a pack that gives both ("4/1 GAL" = 15 kg).
 *
 * Two packs that share a name but differ in size (a case of cans and a case of
 * jugs) get their pack text added so they can't be mixed up: "case (6/#10)".
 */

import { CustomConversion, STANDARD_UNITS_BY_BASE, standardUnit, toBase, type BaseUnit } from "./units";

export interface PackProduct {
  id: string;
  purchaseUnit: string;
  packQtyBase: number | null;
  packText: string | null;
}

export interface UnitOptionsInput {
  base: BaseUnit;
  /** The manager's default count unit. */
  countUnit: string | null;
  /** Units the manager allowed staff to count in (empty = all). */
  allowed?: readonly string[];
  conversions: readonly CustomConversion[];
  /** Active supplier products for this item, any supplier. */
  products: readonly PackProduct[];
  preferredProductId: string | null;
}

export interface UnitOptions {
  /** Every unit, default first. */
  units: string[];
  /** What staff may pick from: `allowed` (when set and still valid), else `units`. */
  staffUnits: string[];
  /** Custom conversions for toBase(), including the pack and density-derived ones. */
  conversions: CustomConversion[];
  /** "6/#10 · 1 case = 6 piece" style notes, per unit. */
  notes: Record<string, string>;
}

const GENERIC_INNER = "piece";
const CASE_LIKE = new Set(["case", "cs", "box", "bx", "pack", "pk", "bag", "bundle", "tray", "flat", "crate"]);
const PIECE_LIKE = new Set(["piece", "pc", "each", "ea"]);
/** Big units nobody counts a shelf in. */
const SKIP_STANDARD = new Set(["bbl", "hl"]);

/** "6/#10" → 6, "4/1 GAL" → 4, "24/BNCH" → 24, "200 CT" → null (one pack, no inner count). */
export function packCount(packText: string | null | undefined): number | null {
  const m = packText?.trim().match(/^(\d+(?:\.\d+)?)\s*[/xX]\s*\S/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 1 ? n : null;
}

/** The inner pack as printed: "6/#10" → "#10", "4/1 GAL" → "1 GAL". */
export function innerPackText(packText: string | null | undefined): string | null {
  const m = packText?.trim().match(/^\d+(?:\.\d+)?\s*[/xX]\s*(.+)$/);
  return m ? m[1].trim() : null;
}

const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.005;
const clean = (u: string) => u.trim().toLowerCase();
const otherDims = (base: BaseUnit): BaseUnit[] => (["g", "ml", "each"] as BaseUnit[]).filter((d) => d !== base);
/** Standard units offered for a dimension (barrels and hectolitres only for liquids measured in ml). */
const standardsFor = (dim: BaseUnit, base: BaseUnit) => STANDARD_UNITS_BY_BASE[dim].filter((u) => (dim === "ml" && base === "ml") || !SKIP_STANDARD.has(u));

/** Volume of a pack in ml from its text ("4/1 GAL"), or weight in g, for density. */
function packMeasure(packText: string | null, dim: BaseUnit): number | null {
  if (!packText) return null;
  const t = packText.toUpperCase().replace(/\s+/g, " ").trim();
  const m = t.match(/^(?:(\d+(?:\.\d+)?)\s*[/X]\s*)?(\d*\.?\d+)\s*-?\s*([A-Z ]+?)\.?$/);
  if (!m) return null;
  let unit = m[3].trim().toLowerCase();
  if (unit === "oz") return null; // weight or fluid? can't tell, so no density from it
  if (unit === "gallon" || unit === "gallons") unit = "gal";
  if (unit === "lt" || unit === "ltr") unit = "l";
  if (unit === "gr") unit = "g";
  const s = standardUnit(unit);
  if (!s || s.base !== dim) return null;
  return (m[1] ? Number(m[1]) : 1) * Number(m[2]) * s.factor;
}

export function unitOptions(input: UnitOptionsInput): UnitOptions {
  const { base } = input;
  const conversions: CustomConversion[] = input.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty }));
  const notes: Record<string, string> = {};
  const has = (u: string) => conversions.find((c) => clean(c.unit) === clean(u));
  const isStandardHere = (u: string) => standardUnit(u)?.base === base;

  /** Add a unit; if the name is taken by a different size, qualify it with the pack text. */
  const add = (unit: string, baseQty: number, qualifier: string | null, note: string): string | null => {
    if (!(baseQty > 0) || !unit.trim()) return null;
    let name = clean(unit);
    if (isStandardHere(name)) return null;
    const cur = has(name);
    if (cur) {
      if (same(cur.baseQty, baseQty)) return cur.unit;
      if (!qualifier) return null;
      name = `${name} (${qualifier.toLowerCase()})`;
      const q = has(name);
      if (q) return same(q.baseQty, baseQty) ? q.unit : null;
    }
    conversions.push({ unit: name, baseQty });
    notes[name] = note;
    return name;
  };

  // Packs: preferred product first so it keeps the plain name.
  const products = [...input.products].sort((a, b) => Number(b.id === input.preferredProductId) - Number(a.id === input.preferredProductId));
  const packUnits: string[] = [];
  for (const p of products) {
    const qty = p.packQtyBase;
    if (!qty || qty <= 0) continue;
    const pu = clean(p.purchaseUnit || "case");
    const n = packCount(p.packText);
    const inner = innerPackText(p.packText);
    const text = p.packText?.trim() || null;
    if (PIECE_LIKE.has(pu) && standardUnit(pu)?.base !== base) {
      // Bought by the piece: the piece is the pack, and a case is n of them.
      const piece = add(pu === "each" || pu === "ea" ? pu : GENERIC_INNER, qty, inner ?? text, text ? `one of ${text}` : "one");
      if (piece) packUnits.push(piece);
      if (n) {
        const c = add("case", qty * n, text, `${text} · ${n} ${piece ?? GENERIC_INNER}`);
        if (c) packUnits.push(c);
      }
    } else {
      const c = add(pu, qty, text, text ? `${text}${n ? ` · ${n} ${GENERIC_INNER}` : ""}` : `one ${pu}`);
      if (c) packUnits.push(c);
      if (n && (CASE_LIKE.has(pu) || !standardUnit(pu))) {
        const piece = add(GENERIC_INNER, qty / n, inner, `one of ${text}`);
        if (piece) packUnits.push(piece);
      }
    }
  }

  // Densities: a custom unit or pack in another dimension lets every unit of that dimension in.
  const derived: string[] = [];
  for (const dim of otherDims(base)) {
    let perUnit: number | null = null; // base units per 1 base-unit of `dim`
    for (const c of conversions) {
      const s = standardUnit(c.unit);
      if (s && s.base === dim) { perUnit = c.baseQty / s.factor; break; }
    }
    if (perUnit == null && dim !== "each") {
      for (const p of products) {
        const m = p.packQtyBase ? packMeasure(p.packText, dim) : null;
        if (m) { perUnit = p.packQtyBase! / m; break; }
      }
    }
    if (perUnit == null) continue;
    for (const u of standardsFor(dim, base)) {
      if (has(u)) continue;
      const s = standardUnit(u)!;
      conversions.push({ unit: u, baseQty: s.factor * perUnit });
      derived.push(u);
    }
  }

  const custom = conversions.map((c) => c.unit).filter((u) => !packUnits.includes(u) && !derived.includes(u));
  const all = [...new Set([...packUnits, ...custom, ...standardsFor(base, base), ...derived])];
  const preferred = products.find((p) => p.id === input.preferredProductId);
  const prefUnit = preferred && packUnits.length ? packUnits[0] : null;
  const want = input.countUnit ? all.find((u) => clean(u) === clean(input.countUnit!)) : undefined;
  const first = want ?? (prefUnit && base !== "each" ? prefUnit : STANDARD_UNITS_BY_BASE[base][0]);
  const units = [first, ...all.filter((u) => u !== first)];
  const allowed = (input.allowed ?? []).map((a) => units.find((u) => clean(u) === clean(a))).filter((u): u is string => !!u);
  const staffUnits = allowed.length ? [...new Set([allowed.includes(first) ? first : allowed[0], ...allowed])] : units;
  return { units, staffUnits, conversions, notes };
}

export interface CountPart { qty: number; unit: string }

/** Add up a count typed in several units, in base units. Throws UnitError on a unit it can't convert. */
export function sumParts(parts: readonly CountPart[], base: BaseUnit, conversions: readonly CustomConversion[]): number {
  let total = 0;
  for (const p of parts) {
    if (!Number.isFinite(p.qty) || p.qty < 0) throw new RangeError("Quantities can't be negative.");
    total += toBase(p.qty, p.unit, base, conversions);
  }
  return total;
}

/** Keep the parts that have a number, merging repeats of the same unit: [2 jug, 1 jug, 3 can] → [3 jug, 3 can]. */
export function tidyParts(parts: readonly { qty: number | null; unit: string }[]): CountPart[] {
  const out: CountPart[] = [];
  for (const p of parts) {
    if (p.qty == null || !Number.isFinite(p.qty)) continue;
    const cur = out.find((o) => clean(o.unit) === clean(p.unit));
    if (cur) cur.qty = Number((cur.qty + p.qty).toFixed(4));
    else out.push({ qty: p.qty, unit: p.unit });
  }
  return out;
}

/** "2 jug + 3 case (6/#10)". */
export const describeParts = (parts: readonly CountPart[]) => parts.map((p) => `${Number(p.qty.toFixed(2))} ${p.unit}`).join(" + ");

/** Read stored parts JSON back, ignoring anything malformed. */
export function readParts(json: unknown): (CountPart & { area?: string })[] | null {
  if (!Array.isArray(json)) return null;
  const out = json
    .filter((p): p is CountPart & { area?: unknown } => !!p && typeof p === "object" && typeof (p as CountPart).qty === "number" && typeof (p as CountPart).unit === "string")
    .map((p) => (typeof p.area === "string" && p.area ? { qty: p.qty, unit: p.unit, area: p.area } : { qty: p.qty, unit: p.unit }));
  return out.length ? out : null;
}

/**
 * Does a count look like a typo? Flags when it's more than 4× or under a
 * quarter of the last count (and the gap is more than `minGap` base units,
 * so 1 → 5 lemons isn't flagged), or when there was none and now there's a lot.
 */
export function looksOff(qtyBase: number, last: number | null, minGap = 0): { off: boolean; ratio: number | null } {
  if (last == null || last <= 0) return { off: false, ratio: null };
  const ratio = qtyBase / last;
  if (Math.abs(qtyBase - last) <= minGap) return { off: false, ratio };
  return { off: ratio > 4 || (qtyBase > 0 && ratio < 0.25), ratio };
}
