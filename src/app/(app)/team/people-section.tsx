import { HelpTip, HelpZone } from "@/components/help";
import { LinkButton, Section } from "@/components/ui";
import { teamPeopleData } from "@/server/services/people";
import { PeopleNotes, type PersonRow } from "./people-client";

/** Self-contained /team section: per-person notes/kudos and document sign-off (loads its own data). */
export async function PeopleNotesSection() {
  const { people } = await teamPeopleData();
  if (people.length === 0) return null;
  return (
    <HelpZone id="team.feedback">
      <Section
        title={<span className="inline-flex items-center gap-1.5">Notes and documents <HelpTip id="team.feedback" /></span>}
        description="Kudos, coaching notes and private notes per person, and who has signed required documents. Tap a name."
        actions={<LinkButton href="/team/documents" size="sm" data-tour="team.documents-link">Documents</LinkButton>}
      >
        <PeopleNotes people={people as PersonRow[]} />
      </Section>
    </HelpZone>
  );
}
