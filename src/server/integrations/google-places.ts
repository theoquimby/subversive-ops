import "server-only";
import { getSecret } from "../services/secrets";
import { NO_NETWORK } from "./network";

/**
 * Google Places API (New) — Place Details (reviews field) and Text Search
 * ("Find my business" in Settings → Connections, so nobody needs to know what
 * a Place ID is). Google returns at most the 5 most relevant reviews per call,
 * so this is a "keep up with what's new" import, not a full history.
 *
 * Needs a Google key (Settings → Connections, or GOOGLE_PLACES_API_KEY) and
 * the Setting `reviews.googlePlaceId`.
 */

export const googlePlacesKey = async () => (await getSecret("GOOGLE_PLACES_API_KEY")) ?? "";
export const googlePlacesReady = async () => (await googlePlacesKey()).length > 0;

export const GOOGLE_NOT_SET_UP = "Google reviews turn on once a Google key is added in Settings → Connections.";

export interface GoogleReview {
  externalId: string;
  author: string | null;
  rating: number;
  text: string;
  postedAt: Date;
}

interface PlacesResponse {
  reviews?: {
    name?: string;
    rating?: number;
    text?: { text?: string };
    originalText?: { text?: string };
    authorAttribution?: { displayName?: string };
    publishTime?: string;
  }[];
  error?: { message?: string; status?: string };
}

/** Plain-English version of a Google error. */
export function friendlyGoogleError(status: number, message?: string, gStatus?: string): string {
  const m = message ?? "";
  if (/API key not valid|API_KEY_INVALID/i.test(m) || (gStatus === "INVALID_ARGUMENT" && /key/i.test(m))) return "Google didn't accept that key. Copy it again from Google Cloud → Keys & credentials.";
  if (/has not been used|is disabled|SERVICE_DISABLED|not enabled/i.test(m)) return "The key works, but “Places API (New)” isn't turned on for it yet. In Google Cloud, search for Places API (New) and press Enable, wait a minute, then test again.";
  if (/billing/i.test(m)) return "Google needs a billing account on this project before it answers (the review import stays within the free monthly allowance). Add one in Google Cloud → Billing, then test again.";
  if (/referer|referrer|restricted|blocked/i.test(m) || status === 403) return "Google blocked the request — the key probably has a restriction that doesn't allow this app. Under the key's settings, set Application restrictions to None, or allow Places API (New).";
  if (status === 404) return "Google couldn't find that business any more. Use Find my business to pick it again.";
  if (status === 429) return "Google says we're asking too often. Try again in a minute.";
  return m ? `Google said: ${m}` : `Google answered with an error (${status}). Try again in a minute.`;
}

async function googleFetch<T>(url: string, init: RequestInit & { key: string; fieldMask: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "X-Goog-Api-Key": init.key, "X-Goog-FieldMask": init.fieldMask, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(NO_NETWORK("Google"));
  }
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) throw new Error(friendlyGoogleError(res.status, j.error?.message, j.error?.status));
  return j;
}

export async function fetchGoogleReviews(placeId: string): Promise<GoogleReview[]> {
  const key = await googlePlacesKey();
  if (!key) throw new Error(GOOGLE_NOT_SET_UP);
  const j = await googleFetch<PlacesResponse>(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`, { key, fieldMask: "reviews" });
  return (j.reviews ?? [])
    .filter((r) => r.rating && r.publishTime)
    .map((r) => ({
      externalId: r.name ?? `${r.authorAttribution?.displayName}|${r.publishTime}`,
      author: r.authorAttribution?.displayName ?? null,
      rating: Math.round(r.rating!),
      text: (r.originalText?.text ?? r.text?.text ?? "").trim(),
      postedAt: new Date(r.publishTime!),
    }));
}

export interface PlaceMatch {
  id: string;
  name: string;
  address: string;
  rating: number | null;
  reviews: number | null;
}

/**
 * "Find my business": Places Text Search with a name and town, e.g.
 * "Subversive Brewing Plattsburgh". `key` tests a key before it's saved.
 */
export async function findPlaces(query: string, key?: string): Promise<PlaceMatch[]> {
  const k = key ?? (await googlePlacesKey());
  if (!k) throw new Error(GOOGLE_NOT_SET_UP);
  const j = await googleFetch<{ places?: { id: string; displayName?: { text?: string }; formattedAddress?: string; rating?: number; userRatingCount?: number }[] }>(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      key: k,
      fieldMask: "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount",
      body: JSON.stringify({ textQuery: query, languageCode: "en", pageSize: 5 }),
    },
  );
  return (j.places ?? []).map((p) => ({ id: p.id, name: p.displayName?.text ?? "Unnamed place", address: p.formattedAddress ?? "", rating: p.rating ?? null, reviews: p.userRatingCount ?? null }));
}
