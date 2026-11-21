/**
 * Where payers live, as far as Square can say. Pure counting: the check page's
 * tally of payments and profiles, and the Customers page's picture of where the
 * cards that paid here come from (by town, by distance, locals against visitors).
 */

import type { RhythmKind } from "./guests";

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
  const zip = /^(\d{5})(-?\d{4})?$/.exec(s);
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

// ---- Which postal code belongs to which card -------------------------------------------------------

/** A payment as the nightly pass sees it: the scrambled card mark, the profile, and the card's own postal code. */
export interface CardPayment {
  cardKey: string | null;
  customerId: string | null;
  postal: string | null;
}

/** What's on file for a card already: where it lives (or "Square doesn't know"), and when that was asked. */
export interface KnownPlace {
  postal: string | null;
  source: PlaceSource;
  checkedOn: string;
}

export type PlaceSource = "profile" | "card" | "none";

/** A card Square had no postal code for is asked about again after this many days. */
export const RECHECK_DAYS = 90;

/**
 * The cards in these payments that need a place: never asked, or asked and found
 * nothing a while ago. Returns, per card, the profile ids to look up and any
 * postal code a typed-in card already gave.
 */
export function cardsToPlace(payments: readonly CardPayment[], known: ReadonlyMap<string, KnownPlace>, today: string, daysBetween: (a: string, b: string) => number) {
  const out = new Map<string, { customerIds: string[]; cardPostal: string | null }>();
  for (const p of payments) {
    if (!p.cardKey) continue;
    const k = known.get(p.cardKey);
    if (k && (k.postal || daysBetween(k.checkedOn, today) < RECHECK_DAYS)) continue;
    const e = out.get(p.cardKey) ?? { customerIds: [], cardPostal: null };
    if (p.customerId && !e.customerIds.includes(p.customerId)) e.customerIds.push(p.customerId);
    if (p.postal && !e.cardPostal) e.cardPostal = p.postal;
    out.set(p.cardKey, e);
  }
  return out;
}

/** The place to keep for a card: a profile's postal code first (it's where they say they live), then the card's own. */
export function placeFor(e: { customerIds: string[]; cardPostal: string | null }, profiles: ReadonlyMap<string, PlaceProfile>): { postal: string | null; source: PlaceSource } {
  for (const id of e.customerIds) {
    const postal = profiles.get(id)?.postal;
    if (postal) return { postal, source: "profile" };
  }
  return e.cardPostal ? { postal: e.cardPostal, source: "card" } : { postal: null, source: "none" };
}

// ---- The picture: where the cards that paid here come from ---------------------------------------------

/** People from one postal code, by kind of card, over the last 12 months. */
export interface PlaceRow {
  postal: string;
  kind: RhythmKind;
  people: number;
  sales: number;
}

/** A town on the map: where a postal code is, from the gazetteer. */
export interface PlaceInfo {
  lat: number;
  lon: number;
  city: string;
  state: string;
  country: string;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export type ByKind = Record<RhythmKind | "all", number>;

export interface Town {
  /** "Catskill, NY" (one bubble for all of a town's postal codes). */
  key: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  miles: number;
  people: ByKind;
  sales: number;
}

export interface DistanceBand {
  key: string;
  label: string;
  /** Up to (not including) this many miles; null for the last band. */
  under: number | null;
  people: ByKind;
}

export interface GuestPlaces {
  /** Cards seen in the last 12 months, how many of them have been asked about, and how many have a place. */
  guests: number;
  checked: number;
  placed: number;
  /** Placed cards whose postal code the gazetteer doesn't know (abroad, mistyped). */
  unknown: number;
  towns: Town[];
  bands: DistanceBand[];
  /** The middle distance for each kind of card, in miles (null with too few). */
  median: Record<RhythmKind | "all", number | null>;
  /** Cards from more than `FAR_MILES` away, by state: too far for the map, so they're listed. */
  far: { state: string; people: number }[];
}

export const BANDS: { key: string; label: string; under: number | null }[] = [
  { key: "near", label: "Under 15 miles", under: 15 },
  { key: "hour", label: "15 to 50 miles", under: 50 },
  { key: "trip", label: "50 to 150 miles", under: 150 },
  { key: "far", label: "150 miles or more", under: null },
];

/** Past this the map would have to show half the country: these are listed by state instead. */
export const FAR_MILES = 400;
/** The map is drawn once this many cards have a place. */
export const PLACES_MIN = 100;
const MEDIAN_MIN = 20;

const empty = (): ByKind => ({ local: 0, visitor: 0, occasional: 0, all: 0 });

/** Miles between two points on the earth (haversine). */
export function milesBetween(a: LatLon, b: LatLon): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

/** Weighted middle of a list of (value, weight). */
function weightedMedian(xs: { v: number; w: number }[]): number | null {
  const total = xs.reduce((s, x) => s + x.w, 0);
  if (total < MEDIAN_MIN) return null;
  const sorted = [...xs].sort((a, b) => a.v - b.v);
  let acc = 0;
  for (const x of sorted) {
    acc += x.w;
    if (acc >= total / 2) return x.v;
  }
  return sorted[sorted.length - 1]?.v ?? null;
}

/**
 * Group the cards by town (every postal code of a town in one bubble, placed at
 * their middle), measure each town from the taproom, and count each kind of
 * card by town and by distance.
 */
export function guestPlaces(rows: readonly PlaceRow[], totals: { guests: number; checked: number }, lookup: (postal: string) => PlaceInfo | null, home: LatLon): GuestPlaces {
  const towns = new Map<string, Town & { latW: number; lonW: number; w: number }>();
  const bands = BANDS.map((b) => ({ ...b, people: empty() }));
  const far = new Map<string, number>();
  const dist: Record<RhythmKind | "all", { v: number; w: number }[]> = { local: [], visitor: [], occasional: [], all: [] };
  let placed = 0;
  let unknown = 0;
  for (const r of rows) {
    if (r.people <= 0) continue;
    placed += r.people;
    const at = lookup(r.postal);
    if (!at) {
      unknown += r.people;
      continue;
    }
    const miles = milesBetween(home, at);
    const name = titleCase(at.city);
    const key = `${name}, ${at.state}`;
    const t = towns.get(key) ?? { key, name, state: at.state, lat: 0, lon: 0, miles: 0, people: empty(), sales: 0, latW: 0, lonW: 0, w: 0 };
    t.people[r.kind] += r.people;
    t.people.all += r.people;
    t.sales += r.sales;
    t.latW += at.lat * r.people;
    t.lonW += at.lon * r.people;
    t.w += r.people;
    towns.set(key, t);
    const band = bands.find((b) => b.under == null || miles < b.under)!;
    band.people[r.kind] += r.people;
    band.people.all += r.people;
    dist[r.kind].push({ v: miles, w: r.people });
    dist.all.push({ v: miles, w: r.people });
    if (miles >= FAR_MILES) far.set(at.state, (far.get(at.state) ?? 0) + r.people);
  }
  const list: Town[] = [...towns.values()].map(({ latW, lonW, w, ...t }) => {
    const lat = latW / w;
    const lon = lonW / w;
    return { ...t, lat, lon, miles: milesBetween(home, { lat, lon }), sales: Math.round(t.sales) };
  });
  list.sort((a, b) => b.people.all - a.people.all || a.key.localeCompare(b.key));
  return {
    guests: totals.guests,
    checked: totals.checked,
    placed,
    unknown,
    towns: list,
    bands,
    median: { local: weightedMedian(dist.local), visitor: weightedMedian(dist.visitor), occasional: weightedMedian(dist.occasional), all: weightedMedian(dist.all) },
    far: [...far].map(([state, people]) => ({ state, people })).sort((a, b) => b.people - a.people || a.state.localeCompare(b.state)),
  };
}

/** Setting set (to the day) the first time enough cards have a place for the map: the What's new card waits for it. */
export const PLACES_READY_KEY = "guests.placesReady";

/** Enough cards placed to draw the map. */
export const placesReady = (p: Pick<GuestPlaces, "placed"> | null | undefined) => !!p && p.placed >= PLACES_MIN;

export interface PlacePoint {
  key: string;
  tone: "good" | "warn" | "bad" | "neutral";
  title: string;
  detail: string;
  action: string | null;
}

const pc = (x: number) => `${Math.round(x * 100)}%`;
const n = (x: number) => Math.round(x).toLocaleString("en-US");
/** Distances the way people say them: "about 8 miles", "about 120 miles". */
export const milesLabel = (m: number) => (m < 1.5 ? "under 2 miles" : m < 20 ? `about ${Math.round(m)} miles` : `about ${Math.round(m / 10) * 10} miles`);

/** "Catskill, Cairo and Hudson": the top towns for one kind of card. */
function topTowns(towns: readonly Town[], kind: RhythmKind, k = 3): string[] {
  return towns
    .filter((t) => t.people[kind] > 0)
    .sort((a, b) => b.people[kind] - a.people[kind] || a.key.localeCompare(b.key))
    .slice(0, k)
    .map((t) => t.name);
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The finding for the Customers page: how far visitors come, where locals live, and how much of it Square could say. */
export function placesPoint(p: GuestPlaces): PlacePoint | null {
  if (!placesReady(p)) return null;
  const vMiles = p.median.visitor;
  const lMiles = p.median.local;
  const visitorsTowns = topTowns(p.towns, "visitor");
  const localTowns = topTowns(p.towns, "local");
  const visitorFar = p.bands.filter((b) => b.under == null || b.under > 50).reduce((s, b) => s + b.people.visitor, 0);
  const visitors = p.bands.reduce((s, b) => s + b.people.visitor, 0);
  const farShare = visitors > 0 ? visitorFar / visitors : 0;
  const title =
    vMiles != null && vMiles >= 50
      ? `Half your visitors come from ${milesLabel(vMiles)} away or more`
      : vMiles != null
        ? `Most visitors come from within an hour`
        : `Most cards that paid here come from ${p.median.all != null ? milesLabel(p.median.all) : "nearby"}`;
  const parts: string[] = [];
  if (visitorsTowns.length) parts.push(`Visitors come most from ${list(visitorsTowns)}${visitors > 0 ? `, and ${pc(farShare)} of them from more than 50 miles` : ""}.`);
  if (localTowns.length) parts.push(`Locals come${lMiles != null ? ` a middle distance of ${milesLabel(lMiles)},` : ""} mostly from ${list(localTowns)}.`);
  parts.push(`Based on the ${n(p.placed)} cards (${pc(p.placed / Math.max(1, p.guests))} of last year's) whose payer Square has a postal code for.`);
  const action =
    farShare >= 0.5
      ? "Visitors decide before they set off: the Google listing, the website and city weekend round-ups are where to reach them, a day or two ahead."
      : "Most visitors live within an hour: local radio, regional papers and neighbouring towns' event listings reach them.";
  return { key: "places", tone: "neutral", title, detail: parts.join(" "), action };
}
