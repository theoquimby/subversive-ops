import { HelpZone } from "@/components/help";
import { GridCell, GridSelect } from "@/components/grid";
import { Card, LinkButton, PageHeader, Section, Th, Tr } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { num } from "@/server/db";
import { isSquareConnected } from "@/server/services/square";
import { describeDiff } from "@/domain/teamSync";
import { lastLaborSync, loadTeam, squareTeamDiffs } from "@/server/services/labor";
import { getLaborRules, getOpeningHours } from "@/server/services/labor-rules";
import { sickBalances } from "@/server/services/payroll";
import { listAnnouncements } from "@/server/services/scheduling";
import { teamCertChips } from "@/server/services/training";
import { AnnouncementsManager } from "./announcements";
import { PeopleNotesSection } from "./people-section";
import { setPositionField } from "./actions";
import { AddEmployeeRow, AddPositionRow, DeletePositionButton, EmployeeGrid, SyncTeamButton } from "./team-client";

export const metadata = { title: "Team" };

const AREAS = [
  { value: "FOH", label: "Front" },
  { value: "BAR", label: "Bar" },
  { value: "BOH", label: "Kitchen" },
];
const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

const td = "border-b border-border px-2 py-1 align-middle [tr:last-child_&]:border-b-0";

export default async function TeamPage() {
  await requireUser("MANAGER");
  const [{ positions, employees, users }, openingHours, lastSync, rules, sick, notes, certChips] = await Promise.all([loadTeam(), getOpeningHours(), lastLaborSync(), getLaborRules(), sickBalances(), listAnnouncements(), teamCertChips().catch(() => new Map())]);
  const diffs = await squareTeamDiffs();
  const differing = employees.filter((e) => diffs[e.id]?.length);
  const tipEligible = new Map(positions.map((p) => [p.id, p.tipEligible]));
  const rateWarning = (rate: number | null, positionIds: string[]) => {
    if (rate == null) return null;
    const tipped = positionIds.length > 0 && positionIds.every((id) => tipEligible.get(id));
    const floor = tipped ? rules.tippedMinimumWage : rules.minimumWage;
    return rate < floor - 0.005 ? `under $${floor.toFixed(2)} ${tipped ? "tipped " : ""}minimum` : null;
  };
  const connected = await isSquareConnected();

  return (
    <>
      <PageHeader
        help="team.page"
        title="Team"
        description={
          connected
            ? `Positions, pay and availability. Square team sync ${relativeTime(lastSync)}.`
            : "Positions, pay and availability. Connect Square to pull in team members, wages and timecards."
        }
        actions={<HelpZone id="team.squareSync" className="flex flex-wrap items-center gap-2"><SyncTeamButton configured={connected} /></HelpZone>}
      />

      <Section help="team.positions" title="Positions" description="Sales per labor hour sets how many people the schedule asks for: one person per that much forecast sales in an hour, within min and max.">
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Position</Th>
              <Th className="hidden w-32 sm:table-cell">Area</Th>
              <Th align="right" className="w-28">Default rate</Th>
              <Th align="right" className="hidden w-24 md:table-cell">Tip points</Th>
              <Th className="hidden w-24 md:table-cell">Tips</Th>
              <Th align="right" className="hidden w-32 lg:table-cell">One per $/hr</Th>
              <Th align="right" className="hidden w-20 sm:table-cell">Min</Th>
              <Th align="right" className="hidden w-20 sm:table-cell">Max</Th>
              <Th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <Tr key={p.id}>
                <td className={td}>
                  <div className="flex items-center gap-2 pl-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
                    <GridCell grid="pos" col="name" value={p.name} onSave={setPositionField.bind(null, p.id, "name")} ariaLabel="Position name" className="min-w-32 flex-1 font-medium" />
                  </div>
                </td>
                <td className={`${td} hidden sm:table-cell`}>
                  <GridSelect value={p.area} options={AREAS} onSave={setPositionField.bind(null, p.id, "area")} ariaLabel={`${p.name} area`} />
                </td>
                <td className={td}>
                  <GridCell grid="pos" col="rate" type="number" prefix="$" decimals={2} value={num(p.defaultRate)} placeholder="—" onSave={setPositionField.bind(null, p.id, "defaultRate")} ariaLabel={`${p.name} default rate`} />
                </td>
                <td className={`${td} hidden md:table-cell`}>
                  <GridCell grid="pos" col="points" type="number" value={num(p.tipPoints)} onSave={setPositionField.bind(null, p.id, "tipPoints")} ariaLabel={`${p.name} tip points`} />
                </td>
                <td className={`${td} hidden md:table-cell`}>
                  <GridSelect value={p.tipEligible ? "yes" : "no"} options={YES_NO} onSave={setPositionField.bind(null, p.id, "tipEligible")} ariaLabel={`${p.name} tip eligible`} />
                </td>
                <td className={`${td} hidden lg:table-cell`}>
                  <GridCell grid="pos" col="sph" type="number" prefix="$" value={num(p.salesPerHour)} placeholder="—" onSave={setPositionField.bind(null, p.id, "salesPerHour")} ariaLabel={`${p.name} sales per labor hour`} />
                </td>
                <td className={`${td} hidden sm:table-cell`}>
                  <GridCell grid="pos" col="min" type="number" value={p.minStaff} onSave={setPositionField.bind(null, p.id, "minStaff")} ariaLabel={`${p.name} minimum staff`} />
                </td>
                <td className={`${td} hidden sm:table-cell`}>
                  <GridCell grid="pos" col="max" type="number" value={p.maxStaff} onSave={setPositionField.bind(null, p.id, "maxStaff")} ariaLabel={`${p.name} maximum staff`} />
                </td>
                <td className={`${td} text-right`}>
                  <DeletePositionButton id={p.id} name={p.name} />
                </td>
              </Tr>
            ))}
          </tbody>
          </table>
          <AddPositionRow />
        </Card>
      </Section>

      <Section help="team.employees" title="People" actions={<LinkButton href="/team/training" size="sm" data-tour="team.training-link">Training</LinkButton>} description="Rates here are the default; a timecard or a person's rate for a specific position wins. The calendar icon opens availability and login. Sick is NY paid sick leave available this year.">
        {differing.length > 0 && (
          <Card className="mb-3 border-warn/40 bg-warn-bg/40 p-4 text-sm">
            <div className="font-medium text-warn">Square has different details for {differing.length} {differing.length === 1 ? "person" : "people"}</div>
            <p className="mt-0.5 text-ink-2">What&apos;s set here is kept, and Square only fills in blanks. If Square is right, change it below; if Ops is right, update it in Square.</p>
            <ul className="mt-2 space-y-1">
              {differing.map((e) => (
                <li key={e.id}>
                  <span className="font-medium">{e.name}</span>
                  <span className="text-muted"> · {diffs[e.id].map(describeDiff).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card className="overflow-x-auto">
          <EmployeeGrid
            employees={employees.map((e) => ({
              id: e.id,
              name: e.name,
              hourlyRate: num(e.hourlyRate),
              isMinor: e.isMinor,
              maxHoursWeek: e.maxHoursWeek,
              active: e.active,
              userId: e.userId,
              squareTeamMemberId: e.squareTeamMemberId,
              positionIds: e.positions.map((p) => p.positionId),
              availability: (e.availability ?? null) as Record<string, [string, string][]> | null,
              sickAvailable: sick.get(e.id)?.available ?? (e.active ? 0 : null),
              rateWarning: rateWarning(num(e.hourlyRate), e.positions.map((p) => p.positionId)),
              certs: certChips.get(e.id) ?? null,
            }))}
            positions={positions.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
            users={users}
            openingHours={openingHours}
          />
          <AddEmployeeRow />
        </Card>
      </Section>

      <PeopleNotesSection />

      <Section help="team.announcements" title="Announcements" description="Short notes for the team. They show at the top of everyone's My shifts.">
        <AnnouncementsManager items={notes.map((n) => ({ id: n.id, body: n.body, author: n.author, pinned: n.pinned, createdAt: n.createdAt.toISOString() }))} />
      </Section>
    </>
  );
}
