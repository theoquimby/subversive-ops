import "server-only";
import { normalPostal, type PlaceProfile } from "@/domain/places";
import { squareCall, SquareClient } from "./square-http";

/**
 * Customer profiles (scope CUSTOMERS_READ: "Permissions: CUSTOMERS_READ" on
 * POST /v2/customers/bulk-retrieve). The request takes `customer_ids` (1 to
 * 100); the answer is `responses`, a map from each id to `{ customer }` or
 * `{ errors }`. Profiles Square makes by itself after a card payment
 * ("instant profiles") aren't listed by ListCustomers when they hold no public
 * details, but they are returned here, which is why this asks by id.
 *
 * Square sends the whole profile. Only two things on it are looked at: the
 * postal code of its address and `creation_source`. The name, email, phone,
 * street and everything else are never read, and nothing is kept.
 */

interface RawCustomer {
  address?: { postal_code?: string };
  creation_source?: string;
}

const BULK = 100;

/** The postal code and origin of each profile Square returns for `ids`; ids it doesn't know are left out. */
export async function profilePlaces(client: SquareClient, ids: readonly string[]): Promise<Map<string, PlaceProfile>> {
  const out = new Map<string, PlaceProfile>();
  for (let i = 0; i < ids.length; i += BULK) {
    const r = await squareCall<{ responses?: Record<string, { customer?: RawCustomer }> }>(client, "/customers/bulk-retrieve", {
      method: "POST",
      body: JSON.stringify({ customer_ids: ids.slice(i, i + BULK) }),
    });
    for (const [id, v] of Object.entries(r.responses ?? {})) {
      if (v.customer) out.set(id, { postal: normalPostal(v.customer.address?.postal_code), source: v.customer.creation_source ?? null });
    }
  }
  return out;
}
