import "server-only";

/**
 * Google Places API (New) — Place Details, reviews field only.
 * Google returns at most the 5 most relevant reviews per call, so this is a
 * "keep up with what's new" import, not a full history.
 *
 * Needs GOOGLE_PLACES_API_KEY (Places API (New) enabled) and the Setting
 * `reviews.googlePlaceId`.
 */

export const googlePlacesKey = () => process.env.GOOGLE_PLACES_API_KEY ?? "";
export const googlePlacesConfigured = () => googlePlacesKey().length > 0;

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
  error?: { message?: string };
}

export async function fetchGoogleReviews(placeId: string): Promise<GoogleReview[]> {
  const key = googlePlacesKey();
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "reviews" },
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as PlacesResponse;
  if (!res.ok) throw new Error(j.error?.message ?? `Google Places returned ${res.status}`);
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
