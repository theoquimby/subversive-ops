import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { getPayrollProvider, hiresOverview, itemHref, listTemplates } from "@/server/services/newHires";
import { HiresBoard } from "./hires-client";
import { TemplatesEditor } from "./templates-client";

export const metadata = { title: "Onboarding" };

/** New hires: add someone, their checklist, and progress across everyone starting. */
export default async function OnboardingPage() {
  await requireUser("MANAGER");
  const [overview, templates, provider, positions, docs, modules, certTypes] = await Promise.all([
    hiresOverview(),
    listTemplates(),
    getPayrollProvider(),
    db.position.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.document.findMany({ where: { active: true, audience: "STAFF", requiresAck: true }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    db.trainingModule.findMany({ where: { active: true }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    db.certType.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: [{ sort: "asc" }, { name: "asc" }] }),
  ]);
  const withLinks = (list: typeof overview.active) => list.map((h) => ({ ...h, items: h.items.map((i) => ({ ...i, href: itemHref(i.kind, "manager", h.employeeId) })) }));

  return (
    <>
      <PageHeader
        help="team.onboarding"
        back={{ href: "/team", label: "Team" }}
        title="Onboarding"
        description="Everyone starting gets a checklist on their phone: sign the handbook, training, certificates, payroll paperwork (done in your payroll provider, never here), availability and an emergency contact."
      />
      <HiresBoard
        today={businessToday()}
        active={withLinks(overview.active)}
        done={withLinks(overview.done)}
        suggest={overview.suggest}
        positions={positions}
        templates={templates.map((t) => ({ id: t.id, name: t.name }))}
        provider={provider}
      />
      <TemplatesEditor
        templates={templates.map((t) => ({ id: t.id, name: t.name, positionIds: t.positionIds, items: t.items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, detail: i.detail, refId: i.refId, required: i.required, staffCanTick: i.staffCanTick })) }))}
        positions={positions}
        refs={{ DOCUMENT: docs.map((d) => ({ value: d.id, label: d.title })), TRAINING: modules.map((m) => ({ value: m.id, label: m.title })), CERT: certTypes.map((c) => ({ value: c.id, label: c.name })) }}
      />
    </>
  );
}
