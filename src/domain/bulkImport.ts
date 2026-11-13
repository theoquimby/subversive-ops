/**
 * Onboarding import: turn arbitrary spreadsheet tables (Max's existing
 * costing workbook) into ingredients, supplier products, prices and recipes.
 *
 * Two table shapes are understood:
 *   - "ingredients": one row per thing you buy
 *       Ingredient · Category · Storage · Supplier · Item # · Pack · Pack qty · Pack unit · Price · Yield %
 *   - "recipes": one row per recipe line (long format)
 *       Recipe · Type · Category · Menu price · Ingredient · Qty · Unit
 *     A tab with no Recipe column is treated as ONE recipe named after the tab.
 *
 * Everything here is pure: it produces an ImportPlan plus human-readable
 * issues; the server applies the plan in one transaction.
 */

import { inferPackQty, parsePrice } from "./priceSheet";
import { fuzzyScore } from "./search";
import { BaseUnit, normalizeUnit, standardUnit } from "./units";

export type TableKind = "ingredients" | "recipes" | "skip";

export interface RawTable {
  name: string; // tab name or "Pasted table"
  headers: string[];
  rows: Record<string, unknown>[];
}

export type IngredientField = "ingredient" | "category" | "storage" | "supplier" | "sku" | "pack" | "packQty" | "packUnit" | "price" | "yield" | "baseUnit";
export type RecipeField = "recipe" | "kind" | "category" | "menuPrice" | "ingredient" | "qty" | "unit" | "yieldQty" | "yieldUnit";
export type Mapping = Partial<Record<IngredientField | RecipeField, string>>;

const PATTERNS: Record<IngredientField | RecipeField, RegExp[]> = {
  ingredient: [/^(ingredient|item|product)( name)?$/i, /ingredient/i, /^name$/i, /^item$/i, /desc/i],
  category: [/^(category|cat|type of item|group)$/i, /categor/i],
  storage: [/storage|location|area|shelf/i],
  supplier: [/supplier|vendor|distributor|purveyor|source/i],
  sku: [/^(item|product)?\s*(#|no\.?|num(ber)?|code|sku)$/i, /sku/i, /item\s*#/i],
  pack: [/^pack(\s*\/?\s*size)?$/i, /^size$/i, /pack\s*desc/i],
  packQty: [/(pack|case|purchase)\s*(qty|quantity|amount)/i, /^qty per (case|pack)/i, /^amount$/i],
  packUnit: [/(pack|case|purchase)\s*(unit|uom)/i, /^uom$/i, /^unit of measure$/i],
  price: [/^(case|pack|unit|purchase)?\s*(price|cost)$/i, /price/i, /^cost$/i],
  yield: [/yield/i, /usable/i],
  baseUnit: [/^(base|recipe)\s*unit$/i],
  recipe: [/^(recipe|menu item|dish|item name)$/i, /recipe/i, /menu item/i, /dish/i],
  kind: [/^type$/i, /^kind$/i],
  menuPrice: [/menu\s*price|sell(ing)?\s*price|^price$/i],
  qty: [/^(qty|quantity|amount|portion)$/i, /qty|quantity|portion/i],
  unit: [/^(unit|uom|measure)$/i, /^unit/i],
  yieldQty: [/batch\s*(yield|size)|yield\s*qty/i],
  yieldUnit: [/yield\s*unit|batch\s*unit/i],
};

const INGREDIENT_FIELDS: IngredientField[] = ["ingredient", "supplier", "sku", "price", "packQty", "packUnit", "pack", "yield", "category", "storage", "baseUnit"];
const RECIPE_FIELDS: RecipeField[] = ["recipe", "ingredient", "qty", "unit", "menuPrice", "kind", "category", "yieldQty", "yieldUnit"];

export const FIELD_LABELS: Record<IngredientField | RecipeField, string> = {
  ingredient: "Ingredient", category: "Category", storage: "Storage area", supplier: "Supplier", sku: "Item #",
  pack: "Pack text (e.g. 6/5 LB)", packQty: "Pack amount", packUnit: "Pack unit", price: "Price per pack", yield: "Yield %",
  baseUnit: "Measured by", recipe: "Recipe", kind: "Type", menuPrice: "Menu price", qty: "Qty", unit: "Unit",
  yieldQty: "Batch yield", yieldUnit: "Batch yield unit",
};

export const fieldsFor = (kind: TableKind) => (kind === "ingredients" ? INGREDIENT_FIELDS : kind === "recipes" ? RECIPE_FIELDS : []);

export function detectTable(t: RawTable): { kind: TableKind; mapping: Mapping } {
  const pick = (fields: (IngredientField | RecipeField)[]) => {
    const m: Mapping = {};
    const used = new Set<string>();
    for (const f of fields) {
      for (const re of PATTERNS[f]) {
        const h = t.headers.find((x) => !used.has(x) && re.test(x.trim()));
        if (h) { m[f] = h; used.add(h); break; }
      }
    }
    return m;
  };
  const r = pick(RECIPE_FIELDS);
  const i = pick(INGREDIENT_FIELDS);
  const looksRecipe = Boolean(r.ingredient && r.qty) && (Boolean(r.recipe) || !i.price);
  if (looksRecipe) return { kind: "recipes", mapping: r };
  if (i.ingredient && (i.price || i.supplier || i.sku)) return { kind: "ingredients", mapping: i };
  return { kind: "skip", mapping: {} };
}

// ---- Plan --------------------------------------------------------------------

export interface PlannedIngredient {
  name: string;
  category: string;
  storageArea: string;
  baseUnit: BaseUnit;
  yieldPct: number;
  existingId?: string;
  product?: { supplier: string; sku: string; description: string; packText: string | null; packQtyBase: number | null; purchaseUnit: string; price: number | null };
}

export interface PlannedRecipe {
  name: string;
  kind: "MENU" | "PREP" | "MODIFIER";
  category: string;
  menuPrice: number | null;
  yieldQty: number;
  yieldUnit: string;
  yieldBase: BaseUnit;
  existingId?: string;
  lines: { ingredient?: string; subRecipe?: string; qty: number; unit: string }[];
}

export interface ImportIssue {
  level: "warn" | "info";
  table: string;
  row?: number;
  message: string;
}

export interface ImportPlan {
  ingredients: PlannedIngredient[];
  recipes: PlannedRecipe[];
  suppliers: string[];
  issues: ImportIssue[];
}

export interface Existing {
  ingredients: { id: string; name: string; baseUnit: BaseUnit }[];
  recipes: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const numOrNull = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v).replace(/[$,%\s]/g, "");
  if (!s) return null;
  const f = s.match(/^(\d+)\/(\d+)$/);
  if (f) return Number(f[1]) / Number(f[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const UNIT_WORDS: Record<string, string> = { ounce: "oz", ounces: "oz", pound: "lb", pounds: "lb", "#": "lb", tablespoon: "tbsp", tablespoons: "tbsp", teaspoon: "tsp", teaspoons: "tsp", gallon: "gal", gallons: "gal", quart: "qt", quarts: "qt", liter: "l", liters: "l", ea: "each", ct: "each", pc: "each", pcs: "each", piece: "each", pieces: "each", slices: "slice", cups: "cup" };
export const cleanUnit = (u: string) => {
  const n = normalizeUnit(u);
  return UNIT_WORDS[n] ?? n;
};
const dimensionOf = (unit: string): BaseUnit | null => standardUnit(cleanUnit(unit))?.base ?? null;

function parseKind(v: string): PlannedRecipe["kind"] {
  const s = v.toLowerCase();
  if (/prep|sauce|batch|sub/.test(s)) return "PREP";
  if (/mod|add/.test(s)) return "MODIFIER";
  return "MENU";
}

export function buildPlan(tables: { table: RawTable; kind: TableKind; mapping: Mapping }[], existing: Existing): ImportPlan {
  const issues: ImportIssue[] = [];
  const ingredients = new Map<string, PlannedIngredient>();
  const recipes = new Map<string, PlannedRecipe>();
  const suppliers = new Set<string>();
  const existingIng = new Map(existing.ingredients.map((i) => [key(i.name), i]));
  const existingRec = new Map(existing.recipes.map((r) => [key(r.name), r]));

  // 1) Ingredients & prices
  for (const { table, kind, mapping: m } of tables) {
    if (kind !== "ingredients") continue;
    table.rows.forEach((row, idx) => {
      const rowNum = idx + 2;
      const name = str(row[m.ingredient!]);
      if (!name) return;
      const packQty = m.packQty ? numOrNull(row[m.packQty]) : null;
      const packUnit = m.packUnit ? cleanUnit(str(row[m.packUnit])) : "";
      const packText = m.pack ? str(row[m.pack]) || null : null;
      const explicitBase = m.baseUnit ? str(row[m.baseUnit]).toLowerCase() : "";
      const base: BaseUnit =
        (["g", "ml", "each"].includes(explicitBase) ? (explicitBase as BaseUnit) : null) ??
        (packUnit ? dimensionOf(packUnit) : null) ??
        (packText ? (["g", "ml", "each"] as BaseUnit[]).find((b) => inferPackQty(packText, b) != null) ?? null : null) ??
        existingIng.get(key(name))?.baseUnit ??
        "each";
      let packQtyBase: number | null = null;
      if (packQty != null && packUnit) {
        const s = standardUnit(packUnit);
        packQtyBase = s && s.base === base ? packQty * s.factor : null;
      } else if (packQty != null && base === "each" && !packUnit) packQtyBase = packQty;
      if (packQtyBase == null) packQtyBase = inferPackQty(packText, base);

      const price = m.price ? parsePrice(row[m.price]) : null;
      const supplier = m.supplier ? str(row[m.supplier]) : "";
      if (m.price && price == null && str(row[m.price])) issues.push({ level: "warn", table: table.name, row: rowNum, message: `${name}: couldn't read price "${str(row[m.price])}"` });
      if (price != null && packQtyBase == null) issues.push({ level: "warn", table: table.name, row: rowNum, message: `${name}: pack size unclear — set it after import to cost recipes` });

      const yieldRaw = m.yield ? numOrNull(row[m.yield]) : null;
      const yieldPct = yieldRaw == null ? 1 : yieldRaw > 1 ? yieldRaw / 100 : yieldRaw;
      if (supplier) suppliers.add(supplier);

      ingredients.set(key(name), {
        name,
        category: (m.category && str(row[m.category])) || "Other",
        storageArea: (m.storage && str(row[m.storage])) || "Dry storage",
        baseUnit: base,
        yieldPct: yieldPct > 0 && yieldPct <= 1 ? yieldPct : 1,
        existingId: existingIng.get(key(name))?.id,
        product: price != null || supplier || (m.sku && str(row[m.sku]))
          ? {
              supplier: supplier || "Unassigned supplier",
              sku: (m.sku && str(row[m.sku])) || `IMPORT-${key(name).replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
              description: name,
              packText: packText ?? (packQty != null ? `${packQty} ${packUnit}`.trim() : null),
              packQtyBase,
              purchaseUnit: "case",
              price,
            }
          : undefined,
      });
      if (!supplier && price != null) suppliers.add("Unassigned supplier");
    });
  }

  // 2) Recipes (long format, or one tab = one recipe)
  for (const { table, kind, mapping: m } of tables) {
    if (kind !== "recipes") continue;
    table.rows.forEach((row, idx) => {
      const rowNum = idx + 2;
      const recipeName = (m.recipe ? str(row[m.recipe]) : "") || (m.recipe ? "" : table.name);
      const ingName = str(row[m.ingredient!]);
      if (!recipeName) return;
      let rec = recipes.get(key(recipeName));
      if (!rec) {
        rec = { name: recipeName, kind: "MENU", category: "Food", menuPrice: null, yieldQty: 1, yieldUnit: "each", yieldBase: "each", existingId: existingRec.get(key(recipeName))?.id, lines: [] };
        recipes.set(key(recipeName), rec);
      }
      if (m.kind && str(row[m.kind])) rec.kind = parseKind(str(row[m.kind]));
      if (m.category && str(row[m.category])) rec.category = str(row[m.category]);
      if (m.menuPrice && numOrNull(row[m.menuPrice]) != null) rec.menuPrice = numOrNull(row[m.menuPrice]);
      if (m.yieldQty && numOrNull(row[m.yieldQty]) != null) {
        rec.yieldQty = numOrNull(row[m.yieldQty])!;
        rec.kind = "PREP";
        const u = m.yieldUnit ? cleanUnit(str(row[m.yieldUnit])) : "";
        if (u && dimensionOf(u)) { rec.yieldUnit = u; rec.yieldBase = dimensionOf(u)!; }
      }
      if (!ingName) return;
      const qty = numOrNull(row[m.qty!]);
      if (qty == null || qty <= 0) {
        issues.push({ level: "warn", table: table.name, row: rowNum, message: `${recipeName} → ${ingName}: missing quantity, line skipped` });
        return;
      }
      const unit = m.unit ? cleanUnit(str(row[m.unit])) || "each" : "each";
      rec.lines.push({ ingredient: ingName, qty, unit });
    });
  }

  // 3) Resolve recipe lines → sub-recipe, planned/existing ingredient, fuzzy match, or new ingredient.
  const allIngNames = new Map<string, string>([...existing.ingredients.map((i) => [key(i.name), i.name] as const), ...[...ingredients.values()].map((i) => [key(i.name), i.name] as const)]);
  for (const rec of recipes.values()) {
    for (const line of rec.lines) {
      const k = key(line.ingredient!);
      if (recipes.has(k) || existingRec.has(k)) {
        line.subRecipe = recipes.get(k)?.name ?? existing.recipes.find((r) => key(r.name) === k)!.name;
        line.ingredient = undefined;
        const sub = recipes.get(k);
        if (sub && sub.kind === "MENU") sub.kind = "PREP";
        continue;
      }
      if (allIngNames.has(k)) { line.ingredient = allIngNames.get(k); continue; }
      let best: string | null = null;
      let bestScore = -Infinity;
      for (const [, name] of allIngNames) {
        const s = fuzzyScore(line.ingredient!, name);
        if (s != null && s > bestScore) { best = name; bestScore = s; }
      }
      if (best && bestScore > line.ingredient!.replace(/\s/g, "").length * 2.5) {
        issues.push({ level: "info", table: rec.name, message: `"${line.ingredient}" matched to ingredient "${best}"` });
        line.ingredient = best;
      } else {
        const dim = dimensionOf(line.unit) ?? "each";
        ingredients.set(k, { name: line.ingredient!, category: "Other", storageArea: "Dry storage", baseUnit: dim, yieldPct: 1 });
        allIngNames.set(k, line.ingredient!);
        issues.push({ level: "warn", table: rec.name, message: `"${line.ingredient}" isn't in the ingredient list — created without a price` });
      }
    }
  }
  // Prep recipes used by weight/volume need a matching yield unit; flag instead of guessing.
  for (const rec of recipes.values()) {
    if (rec.kind === "PREP" && rec.yieldBase === "each") {
      const usedAs = [...recipes.values()].flatMap((r) => r.lines).find((l) => l.subRecipe === rec.name);
      const dim = usedAs ? dimensionOf(usedAs.unit) : null;
      if (dim && dim !== "each") issues.push({ level: "warn", table: rec.name, message: `Prep recipe "${rec.name}" needs a batch yield (e.g. 2 l) so its cost per ${usedAs!.unit} can be worked out` });
    }
  }

  return { ingredients: [...ingredients.values()], recipes: [...recipes.values()], suppliers: [...suppliers], issues };
}

// ---- Pasted text -------------------------------------------------------------

/** Parse a block copied from Sheets/Excel (tab-separated) or CSV into a table. */
export function parsePastedTable(text: string, name = "Pasted table"): RawTable {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { name, headers: [], rows: [] };
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const split = (l: string) => (sep === "\t" ? l.split("\t") : splitCsv(l)).map((c) => c.trim());
  const headers = split(lines[0]).map((h, i) => h || `Column ${i + 1}`);
  const rows = lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { name, headers, rows };
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Whole workbook as .xlsx (all tabs). */
export function googleSheetXlsxUrl(url: string): string | null {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx` : null;
}
