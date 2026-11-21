import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { linkAssistant } from "@/server/services/linking";
import { LinkAssistantView } from "./link-assistant";

export const metadata = { title: "Link your sales" };

export default async function LinkSalesPage() {
  await requireUser("MANAGER");
  const a = await linkAssistant();
  return (
    <>
      <PageHeader
        help="sales.link"
        title="Link your sales"
        back={{ href: "/sales", label: "Sales" }}
        description="Give every Square item a cost: a recipe, a keg, or a cost each. The list below says what to do first; each link shows what it does before it's saved, and every change can be undone."
      />
      <LinkAssistantView data={{ coverage: a.coverage, plan: a.plan, unlinked: a.unlinked, skipped: a.skipped, beerGroups: a.beerGroups, flagged: a.flagged, recipes: a.recipes, parts: a.parts, history: a.history, neverSold: a.neverSold }} />
    </>
  );
}
