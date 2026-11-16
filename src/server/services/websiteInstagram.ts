import "server-only";
import { instagramFeed, type WebInstagramPost } from "@/domain/websiteInstagram";
import { db } from "../db";
import { metaStatus } from "./metaChannels";

/**
 * The latest Instagram posts for the website, from what the nightly Meta sync
 * keeps (Online → Instagram). Nothing is asked of Instagram here, so the
 * website needs no token of its own. Empty until Instagram is connected.
 */
export async function instagramPostsFeed(now = new Date()): Promise<WebInstagramPost[]> {
  const s = await metaStatus();
  if (!s.igId) return [];
  const rows = await db.onlinePost.findMany({
    where: { channel: "instagram" },
    orderBy: { postedAt: "desc" },
    take: 25,
    select: { externalId: true, kind: true, caption: true, permalink: true, thumbnailUrl: true, postedAt: true },
  });
  return instagramFeed(
    rows.map((r) => ({ ...r, postedAt: r.postedAt.toISOString() })),
    now,
  );
}
