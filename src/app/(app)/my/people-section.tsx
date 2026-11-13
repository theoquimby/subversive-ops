import { HelpTip, HelpZone } from "@/components/help";
import { db } from "@/server/db";
import { documentScope } from "@/server/services/documents";
import { myPeopleData } from "@/server/services/people";
import { PolicyAsk } from "../help/policy-ask";
import { MyDocuments, MyFeedback } from "./people-panel";

/** Documents to read/sign and notes managers shared — near the top of My shifts. */
export async function MyPeopleTop({ employeeId }: { employeeId: string }) {
  const { feedback, docs } = await myPeopleData(employeeId);
  return (
    <>
      <MyDocuments docs={docs} />
      <MyFeedback items={feedback} />
    </>
  );
}

export const POLICY_EXAMPLES = ["How long is my meal break?", "How do I call out sick?", "What's the dress code?"];

/** "Ask about policies" for staff. */
export async function MyPolicyAsk() {
  const hasDocs = (await db.document.count({ where: documentScope("STAFF") })) > 0;
  if (!hasDocs) return null;
  return (
    <HelpZone id="my.policyAsk" className="mt-10"><section data-tour="my.policy-ask">
      <h2 className="mb-1 flex items-center gap-1.5 text-[0.95rem] font-semibold">Ask about policies <HelpTip id="my.policyAsk" /></h2>
      <p className="mb-3 text-sm text-muted">Answers come straight from the handbook and policies your managers uploaded.</p>
      <PolicyAsk hasDocs examples={POLICY_EXAMPLES} />
    </section></HelpZone>
  );
}
