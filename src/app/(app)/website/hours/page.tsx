import { requireUser } from "@/server/auth";
import { getRegularHours, getSeasonalHours } from "@/server/services/labor-rules";
import { businessToday } from "@/server/services/sales";
import { getBusinessContact } from "@/server/services/settings";
import { siteFeed, websiteSettings } from "@/server/services/website";
import { HoursTab } from "./hours-client";

export const metadata = { title: "Website · Hours & notice" };

export default async function WebsiteHoursPage() {
  await requireUser("MANAGER");
  const [site, regular, seasons, s, contact] = await Promise.all([siteFeed(), getRegularHours(), getSeasonalHours(), websiteSettings(), getBusinessContact()]);
  return <HoursTab feed={site.feed} stale={site.stale} regular={regular} seasons={seasons.map((x) => ({ label: x.label, from: x.from, to: x.to }))} settings={{ notice: s.notice, exactHours: s.exactHours, links: s.links, phoneNote: s.phoneNote }} contact={contact} today={businessToday()} />;
}
