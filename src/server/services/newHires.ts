import "server-only";
import { parseISODate, toISODate, type ISODate } from "@/domain/dates";
import { defaultDue, defaultTemplateItems, hireState, itemDone, likelyNewHires, onboardingProgress, parseProvider, type OnboardingFacts, type OnboardingKind, type PayrollProvider } from "@/domain/onboarding";
import { db } from "../db";
import { documentScope } from "./documents";
import { businessToday } from "./sales";
import { myTraining } from "./training";

/**
 * New-hire onboarding (not the app's own first-run setup — that's services/onboarding.ts).
 * A checklist per hire, copied from a template; linked items follow the
 * documents, training, certificates and availability pages.
 */

export const PROVIDER_KEY = "payroll.provider";

export async function getPayrollProvider(): Promise<PayrollProvider> {
  return parseProvider((await db.setting.findUnique({ where: { key: PROVIDER_KEY } }))?.value);
}

export async function savePayrollProvider(p: PayrollProvider) {
  const value = JSON.stringify(p);
  await db.setting.upsert({ where: { key: PROVIDER_KEY }, create: { key: PROVIDER_KEY, value }, update: { value } });
}

/** Makes the starting template the first time anyone opens onboarding. */
export async function ensureDefaultTemplate() {
  if ((await db.onboardingTemplate.count()) > 0) return;
  const provider = await getPayrollProvider();
  await db.onboardingTemplate.create({
    data: { name: "Everyone", items: { create: defaultTemplateItems(provider.name).map((it, i) => ({ ...it, detail: it.detail ?? null, sort: i })) } },
  });
}

export async function listTemplates() {
  await ensureDefaultTemplate();
  return db.onboardingTemplate.findMany({ where: { active: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], include: { items: { orderBy: { sort: "asc" } } } });
}

/** Best template for someone: one made for one of their positions, else the first. */
async function pickTemplate(positionIds: string[]) {
  const ts = await listTemplates();
  return ts.find((t) => t.positionIds.some((p) => positionIds.includes(p))) ?? ts.find((t) => t.positionIds.length === 0) ?? ts[0] ?? null;
}

/**
 * Start someone's checklist. Copies the template's items, assigns training
 * modules made for their positions, and sets their start date if it's blank.
 */
export async function startOnboarding(args: { employeeId: string; templateId?: string | null; startDate?: ISODate; by: string; source?: "MANUAL" | "SQUARE" }) {
  const emp = await db.employee.findUnique({ where: { id: args.employeeId }, include: { positions: true } });
  if (!emp) return { error: "That person isn't on the team." };
  const existing = await db.onboarding.findFirst({ where: { employeeId: emp.id, status: "ACTIVE" } });
  if (existing) return { error: `${emp.name} already has a checklist.` };
  const positionIds = emp.positions.map((p) => p.positionId);
  const template = args.templateId ? await db.onboardingTemplate.findUnique({ where: { id: args.templateId }, include: { items: { orderBy: { sort: "asc" } } } }) : await pickTemplate(positionIds);
  if (!template) return { error: "Make a checklist template first." };
  const start = args.startDate ?? (emp.startDate ? toISODate(emp.startDate) : businessToday());
  const modules = positionIds.length ? await db.trainingModule.findMany({ where: { active: true, positionIds: { hasSome: positionIds } }, select: { id: true } }) : [];
  const ob = await db.$transaction(async (tx) => {
    if (!emp.startDate) await tx.employee.update({ where: { id: emp.id }, data: { startDate: parseISODate(start) } });
    if (modules.length) await tx.trainingAssignment.createMany({ data: modules.map((m) => ({ employeeId: emp.id, moduleId: m.id, assignedBy: args.by, dueOn: parseISODate(defaultDue(start)) })), skipDuplicates: true });
    return tx.onboarding.create({
      data: {
        employeeId: emp.id,
        templateId: template.id,
        startDate: parseISODate(start),
        dueOn: parseISODate(defaultDue(start)),
        source: args.source ?? "MANUAL",
        createdBy: args.by,
        items: { create: template.items.map((it, i) => ({ sort: i, kind: it.kind, title: it.title, detail: it.detail, refId: it.refId, required: it.required, staffCanTick: it.staffCanTick })) },
      },
    });
  });
  return { ok: `Checklist started for ${emp.name}.`, id: ob.id };
}

// ---- Progress --------------------------------------------------------------------------

async function factsFor(employeeIds: string[], today: ISODate): Promise<Map<string, OnboardingFacts>> {
  const [docs, acks, emps] = await Promise.all([
    db.document.findMany({ where: { ...documentScope("STAFF"), requiresAck: true }, select: { id: true } }),
    db.documentAck.findMany({ where: { employeeId: { in: employeeIds } }, select: { employeeId: true, documentId: true } }),
    db.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, availability: true, emergencyName: true, emergencyPhone: true } }),
  ]);
  const out = new Map<string, OnboardingFacts>();
  for (const e of emps) {
    const t = await myTraining(e.id, today);
    out.set(e.id, {
      docsToSign: docs.map((d) => d.id),
      signedDocs: new Set(acks.filter((a) => a.employeeId === e.id).map((a) => a.documentId)),
      training: new Map(t.checklists.map((c) => [c.moduleId, c.state === "signed-off" || c.state === "ready"])),
      certs: new Map(t.certs.map((c) => [c.typeId, c.status === "valid" || c.status === "expiring"])),
      requiredCerts: t.certs.filter((c) => c.required).map((c) => c.typeId),
      availabilitySet: e.availability != null,
      emergencySet: !!(e.emergencyName?.trim() && e.emergencyPhone?.trim()),
    });
  }
  return out;
}

/** Where each item leads, so the checklist is one tap from doing the thing. */
export function itemHref(kind: OnboardingKind, audience: "staff" | "manager", employeeId?: string): string | null {
  if (audience === "staff") {
    return ({ DOCUMENT: "/my/me#documents", TRAINING: "/my/me#training", CERT: "/my/me#training", AVAILABILITY: "/my/shifts#availability", EMERGENCY: "/my/onboarding#emergency", PAYROLL: null, TASK: null } as const)[kind];
  }
  return ({ DOCUMENT: "/team/documents", TRAINING: "/team/training", CERT: "/team/training", AVAILABILITY: employeeId ? "/team" : "/team", EMERGENCY: null, PAYROLL: null, TASK: null } as const)[kind];
}

export async function onboardingsWithProgress(where: { employeeId?: string; status?: string[] }) {
  const today = businessToday();
  const rows = await db.onboarding.findMany({
    where: { ...(where.employeeId ? { employeeId: where.employeeId } : {}), status: { in: where.status ?? ["ACTIVE"] } },
    include: { items: { orderBy: { sort: "asc" } }, employee: { select: { id: true, name: true, userId: true, emergencyName: true, emergencyPhone: true, emergencyRelation: true, positions: { select: { position: { select: { name: true } } } } } }, template: { select: { name: true } } },
    orderBy: { startDate: "desc" },
  });
  const facts = await factsFor([...new Set(rows.map((r) => r.employeeId))], today);
  return rows.map((r) => {
    const f = facts.get(r.employeeId)!;
    const items = r.items.map((i) => ({ id: i.id, kind: i.kind as OnboardingKind, title: i.title, detail: i.detail, refId: i.refId, required: i.required, staffCanTick: i.staffCanTick, doneAt: i.doneAt?.toISOString() ?? null, doneBy: i.doneBy, done: itemDone({ kind: i.kind as OnboardingKind, refId: i.refId, doneAt: i.doneAt }, f) }));
    const progress = onboardingProgress(items.map((i) => ({ kind: i.kind, refId: i.refId, doneAt: i.doneAt, required: i.required })), f);
    const due = r.dueOn ? toISODate(r.dueOn) : null;
    return {
      id: r.id,
      employeeId: r.employeeId,
      name: r.employee.name,
      hasLogin: !!r.employee.userId,
      positions: r.employee.positions.map((p) => p.position.name),
      template: r.template?.name ?? null,
      startDate: toISODate(r.startDate),
      dueOn: due,
      status: r.status,
      source: r.source,
      seenAt: r.seenAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      emergency: { name: r.employee.emergencyName, phone: r.employee.emergencyPhone, relation: r.employee.emergencyRelation },
      items,
      progress,
      state: r.status === "DONE" ? ("done" as const) : hireState(progress, due, today),
    };
  });
}

export type HireView = Awaited<ReturnType<typeof onboardingsWithProgress>>[number];

/** Close a checklist once every required item is done (called after anything that can finish one). */
export async function closeIfComplete(onboardingId: string): Promise<boolean> {
  const [v] = (await onboardingsWithProgress({ status: ["ACTIVE"] })).filter((o) => o.id === onboardingId);
  if (!v || !v.progress.complete) return false;
  const r = await db.onboarding.updateMany({ where: { id: onboardingId, status: "ACTIVE" }, data: { status: "DONE", completedAt: new Date() } });
  return r.count > 0;
}

/** For the Onboarding page: everyone in progress, recent finishes, and people who look new but have no checklist. */
export async function hiresOverview() {
  const [active, recentDone, emps, onboarded] = await Promise.all([
    onboardingsWithProgress({ status: ["ACTIVE"] }),
    onboardingsWithProgress({ status: ["DONE"] }),
    db.employee.findMany({ where: { active: true }, select: { id: true, name: true, active: true, createdAt: true, startDate: true, squareTeamMemberId: true } }),
    db.onboarding.findMany({ select: { employeeId: true } }),
  ]);
  const since = Date.now() - 45 * 86_400_000;
  const suggest = likelyNewHires(emps, new Set(onboarded.map((o) => o.employeeId)), new Date());
  return {
    active,
    done: recentDone.filter((d) => d.completedAt && Date.parse(d.completedAt) >= since),
    suggest: suggest.map((e) => ({ id: e.id, name: e.name, fromSquare: !!e.squareTeamMemberId, added: toISODate(e.createdAt) })),
  };
}

