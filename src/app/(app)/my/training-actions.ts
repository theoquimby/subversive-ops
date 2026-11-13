"use server";

/** Staff training actions on /my: upload your own certificate, tick checklist steps. */

import { expiryFor } from "@/domain/certs";
import { parseISODate } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { employeeForUser } from "@/server/services/scheduling";
import { certFileData, setStepDone } from "@/server/services/training";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const refresh = () => { revalidatePath("/my"); revalidatePath("/team/training"); revalidatePath("/team"); };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)));

/** A photo or PDF of your own certificate. It goes in unverified until a manager checks it. */
export async function uploadMyCertificate(form: FormData): Promise<{ error?: string; ok?: string }> {
  const s = await requireUser();
  const me = await employeeForUser(s.userId);
  if (!me) return { error: "Your login isn't linked to a team member yet. Ask a manager." };
  const p = z.object({ certTypeId: z.string().min(1), issuedOn: isoDate, expiresOn: isoDate.optional(), number: z.string().max(80).optional() }).safeParse({
    certTypeId: form.get("certTypeId"),
    issuedOn: form.get("issuedOn"),
    expiresOn: form.get("expiresOn") || undefined,
    number: form.get("number") || undefined,
  });
  if (!p.success) return { error: "Pick the date on the certificate." };
  if (p.data.issuedOn > businessToday()) return { error: "The issue date can't be in the future." };
  const type = await db.certType.findFirst({ where: { id: p.data.certTypeId, active: true } });
  if (!type) return { error: "That certificate isn't tracked any more." };
  const file = await certFileData(form.get("file"));
  if (!file) return { error: "Add a photo or PDF of the certificate." };
  if ("error" in file) return file;
  const auto = expiryFor(p.data.issuedOn, type.validityMonths);
  const expires = expiryFor(p.data.issuedOn, type.validityMonths, p.data.expiresOn);
  if (expires && expires < p.data.issuedOn) return { error: "It can't expire before it was issued." };
  await db.certification.create({
    data: {
      employeeId: me.id,
      certTypeId: type.id,
      issuedOn: parseISODate(p.data.issuedOn),
      expiresOn: expires ? parseISODate(expires) : null,
      expiryOverridden: !!p.data.expiresOn && p.data.expiresOn !== auto,
      number: p.data.number?.trim() || null,
      uploadedBy: s.name,
      ...file,
    },
  });
  refresh();
  return { ok: "Uploaded — a manager will check it" };
}

/** Tick or untick a step on one of your own checklists (until it's signed off). */
export async function tickMyStep(assignmentId: string, stepId: string, done: boolean): Promise<{ error?: string }> {
  const s = await requireUser();
  const me = await employeeForUser(s.userId);
  if (!me) return { error: "Your login isn't linked to a team member yet." };
  const a = await db.trainingAssignment.findUnique({ where: { id: assignmentId }, select: { employeeId: true, signedOffAt: true } });
  if (!a || a.employeeId !== me.id) return { error: "That checklist isn't yours." };
  if (a.signedOffAt) return { error: "Already signed off by a manager." };
  await setStepDone(assignmentId, stepId, done, s.name);
  refresh();
  return {};
}
