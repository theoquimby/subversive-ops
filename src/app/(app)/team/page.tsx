import { GridCell, GridSelect } from "@/components/grid";
import { Card, PageHeader, Section, Th, Tr } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { num } from "@/server/db";
import { squareConfigured } from "@/server/env";
import { lastLaborSync, loadTeam } from "@/server/services/labor";
import { getOpeningHours } from "@/server/services/labor-rules";
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
  const [{ positions, employees, users }, openingHours, lastSync] = await Promise.all([loadTeam(), getOpeningHours(), lastLaborSync()]);
  const connected = squareConfigured();

  return (
    <>
      <PageHeader
        title="Team"
        description={
          connected
            ? `Positions, pay and availability. Square team sync ${relativeTime(lastSync)}.`
            : "Positions, pay and availability. Connect Square to pull in team members, wages and timecards."
        }
        actions={<SyncTeamButton configured={connected} />}
      />

      <Section title="Positions" description="Sales per labor hour sets how many people the schedule asks for: one person per that much forecast sales in an hour, within min and max.">
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

      <Section title="People" description="Rates here are the default; a timecard or a person's rate for a specific position wins. The calendar icon opens availability.">
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
            }))}
            positions={positions.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
            users={users}
            openingHours={openingHours}
          />
          <AddEmployeeRow />
        </Card>
      </Section>
    </>
  );
}
