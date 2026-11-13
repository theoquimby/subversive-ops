import { HelpTip, HelpZone } from "@/components/help";
import { Card, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { pct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { certMatrix, ensureCertPresets, linkableDocuments, trainingModules } from "@/server/services/training";
import { CertMatrix } from "./matrix-client";
import { TrainingModules } from "./modules-client";
import { fullDateOf } from "./status";
import { CertTypesGrid } from "./types-client";

export const metadata = { title: "Training" };

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  await requireUser("MANAGER");
  await ensureCertPresets();
  const [m, modules, positions, docs, sp] = await Promise.all([
    certMatrix(),
    trainingModules(),
    db.position.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
    linkableDocuments(),
    searchParams,
  ]);
  const s = m.summary;
  const people = m.people.map((p) => ({ id: p.id, name: p.name, positionIds: p.positionIds }));

  return (
    <>
      <PageHeader
        help="training.page"
        back={{ href: "/team", label: "Team" }}
        title="Training & certificates"
        description="Who holds which certificate, what's about to expire, and onboarding checklists. Staff can upload their own cards on My shifts."
        actions={<LinkButton href="/team/documents" size="sm" className="h-10 sm:h-8">Documents</LinkButton>}
      />

      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="training.stats">
        <Stat help="training.compliant" label="Compliant" value={pct(s.pct, 0)} tone={s.pct == null ? undefined : s.pct >= 0.95 ? "good" : s.pct >= 0.8 ? "warn" : "bad"} hint={s.required ? `${s.ok} of ${s.required} required certificates in date` : "Nothing required yet"} />
        <Stat help="training.expiring" label="Expiring in 30 days" value={s.expiring} tone={s.expiring ? "warn" : undefined} hint={s.nextExpiry ? `Next: ${fullDateOf(s.nextExpiry)}` : "Nothing coming up"} />
        <Stat help="training.expired" label="Expired" value={s.expired} tone={s.expired ? "bad" : undefined} hint={s.expired ? "Renew before their next shift" : "None"} />
        <Stat help="training.missing" label="Missing" value={s.missing} tone={s.missing ? "bad" : undefined} hint={s.unverified ? `${s.unverified} uploaded, waiting to be verified` : "Required, nothing on file"} />
      </div>

      <Section
        help="training.matrix"
        title={<span className="inline-flex items-center gap-1.5">Certificates <HelpTip id="training.matrix" /></span>}
        description="Everyone against every certificate. Tap a cell to add or renew one, see the photo, or verify what staff uploaded."
      >
        <CertMatrix people={m.people} types={m.types} cells={m.cells} positions={positions} today={m.today} focus={sp.person} />
      </Section>

      <Section
        help="training.types"
        title="Certificate types"
        description="Which certificates you track, how long each lasts, and who needs it. Changing the months updates expiry dates that weren't set by hand."
      >
        <HelpZone id="training.nyPresets" className="mb-3">
          <Card className="border-warn/40 bg-warn-bg/40 px-4 py-3 text-sm">
            <span className="font-medium text-warn">Starting points for New York — Max, please confirm.</span>{" "}
            <span className="text-ink-2">ATAP, ServSafe, allergen and first-aid timings are typical, not legal advice. Check with the SLA, Greene County health department and your insurer, then adjust below.</span>
          </Card>
        </HelpZone>
        <CertTypesGrid types={m.types} positions={positions} />
      </Section>

      <Section
        help="training.modules"
        title="Checklists"
        description="Onboarding and skills checklists. Staff tick steps on My shifts; you sign them off here."
      >
        <TrainingModules modules={modules} people={people} positions={positions} docs={docs} today={m.today} />
      </Section>
    </>
  );
}
