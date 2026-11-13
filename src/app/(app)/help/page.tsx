import { HelpTip, HelpZone } from "@/components/help";
import { LinkButton } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { documentScope } from "@/server/services/documents";
import { HelpCenter } from "./help-center";
import { PolicyAsk } from "./policy-ask";

export const metadata = { title: "Help" };

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string; tour?: string }> }) {
  const me = await requireUser();
  const { q = "", tour } = await searchParams;
  const docs = await db.document.count({ where: documentScope(me.role) });
  const manager = me.role === "MANAGER";
  return (
    <>
      <HelpCenter userId={me.userId} role={me.role} initialQuery={q} autoTour={tour} />
      {(manager || docs > 0) && (
        <HelpZone id="team.policyAssistant" className="mx-auto mt-12 max-w-5xl"><section data-tour="help.policy-ask">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-[0.95rem] font-semibold">Ask about policies <HelpTip id="team.policyAssistant" /></h2>
              <p className="mt-0.5 text-sm text-muted">Answers from your uploaded handbook and policies only{manager ? " — the same box staff see on My shifts" : ""}.</p>
            </div>
            {manager && <LinkButton href="/team/documents" size="sm">Documents</LinkButton>}
          </div>
          <PolicyAsk hasDocs={docs > 0} examples={["How long is a meal break?", "What's the call-out policy?", "Can staff drink after a shift?"]} />
        </section></HelpZone>
      )}
    </>
  );
}
