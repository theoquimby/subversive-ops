/**
 * Net sales per item and per modifier from Square order line items.
 *
 * Square reports a line's discounts only for the line as a whole
 * (`total_discount_money`), while each modifier carries its pre-discount price
 * (`total_price_money`). Taking the modifiers' prices off the discounted line
 * put the whole discount on the base item, so a comped "$0 item + paid
 * add-ons" came out negative and a discounted sandwich with add-ons looked
 * cheaper than it was. Here the line's net is shared between the item and its
 * modifiers in proportion to their gross amounts, so the parts always add up
 * to the line's net.
 *
 * Field names follow Square's OrderLineItem / OrderReturnLineItem objects:
 * sale lines have `gross_sales_money` and `modifiers`; return lines have
 * `gross_return_money` and `return_modifiers`.
 */

export interface SquareMoney {
  amount?: number | null;
}

export interface SquareLineModifier {
  catalog_object_id?: string;
  name?: string;
  quantity?: string;
  total_price_money?: SquareMoney;
}

export interface SquareLine {
  catalog_object_id?: string;
  name?: string;
  variation_name?: string;
  quantity: string;
  item_type?: string;
  /** Sale lines. */
  gross_sales_money?: SquareMoney;
  /** Return lines. */
  gross_return_money?: SquareMoney;
  variation_total_price_money?: SquareMoney;
  total_discount_money?: SquareMoney;
  total_tax_money?: SquareMoney;
  total_service_charge_money?: SquareMoney;
  total_money?: SquareMoney;
  modifiers?: SquareLineModifier[];
  return_modifiers?: SquareLineModifier[];
}

export interface LineUnit {
  squareId: string;
  name: string;
  /** Negative for returns. */
  qty: number;
  /** Cents before tax, tips and service charges, after discounts. Negative for returns. */
  netCents: number;
}

const cents = (m?: SquareMoney | null) => m?.amount ?? 0;

/**
 * A line's net sales in cents: gross (item + modifiers) minus discounts,
 * before tax and service charges. Falls back to total − tax − service charge
 * when Square didn't send the gross amount.
 */
export function lineNetCents(li: SquareLine): number {
  const gross = li.gross_sales_money ?? li.gross_return_money;
  if (gross?.amount != null) return gross.amount - cents(li.total_discount_money);
  return cents(li.total_money) - cents(li.total_tax_money) - cents(li.total_service_charge_money);
}

const lineName = (li: SquareLine) => [li.name, li.variation_name && li.variation_name !== "Regular" ? li.variation_name : null].filter(Boolean).join(" · ");

/**
 * The units one line contributes: the item itself (when it's a catalog item)
 * and each catalog modifier. `sign` is 1 for sales, −1 for returns.
 */
export function lineUnits(li: SquareLine, sign: 1 | -1): LineUnit[] {
  const qty = Number(li.quantity) || 0;
  const mods = li.modifiers ?? li.return_modifiers ?? [];
  const net = lineNetCents(li);
  const modGross = mods.map((m) => Math.max(0, cents(m.total_price_money)));
  const modGrossSum = modGross.reduce((s, x) => s + x, 0);
  const lineGross = (li.gross_sales_money ?? li.gross_return_money)?.amount;
  const baseGross = Math.max(0, li.variation_total_price_money?.amount ?? (lineGross != null ? lineGross - modGrossSum : net - modGrossSum));
  const totalGross = baseGross + modGrossSum;
  const modNet = modGross.map((g) => (totalGross > 0 ? Math.round((net * g) / totalGross) : 0));
  const baseNet = net - modNet.reduce((s, x) => s + x, 0);

  const out: LineUnit[] = [];
  if (li.catalog_object_id) out.push({ squareId: li.catalog_object_id, name: lineName(li), qty: sign * qty, netCents: sign * baseNet });
  mods.forEach((m, i) => {
    if (!m.catalog_object_id) return;
    out.push({ squareId: m.catalog_object_id, name: m.name ?? "Modifier", qty: sign * qty * (m.quantity != null ? Number(m.quantity) || 0 : 1), netCents: sign * modNet[i] });
  });
  return out;
}
