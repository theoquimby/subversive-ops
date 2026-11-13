"use server";

import { expiryFor } from "@/domain/certs";
import { parseISODate } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { certFileData, recomputeExpiries, setStepDone } from "@/server/services/training";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = Promise<{ error?: string } | void>;

function refresh() {
  revalidatePath("/team/training");
  revalidatePath("/team");
  revalidatePath("/my");
  revalidatePath("/brief");
  revalidatePath("/schedule");
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const yes = (raw: string) => ["yes", "true", "1", "y"].includes(raw.trim().toLowerCase());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), "Pick a date");

// ---- Certificate types ---------------------------------------------------------------

export async function addCertType(name: string): R {
  await requireUser("MANAGER");
  const n = name.trim().slice(0, 80);
  if (!n) return { error: "Give it a name" };
  const max = await db.certType.aggregate({ _max: { sort: true } });
  try {
    await db.certType.create({ data: { name: n, validityMonths: 36, sort: (max._max.sort ?? 0) + 1 } });
  } catch (e) {
    if (isUnique(e)) return { error: "There's already one with that name" };
    throw e;
  }
  refresh();
}

const typeFields = z.enum(["name", "description", "issuer", "validityMonths", "requiredForAll", "requiredForMinors", "isAnnualTraining", "active"]);

export async function setCertTypeField(id: string, field: z.infer<typeof typeFields>, raw: string): R {
  await requireUser("MANAGER");
  typeFields.parse(field);
  const v = raw.trim();
  let data: Prisma.CertTypeUpdateInput;
  switch (field) {
    case "name":
      if (!v) return { error: "Can't be empty" };
      data = { name: v.slice(0, 80) };
      break;
    case "description":
    case "issuer":
      data = { [field]: v ? v.slice(0, 400) : null };
      break;
    case "validityMonths": {
      const s = v.replace(/\s*(months?|mo)\s*$/i, "");
      if (!s || /^(never|none|—|-)$/i.test(s)) data = { validityMonths: null };
      else {
        const n = Number(s);
        if (!Number.isInteger(n) || n < 1 || n > 240) return { error: "Months, 1–240 (blank = never expires)" };
        data = { validityMonths: n };
      }
      break;
    }
    default:
      data = { [field]: yes(v) };
  }
  try {
    const t = await db.certType.update({ where: { id }, data });
    if (field === "validityMonths") await recomputeExpiries(id, t.validityMonths, expiryFor);
  } catch (e) {
    if (isUnique(e)) return { error: "There's already one with that name" };
    throw e;
  }
  refresh();
}

export async function setCertTypePosition(id: string, positionId: string, on: boolean): R {
  await requireUser("MANAGER");
  const t = await db.certType.findUnique({ where: { id }, select: { appliesTo: true } });
  if (!t) return { error: "That type is gone" };
  const next = on ? [...new Set([...t.appliesTo, positionId])] : t.appliesTo.filter((p) => p !== positionId);
  await db.certType.update({ where: { id }, data: { appliesTo: next } });
  refresh();
}

export async function deleteCertType(id: string): R {
  await requireUser("MANAGER");
  const held = await db.certification.count({ where: { certTypeId: id } });
  if (held > 0) return { error: `${held} certificate${held === 1 ? " is" : "s are"} on file for it. Set it to Archived instead to keep the history.` };
  await db.certType.delete({ where: { id } }).catch(() => null);
  refresh();
}

// ---- Certificates -------------------------------------------------------------------------

const certInput = z.object({
  employeeId: z.string().min(1),
  certTypeId: z.string().min(1),
  issuedOn: isoDate,
  expiresOn: isoDate.optional().or(z.literal("")),
  number: z.string().max(80).optional(),
  notes: z.string().max(500).optional(),
  verified: z.enum(["yes", "no"]).optional(),
});

/** Add a certificate (a renewal is a new row; the old one stays as history). */
export async function addCertificate(form: FormData): Promise<{ error?: string; ok?: string }> {
  const s = await requireUser("MANAGER");
  const p = certInput.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!p.success) return { error: "Pick the date it was issued." };
  const d = p.data;
  const type = await db.certType.findUnique({ where: { id: d.certTypeId } });
  if (!type) return { error: "That certificate type is gone." };
  const file = await certFileData(form.get("file"));
  if (file && "error" in file) return file;
  const override = d.expiresOn || null;
  const expires = expiryFor(d.issuedOn, type.validityMonths, override);
  if (expires && expires < d.issuedOn) return { error: "It can't expire before it was issued." };
  const auto = expiryFor(d.issuedOn, type.validityMonths);
  await db.certification.create({
    data: {
      employeeId: d.employeeId,
      certTypeId: d.certTypeId,
      issuedOn: parseISODate(d.issuedOn),
      expiresOn: expires ? parseISODate(expires) : null,
      expiryOverridden: !!override && override !== auto,
      number: d.number?.trim() || null,
      notes: d.notes?.trim() || null,
      uploadedBy: s.name,
      ...(d.verified !== "no" ? { verifiedBy: s.name, verifiedAt: new Date() } : {}),
      ...(file ? file : {}),
    },
  });
  refresh();
  return { ok: "Saved" };
}

export async function setCertificateVerified(id: string, verified: boolean): R {
  const s = await requireUser("MANAGER");
  await db.certification.update({ where: { id }, data: verified ? { verifiedBy: s.name, verifiedAt: new Date() } : { verifiedBy: null, verifiedAt: null } }).catch(() => null);
  refresh();
}

export async function deleteCertificate(id: string): R {
  await requireUser("MANAGER");
  await db.certification.delete({ where: { id } }).catch(() => null);
  refresh();
}

/** Attach or replace the photo / PDF on a certificate already on file. */
export async function attachCertificateFile(id: string, form: FormData): R {
  await requireUser("MANAGER");
  const file = await certFileData(form.get("file"));
  if (!file) return { error: "Choose a photo or PDF." };
  if ("error" in file) return file;
  await db.certification.update({ where: { id }, data: file });
  refresh();
}

// ---- Checklists ---------------------------------------------------------------------------

export async function addModule(title: string): Promise<{ error?: string; id?: string }> {
  await requireUser("MANAGER");
  const t = title.trim().slice(0, 100);
  if (!t) return { error: "Give the checklist a name" };
  const m = await db.trainingModule.create({ data: { title: t } });
  refresh();
  return { id: m.id };
}

const moduleFields = z.enum(["title", "description", "active"]);

export async function setModuleField(id: string, field: z.infer<typeof moduleFields>, raw: string): R {
  await requireUser("MANAGER");
  moduleFields.parse(field);
  const v = raw.trim();
  if (field === "title" && !v) return { error: "Can't be empty" };
  const data = field === "active" ? { active: yes(v) } : field === "title" ? { title: v.slice(0, 100) } : { description: v ? v.slice(0, 500) : null };
  await db.trainingModule.update({ where: { id }, data }).catch(() => null);
  refresh();
}

export async function setModulePosition(id: string, positionId: string, on: boolean): R {
  await requireUser("MANAGER");
  const m = await db.trainingModule.findUnique({ where: { id }, select: { positionIds: true } });
  if (!m) return { error: "That checklist is gone" };
  await db.trainingModule.update({ where: { id }, data: { positionIds: on ? [...new Set([...m.positionIds, positionId])] : m.positionIds.filter((p) => p !== positionId) } });
  refresh();
}

export async function deleteModule(id: string): R {
  await requireUser("MANAGER");
  await db.trainingModule.delete({ where: { id } }).catch(() => null);
  refresh();
}

export async function addStep(moduleId: string, title: string): R {
  await requireUser("MANAGER");
  const t = title.trim().slice(0, 160);
  if (!t) return { error: "Type the step" };
  const max = await db.trainingStep.aggregate({ where: { moduleId }, _max: { sort: true } });
  await db.trainingStep.create({ data: { moduleId, title: t, sort: (max._max.sort ?? 0) + 1 } });
  // Anyone who'd finished gets the new step to do.
  await db.trainingAssignment.updateMany({ where: { moduleId, signedOffAt: null }, data: { completedAt: null } });
  refresh();
}

const stepFields = z.enum(["title", "detail", "documentId"]);

export async function setStepField(id: string, field: z.infer<typeof stepFields>, raw: string): R {
  await requireUser("MANAGER");
  stepFields.parse(field);
  const v = raw.trim();
  if (field === "title" && !v) return { error: "Can't be empty" };
  if (field === "documentId" && v && !(await db.document.findFirst({ where: { id: v, active: true } }))) return { error: "That document is gone" };
  const data = field === "title" ? { title: v.slice(0, 160) } : field === "detail" ? { detail: v ? v.slice(0, 1000) : null } : { documentId: v || null };
  await db.trainingStep.update({ where: { id }, data }).catch(() => null);
  refresh();
}

export async function moveStep(id: string, dir: -1 | 1): R {
  await requireUser("MANAGER");
  const step = await db.trainingStep.findUnique({ where: { id } });
  if (!step) return;
  const steps = await db.trainingStep.findMany({ where: { moduleId: step.moduleId }, orderBy: { sort: "asc" } });
  const i = steps.findIndex((s) => s.id === id);
  const j = i + dir;
  if (j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  await db.$transaction(steps.map((s, k) => db.trainingStep.update({ where: { id: s.id }, data: { sort: k + 1 } })));
  refresh();
}

export async function deleteStep(id: string): R {
  await requireUser("MANAGER");
  await db.trainingStep.delete({ where: { id } }).catch(() => null);
  refresh();
}

const assignInput = z.object({
  moduleId: z.string().min(1),
  employeeIds: z.array(z.string()).max(200).default([]),
  positionId: z.string().optional(),
  dueOn: isoDate.optional().or(z.literal("")),
});

/** Assign a checklist to people, or to everyone in a position. People who already have it are left alone. */
export async function assignModule(input: z.input<typeof assignInput>): Promise<{ error?: string; ok?: string }> {
  const s = await requireUser("MANAGER");
  const p = assignInput.safeParse(input);
  if (!p.success) return { error: "Pick who to assign it to." };
  const { moduleId, positionId, dueOn } = p.data;
  let ids = p.data.employeeIds;
  if (positionId) ids = (await db.employee.findMany({ where: { active: true, positions: { some: { positionId } } }, select: { id: true } })).map((e) => e.id);
  if (ids.length === 0) return { error: positionId ? "Nobody active has that position." : "Pick who to assign it to." };
  const res = await db.trainingAssignment.createMany({
    data: ids.map((employeeId) => ({ employeeId, moduleId, assignedBy: s.name, dueOn: dueOn ? parseISODate(dueOn) : null })),
    skipDuplicates: true,
  });
  refresh();
  const skipped = ids.length - res.count;
  return { ok: `Assigned to ${res.count} ${res.count === 1 ? "person" : "people"}${skipped ? ` · ${skipped} already had it` : ""}` };
}

export async function setAssignmentDue(id: string, dueOn: string): R {
  await requireUser("MANAGER");
  if (dueOn && !isoDate.safeParse(dueOn).success) return { error: "Pick a date" };
  await db.trainingAssignment.update({ where: { id }, data: { dueOn: dueOn ? parseISODate(dueOn) : null } }).catch(() => null);
  refresh();
}

export async function removeAssignment(id: string): R {
  await requireUser("MANAGER");
  await db.trainingAssignment.delete({ where: { id } }).catch(() => null);
  refresh();
}

/** Managers can tick a step for someone (e.g. watched them do it). */
export async function setAssignmentStep(assignmentId: string, stepId: string, done: boolean): R {
  const s = await requireUser("MANAGER");
  await setStepDone(assignmentId, stepId, done, s.name);
  refresh();
}

export async function signOffAssignment(id: string, on: boolean): R {
  const s = await requireUser("MANAGER");
  await db.trainingAssignment.update({ where: { id }, data: on ? { signedOffBy: s.name, signedOffAt: new Date() } : { signedOffBy: null, signedOffAt: null } }).catch(() => null);
  refresh();
}
