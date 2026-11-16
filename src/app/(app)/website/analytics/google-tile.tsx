import { ChevronRight, Search } from "lucide-react";
import { HelpZone } from "@/components/help";
import { Badge, Card, LinkButton } from "@/components/ui";
import { googleStatus } from "@/server/services/googleSearch";

/** Settings → Connections: the Google Search Console + Business Profile connection, managed on its own page. */
export async function GoogleSearchTile() {
  const s = await googleStatus();
  const tone = s.needsReconnect ? "bad" : s.connected ? "good" : s.appReady ? "warn" : "neutral";
  const text = s.needsReconnect ? "Connect again" : s.connected ? "Connected" : s.appReady ? "Ready to connect" : "Not set up";
  return (
    <HelpZone id="website.analytics.googleSetup" className="mt-6 block">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5" data-tour="connections.googleSearch">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[0.65rem] bg-surface-2 text-ink-2"><Search className="size-[1.1rem]" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">Google Search & listing</span>
              <Badge tone={tone}>{text}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-ink-2">Search terms that find the website (Search Console) and how the Google listing is seen and used: calls, directions, website clicks. Shows under Online.</p>
          </div>
        </div>
        <LinkButton href="/website/analytics/google" variant={s.connected ? "secondary" : "primary"}>{s.connected ? "Manage" : "Set up"} <ChevronRight className="size-4" /></LinkButton>
      </Card>
    </HelpZone>
  );
}
