import "server-only";
import { reviewsPlace } from "@/domain/googleData";
import { googleHub, type GoogleHub, type GoogleHubFacts } from "@/domain/googleHub";
import type { SecretStatus } from "@/domain/secrets";
import { db } from "../db";
import { googleStatus, type GoogleStatus } from "./googleSearch";
import { SETTING_PLACE_ID } from "./reviews";
import { secretStatus } from "./secrets";

export interface GoogleHubData {
  hub: GoogleHub;
  status: GoogleStatus;
  secrets: { clientId: SecretStatus; clientSecret: SecretStatus; places: SecretStatus };
  /** Where reviews come from: the picked listing when it has a place id, else the business found by search. */
  place: { id: string | null; name: string | null; fromListing: boolean };
  /** The last Google reviews test (the Find my business search), as Settings → Connections stores it. */
  reviewsTest: { ok: boolean; message: string; at: string } | null;
}

/** Everything Settings → Connections → Google shows, read once. Secret values never leave the server: only their status. */
export async function googleHubData(): Promise<GoogleHubData> {
  const [status, [clientId, clientSecret, places], rows] = await Promise.all([
    googleStatus(),
    secretStatus(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_PLACES_API_KEY"]),
    db.setting.findMany({ where: { key: { in: [SETTING_PLACE_ID, "reviews.googlePlaceName", "connections.test.google"] } } }),
  ]);
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  let reviewsTest: GoogleHubData["reviewsTest"] = null;
  try {
    const raw = get("connections.test.google");
    reviewsTest = raw ? (JSON.parse(raw) as GoogleHubData["reviewsTest"]) : null;
  } catch {
    reviewsTest = null;
  }
  const place = reviewsPlace({ location: status.location, title: status.locationTitle, placeId: status.locationPlaceId }, { id: get(SETTING_PLACE_ID), name: get("reviews.googlePlaceName") });
  const facts: GoogleHubFacts = {
    signIn: {
      clientIdSaved: clientId.set,
      clientSecretSaved: clientSecret.set,
      connected: status.connected,
      connectedBy: status.connectedBy,
      connectedAt: status.connectedAt,
      needsReconnect: status.needsReconnect,
      searchAllowed: status.grant.search,
      listingAllowed: status.grant.business,
    },
    search: { siteUrl: status.siteUrl, syncedAt: status.state.search.at, error: status.state.search.error, hasData: status.hasSearchData },
    listing: { location: status.location, title: status.locationTitle, syncedAt: status.state.profile.at, error: status.state.profile.error, hasData: status.hasProfileData },
    reviews: { keySaved: places.set, placeId: place.id, placeName: place.name, fromListing: place.fromListing, test: reviewsTest },
  };
  return { hub: googleHub(facts), status, secrets: { clientId, clientSecret, places }, place, reviewsTest };
}
