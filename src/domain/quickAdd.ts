/**
 * Parse free-text recipe lines like "6 oz ground beef", "1 1/2 cups flour",
 * "2 slices cheddar", "aioli 1 tbsp" into qty + unit + best-matching item.
 */
import { fuzzyScore } from "./search";
import { normalizeUnit, standardUnit } from "./units";

export interface QuickItem {
  id: string;
  name: string;
  units: string[]; // units valid for this item, first = default
}

export interface ParsedLine {
  raw: string;
  qty: number;
  unit: string;
  item: QuickItem | null;
}

const UNIT_ALIASES: Record<string, string> = {
  ounce: "oz", ounces: "oz", pound: "lb", pounds: "lb", tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp", tbl: "tbsp",
  teaspoon: "tsp", teaspoons: "tsp", liters: "l", litre: "l", quart: "qt", quarts: "qt", gallon: "gal", gallons: "gal",
  slices: "slice", pieces: "each", piece: "each", pc: "each", ea: "each", grams: "g", kilogram: "kg", kilos: "kg", cups: "cup",
};

function parseQty(tok: string): number | null {
  if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok);
  const f = tok.match(/^(\d+)\/(\d+)$/);
  if (f && Number(f[2]) > 0) return Number(f[1]) / Number(f[2]);
  const uni: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
  return uni[tok] ?? null;
}

function canonicalUnit(tok: string, known: Set<string>): string | null {
  const t = normalizeUnit(tok);
  const alias = UNIT_ALIASES[t] ?? t;
  if (standardUnit(alias) || known.has(alias)) return alias;
  if (t.endsWith("s") && known.has(t.slice(0, -1))) return t.slice(0, -1);
  return null;
}

/** Pull "qty unit" from the front (or back) of the tokens. */
function extract(tokens: string[], known: Set<string>) {
  let qty: number | null = null;
  let unit: string | null = null;
  const rest = [...tokens];
  const takeFront = () => {
    // "1 1/2", "1.5", "½"
    const a = parseQty(rest[0] ?? "");
    if (a == null) return false;
    rest.shift();
    const b = parseQty(rest[0] ?? "");
    if (b != null && b < 1) { rest.shift(); qty = a + b; } else qty = a;
    const u = rest[0] ? canonicalUnit(rest[0], known) : null;
    if (u) { unit = u; rest.shift(); }
    if (rest[0]?.toLowerCase() === "of") rest.shift();
    return true;
  };
  // "6oz beef" → split glued number+unit
  const glued = rest[0]?.match(/^(\d+(?:\.\d+)?)([a-z]+)$/i);
  if (glued && canonicalUnit(glued[2], known)) rest.splice(0, 1, glued[1], glued[2]);
  if (!takeFront()) {
    // "aioli 1 tbsp"
    const n = rest.length;
    const u = n >= 2 ? canonicalUnit(rest[n - 1], known) : null;
    const q = parseQty(rest[u ? n - 2 : n - 1] ?? "");
    if (q != null) {
      qty = q;
      unit = u;
      rest.splice(u ? n - 2 : n - 1);
    }
  }
  return { qty, unit, name: rest.join(" ") };
}

export function parseQuickLine(raw: string, items: QuickItem[]): ParsedLine | null {
  const text = raw.trim().replace(/^[-•*]\s*/, "").replace(/,/g, " ");
  if (!text) return null;
  const known = new Set(items.flatMap((i) => i.units.map(normalizeUnit)));
  const { qty, unit, name } = extract(text.split(/\s+/), known);
  if (!name) return null;

  let best: QuickItem | null = null;
  let bestScore = -Infinity;
  for (const it of items) {
    const s = fuzzyScore(name, it.name);
    if (s != null && s > bestScore) { best = it; bestScore = s; }
  }
  // Fall back to word overlap when characters don't line up in order ("beef ground").
  if (!best) {
    const words = name.toLowerCase().split(/\s+/);
    let bestHits = 0;
    for (const it of items) {
      const hits = words.filter((w) => w.length > 2 && it.name.toLowerCase().includes(w)).length;
      if (hits > bestHits) { best = it; bestHits = hits; }
    }
  }
  const unitForItem = best ? (unit && best.units.map(normalizeUnit).includes(unit) ? best.units[best.units.map(normalizeUnit).indexOf(unit)] : unit ?? best.units[0]) : unit ?? "each";
  return { raw, qty: qty ?? 1, unit: unitForItem, item: best };
}

/**
 * Split a line into quantity, unit and the rest: "1 1/2 cups flour" →
 * { qty: 1.5, unit: "cup", name: "flour" }. qty/unit are null when absent.
 * `knownUnits` adds custom units (slice, bun…) on top of the standard ones.
 */
export function splitQtyUnit(text: string, knownUnits: Iterable<string> = []): { qty: number | null; unit: string | null; name: string } {
  const known = new Set([...knownUnits].map(normalizeUnit));
  const tokens = text.trim().replace(/^[-•*]\s*/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);
  return extract(tokens, known);
}
