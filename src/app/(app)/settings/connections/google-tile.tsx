import { Search } from "lucide-react";
import { GOOGLE_HUB_HREF, hubTileStatus } from "@/domain/googleHub";
import { googleHubData } from "@/server/services/googleHub";
import { LinkTile } from "./link-tile";

/** Settings → Connections: every Google connection in one tile, managed on Settings → Connections → Google. */
export async function GoogleTile() {
  const { hub } = await googleHubData();
  const s = hubTileStatus(hub.counts);
  return (
    <LinkTile
      help="settings.google"
      tour="connections.google"
      icon={Search}
      area="online"
      title="Google"
      turnsOn="Search Console, your Google listing and Google reviews, on one page. One sign-in and one key."
      tone={s.tone}
      label={s.label}
      detail={hub.summary}
      time="About 20 minutes, plus Google's review"
      href={GOOGLE_HUB_HREF}
    />
  );
}
