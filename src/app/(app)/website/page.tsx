import { requireUser } from "@/server/auth";
import { publicOrigin } from "@/server/services/public-url";
import { eventsFeed, feedsHealth, lastPing, menuFeed, siteFeed, websiteConnection } from "@/server/services/website";
import { listInquiries } from "@/server/services/websiteInquiries";
import { OverviewTab } from "./overview";

export const metadata = { title: "Website" };

export default async function WebsiteOverviewPage() {
  await requireUser("MANAGER");
  const origin = await publicOrigin();
  const [site, menu, events, ping, conn, health, inquiries] = await Promise.all([
    siteFeed().catch(() => null),
    menuFeed().catch(() => null),
    eventsFeed({ days: 60, pastDays: 0, origin }).catch(() => null),
    lastPing(),
    websiteConnection(),
    feedsHealth(origin),
    listInquiries(5),
  ]);
  return (
    <OverviewTab
      origin={origin}
      site={site?.feed ?? null}
      staleDays={site ? Object.keys(site.stale).length : 0}
      menu={menu ? { counts: menu.counts, warnings: menu.warnings.length, updated: menu.menu._meta.updated } : null}
      events={events?.events.slice(0, 4) ?? []}
      eventCount={events?.events.length ?? 0}
      ping={ping}
      websiteUrl={conn.url}
      secretSet={!!conn.secret}
      health={health}
      inquiries={inquiries}
    />
  );
}
