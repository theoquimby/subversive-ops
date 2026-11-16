import { describe, expect, it } from "vitest";
import { cdnExpiry, instagramFeed, type StoredIgPost } from "../websiteInstagram";

const now = new Date("2026-11-16T12:00:00Z");
const hex = (d: Date) => Math.floor(d.getTime() / 1000).toString(16).toUpperCase();
const cdn = (expires: Date, host = "scontent-lga3-1.cdninstagram.com") => `https://${host}/v/t51.29350-15/1_n.jpg?stp=dst-jpg&_nc_cat=1&oh=00_AYabc&oe=${hex(expires)}`;
const later = new Date("2026-11-20T00:00:00Z");

const post = (over: Partial<StoredIgPost>): StoredIgPost => ({ externalId: "1", kind: "post", caption: "Festbier is on.", permalink: "https://www.instagram.com/p/abc/", thumbnailUrl: cdn(later), postedAt: "2026-11-15T18:00:00.000Z", ...over });

describe("cdnExpiry", () => {
  it("reads Instagram's oe= expiry", () => {
    expect(cdnExpiry(cdn(later))?.toISOString()).toBe(later.toISOString());
    expect(cdnExpiry("https://scontent.cdninstagram.com/x.jpg")).toBeNull();
    expect(cdnExpiry("not a url")).toBeNull();
  });
});

describe("instagramFeed", () => {
  it("gives the latest five in the website's shape", () => {
    const rows = Array.from({ length: 7 }, (_, i) => post({ externalId: `${i}`, postedAt: `2026-11-${String(15 - i).padStart(2, "0")}T18:00:00.000Z` }));
    const out = instagramFeed(rows, now);
    expect(out.map((p) => p.id)).toEqual(["0", "1", "2", "3", "4"]);
    expect(out[0]).toEqual({ id: "0", caption: "Festbier is on.", mediaType: "IMAGE", mediaUrl: cdn(later), thumbnailUrl: null, permalink: "https://www.instagram.com/p/abc/", timestamp: "2026-11-15T18:00:00.000Z" });
  });

  it("sends a reel or video as its cover picture, a carousel as its first picture", () => {
    const [reel, carousel] = instagramFeed([post({ externalId: "r", kind: "reel" }), post({ externalId: "c", kind: "carousel", postedAt: "2026-11-14T00:00:00.000Z" })], now);
    expect(reel).toMatchObject({ mediaType: "VIDEO", mediaUrl: null, thumbnailUrl: cdn(later) });
    expect(carousel).toMatchObject({ mediaType: "CAROUSEL_ALBUM", mediaUrl: cdn(later), thumbnailUrl: null });
  });

  it("leaves out posts whose picture has run out, or isn't from Instagram, or has no link", () => {
    const soon = new Date(now.getTime() + 30 * 60_000);
    const out = instagramFeed(
      [
        post({ externalId: "expired", thumbnailUrl: cdn(new Date("2026-11-10T00:00:00Z")) }),
        post({ externalId: "soon", thumbnailUrl: cdn(soon) }),
        post({ externalId: "elsewhere", thumbnailUrl: "https://example.com/a.jpg" }),
        post({ externalId: "nopic", thumbnailUrl: null }),
        post({ externalId: "nolink", permalink: null }),
        post({ externalId: "fb-cdn", thumbnailUrl: cdn(later, "scontent.xx.fbcdn.net") }),
        post({ externalId: "no-expiry", thumbnailUrl: "https://scontent.cdninstagram.com/x.jpg" }),
      ],
      now,
    );
    expect(out.map((p) => p.id)).toEqual(["fb-cdn", "no-expiry"]);
  });
});
