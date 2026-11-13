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
  revalidatePath("/settings", "layout");
  return { ok: `Added ${p.data.name}` };
}

export async function loadDemoData() {
  await requireUser("MANAGER");
  const empty = (await db.ingredient.count()) === 0 && (await db.recipe.count()) === 0;
  if (!empty) return;
  const { seedDemo } = await import("@/server/demo-data");
  await seedDemo(db, { keepUsers: true });
  revalidatePath("/", "layout");
}

/** Wipes every ingredient, price, recipe, sale, count and order. Logins are kept. */
export async function clearAllData(_: Result, form: FormData): Promise<Result> {
  await requireUser("MANAGER");
  if (String(form.get("confirm")).trim().toUpperCase() !== "CLEAR") return { error: 'Type CLEAR to confirm.' };
  const { seedDemo } = await import("@/server/demo-data");
  await seedDemo(db, { keepUsers: true, mode: "empty" });
  revalidatePath("/", "layout");
  return { ok: "All data cleared. Logins kept." };
}
