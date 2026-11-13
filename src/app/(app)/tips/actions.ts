"use server";

import { setOverride } from "@/domain/tipSources";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { findPeriod, parseOverrides, savePeriod } from "@/server/services/tips";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.object({
  from: ISO,
  to: ISO,
  method: z.enum(["HOURS", "POINTS"]),
  cardMode: z.enum(["POOL", "KEEP"]),
  cashMode: z.enum(["POOL", "KEEP"]),
});

type Result = { error?: string; id?: string };

/** Save the period with its split settings; manual tip values already saved are kept. */
export async function saveTipPeriod(raw: z.input<typeof period>): Promise<Result> {
  await requireUser("MANAGER");
  const p = period.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the period." };
  if (p.data.to < p.data.from) return { error: "The period ends before it starts." };
  const existing = await findPeriod(p.data.from, p.data.to);
  const r = await savePeriod(p.data.from, p.data.to, p.data.method, p.data.cardMode, p.data.cashMode, parseOverrides(existing?.overrides));
  revalidatePath("/tips");
  return { error: r.error, id: r.id };
}

const tipValue = period.extend({
  kind: z.enum(["CARD", "CASH"]),
  /** null = the pooled line (tips Square doesn't link to anyone). */
  employeeId: z.string().min(1).nullable(),
  /** Empty → back to Square's number. */
  value: z.string().max(20),
});

/**
 * Type over one tip value (a person's card or cash tips, or a pooled line).
 * Saves the period (creating a draft if needed) so the value is kept; the
 * Square sync never changes it. Clearing the cell goes back to Square's value.
 */
export async function setTipValue(raw: z.input<typeof tipValue>): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const p = tipValue.safeParse(raw);
  if (!p.success) return { error: "Check the value." };
  const { from, to, method, cardMode, cashMode, kind, employeeId } = p.data;
  if (to < from) return { error: "The period ends before it starts." };
  const text = p.data.value.replace(/[$,\s]/g, "");
  const value = text === "" ? null : Number(text);
  if (value != null && (!Number.isFinite(value) || value < 0 || value > 1_000_000)) return { error: "Enter an amount like 42.50, or clear it to use Square's." };
  const existing = await findPeriod(from, to);
  if (existing?.finalized) return { error: "This period is finalized." };
  const overrides = setOverride(parseOverrides(existing?.overrides), { kind, employeeId }, value);
  const r = await savePeriod(from, to, method, cardMode, cashMode, overrides);
  revalidatePath("/tips");
  return r.error ? { error: r.error } : {};
}

/** Lock the period. It is saved once more first, so it locks exactly what the page shows now. */
export async function finalizeTipPeriod(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const p = await db.tipPeriod.findUnique({ where: { id } });
  if (!p) return { error: "That period is gone." };
  if (p.finalized) return {};
  const from = p.startDate.toISOString().slice(0, 10);
  const to = p.endDate.toISOString().slice(0, 10);
  const r = await savePeriod(from, to, p.method as "HOURS" | "POINTS", p.cardMode as "POOL" | "KEEP", p.cashMode as "POOL" | "KEEP", parseOverrides(p.overrides));
  if (r.error) return { error: r.error };
  await db.tipPeriod.update({ where: { id: r.id }, data: { finalized: true } });
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
