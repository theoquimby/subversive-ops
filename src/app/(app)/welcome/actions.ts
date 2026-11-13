"use server";

import { hashPin, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { saveOpeningHours } from "@/server/services/labor-rules";
import { isStepId, recordStep, saveBusinessProfile, saveOnboardingProgress } from "@/server/services/onboarding";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadDemoData } from "../settings/actions";

type Result = { error?: string; ok?: boolean };

export async function moveStep(step: string, status: "done" | "skipped" | "visit", next: string): Promise<Result> {
  await requireUser("MANAGER");
  if (!isStepId(step) || !isStepId(next)) return { error: "Unknown step" };
  await recordStep(step, status, next);
  return { ok: true };
}

export async function dismissSetupCard(): Promise<Result> {
  await requireUser("MANAGER");
  await saveOnboardingProgress({ dismissed: true });
  revalidatePath("/", "layout");
  return { ok: true };
}

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const hoursSchema = z.record(z.string().regex(/^[0-6]$/), z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]));

const basicsSchema = z.object({
  name: z.string().trim().min(1, "Add the business name").max(80),
  timezone: z.string().refine(validZone, "Pick a time zone"),
  hours: hoursSchema,
  targetPct: z.number().gt(0, "Target is 1–99%").lt(100, "Target is 1–99%"),
});

export async function saveBasics(input: z.input<typeof basicsSchema>): Promise<Result> {
  await requireUser("MANAGER");
  const p = basicsSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  for (const [d, [open, close]] of Object.entries(v.hours)) {
    if (close <= open) return { error: `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(d)]} closes before it opens` };
  }
  await saveBusinessProfile({ name: v.name, timezone: v.timezone });
  await saveOpeningHours(Object.fromEntries(Object.entries(v.hours).map(([d, h]) => [Number(d), h])) as Record<number, [number, number]>);
  const target = String(v.targetPct / 100);
  await db.setting.upsert({ where: { key: "costing.targetFoodCostPct" }, create: { key: "costing.targetFoodCostPct", value: target }, update: { value: target } });
  await recordStep("basics", "done", "suppliers");
  revalidatePath("/", "layout");
  return { ok: true };
}

const supplierSchema = z.object({
  name: z.string().trim().min(1, "Add the supplier's name").max(80),
  kind: z.enum(["DISTRIBUTOR", "LOCAL"]),
  deliveryDays: z.array(z.number().int().min(0).max(6)).max(7),
});

export async function addSupplier(input: z.input<typeof supplierSchema>): Promise<Result & { id?: string }> {
  await requireUser("MANAGER");
  const p = supplierSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    const s = await db.supplier.create({ data: { name: p.data.name, kind: p.data.kind, deliveryDays: [...new Set(p.data.deliveryDays)].sort(), leadTimeDays: 1 } });
    revalidatePath("/", "layout");
    return { ok: true, id: s.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "There's already a supplier with that name." };
    throw e;
  }
}

export async function setSupplierDays(id: string, days: number[]): Promise<Result> {
  await requireUser("MANAGER");
  const p = z.array(z.number().int().min(0).max(6)).safeParse(days);
  if (!p.success) return { error: "Pick delivery days" };
  await db.supplier.update({ where: { id }, data: { deliveryDays: [...new Set(p.data)].sort() } });
  revalidatePath("/", "layout");
  return { ok: true };
}

const memberSchema = z.object({
  name: z.string().trim().min(1, "Add their name").max(60),
  pin: z.string().regex(/^\d{4,8}$/, "PIN is 4–8 digits"),
  role: z.enum(["MANAGER", "STAFF"]),
});

export async function addTeamMember(input: z.input<typeof memberSchema>): Promise<Result> {
  await requireUser("MANAGER");
  const p = memberSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    await db.user.create({ data: { name: p.data.name, role: p.data.role, pinHash: await hashPin(p.data.pin) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Someone already has that name." };
    throw e;
  }
  revalidatePath("/welcome");
  return { ok: true };
}

export async function loadDemo(): Promise<Result> {
  await requireUser("MANAGER");
  const empty = (await db.ingredient.count()) === 0 && (await db.recipe.count()) === 0;
  if (!empty) return { error: "You already have data, so the demo wasn't loaded." };
  await loadDemoData();
  await recordStep("data", "done", "square");
  return { ok: true };
}
