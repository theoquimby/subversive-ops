"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { savePeriod } from "@/server/services/tips";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const input = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total: z.number().min(0, "Tips can't be negative.").max(1_000_000),
  method: z.enum(["HOURS", "POINTS"]),
});

export async function saveTipPeriod(raw: z.input<typeof input>): Promise<{ error?: string; id?: string }> {
  await requireUser("MANAGER");
  const p = input.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the period." };
  if (p.data.to < p.data.from) return { error: "The period ends before it starts." };
  const r = await savePeriod(p.data.from, p.data.to, p.data.total, p.data.method);
  revalidatePath("/tips");
  return r;
}

export async function finalizeTipPeriod(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await db.tipPeriod.update({ where: { id }, data: { finalized: true } });
  revalidatePath("/tips");
  return {};
}

export async function deleteTipPeriod(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const r = await db.tipPeriod.deleteMany({ where: { id, finalized: false } });
  if (!r.count) return { error: "Finalized periods can't be deleted." };
  revalidatePath("/tips");
  return {};
}
