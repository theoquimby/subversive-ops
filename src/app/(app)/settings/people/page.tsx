import { HelpZone } from "@/components/help";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { SettingGroup, LinkRow } from "../controls";
import { AddUserForm } from "../forms";
import { LoginsList } from "./people-client";

export const metadata = { title: "Logins & access" };

const STAFF_CAN = [
  ["My shifts", "Their shifts, open shifts to pick up, swaps, time off, sick leave and availability"],
  ["Counts", "Stock counts, area by area"],
  ["Waste", "Logging what gets thrown out"],
  ["Help", "The help center and the staff tours"],
] as const;

export default async function PeopleSettingsPage() {
  const me = await requireUser("MANAGER");
  const [users, positions, employees, people] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }] }),
    db.position.count(),
    db.employee.count({ where: { active: true } }),
    db.employee.findMany({ where: { userId: { not: null } }, select: { userId: true, name: true, active: true } }),
  ]);
  const linked = new Map(people.map((e) => [e.userId!, e]));
  const now = new Date();
  const rows = users.map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active, locked: !!u.lockedUntil && u.lockedUntil > now, me: u.id === me.userId, employee: linked.get(u.id)?.name ?? null }));

  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Logins & access" description="Who can sign in, and what they see. Everyone signs in with their name and a 4–8 digit PIN." />

      <HelpZone id="settings.team">
        <SettingGroup id="logins" title="Logins & PINs" description="Rename, change access, set a new PIN (it also unlocks a locked login) or switch a login off. Changes save as you make them. Link a login to a person on the Team page.">
          <LoginsList rows={rows} />
          <div className="bg-surface-2/30"><AddUserForm /></div>
        </SettingGroup>
      </HelpZone>

      <HelpZone id="settings.people.access">
        <SettingGroup id="access" title="What staff can open" description="Managers see everything. Staff logins see only these, on their phone or the shared tablet.">
          {STAFF_CAN.map(([t, d]) => (
            <div key={t} className="px-4 py-3 sm:px-5">
              <div className="text-sm font-medium text-ink">{t}</div>
              <p className="mt-0.5 text-[0.8rem] text-muted">{d}</p>
            </div>
          ))}
          <p className="px-4 py-3 text-xs text-muted sm:px-5">Staff never see costs, sales, pay rates or anyone else's details. To give someone more, make their login a Manager above.</p>
        </SettingGroup>
      </HelpZone>

      <SettingGroup title="People and positions" description="Set on the Team page, next to the people.">
        <LinkRow href="/team" label="Positions & pay rates" what="Each position's default rate, tip points and how many to staff per sales dollar." value={`${positions} positions`} help="settings.people.positions" />
        <LinkRow href="/team" label="Employees" what="Pay rates, availability, max hours and which positions each person works." value={`${employees} active`} />
        <LinkRow href="/team/training" label="Certificates & training" what="ATAP, food handler and other certificates, with expiry reminders." />
      </SettingGroup>
    </div>
  );
}
