/**
 * Prices typed by hand: a first price for an ingredient that has no supplier
 * product yet, and the price boxes on "Update prices by hand".
 */
import { parseAmount } from "@/lib/amount";
import { toBase, type BaseUnit, type CustomConversion } from "./units";

export interface HandPriceInput {
  /** An existing supplier's name, or a new one. */
  supplier: string;
  /** What you buy, as you'd say it: "50 lb bag", "case of 6 #10 cans". Optional. */
  what: string;
  /** How much is in one of it: "50" + "lb". */
  size: string;
  sizeUnit: string;
  /** The price of one, and what one is called ("case", "bag"). */
  price: string;
  per: string;
}

export interface HandPrice {
  supplier: string;
  description: string;
  packText: string;
  purchaseUnit: string;
  /** How much of the ingredient's base unit one contains. */
  packQtyBase: number;
  price: number;
}

const MEASURE: Record<BaseUnit, string> = { g: "weight", ml: "volume", each: "count" };

export function readHandPrice(input: HandPriceInput, ingredientName: string, base: BaseUnit, conversions: readonly CustomConversion[]): { ok: HandPrice } | { error: string; field: keyof HandPriceInput } {
  const supplier = input.supplier.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!supplier) return { error: "Pick a supplier, or type a new one.", field: "supplier" };
  const size = parseAmount(input.size);
  if (size == null || !(size > 0)) return { error: "How much is in one? For example 50 lb.", field: "size" };
  let packQtyBase: number;
  try {
    packQtyBase = toBase(size, input.sizeUnit, base, conversions);
  } catch {
    return { error: `${ingredientName} is measured by ${MEASURE[base]}, so ${input.sizeUnit || "that unit"} doesn't work here. Pick another unit.`, field: "sizeUnit" };
  }
  const price = parseAmount(input.price);
  if (price == null || !(price > 0)) return { error: "Type the price, for example $42.50.", field: "price" };
  const what = input.what.trim().replace(/\s+/g, " ").slice(0, 80);
  const purchaseUnit = input.per.trim().toLowerCase().slice(0, 20) || "case";
  return {
    ok: {
      supplier,
      description: what ? `${ingredientName}, ${what}` : ingredientName,
      packText: what || `${Number(size.toFixed(3))} ${input.sizeUnit}`,
      purchaseUnit,
      packQtyBase,
      price: Math.round(price * 100) / 100,
    },
  };
}

/** The item number for a product added by hand: one per ingredient and supplier. */
export const handSku = (ingredientId: string) => `HAND-${ingredientId.slice(-8).toUpperCase()}`;

export type TypedPrice =
  | { kind: "blank" }
  | { kind: "same"; price: number }
  | { kind: "bad"; error: string }
  | { kind: "change"; price: number; delta: number | null };

/** What a price box holds: nothing, the same price, a new one, or something that isn't a price. */
export function typedPrice(text: string, current: number | null): TypedPrice {
  if (!text.trim()) return { kind: "blank" };
  const n = parseAmount(text);
  if (n == null) return { kind: "bad", error: "Not a price" };
  if (n < 0) return { kind: "bad", error: "Can't be below 0" };
  const price = Math.round(n * 100) / 100;
  if (current != null && Math.abs(price - current) < 0.005) return { kind: "same", price };
  return { kind: "change", price, delta: current ? (price - current) / current : null };
}
