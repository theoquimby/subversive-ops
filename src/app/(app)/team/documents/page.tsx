import { HelpTip, HelpZone } from "@/components/help";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { documentList, teamPeopleData } from "@/server/services/people";
import { claudeConfigured } from "@/server/integrations/claude";
import { AckMatrix, DocumentGrid, UploadDocument } from "./documents-client";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  await requireUser("MANAGER");
  const [{ docs, staff }, people] = await Promise.all([documentList(), teamPeopleData()]);
  return (
    <>
      <PageHeader
        help="team.documents"
        title="Documents"
        description="Handbook, policies and new-hire forms. Staff read and sign them on My shifts, and the policy assistant answers questions from them."
        back={{ href: "/team", label: "Team" }}
      />
      <HelpZone id="team.documents.upload">
        <Section title={<span className="inline-flex items-center gap-1.5">Add a document <HelpTip id="team.documents" /></span>} description={claudeConfigured() ? "PDFs are read automatically, scans included." : "Text is read from most PDFs. For scans or Word files, paste the text after uploading."}>
          <UploadDocument />
        </Section>
      </HelpZone>
      <Section help="team.documents.library" title="Library" description="Edit any cell to change it. ••• shows the text the assistant reads.">
        {docs.length === 0 ? <EmptyState title="No documents yet">Upload the staff handbook first — it answers most questions.</EmptyState> : <DocumentGrid docs={docs} staff={staff} />}
      </Section>
      <HelpZone id="team.documents.signoff">
        <Section title="Sign-off" description="Who has acknowledged each required document.">
          <AckMatrix docs={people.docs} people={people.people} />
        </Section>
      </HelpZone>
    </>
  );
}
