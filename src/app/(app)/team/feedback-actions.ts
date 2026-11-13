"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const input = z.object({
  employeeId: z.string().min(1),
  kind: z.enum(["PRAISE", "COACHING", "NOTE"]),
  body: z.string().trim().min(1).max(2000),
  visible: z.boolean(),
});

export async function addFeedback(raw: z.input<typeof input>): Promise<{ error?: string; id?: string }> {
  const s = await requireUser("MANAGER");
  const p = input.safeParse(raw);
  if (!p.success) return { error: p.error.issues.some((i) => i.path[0] === "body") ? "Write a short note first." : "Check the note." };
  const emp = await db.employee.findUnique({ where: { id: p.data.employeeId }, select: { id: true } });
  if (!emp) return { error: "That person isn't on the team any more." };
  const f = await db.employeeFeedback.create({ data: { employeeId: p.data.employeeId, kind: p.data.kind, body: p.data.body, visibleToEmployee: p.data.visible, authorId: s.userId } });
  revalidatePath("/team");
  revalidatePath("/my");
  return { id: f.id };
}

export async function setFeedbackVisible(id: string, visible: boolean): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await db.employeeFeedback.update({ where: { id }, data: { visibleToEmployee: visible } }).catch(() => null);
  revalidatePath("/team");
  revalidatePath("/my");
  return {};
}

export async function deleteFeedback(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await db.employeeFeedback.deleteMany({ where: { id } });
  revalidatePath("/team");
  revalidatePath("/my");
  return {};
}
