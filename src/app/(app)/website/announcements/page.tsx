import { requireUser } from "@/server/auth";
import { businessToday } from "@/server/services/sales";
import { websiteConnection } from "@/server/services/website";
import { eventLinkOptions, listAnnouncements } from "@/server/services/websiteAnnouncements";
import { AnnouncementsTab } from "./announcements-client";

export const metadata = { title: "Website · Announcements" };

export default async function WebsiteAnnouncementsPage() {
  await requireUser("MANAGER");
  const [rows, events, conn] = await Promise.all([listAnnouncements(), eventLinkOptions(), websiteConnection()]);
  return <AnnouncementsTab rows={rows} events={events} today={businessToday()} siteUrl={conn.url} />;
}
