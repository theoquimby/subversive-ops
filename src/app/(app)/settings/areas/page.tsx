import { PageHeader } from "@/components/ui";
import { HelpZone } from "@/components/help";
import { requireUser } from "@/server/auth";
import { storageAreasWithCounts } from "@/server/services/inventory";
import { AreaManager } from "../../count/area-manager";

export const metadata = { title: "Storage areas" };

export default async function AreasSettingsPage() {
  await requireUser("MANAGER");
  const areas = await storageAreasWithCounts();
  return (
    <div className="max-w-2xl">
      <PageHeader
        help="settings.areas"
        back={{ href: "/settings", label: "Settings" }}
        title="Storage areas"
        description="Where things live — walk-in, freezer, bar, dry storage. Each area gets its own count, in the order you walk them."
      />
      <HelpZone id="settings.areas.list"><AreaManager areas={areas} /></HelpZone>
    </div>
  );
}
