import "server-only";
import { env } from "../env";

/**
 * Minimal Square REST client — only the read endpoints this app needs
 * (catalog + orders). Uses fetch directly; no SDK dependency to keep current.
 */

const SQUARE_VERSION = "2025-10-16";

const baseUrl = () =>
  env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";

export class SquareError extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body as { errors?: { detail?: string }[] }).errors?.map((e) => e.detail).join("; ");
    throw new SquareError(`Square ${res.status}: ${detail || res.statusText}`);
  }
  return body as T;
}

// ---- Catalog -----------------------------------------------------------------

interface CatalogObject {
  id: string;
  type: string;
  is_deleted?: boolean;
  item_data?: {
    name?: string;
    variations?: { id: string; is_deleted?: boolean; item_variation_data?: { name?: string } }[];
  };
  modifier_list_data?: {
    name?: string;
    modifiers?: { id: string; is_deleted?: boolean; modifier_data?: { name?: string } }[];
  };
}

export interface SellableObject {
  squareId: string;
  squareName: string;
  squareType: "ITEM_VARIATION" | "MODIFIER";
}

export async function listSellables(): Promise<SellableObject[]> {
  const out: SellableObject[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ types: "ITEM,MODIFIER_LIST" });
    if (cursor) q.set("cursor", cursor);
    const page = await call<{ objects?: CatalogObject[]; cursor?: string }>(`/catalog/list?${q}`);
    for (const o of page.objects ?? []) {
      if (o.is_deleted) continue;
      if (o.type === "ITEM" && o.item_data) {
        const vars = (o.item_data.variations ?? []).filter((v) => !v.is_deleted);
        for (const v of vars) {
          const vName = v.item_variation_data?.name;
          const name = vars.length > 1 && vName && vName !== "Regular" ? `${o.item_data.name} · ${vName}` : (o.item_data.name ?? "Item");
          out.push({ squareId: v.id, squareName: name, squareType: "ITEM_VARIATION" });
        }
      }
      if (o.type === "MODIFIER_LIST" && o.modifier_list_data) {
        for (const m of o.modifier_list_data.modifiers ?? []) {
          if (m.is_deleted) continue;
          out.push({ squareId: m.id, squareName: `${m.modifier_data?.name ?? "Modifier"} (${o.modifier_list_data.name ?? "modifier"})`, squareType: "MODIFIER" });
        }
      }
    }
    cursor = page.cursor;
  } while (cursor);
  return out;
}

// ---- Orders ------------------------------------------------------------------

interface Money { amount?: number }
interface OrderLine {
  catalog_object_id?: string;
  name?: string;
  variation_name?: string;
  quantity: string;
  total_money?: Money;
  modifiers?: { catalog_object_id?: string; name?: string; quantity?: string; total_price_money?: Money }[];
}
interface Order {
  id: string;
  closed_at?: string;
  line_items?: OrderLine[];
  returns?: { return_line_items?: OrderLine[] }[];
}

export interface SoldUnit {
  closedAt: string; // ISO timestamp
  squareId: string;
  name: string;
  qty: number; // negative for returns
  netSales: number; // dollars
}

/** All units sold (items and modifiers) in completed orders closed in [start, end). */
export async function listSoldUnits(startISO: string, endISO: string): Promise<SoldUnit[]> {
  const out: SoldUnit[] = [];
  let cursor: string | undefined;
  do {
    const page = await call<{ orders?: Order[]; cursor?: string }>("/orders/search", {
      method: "POST",
      body: JSON.stringify({
        location_ids: [env.SQUARE_LOCATION_ID],
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
      const push = (lines: OrderLine[] | undefined, sign: 1 | -1) => {
        for (const li of lines ?? []) {
          const qty = Number(li.quantity) || 0;
          if (li.catalog_object_id) {
            out.push({
              closedAt: order.closed_at!,
              squareId: li.catalog_object_id,
              name: [li.name, li.variation_name && li.variation_name !== "Regular" ? li.variation_name : null].filter(Boolean).join(" · "),
              qty: sign * qty,
              netSales: (sign * (li.total_money?.amount ?? 0)) / 100,
            });
          }
          for (const m of li.modifiers ?? []) {
            if (!m.catalog_object_id) continue;
            out.push({
              closedAt: order.closed_at!,
              squareId: m.catalog_object_id,
              name: m.name ?? "Modifier",
              qty: sign * qty * (m.quantity ? Number(m.quantity) : 1),
              netSales: (sign * (m.total_price_money?.amount ?? 0)) / 100,
            });
          }
        }
      };
      push(order.line_items, 1);
      for (const r of order.returns ?? []) push(r.return_line_items, -1);
    }
    cursor = page.cursor;
  } while (cursor);
  return out;
}
