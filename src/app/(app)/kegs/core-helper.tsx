import { suggestionReason } from "@/domain/beerStanding";
import { coreHelper } from "@/server/services/beers";
import { dated } from "./accounts/bits";
import { CoreHelper } from "./standing";

/**
 * "Pick your core beers" on Demand and Setup, until one beer is core or a
 * manager hides it. Nothing when it's done; a problem working out the
 * suggestions leaves it out rather than taking the page down.
 */
export async function CoreHelperSection() {
  const rows = await coreHelper().catch((e) => {
    console.error("kegs: core helper skipped", (e as Error).message);
    return null;
  });
  if (!rows?.length) return null;
  return <CoreHelper items={rows.map((r) => ({ id: r.id, name: r.name, color: r.color, suggested: r.suggestion.standing, reason: suggestionReason(r.suggestion, dated) }))} />;
}
