"use server";

import { isLeadRef } from "@/domain/brewOrdering";
import { requireUser } from "@/server/auth";
import { addBrewerySupplier, moveSupplierToBrewery, moveSupplierToKitchen, setBrewerySupplierField, setOrderPlaced, type SupplierField } from "@/server/services/brewOrdering";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function refresh() {
  revalidatePath("/brewery", "layout");
  revalidatePath("/");
}

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function setPlacedAction(batchId: string, supplierId: string, placed: boolean, on?: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const p = z.object({ batchId: z.string().min(1), supplierId: z.string().trim().min(1).max(60), placed: z.boolean(), on: iso.optional() }).safeParse({ batchId, supplierId, placed, on });
  if (!p.success) return { error: "Reload the page and try again." };
  const r = await setOrderPlaced(p.data.batchId, p.data.supplierId, p.data.placed, p.data.on);
  if (!r.error) refresh();
  return r;
}

const fields = z.enum(["name", "leadDays", "ref", "deliveryDays", "email", "notes", "active"]);

export async function setSupplierFieldAction(id: string, field: SupplierField, raw: string): Promise<{ error?: string } | void> {
  await requireUser("MANAGER");
  fields.parse(field);
  const r = await setBrewerySupplierField(String(id), field, String(raw).slice(0, 500));
  if (r.error) return r;
  refresh();
}

export async function addSupplierAction(input: unknown): Promise<{ id?: string; error?: string }> {
  await requireUser("MANAGER");
  const p = z.object({ name: z.string().trim().min(1, "Name the supplier.").max(120), leadDays: z.coerce.number().int("Whole days, like 14").min(0).max(120), ref: z.string() }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  if (!isLeadRef(p.data.ref)) return { error: "Pick what the lead time counts back from." };
  const r = await addBrewerySupplier(p.data.name, p.data.leadDays, p.data.ref);
  if ("id" in r) refresh();
  return r;
}

export async function moveSupplierHereAction(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const r = await moveSupplierToBrewery(String(id));
  if (!r.error) refresh();
  return r;
}

export async function moveSupplierToKitchenAction(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const r = await moveSupplierToKitchen(String(id));
  if (!r.error) refresh();
  return r;
}
