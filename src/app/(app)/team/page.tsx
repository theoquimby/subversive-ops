import { positionColor } from "@/domain/positionColors";
import { Verdict } from "@/components/chapter";
import { HelpZone } from "@/components/help";
import { teamStory } from "@/domain/teamStory";
import { teamPeopleData } from "@/server/services/people";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { PersonRow } from "./people-client";
import { GridCell, GridSelect } from "@/components/grid";
import { Card, LinkButton, PageHeader, Section, Th, Tr } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { isSquareConnected } from "@/server/services/square";
import { describeDiff } from "@/domain/teamSync";
import { lastLaborSync, loadTeam, squareTeamDiffs } from "@/server/services/labor";
import { getLaborRules, getOpeningHours } from "@/server/services/labor-rules";
import { sickBalances } from "@/server/services/payroll";
import { announcementsForManagers } from "@/server/services/scheduling";
import { businessToday } from "@/server/services/sales";
import { teamCertChips } from "@/server/services/training";
import { AnnouncementsManager } from "./announcements";
import { setPositionField } from "./actions";
import { AddPositionRow, DeletePositionButton, EmployeeGrid, SyncTeamButton } from "./team-client";

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
  const [{ positions, employees, users }, openingHours, lastSync, rules, sick, notes, certChips] = await Promise.all([loadTeam(), getOpeningHours(), lastLaborSync(), getLaborRules(), sickBalances(), announcementsForManagers(), teamCertChips().catch(() => new Map())]);
  const diffs = await squareTeamDiffs();
  const differing = employees.filter((e) => diffs[e.id]?.length);
  const tipEligible = new Map(positions.map((p) => [p.id, p.tipEligible]));
  const rateWarning = (rate: number | null, positionIds: string[]) => {
    if (rate == null) return null;
    const tipped = positionIds.length > 0 && positionIds.every((id) => tipEligible.get(id));
    const floor = tipped ? rules.tippedMinimumWage : rules.minimumWage;
    return rate < floor - 0.005 ? `under $${floor.toFixed(2)} ${tipped ? "tipped " : ""}minimum` : null;
  };
  const [connected, unread, newHires, { people }] = await Promise.all([isSquareConnected(), db.staffMessage.count({ where: { readAt: null } }), db.onboarding.count({ where: { status: "ACTIVE" } }), teamPeopleData()]);
  const notesBy = Object.fromEntries(people.map((p) => [p.id, p as PersonRow]));
  const active = employees.filter((e) => e.active);
  const story = teamStory(
    active.map((e) => {
      const n = notesBy[e.id];
      return {
        id: e.id,
        name: e.name,
        hasLogin: !!e.userId,
        certs: certChips.get(e.id)?.status ?? null,
        docsSigned: n ? n.acks.filter((a) => a.ackedAt).length : 0,
        docsRequired: n?.acks.length ?? 0,
        underMinimum: !!rateWarning(num(e.hourlyRate), e.positions.map((p) => p.positionId)),
      };
    }),
  );
  const withLogin = active.filter((e) => e.userId).length;
  const docsDone = active.filter((e) => { const n = notesBy[e.id]; return n && n.acks.length > 0 && n.acks.every((a) => a.ackedAt); }).length;
  const docsAny = active.some((e) => (notesBy[e.id]?.acks.length ?? 0) > 0);
  const certsKnown = active.filter((e) => { const c = certChips.get(e.id)?.status; return c && c !== "not-required"; });
  const certsOk = certsKnown.filter((e) => certChips.get(e.id)?.status === "valid" || certChips.get(e.id)?.status === "expiring").length;

  return (
    <>
      <PageHeader
        help="team.page"
        title="Team"
        description={
          connected
            ? `Who's on the team, what they're paid and whether they're set up to work. Square team sync ${relativeTime(lastSync)}.`
            : "Who's on the team, what they're paid and whether they're set up to work. Connect Square to pull in team members, wages and timecards."
        }
        actions={
          <>
            <HelpZone id="team.workforceLinks" className="flex flex-wrap items-center gap-2">
              <LinkButton href="/team/onboarding" size="sm">Onboarding{newHires ? ` · ${newHires}` : ""}</LinkButton>
              <LinkButton href="/team/recognition" size="sm">Shout-outs</LinkButton>
              <LinkButton href="/team/messages" size="sm">Messages{unread ? ` · ${unread} new` : ""}</LinkButton>
            </HelpZone>
            <HelpZone id="team.squareSync" className="flex flex-wrap items-center gap-2"><SyncTeamButton configured={connected} /></HelpZone>
          </>
        }
      />

      <Verdict
        badge={{ tone: story.tone }}
        title={story.title}
        line={story.line}
        stats={[
          { label: "Active people", value: active.length },
          { label: "Can sign in", value: `${withLogin} of ${active.length}`, tone: withLogin < active.length ? "warn" : "neutral" },
          docsAny ? { label: "Signed every document", value: `${docsDone} of ${active.length}`, tone: docsDone < active.length ? "warn" : "neutral" } : { label: "Documents to sign", value: "—", hint: "None required yet", tone: "unknown" },
          ...(certsKnown.length ? [{ label: "Certificates in order", value: `${certsOk} of ${certsKnown.length}`, tone: certsOk < certsKnown.length ? ("bad" as const) : ("neutral" as const) }] : []),
        ]}
      />
      {story.findings.length > 0 && (
        <Card className="mb-10 divide-y divide-border overflow-hidden">
          {story.findings.map((f) => (
            <Link key={f.id} href={f.href} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-120 hover:bg-surface-2/60 sm:px-5">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${f.tone === "bad" ? "bg-bad" : "bg-warn"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{f.title}<span className="sr-only"> ({f.tone === "bad" ? "Needs attention" : "Worth a look"})</span></span>
                <span className="block text-sm text-ink-2">{f.detail}</span>
              </span>
              <span className="hidden shrink-0 text-sm text-muted sm:inline">{f.action}</span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
            </Link>
          ))}
        </Card>
      )}

      <div id="people" className="scroll-mt-24" />
      <Section
        help="team.employees"
        title="People"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton href="/team/training" size="sm" data-tour="team.training-link">Training</LinkButton>
            <LinkButton href="/team/documents" size="sm" data-tour="team.documents-link">Documents</LinkButton>
          </div>
        }
        description="Click a row, away from the cells, for availability and login; tap Documents or Notes for kudos, coaching and sign-off. A person's rate here is their default: a rate on a timecard or for one position wins. Sick is NY paid sick leave left this year."
      >
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
            positions={positions.map((p) => ({ id: p.id, name: p.name, color: positionColor(p.color) }))}
            users={users}
            openingHours={openingHours}
            notes={notesBy}
          />
      </Section>

      <Section help="team.announcements" title="Announcements" description="Short notes for the team. They show at the top of everyone's My shifts.">
        <AnnouncementsManager items={notes.live} scheduled={notes.scheduled} today={businessToday()} />
      </Section>
      <details className="group/pos mb-10">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-lg text-[0.95rem] font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <ChevronDown aria-hidden className="size-4 -rotate-90 text-muted transition-transform duration-180 group-open/pos:rotate-0" />
          Positions and staffing levels
          <span className="text-sm font-normal text-muted">{positions.length} position{positions.length === 1 ? "" : "s"}</span>
        </summary>
      <Section help="team.positions" className="mt-2" description="Each position's pay and tips, and how many the schedule asks for: one person for every so much forecast sales in an hour, never fewer than Min or more than Max.">
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Position</Th>
              <Th className="hidden w-32 sm:table-cell">Area</Th>
              <Th align="right" className="w-28">Default rate</Th>
              <Th align="right" className="hidden w-24 md:table-cell">Tip points</Th>
              <Th className="hidden w-24 md:table-cell">Tips</Th>
              <Th align="right" className="hidden w-36 lg:table-cell"><span title="One more person on shift for every this much forecast sales in an hour">Sales per person</span></Th>
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
                    <span className="size-2 shrink-0 rounded-full" style={{ background: positionColor(p.color) }} />
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
      </details>

    </>
  );
}
