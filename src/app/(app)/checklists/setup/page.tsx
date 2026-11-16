import { HelpZone } from "@/components/help";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { checklistTemplates, ensureChecklistPresets } from "@/server/services/checklists";
import { ChecklistSetup } from "./setup-client";

export const metadata = { title: "Set up checklists" };

export default async function ChecklistSetupPage() {
  await requireUser("MANAGER");
  await ensureChecklistPresets();
  const [templates, positions] = await Promise.all([
    checklistTemplates(),
    db.position.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader
        help="checklists.setup"
        back={{ href: "/checklists", label: "Checklists" }}
        title="Set up checklists"
        description="The steps for each list, when it runs and who it's for. Changes show on everyone's phone straight away; past days keep what was ticked."
      />
      <HelpZone id="checklists.setup">
        <ChecklistSetup templates={templates} positions={positions} />
      </HelpZone>
    </>
  );
}
