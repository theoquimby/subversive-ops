import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { elsewhereGroups, overviewBlocks, splitByFocus, type Focus, type OverviewBlock } from "@/domain/focus";
import { dayDate, relativeTime } from "@/lib/format";
import { TopInsights } from "@/app/(app)/insights/top-insights";
import { requireUser } from "@/server/auth";
import { focusPromptDismissed, userFocus } from "@/server/services/focus";
import { onboardingState } from "@/server/services/onboarding";
import { businessToday } from "@/server/services/sales";
import { setupChecklist } from "@/server/services/setupChecklist";
import { squareSummary } from "@/server/services/square";
import { refreshIfStale } from "@/server/services/square-sync";
import { FocusPrompt } from "./_overview/focus-picker";
import { BreweryBlock, CostsBlock, DeliveriesBlock, ElsewhereBlock, NeedsBlock, overviewNeeds, TodayBlock, WeekBlock } from "./_overview/sections";
import { SetupCard } from "./_overview/setup-card";
import { LastNightNotes } from "./notes/last-night";

export const metadata = { title: "Overview" };

/**
 * The Overview. With no focus it's the same for every manager. With one
 * ("What I look after"), it leads with the person's areas in their order and
 * folds the rest into Elsewhere. Each block loads its own data, so blocks that
 * aren't shown cost nothing (see _overview/sections.tsx).
 */
export default async function OverviewPage() {
  const session = await requireUser("MANAGER");
  const today = businessToday();
  const [focus, promptDismissed] = await Promise.all([userFocus(session.userId), focusPromptDismissed(session.userId).catch(() => true)]);
  const blocks = overviewBlocks(focus);

  const render = (b: OverviewBlock) => {
    switch (b) {
      case "today":
        return <TodayBlock key={b} today={today} />;
      case "needs":
        return <Needs key={b} focus={focus} />;
      case "notes":
        return <LastNightNotes key={b} />;
      case "insights":
        return <div key={b} className="empty:hidden"><TopInsights /></div>;
      case "week":
        return <WeekBlock key={b} today={today} />;
      case "costs":
        return <CostsBlock key={b} today={today} />;
      case "deliveries":
        return <DeliveriesBlock key={b} today={today} />;
      case "brewery":
        return <BreweryBlock key={b} />;
      case "elsewhere":
        return <Elsewhere key={b} focus={focus} />;
    }
  };

  return (
    <>
      <OverviewHeader />
      {focus.length === 0 && !promptDismissed && <FocusPrompt />}
      {blocks.map(render)}
    </>
  );
}

/** Title, Square sync line and the setup card (refreshes Square sales when stale). */
async function OverviewHeader() {
  const [square, ob, checklist] = await Promise.all([squareSummary(), onboardingState(), setupChecklist(), refreshIfStale()]);
  return (
    <>
      <PageHeader
        help="overview.page"
        title="Overview"
        description={<>{dayDate(businessToday())} · <Link href="/settings/square" className="underline-offset-2 hover:text-ink hover:underline">{square.connected && square.lastSync ? `Square synced ${relativeTime(square.lastSync)}` : square.text}</Link></>}
      />
      {!checklist.essentialsDone && !ob.dismissed && <SetupCard checklist={checklist} />}
    </>
  );
}

async function Needs({ focus }: { focus: Focus[] }) {
  const needs = await overviewNeeds();
  if (focus.length === 0) return <NeedsBlock items={needs} />;
  const { mine, elsewhere } = splitByFocus(needs, focus);
  return <NeedsBlock items={mine} elsewhere={elsewhere.length} />;
}

async function Elsewhere({ focus }: { focus: Focus[] }) {
  const { elsewhere } = splitByFocus(await overviewNeeds(), focus);
  return <ElsewhereBlock groups={elsewhereGroups(elsewhere, focus)} />;
}
