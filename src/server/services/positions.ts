import "server-only";
import { dropPosition } from "@/domain/positionLinks";
import { db } from "../db";

/**
 * Delete a position and take its id out of every list that names it, in one
 * transaction: certificates it needs (CertType.appliesTo), checklists,
 * training modules and onboarding templates (positionIds).
 *
 * A checklist or training module that was only for this position would, with
 * an empty list, suddenly be for everyone; it's switched off instead (kept, not
 * deleted), so it still applies to nobody, as it did a moment ago.
 */
export async function deletePositionEverywhere(id: string): Promise<{ switchedOff: string[] }> {
  return db.$transaction(async (tx) => {
    const switchedOff: string[] = [];
    for (const c of await tx.certType.findMany({ where: { appliesTo: { has: id } }, select: { id: true, appliesTo: true } })) {
      await tx.certType.update({ where: { id: c.id }, data: { appliesTo: dropPosition(c.appliesTo, id).ids } });
    }
    for (const t of await tx.checklistTemplate.findMany({ where: { positionIds: { has: id } }, select: { id: true, name: true, positionIds: true } })) {
      const d = dropPosition(t.positionIds, id);
      await tx.checklistTemplate.update({ where: { id: t.id }, data: { positionIds: d.ids, ...(d.emptied ? { active: false } : {}) } });
      if (d.emptied) switchedOff.push(t.name);
    }
    for (const m of await tx.trainingModule.findMany({ where: { positionIds: { has: id } }, select: { id: true, title: true, positionIds: true } })) {
      const d = dropPosition(m.positionIds, id);
      await tx.trainingModule.update({ where: { id: m.id }, data: { positionIds: d.ids, ...(d.emptied ? { active: false } : {}) } });
      if (d.emptied) switchedOff.push(m.title);
    }
    for (const o of await tx.onboardingTemplate.findMany({ where: { positionIds: { has: id } }, select: { id: true, positionIds: true } })) {
      await tx.onboardingTemplate.update({ where: { id: o.id }, data: { positionIds: dropPosition(o.positionIds, id).ids } });
    }
    await tx.position.delete({ where: { id } });
    return { switchedOff };
  });
}
