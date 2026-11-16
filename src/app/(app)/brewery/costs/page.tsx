import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { cogsView } from "@/server/services/brewCogs";
import { CostsClient } from "./costs-client";

export const metadata = { title: "Brewing costs" };

export default async function Page() {
  await requireUser("MANAGER");
  const view = await cogsView();
  return (
    <>
      <PageHeader
        help="brewery.costs"
        title="Brewing costs"
        description="What each recipe costs per batch, barrel, keg and pint from today's ingredient prices, and what's left of the selling price. Try a price change below without saving anything."
      />
      <CostsClient view={view} />
      <p className="mt-3 text-xs text-muted">
        Per-volume costs share the batch over what reaches the kegs. Pint margins are against the average draft price on Square{view.squarePrices ? "" : " (not available right now)"}, after foam and line loss: {Math.round(view.pourYield * 100)}% of a keg reaches the glass{view.pourYieldMeasured ? ", measured from kicked kegs" : ""}.
      </p>
    </>
  );
}
