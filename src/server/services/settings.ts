import "server-only";
import { db } from "../db";

/**
 * Settings that have no other home: the business's contact details, the
 * weather location, and the labor % used when a week has no budget.
 * Every key has a default that matches how the app behaved before it existed.
 */

const put = (key: string, value: string) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

// ---- Business contact ------------------------------------------------------------------

export const CONTACT_FIELDS = ["name", "address", "phone", "email", "website"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export type BusinessContact = Record<ContactField, string>;

const contactKey = (f: ContactField) => `business.${f}`;

export async function getBusinessContact(): Promise<BusinessContact> {
  const rows = await db.setting.findMany({ where: { key: { in: CONTACT_FIELDS.map(contactKey) } } });
  const get = (f: ContactField) => rows.find((r) => r.key === contactKey(f))?.value ?? "";
  return { name: get("name") || "Subversive", address: get("address"), phone: get("phone"), email: get("email"), website: get("website") };
}

export async function saveBusinessField(field: ContactField, value: string) {
  if (!value && field !== "name") await db.setting.deleteMany({ where: { key: contactKey(field) } });
  else await put(contactKey(field), value);
}

// ---- Weather location ---------------------------------------------------------------------

export interface WeatherLocation {
  lat: number;
  lon: number;
  label: string;
}

export async function saveLocation(loc: WeatherLocation) {
  await put("location", JSON.stringify(loc));
  // The next weather refresh should use the new place straight away.
  await db.setting.deleteMany({ where: { key: "weather.status" } });
}

/**
 * Address lookup for the weather location, from the US Census Bureau's
 * geocoder (government service, free, no key). It needs a street address, not
 * just a town. Never throws.
 */
export async function findTown(q: string): Promise<{ results: WeatherLocation[] } | { error: string }> {
  const fail = { error: "The address lookup isn't answering right now. Type the latitude and longitude instead." };
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return fail;
    const j = (await res.json()) as { result?: { addressMatches?: { coordinates?: { x?: number; y?: number }; addressComponents?: { city?: string; state?: string } }[] } };
    const seen = new Set<string>();
    const results: WeatherLocation[] = [];
    for (const m of j.result?.addressMatches ?? []) {
      const lat = m.coordinates?.y;
      const lon = m.coordinates?.x;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      const city = (m.addressComponents?.city ?? "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
      const label = [city, m.addressComponents?.state].filter(Boolean).join(", ") || q;
      if (seen.has(label)) continue;
      seen.add(label);
      results.push({ lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000, label });
    }
    return { results: results.slice(0, 5) };
  } catch {
    return fail;
  }
}

// ---- Default labor target -----------------------------------------------------------------

const LABOR_DEFAULT_KEY = "budgets.defaultLaborPct";

/** Labor % (fraction) for weeks with no budget; null = none (the schedule then has no target, as before). */
export async function defaultLaborPct(): Promise<number | null> {
  const s = await db.setting.findUnique({ where: { key: LABOR_DEFAULT_KEY } });
  const n = Number(s?.value);
  return s && Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

export async function saveDefaultLaborPct(fraction: number | null) {
  if (fraction == null) await db.setting.deleteMany({ where: { key: LABOR_DEFAULT_KEY } });
  else await put(LABOR_DEFAULT_KEY, String(fraction));
}
