/**
 * Suggested purchase orders.
 *
 * For each ingredient bought from a supplier:
 *   projected on hand at delivery = on hand now − usage until delivery + already-ordered
 *   needed for the cover window   = forecast usage (delivery → next delivery) × (1 + safety)
 *   order                         = max(0, needed − projected), rounded up to whole packs
 *
 * Every number that goes into a suggestion is returned alongside it, so the
 * person placing the order can see *why* and override confidently.
 */

export interface OrderableProduct {
  supplierProductId: string;
  ingredientId: string;
  ingredientName: string;
  description: string;
  purchaseUnit: string;
  packQtyBase: number | null;
  unitPrice: number | null;
  safetyPct: number;
}

export interface IngredientPosition {
  onHandNow: number; // base units, may be estimated
  /** False when the ingredient has never been counted — stock is unknown, not zero. */
  onHandKnown?: boolean;
  usageUntilDelivery: number; // base units
  usageDuringCover: number; // base units
  incomingBeforeDelivery: number; // base units already on open orders
}

export interface OrderSuggestion {
  supplierProductId: string;
  ingredientId: string;
  ingredientName: string;
  description: string;
  purchaseUnit: string;
  packQtyBase: number | null;
  unitPrice: number | null;
  projectedAtDelivery: number;
  neededForCover: number;
  shortfall: number;
  suggestedUnits: number;
  lineCost: number | null;
  status: "covered" | "order" | "needs-setup" | "needs-count";
  note?: string;
}

export function suggestLine(p: OrderableProduct, pos: IngredientPosition): OrderSuggestion {
  const projected = pos.onHandNow - pos.usageUntilDelivery + pos.incomingBeforeDelivery;
  const needed = pos.usageDuringCover * (1 + p.safetyPct);
  const shortfall = Math.max(0, needed - Math.max(0, projected));

  const base = {
    supplierProductId: p.supplierProductId,
    ingredientId: p.ingredientId,
    ingredientName: p.ingredientName,
    description: p.description,
    purchaseUnit: p.purchaseUnit,
    packQtyBase: p.packQtyBase,
    unitPrice: p.unitPrice,
    projectedAtDelivery: projected,
    neededForCover: needed,
    shortfall,
  };

  if (!p.packQtyBase || p.packQtyBase <= 0) {
    return { ...base, suggestedUnits: 0, lineCost: null, status: "needs-setup", note: "Set the pack size so this can be ordered automatically." };
  }
  if (pos.onHandKnown === false) {
    // Don't guess: ordering a full case because we *don't know* is how over-ordering happens.
    return { ...base, suggestedUnits: 0, lineCost: 0, status: "needs-count", note: "Count this once so it can be ordered automatically." };
  }
  // Tiny tolerance so 2.0000001 cases doesn't become 3.
  const units = shortfall <= 0 ? 0 : Math.ceil(shortfall / p.packQtyBase - 1e-6);
  return {
    ...base,
    suggestedUnits: units,
    lineCost: p.unitPrice == null ? null : units * p.unitPrice,
    status: units > 0 ? "order" : "covered",
  };
}

/**
 * Estimated on-hand quantity: last count, plus deliveries received after it,
 * minus theoretical usage from sales and logged waste since the count.
 */
export function estimateOnHand(args: {
  lastCountQty: number | null;
  receivedSinceCount: number;
  usageSinceCount: number;
  wasteSinceCount: number;
}): { qty: number; estimated: boolean } {
  if (args.lastCountQty == null) return { qty: 0, estimated: true };
  const qty = args.lastCountQty + args.receivedSinceCount - args.usageSinceCount - args.wasteSinceCount;
  return { qty: Math.max(0, qty), estimated: true };
}
