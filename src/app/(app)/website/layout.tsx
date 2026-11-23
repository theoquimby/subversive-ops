import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import type { ReactNode } from "react";
import { ChannelVars } from "../online/channel";
import { WebsiteTabs } from "./tabs";

/** The Website hub: one header and the tabs for every page under /website (including Analytics). */
export default async function WebsiteLayout({ children }: { children: ReactNode }) {
  await requireUser("MANAGER");
  const newInquiries = await db.webInquiry.count({ where: { seenAt: null } });
  return (
    <div className="max-w-6xl">
      <ChannelVars />
      <PageHeader
        help="website.page"
        title="Website"
        description="Everything guests see on the public website: hours, the notice, the menu, events and the inquiry form. Change it here and the website picks it up by itself."
      />
      <WebsiteTabs newInquiries={newInquiries} />
      {children}
    </div>
  );
}
