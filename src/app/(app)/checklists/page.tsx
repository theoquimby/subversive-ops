import { HelpTip, HelpZone } from "@/components/help";
import { Card, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
import { completionRate } from "@/domain/checklists";
import { pct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { checklistHistory, ensureChecklistPresets, todaysRuns } from "@/server/services/checklists";
import { employeeForUser } from "@/server/services/scheduling";
import { staffJobsDue } from "@/server/services/upkeep";
import { HistoryGrid } from "./history-grid";
import { JobsDue, RunCard } from "./run-client";

export const metadata = { title: "Checklists" };

export default async function ChecklistsPage() {
  const s = await requireUser();
  const manager = s.role === "MANAGER";
  await ensureChecklistPresets();
  const me = await employeeForUser(s.userId);
  const [{ runs, today }, jobs, history] = await Promise.all([
    todaysRuns({ positionIds: me?.positions.map((p) => p.positionId) ?? [] }),
    staffJobsDue(),
    manager ? checklistHistory(14) : Promise.resolve(null),
  ]);
  const mine = runs.filter((r) => r.forMe);
  const others = runs.filter((r) => !r.forMe);
  const rate = history ? completionRate(history.rows.flatMap((r) => r.marks.filter((m) => m.date < today).map((m) => m.mark))) : null;

  return (
    <>
      <PageHeader
        help="checklists.page"
        title="Checklists"
        description="Opening, mid and closing routines. Tick each step as it's done and sign the list at the end, so the next shift knows it's handled."
        actions={manager ? <LinkButton href="/checklists/setup" size="sm" className="h-10 sm:h-8">Set up lists</LinkButton> : undefined}
      />

      <HelpZone id="checklists.today" tour="checklists.today" className="mb-10">
        {runs.length === 0 ? (
          <EmptyState title="No lists today" action={manager ? <LinkButton href="/checklists/setup" variant="primary">Set up lists</LinkButton> : undefined}>
            {manager ? "Nothing is set to run today. Add an opening or closing list, or turn one back on." : "Nothing is set to run today. A manager sets lists up."}
          </EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {[...mine, ...others].map((r) => <RunCard key={`${r.templateId}|${r.date}`} run={r} today={today} canUndoAny={manager} userName={s.name} />)}
          </div>
        )}
      </HelpZone>

      {jobs.length > 0 && (
        <HelpZone id="checklists.jobs" className="mb-10">
          <Section title={<span className="inline-flex items-center gap-1.5">Upkeep due <HelpTip id="checklists.jobs" /></span>} description="Cleaning and care jobs that came due. Tap Done when it's finished — it's logged with your name.">
            <JobsDue jobs={jobs} today={today} />
          </Section>
        </HelpZone>
      )}

      {history && (
        <div id="history" className="scroll-mt-20">
          <HelpZone id="checklists.history">
            <Section
              title={<span className="inline-flex items-center gap-1.5">Last two weeks <HelpTip id="checklists.history" /></span>}
              description={rate == null ? "How each list went, day by day." : `${pct(rate, 0)} of lists were finished. Hover or tap a day for who signed it.`}
            >
              {history.rows.length === 0 ? <Card className="p-4 text-sm text-muted">No lists yet.</Card> : <HistoryGrid dates={history.dates} rows={history.rows} today={today} />}
            </Section>
          </HelpZone>
        </div>
      )}
    </>
  );
}
