"use server";

import { createFirstManager, loginWithPin } from "@/server/auth";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({ name: z.string().trim().min(1, "Enter your name"), pin: z.string().regex(/^\d{4,8}$/, "PIN is 4–8 digits") });

export async function login(_: { error?: string } | undefined, form: FormData) {
  const parsed = schema.safeParse({ name: form.get("name"), pin: form.get("pin") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const res = await loginWithPin(parsed.data.name, parsed.data.pin);
  if (!res.ok) return { error: res.error };
  redirect(res.role === "MANAGER" ? "/" : "/my");
}

export async function setup(_: { error?: string } | undefined, form: FormData) {
  const parsed = schema.safeParse({ name: form.get("name"), pin: form.get("pin") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (form.get("pin") !== form.get("confirm")) return { error: "PINs don't match" };
  const res = await createFirstManager(parsed.data.name, parsed.data.pin);
  if (!res.ok) return { error: res.error };
  redirect("/settings?welcome=1");
}
