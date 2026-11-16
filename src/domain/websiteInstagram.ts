/**
 * The latest Instagram posts for the website (GET /api/public/instagram), from
 * what the nightly Meta sync already keeps in OnlinePost. The shape follows
 * Instagram's own media fields, so the website reads it the way it read
 * Instagram: { id, caption, mediaType, mediaUrl, thumbnailUrl, permalink, timestamp }.
 *
 * Instagram's picture addresses are signed and run out (the `oe` parameter is
 * the expiry, in hex seconds). The nightly sync reads the latest posts again
 * and stores fresh addresses; a post whose address has run out (say the sync
 * stopped) is left out rather than sent as a broken picture. Pure.
 */

export const INSTAGRAM_FEED_LIMIT = 5;
/** Leave a picture out when it runs out within this long (it may sit in caches meanwhile). */
const EXPIRY_MARGIN_MS = 2 * 60 * 60 * 1000;

export type IgMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";

export interface WebInstagramPost {
  id: string;
  /** The first couple of hundred characters, on one line. */
  caption: string | null;
  mediaType: IgMediaType;
  /** The picture for IMAGE and CAROUSEL_ALBUM (a carousel's first). null for VIDEO: Ops keeps only its cover. */
  mediaUrl: string | null;
  /** The cover picture for VIDEO (reels too); null otherwise, as Instagram does. */
  thumbnailUrl: string | null;
  permalink: string;
  /** ISO instant it was posted. */
  timestamp: string;
}

export interface StoredIgPost {
  externalId: string;
  /** post | reel | video | carousel */
  kind: string;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  postedAt: string;
}

/** When a signed Instagram/Facebook picture address runs out, from its oe= parameter. */
export function cdnExpiry(url: string): Date | null {
  try {
    const oe = new URL(url).searchParams.get("oe");
    if (!oe || !/^[0-9a-f]{1,12}$/i.test(oe)) return null;
    return new Date(parseInt(oe, 16) * 1000);
  } catch {
    return null;
  }
}

const isInstagramCdn = (src: string) => {
  try {
    const u = new URL(src);
    return u.protocol === "https:" && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname);
  } catch {
    return false;
  }
};

const isPermalink = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" && /^(www\.)?instagram\.com$/.test(u.hostname);
  } catch {
    return false;
  }
};

const mediaType = (kind: string): IgMediaType => (kind === "reel" || kind === "video" ? "VIDEO" : kind === "carousel" ? "CAROUSEL_ALBUM" : "IMAGE");

/** Newest first, at most five, only posts with a link and a picture that still works. */
export function instagramFeed(rows: readonly StoredIgPost[], now: Date, limit = INSTAGRAM_FEED_LIMIT): WebInstagramPost[] {
  const out: WebInstagramPost[] = [];
  const sorted = [...rows].sort((a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0));
  for (const r of sorted) {
    const pic = r.thumbnailUrl;
    if (!pic || !isInstagramCdn(pic) || !r.permalink || !isPermalink(r.permalink)) continue;
    const exp = cdnExpiry(pic);
    if (exp && exp.getTime() - now.getTime() < EXPIRY_MARGIN_MS) continue;
    const type = mediaType(r.kind);
    out.push({
      id: r.externalId,
      caption: r.caption?.trim() || null,
      mediaType: type,
      mediaUrl: type === "VIDEO" ? null : pic,
      thumbnailUrl: type === "VIDEO" ? pic : null,
      permalink: r.permalink,
      timestamp: r.postedAt,
    });
    if (out.length === limit) break;
  }
  return out;
}
