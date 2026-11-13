import "server-only";
import { lineNetCents, lineUnits, type SquareLine, type SquareMoney } from "@/domain/squareOrders";
import { squareCall, SquareClient } from "./square-http";

/**
 * Minimal Square REST client — only the read endpoints this app needs
 * (catalog + orders). Uses fetch directly; no SDK dependency to keep current.
 * Every call takes the connected account explicitly (see services/square.ts).
 */

export { SquareError } from "./square-http";

// ---- Catalog -----------------------------------------------------------------

interface MoneyAmount { amount?: number | null }

interface CatalogObject {
  id: string;
  type: string;
  is_deleted?: boolean;
  item_data?: {
    name?: string;
    is_archived?: boolean;
    category_id?: string;
    categories?: { id: string }[];
    reporting_category?: { id: string };
    variations?: { id: string; is_deleted?: boolean; item_variation_data?: { name?: string; price_money?: MoneyAmount } }[];
  };
  category_data?: { name?: string };
  modifier_list_data?: {
    name?: string;
    modifiers?: { id: string; is_deleted?: boolean; modifier_data?: { name?: string; price_money?: MoneyAmount } }[];
  };
}

export interface SellableObject {
  squareId: string;
  squareName: string;
  squareType: "ITEM_VARIATION" | "MODIFIER";
  /** Name without the modifier list, used to match and to name new recipes. */
  baseName: string;
  /** Dollars; null for variable-priced items. */
  price: number | null;
  category: string | null;
  archived: boolean;
}

const dollars = (m?: MoneyAmount) => (m?.amount != null ? m.amount / 100 : null);

export async function listSellables(client: SquareClient): Promise<SellableObject[]> {
  const items: CatalogObject[] = [];
  const lists: CatalogObject[] = [];
  const categories = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ types: "ITEM,MODIFIER_LIST,CATEGORY" });
    if (cursor) q.set("cursor", cursor);
    const page = await squareCall<{ objects?: CatalogObject[]; cursor?: string }>(client, `/catalog/list?${q}`);
    for (const o of page.objects ?? []) {
      if (o.is_deleted) continue;
      if (o.type === "ITEM" && o.item_data) items.push(o);
      else if (o.type === "MODIFIER_LIST" && o.modifier_list_data) lists.push(o);
      else if (o.type === "CATEGORY") categories.set(o.id, o.category_data?.name ?? "");
    }
    cursor = page.cursor;
  } while (cursor);

  const out: SellableObject[] = [];
  for (const o of items) {
    const d = o.item_data!;
    const catId = d.categories?.[0]?.id ?? d.reporting_category?.id ?? d.category_id;
    const category = (catId && categories.get(catId)) || null;
    const vars = (d.variations ?? []).filter((v) => !v.is_deleted);
    for (const v of vars) {
      const vName = v.item_variation_data?.name;
      const name = vars.length > 1 && vName && vName !== "Regular" ? `${d.name} · ${vName}` : (d.name ?? "Item");
      out.push({ squareId: v.id, squareName: name, squareType: "ITEM_VARIATION", baseName: name, price: dollars(v.item_variation_data?.price_money), category, archived: !!d.is_archived });
    }
  }
  for (const o of lists) {
    const d = o.modifier_list_data!;
    for (const m of d.modifiers ?? []) {
      if (m.is_deleted) continue;
      const base = m.modifier_data?.name ?? "Modifier";
      out.push({ squareId: m.id, squareName: `${base} (${d.name ?? "modifier"})`, squareType: "MODIFIER", baseName: base, price: dollars(m.modifier_data?.price_money), category: d.name ?? null, archived: false });
    }
  }
  return out;
}

// ---- Orders ------------------------------------------------------------------

type Money = SquareMoney;
interface Order {
  id: string;
  closed_at?: string;
  total_money?: Money;
  total_tax_money?: Money;
  total_tip_money?: Money;
  total_service_charge_money?: Money;
  /** After returns; preferred when present. */
  net_amounts?: { total_money?: Money; tax_money?: Money; tip_money?: Money; service_charge_money?: Money };
  line_items?: SquareLine[];
  returns?: { return_line_items?: SquareLine[] }[];
}

export interface OrderTotal {
  closedAt: string;
  netSales: number; // dollars, after discounts and returns, before tax, tips & service charges; gift card sales excluded
  tips: number;
  tax: number; // dollars
}

export interface SoldUnit {
  closedAt: string; // ISO timestamp
  squareId: string;
  name: string;
  qty: number; // negative for returns
  netSales: number; // dollars after discounts, before tax; a line's net is shared between the item and its modifiers (each its own unit)
}

/** All units sold (items and modifiers) in completed orders closed in [start, end), plus per-order totals. */
export async function listOrders(client: SquareClient, startISO: string, endISO: string): Promise<{ units: SoldUnit[]; orders: OrderTotal[] }> {
  const out: SoldUnit[] = [];
  const totals: OrderTotal[] = [];
  // orders/search takes at most 10 locations per request.
  for (let i = 0; i < client.locationIds.length; i += 10) {
    const locationIds = client.locationIds.slice(i, i + 10);
    let cursor: string | undefined;
    do {
      const page = await squareCall<{ orders?: Order[]; cursor?: string }>(client, "/orders/search", {
        method: "POST",
        body: JSON.stringify({
          location_ids: locationIds,
          limit: 500,
          cursor,
          query: {
            filter: {
              date_time_filter: { closed_at: { start_at: startISO, end_at: endISO } },
              state_filter: { states: ["COMPLETED"] },
            },
            sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
          },
        }),
      });
      for (const order of page.orders ?? []) {
        if (!order.closed_at) continue;
        const cents = (m?: Money) => m?.amount ?? 0;
        const n = order.net_amounts;
        const gross = n ? cents(n.total_money) - cents(n.tax_money) - cents(n.tip_money) - cents(n.service_charge_money)
          : cents(order.total_money) - cents(order.total_tax_money) - cents(order.total_tip_money) - cents(order.total_service_charge_money);
        // Gift card loads are money in, not sales.
        const giftCards = (order.line_items ?? []).filter((li) => li.item_type === "GIFT_CARD").reduce((s, li) => s + lineNetCents(li), 0);
        totals.push({ closedAt: order.closed_at, netSales: (gross - giftCards) / 100, tips: cents(n?.tip_money ?? order.total_tip_money) / 100, tax: cents(n?.tax_money ?? order.total_tax_money) / 100 });
        const push = (lines: SquareLine[] | undefined, sign: 1 | -1) => {
          for (const li of lines ?? []) {
            for (const u of lineUnits(li, sign)) out.push({ closedAt: order.closed_at!, squareId: u.squareId, name: u.name, qty: u.qty, netSales: u.netCents / 100 });
          }
        };
        push(order.line_items, 1);
        for (const r of order.returns ?? []) push(r.return_line_items, -1);
      }
      cursor = page.cursor;
    } while (cursor);
  }
  return { units: out, orders: totals };
}
