"use server";

import { requireUser } from "@/server/auth";
import { breweryDefaults } from "@/server/services/brewery";
import { addStarterTanks, addTank, deleteTank, saveBreweryDefaults, saveSnapDays, setTankField, type TankField } from "@/server/services/breweryWrite";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function refresh() {
  revalidatePath("/brewery", "layout");
  revalidatePath("/");
}

const fields = z.enum(["name", "kind", "capacityBbl", "sort", "active", "notes", "zone", "layoutRow", "layoutCol"]);
const kind = z.enum(["FERMENTER", "BRITE", "OTHER"]);
const place = z.preprocess((v) => (v === "" || v == null ? null : Number(String(v).trim())), z.number({ message: "Row and column are whole numbers" }).int("Row and column are whole numbers").min(1, "Row and column start at 1").max(20, "Row and column go up to 20").nullable());

export async function addTankAction(input: unknown): Promise<{ ok?: string; error?: string }> {
  await requireUser("MANAGER");
  const p = z.object({ name: z.string().trim().min(1, "Name the tank, like FV3").max(40), kind, capacityBbl: z.coerce.number({ message: "Barrels, like 7" }).positive("Barrels, like 7").max(1000) }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  const r = await addTank(p.data.name, p.data.kind, p.data.capacityBbl);
  if ("ok" in r) refresh();
  return r;
}

/** Setup's quick start: Brew Manager's tanks (as edited on the page), all at once. */
export async function addStarterTanksAction(input: unknown): Promise<{ ok?: string; error?: string }> {
  await requireUser("MANAGER");
  const p = z
    .array(z.object({ name: z.string().trim().min(1, "Every tank needs a name").max(40), kind, capacityBbl: z.coerce.number({ message: "Sizes in barrels, like 7" }).positive("Sizes in barrels, like 7").max(1000), zone: z.string().trim().max(40).nullish().transform((v) => v || null), layoutRow: place, layoutCol: place }))
    .max(40)
    .safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  const r = await addStarterTanks(p.data);
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

/** The weekdays transfers or packaging happen on. */
export async function setSnapDaysAction(which: "transfer" | "package", days: number[]): Promise<{ error?: string } | void> {
  await requireUser("MANAGER");
  const p = z.object({ which: z.enum(["transfer", "package"]), days: z.array(z.number().int().min(0).max(6)).max(7) }).safeParse({ which, days });
  if (!p.success) return { error: "Pick the days" };
  await saveSnapDays(p.data.which, p.data.days);
  refresh();
}
