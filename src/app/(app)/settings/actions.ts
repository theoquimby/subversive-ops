"use server";

import { hashPin, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Result = { error?: string; ok?: string } | undefined;

const userSchema = z.object({ name: z.string().trim().min(1, "Name is required"), pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4–8 digits"), role: z.enum(["MANAGER", "STAFF"]) });

export async function addUser(_: Result, form: FormData): Promise<Result> {
  await requireUser("MANAGER");
  const p = userSchema.safeParse({ name: form.get("name"), pin: form.get("pin"), role: form.get("role") });
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    await db.user.create({ data: { name: p.data.name, role: p.data.role, pinHash: await hashPin(p.data.pin) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Someone already has that name." };
    throw e;
  }
  revalidatePath("/settings");
  return { ok: `Added ${p.data.name}` };
}

export async function resetPin(userId: string, form: FormData) {
  await requireUser("MANAGER");
  const pin = String(form.get("pin") ?? "");
  if (!/^\d{4,8}$/.test(pin)) return;
  await db.user.update({ where: { id: userId }, data: { pinHash: await hashPin(pin), failedPinAttempts: 0, lockedUntil: null } });
  revalidatePath("/settings");
}

export async function toggleUser(userId: string) {
  const me = await requireUser("MANAGER");
  if (me.userId === userId) return;
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await db.user.update({ where: { id: userId }, data: { active: !u.active } });
  revalidatePath("/settings");
}

const supplierSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: z.enum(["DISTRIBUTOR", "LOCAL"]),
  email: z.string().trim().email().or(z.literal("")).optional(),
  leadTimeDays: z.coerce.number().int().min(0).max(14),
  minOrder: z.string().optional(),
  deliveryDays: z.array(z.coerce.number().int().min(0).max(6)),
});

export async function saveSupplier(id: string | null, _: Result, form: FormData): Promise<Result> {
  await requireUser("MANAGER");
  const p = supplierSchema.safeParse({
    name: form.get("name"), kind: form.get("kind"), email: form.get("email") ?? "", leadTimeDays: form.get("leadTimeDays") ?? 1,
    minOrder: String(form.get("minOrder") ?? ""), deliveryDays: form.getAll("deliveryDays"),
  });
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  const data = {
    name: v.name, kind: v.kind, email: v.email || null, leadTimeDays: v.leadTimeDays, deliveryDays: v.deliveryDays.sort(),
    minOrder: v.minOrder && Number(v.minOrder) > 0 ? new Prisma.Decimal(Number(v.minOrder)) : null,
  };
  try {
    if (id) await db.supplier.update({ where: { id }, data });
    else await db.supplier.create({ data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "A supplier with that name exists." };
    throw e;
  }
  revalidatePath("/settings");
  revalidatePath("/ordering");
  return { ok: "Saved" };
}

export async function saveTarget(form: FormData) {
  await requireUser("MANAGER");
  const pct = Number(form.get("target"));
  if (!(pct > 0 && pct < 100)) return;
  await db.setting.upsert({ where: { key: "costing.targetFoodCostPct" }, create: { key: "costing.targetFoodCostPct", value: String(pct / 100) }, update: { value: String(pct / 100) } });
  revalidatePath("/", "layout");
}
