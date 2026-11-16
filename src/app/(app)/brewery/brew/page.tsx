import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { brewDayLists, gravityUnit } from "@/server/services/brewDay";
import { AbvCalculator, GravityUnitToggle } from "./gravity-bits";
import { BrewDayStart } from "./start";

export const metadata = { title: "Brew days" };

/**
 * Brew days: carry on with one that's going, start one for a planned brew, or
 * start one from a recipe. ?recipe=<id>, ?tank=<id> and ?batch=<id> come from
 * "Brew this" on a recipe, a tank on the tanks page and a brew on the schedule.
 */
export default async function BrewDaysPage({ searchParams }: { searchParams: Promise<{ recipe?: string; tank?: string; batch?: string }> }) {
  await requireUser("MANAGER");
  const [sp, lists, unit] = await Promise.all([searchParams, brewDayLists(), gravityUnit()]);
  return (
    <>
      <PageHeader
        help="brewery.brewday"
        title="Brew day"
        description="Readings, timers and hop additions for each stage, saved on the phone as you go."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GravityUnitToggle unit={unit} />
            <AbvCalculator unit={unit} />
          </div>
        }
      />
      <BrewDayStart lists={lists} pick={{ recipeId: sp.recipe ?? null, tankId: sp.tank ?? null, batchId: sp.batch ?? null }} />
    </>
  );
}
