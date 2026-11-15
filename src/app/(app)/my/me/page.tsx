import { HelpZone } from "@/components/help";
import { PushToggle } from "@/components/push-toggle";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { employeeForUser } from "@/server/services/scheduling";
import { MyPeopleTop, MyPolicyAsk } from "../people-section";
import { MyTrainingSection } from "../training-section";

export const metadata = { title: "Me" };

/** Staff: documents to sign, training and certificates, notes from managers, policies and notification settings. */
export default async function MePage() {
  const session = await requireUser();
  const me = await employeeForUser(session.userId);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader help="my.me" title="Me" description="Documents to sign, your training and certificates, notes from your managers and notifications." />
      {me ? (
        <>
          <MyPeopleTop employeeId={me.id} empty={<EmptyState title="No documents yet">When your managers share the handbook or a policy, it shows up here to read and sign.</EmptyState>} />
          <MyTrainingSection employeeId={me.id} />
        </>
      ) : (
        <EmptyState title="Your login isn't linked to a team member yet">Ask a manager to connect it on the Team page. Your documents and training will show up here.</EmptyState>
      )}
      <MyPolicyAsk />
      <HelpZone id="my.notifications" className="mt-10">
        <section id="notifications" className="scroll-mt-20">
          <h2 className="mb-3 text-[0.95rem] font-semibold">Notifications</h2>
          <PushToggle />
        </section>
      </HelpZone>
      <p className="mt-10 text-center text-xs text-muted">Signed in as {session.name}</p>
    </div>
  );
}
