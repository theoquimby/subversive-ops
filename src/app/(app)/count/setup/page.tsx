import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { storageAreasWithCounts } from "@/server/services/inventory";
import { countItems, prepsOffCount } from "@/server/services/counts";
import { CountSetup } from "./count-setup";

export const metadata = { title: "Set up the count" };

/** Managers: get every item ready so anyone can count it right. */
export default async function CountSetupPage() {
  await requireUser("MANAGER");
  const [items, areas, preps] = await Promise.all([countItems("All", "MANAGER"), storageAreasWithCounts(), prepsOffCount()]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader help="count.setup" title="Set up the count" description="Put items in shelf order, add a photo and a how-to note, choose the units staff count in and how often. Add prep items you want counted." back={{ href: "/count", label: "Counts" }} />
      <CountSetup items={items} areas={areas} prepsOff={preps} />
    </div>
  );
}
