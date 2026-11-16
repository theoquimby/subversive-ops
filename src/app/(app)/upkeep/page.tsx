import { HelpTip, HelpZone } from "@/components/help";
import { Card, PageHeader, Section, Stat } from "@/components/ui";
import { money } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { ensureUpkeepPresets, upkeepBoard } from "@/server/services/upkeep";
import { EquipmentGrid } from "./equipment-client";
import { JobsTable } from "./jobs-client";
import { LogList, RepairButton } from "./log-client";

export const metadata = { title: "Upkeep" };

export default async function UpkeepPage() {
  await requireUser("MANAGER");
  await ensureUpkeepPresets();
  const b = await upkeepBoard();
  const s = b.summary;
  const equipOptions = b.equipment.filter((e) => e.active).map((e) => ({ value: e.id, label: e.name, group: e.area }));

  return (
    <>
      <PageHeader
        help="upkeep.page"
        title="Upkeep"
        description="Draft lines, the hood, the walk-in and everything else that needs looking after: what's due, who to call, and what repairs have cost."
        actions={<RepairButton equipment={equipOptions} today={b.today} />}
      />

      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="upkeep.stats">
        <Stat help="upkeep.overdue" label="Overdue" value={s.overdue} tone={s.overdue ? "bad" : undefined} hint={s.overdue ? "Past their due date" : "Nothing late"} />
        <Stat help="upkeep.due" label="Due this week" value={s.dueToday + s.soon} tone={s.dueToday ? "warn" : undefined} hint={s.dueToday ? `${s.dueToday} due today` : "Coming up in 7 days"} />
        <Stat help="upkeep.down" label="Down for repair" value={b.openRepairs.length} tone={b.openRepairs.length ? "bad" : undefined} hint={b.openRepairs[0] ? (b.openRepairs[0].equipment ?? b.openRepairs[0].title) : "Everything working"} />
        <Stat help="upkeep.spend" label="Repairs & service, 12 months" value={money(s.spend12, { whole: true })} hint="From the log below" />
      </div>

      <HelpZone id="upkeep.jobs" tour="upkeep.jobs" className="mb-10">
        <Section
          title={<span className="inline-flex items-center gap-1.5">Jobs <HelpTip id="upkeep.jobs" /></span>}
          description="Each job comes round every so often. Tap Done when it's finished; the next due date moves on. Jobs marked Staff show on everyone's Checklists page when due."
        >
          {s.unknown > 0 && (
            <Card className="mb-3 border-warn/40 bg-warn-bg/40 px-4 py-3 text-sm">
              <span className="font-medium text-warn">{s.unknown} job{s.unknown === 1 ? " needs" : "s need"} a last-done date.</span>{" "}
              <span className="text-ink-2">Pick roughly when each was last done and they start counting down. The intervals are typical starting points (Brewers Association draft guide, NFPA for the hood) — check them against your vendors and the fire marshal.</span>
            </Card>
          )}
          <JobsTable tasks={b.tasks} inactive={b.inactiveTasks} equipment={equipOptions} today={b.today} />
        </Section>
      </HelpZone>

      <HelpZone id="upkeep.equipment" className="mb-10">
        <Section title={<span className="inline-flex items-center gap-1.5">Equipment <HelpTip id="upkeep.equipment" /></span>} description="Make, serial, who services it and the warranty, so the number is there when something breaks at 9pm on a Friday.">
          <EquipmentGrid equipment={b.equipment} today={b.today} />
        </Section>
      </HelpZone>

      <HelpZone id="upkeep.log">
        <Section title={<span className="inline-flex items-center gap-1.5">Log <HelpTip id="upkeep.log" /></span>} description="Every job done, repair and service visit, newest first.">
          <LogList logs={b.logs.slice(0, 80)} />
        </Section>
      </HelpZone>
    </>
  );
}
