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

/** Town search for the weather location (Open-Meteo, free, no key). Never throws. */
export async function findTown(q: string): Promise<{ results: WeatherLocation[] } | { error: string }> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { error: "The town search isn't answering right now. Type the latitude and longitude instead." };
    const j = (await res.json()) as { results?: { name: string; latitude: number; longitude: number; admin1?: string; country_code?: string }[] };
    return {
      results: (j.results ?? []).map((r) => ({
        lat: Math.round(r.latitude * 10000) / 10000,
        lon: Math.round(r.longitude * 10000) / 10000,
        label: [r.name, r.country_code === "US" ? stateCode(r.admin1) : r.admin1 ?? r.country_code].filter(Boolean).join(", "),
      })),
    };
  } catch {
    return { error: "The town search isn't answering right now. Type the latitude and longitude instead." };
  }
}

const STATES: Record<string, string> = { "New York": "NY", Vermont: "VT", Massachusetts: "MA", Connecticut: "CT", "New Jersey": "NJ", Pennsylvania: "PA" };
const stateCode = (s?: string) => (s ? STATES[s] ?? s : undefined);

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
