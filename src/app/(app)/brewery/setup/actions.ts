"use server";

import { requireUser } from "@/server/auth";
import { breweryDefaults } from "@/server/services/brewery";
import { addTank, deleteTank, saveBreweryDefaults, setTankField, type TankField } from "@/server/services/breweryWrite";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function refresh() {
  revalidatePath("/brewery", "layout");
  revalidatePath("/");
}

const fields = z.enum(["name", "kind", "capacityBbl", "sort", "active", "notes"]);

export async function addTankAction(input: unknown): Promise<{ ok?: string; error?: string }> {
  await requireUser("MANAGER");
  const p = z.object({ name: z.string().trim().min(1, "Name the tank, like FV3").max(40), kind: z.enum(["FERMENTER", "BRITE", "OTHER"]), capacityBbl: z.coerce.number({ message: "Barrels, like 7" }).positive("Barrels, like 7").max(1000) }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  const r = await addTank(p.data.name, p.data.kind, p.data.capacityBbl);
  if ("ok" in r) refresh();
  return r;
}

export async function setTankFieldAction(id: string, field: TankField, raw: string): Promise<{ error?: string } | void> {
  await requireUser("MANAGER");
  fields.parse(field);
  const r = await setTankField(id, field, String(raw).slice(0, 500));
  if ("error" in r) return { error: r.error };
  refresh();
}

export async function deleteTankAction(id: string): Promise<{ ok?: string; error?: string }> {
  await requireUser("MANAGER");
  const r = await deleteTank(id);
  if ("ok" in r) refresh();
  return r;
}

export async function setDefaultDaysAction(which: "ferment" | "condition", raw: string): Promise<{ error?: string } | void> {
  await requireUser("MANAGER");
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0 || n > 120) return { error: "Whole days, like 14" };
  const d = await breweryDefaults();
  await saveBreweryDefaults(which === "ferment" ? n : d.fermentDays, which === "condition" ? n : d.conditionDays);
  refresh();
}
