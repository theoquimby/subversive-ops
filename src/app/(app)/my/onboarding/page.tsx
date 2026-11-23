import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { getPayrollProvider, itemHref, onboardingsWithProgress } from "@/server/services/newHires";
import { employeeForUser } from "@/server/services/scheduling";
import { MyChecklist } from "./checklist";

export const metadata = { title: "My checklist" };

/** A new hire's first-week checklist: sign, train, certificates, payroll paperwork (done in the provider), contacts. */
export default async function MyOnboardingPage() {
  const session = await requireUser();
  const me = await employeeForUser(session.userId);
  if (!me) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader help="my.onboarding" title="My checklist" back={{ href: "/my", label: "Today" }} />
        <EmptyState title="Your login isn't linked to a team member yet">Ask a manager to connect it on the Team page.</EmptyState>
      </div>
    );
  }
  const [list, provider] = await Promise.all([onboardingsWithProgress({ employeeId: me.id, status: ["ACTIVE", "DONE"] }), getPayrollProvider()]);
  const ob = list.find((o) => o.status === "ACTIVE") ?? list[0] ?? null;
  // First open = "seen" (the manager's list shows who hasn't looked yet).
  if (ob && !ob.seenAt) await db.onboarding.updateMany({ where: { id: ob.id, seenAt: null }, data: { seenAt: new Date() } });

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader help="my.onboarding" title="My checklist" back={{ href: "/my", label: "Today" }} description={ob ? `Welcome to the team, ${me.name.split(" ")[0]}. Work through these in your first couple of weeks. Most take a minute.` : undefined} />
      {!ob ? (
        <EmptyState title="No checklist for you">When a manager sets up your first-week checklist, it shows up here.</EmptyState>
      ) : (
        <MyChecklist
          done={ob.status === "DONE"}
          dueOn={ob.dueOn}
          progress={ob.progress}
          provider={provider}
          emergency={ob.emergency}
          items={ob.items.map((i) => ({ ...i, href: itemHref(i.kind, "staff") }))}
        />
      )}
    </div>
  );
}
