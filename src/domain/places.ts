/**
 * Where payers live, as far as Square can say. Pure tallying for the check
 * page: it turns payments and the profiles behind them into counts and
 * three-digit areas. Nothing here is kept anywhere.
 */

/** One completed payment: the Square profile it's tied to, and a postal code the card itself carried. */
export interface PlacePayment {
  customerId: string | null;
  postal: string | null;
}

/** What is looked at on a Square customer profile: its postal code and how the profile came to be. */
export interface PlaceProfile {
  postal: string | null;
  source: string | null;
}

/** A tidy postal code (a US ZIP+4 cut to its five digits), or null when there isn't one. */
export function normalPostal(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return null;
  const zip = /^(\d{5})(-\d{4})?$/.exec(s);
  return zip ? zip[1] : s;
}

/** The first three characters: in the US, the sorting area a ZIP belongs to. */
export const areaOf = (postal: string) => postal.slice(0, 3);

export interface ProfileTally {
  /** Completed payments looked at. */
  payments: number;
  /** Different Square profiles behind them, and how many of those Square returned. */
  customers: number;
  found: number;
  /** Profiles that hold a postal code. */
  withPostal: number;
  /** Payments tied to a profile that holds one. */
  paymentsWithProfilePostal: number;
  /** Payments that can be placed at all: through the profile or through the card. */
  placed: number;
  distinctPostal: number;
  /** The commonest areas by people: a profile counts once however often it paid; a card with no profile counts per payment. */
  areas: { area: string; people: number }[];
  /** Profiles by how they were created (Square's creation_source), most first. */
  bySource: { source: string; customers: number; withPostal: number }[];
}

const AREAS_SHOWN = 12;

export function tallyProfiles(payments: readonly PlacePayment[], profiles: ReadonlyMap<string, PlaceProfile>): ProfileTally {
  const ids = new Set<string>();
  const cardPostal = new Map<string, string>();
  const areas = new Map<string, number>();
  const codes = new Set<string>();
  const place = (postal: string) => {
    codes.add(postal);
    areas.set(areaOf(postal), (areas.get(areaOf(postal)) ?? 0) + 1);
  };
  let paymentsWithProfilePostal = 0;
  let placed = 0;
  for (const p of payments) {
    const profile = p.customerId ? (profiles.get(p.customerId)?.postal ?? null) : null;
    if (p.customerId) {
      ids.add(p.customerId);
      if (p.postal && !cardPostal.has(p.customerId)) cardPostal.set(p.customerId, p.postal);
    } else if (p.postal) {
      place(p.postal);
    }
    if (profile) paymentsWithProfilePostal++;
    if (profile || p.postal) placed++;
  }
  const by = new Map<string, { customers: number; withPostal: number }>();
  let found = 0;
  let withPostal = 0;
  for (const id of ids) {
    const profile = profiles.get(id);
    const postal = profile?.postal ?? cardPostal.get(id) ?? null;
    if (postal) place(postal);
    if (!profile) continue;
    found++;
    const s = by.get(profile.source ?? "OTHER") ?? { customers: 0, withPostal: 0 };
    s.customers++;
    if (profile.postal) {
      s.withPostal++;
      withPostal++;
    }
    by.set(profile.source ?? "OTHER", s);
  }
  return {
    payments: payments.length,
    customers: ids.size,
    found,
    withPostal,
    paymentsWithProfilePostal,
    placed,
    distinctPostal: codes.size,
    areas: [...areas].map(([area, people]) => ({ area, people })).sort((a, b) => b.people - a.people || a.area.localeCompare(b.area)).slice(0, AREAS_SHOWN),
    bySource: [...by].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.customers - a.customers || a.source.localeCompare(b.source)),
  };
}
