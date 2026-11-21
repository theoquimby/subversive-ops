import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { autoLinkedToday, autoLinkSalesQuietly, linkAssistant, recentAutoLinks } from "@/server/services/linking";
import { businessToday } from "@/server/services/sales";

/** Drafting many recipes runs in stretches of up to a minute. */
export const maxDuration = 60;
import { LinkAssistantView } from "./link-assistant";

export const metadata = { title: "Link your sales" };

export default async function LinkSalesPage() {
  await requireUser("MANAGER");
  // Overnight linking also runs on the first look of the day, so a new sure match doesn't wait a night.
  if (!(await autoLinkedToday(businessToday()))) await autoLinkSalesQuietly();
  const [a, auto] = await Promise.all([linkAssistant(), recentAutoLinks()]);
  return (
    <>
      <PageHeader
        help="sales.link"
        title="Link your sales"
        back={{ href: "/sales", label: "Sales" }}
        description="Give every Square item a cost: a recipe, a keg, or a cost each. The list below says what to do first; each link shows what it does before it's saved, and every change can be undone."
      />
      <LinkAssistantView data={{ coverage: a.coverage, plan: a.plan, unlinked: a.unlinked, skipped: a.skipped, beerGroups: a.beerGroups, flagged: a.flagged, recipes: a.recipes, parts: a.parts, history: a.history, neverSold: a.neverSold, auto }} />
    </>
  );
}
