import { Camera } from "lucide-react";
import { META_SETUP_HREF } from "@/domain/onlineChannels";
import { shortDate } from "@/lib/format";
import { metaStatus } from "@/server/services/metaChannels";
import { LinkTile } from "../../settings/connections/link-tile";

/** Settings → Connections: the Instagram and Facebook Page connection, managed on its own page. */
export async function MetaTile() {
  const s = await metaStatus();
  // Instagram that answers only to the owner's 60-day sign-in: a reminder from ten days before it runs out.
  const soon = s.connected && s.reconnectBy?.soon ? s.reconnectBy : null;
  const tone = s.needsReconnect ? "bad" : soon ? "warn" : s.connected ? (s.pageId ? "good" : "warn") : s.appReady ? "warn" : "neutral";
  const text = s.needsReconnect ? "Connect again" : soon ? (soon.daysLeft < 0 ? "Instagram stopped: connect again" : `Connect again by ${shortDate(soon.on)}`) : s.connected ? (s.pageId ? "Connected" : "Pick the Page") : s.appReady ? "Ready to connect" : "Not set up";
  return (
    <LinkTile
      help="online.meta"
      tour="connections.meta"
      icon={Camera}
      area="online"
      title="Instagram & Facebook Page"
      turnsOn="Followers, how far your posts and reels travel, and what people tap on the profile and the Page. One sign-in with Facebook, read-only."
      tone={tone}
      label={text}
      detail="Shows under Online › Instagram and Online › Facebook."
      time="About 15 minutes"
      href={META_SETUP_HREF}
    />
  );
}
