import { Camera, ChevronRight } from "lucide-react";
import { HelpZone } from "@/components/help";
import { Badge, Card, LinkButton } from "@/components/ui";
import { META_SETUP_HREF } from "@/domain/onlineChannels";
import { metaStatus } from "@/server/services/metaChannels";

/** Settings → Connections: the Instagram and Facebook Page connection, managed on its own page. */
export async function MetaTile() {
  const s = await metaStatus();
  const tone = s.needsReconnect ? "bad" : s.connected ? (s.pageId ? "good" : "warn") : s.appReady ? "warn" : "neutral";
  const text = s.needsReconnect ? "Connect again" : s.connected ? (s.pageId ? "Connected" : "Pick the Page") : s.appReady ? "Ready to connect" : "Not set up";
  return (
    <HelpZone id="online.meta" className="mt-6 block">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5" data-tour="connections.meta">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[0.65rem] bg-surface-2 text-ink-2"><Camera className="size-[1.1rem]" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">Instagram & Facebook Page</span>
              <Badge tone={tone}>{text}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-ink-2">Followers, how far your posts and reels travel, and what people tap on the profile and the Page. One sign-in with Facebook, read-only. Shows under Online.</p>
          </div>
        </div>
        <LinkButton href={META_SETUP_HREF} variant={s.connected ? "secondary" : "primary"}>{s.connected ? "Manage" : "Set up"} <ChevronRight className="size-4" /></LinkButton>
      </Card>
    </HelpZone>
  );
}
