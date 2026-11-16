"use server";

import { requireUser } from "@/server/auth";
import {
  addBrewingIngredient,
  deleteStockMove,
  moveIngredientToBrewery,
  moveIngredientToKitchen,
  saveAdjust,
  saveCounts,
  saveReceived,
  stockHistory,
  type StockMoveView,
} from "@/server/services/brewStock";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function refresh() {
  revalidatePath("/brewery", "layout");
  revalidatePath("/");
}

const entry = z.object({ ingredientId: z.string().min(1), qty: z.number().finite(), unit: z.string().trim().min(1).max(30) });
const entries = z.array(entry).max(1000);

export async function saveCountsAction(input: unknown): Promise<{ ok?: string; error?: string; errors?: { ingredientId: string; error: string }[] }> {
  const u = await requireUser("MANAGER");
  const p = entries.safeParse(input);
  if (!p.success) return { error: "Some amounts aren't numbers. Check them and save again." };
  if (!p.data.length) return { error: "Type at least one amount." };
  if (p.data.some((e) => e.qty < 0)) return { error: "A count can't be less than zero." };
  const r = await saveCounts(p.data, u.name);
  if (r.saved) refresh();
  return r.errors.length ? { errors: r.errors, error: r.saved ? `Saved ${r.saved}; ${r.errors.length} need a look.` : r.errors[0].error } : { ok: `Counted ${r.saved} ingredient${r.saved === 1 ? "" : "s"}.` };
}

export async function saveReceivedAction(input: unknown, note: unknown): Promise<{ ok?: string; error?: string; errors?: { ingredientId: string; error: string }[] }> {
  const u = await requireUser("MANAGER");
  const p = entries.safeParse(input);
  const n = z.string().max(200).nullable().safeParse(note ?? null);
  if (!p.success || !n.success) return { error: "Some amounts aren't numbers. Check them and save again." };
  if (!p.data.some((e) => e.qty > 0)) return { error: "Type at least one amount that came in." };
  const r = await saveReceived(p.data, n.data, u.name);
  if (r.saved) refresh();
  return r.errors.length ? { errors: r.errors, error: r.saved ? `Saved ${r.saved}; ${r.errors.length} need a look.` : r.errors[0].error } : { ok: `Added ${r.saved} to stock.` };
}

export async function saveAdjustAction(input: unknown): Promise<{ error?: string }> {
  const u = await requireUser("MANAGER");
  const p = entry.extend({ note: z.string().trim().min(1, "Say why, like “spilled half a sack”").max(200) }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the amount" };
  const r = await saveAdjust(p.data, p.data.note, u.name);
  if (!r.error) refresh();
  return r;
}

export async function stockHistoryAction(ingredientId: string): Promise<StockMoveView[]> {
  await requireUser("MANAGER");
  return stockHistory(String(ingredientId));
}

export async function deleteMoveAction(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const r = await deleteStockMove(String(id));
  if (!r.error) refresh();
  return r;
}

export async function addIngredientAction(input: unknown): Promise<{ id?: string; error?: string }> {
  await requireUser("MANAGER");
  const p = z.object({ name: z.string().trim().min(1, "Name it first, like Pilsner malt.").max(120), category: z.enum(["Malt", "Hops", "Yeast", "Brewing"]), unit: z.enum(["lb", "oz", "kg", "g", "gal", "l", "ml", "pkg"]) }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  const r = await addBrewingIngredient(p.data.name, p.data.category, p.data.unit);
  if ("id" in r) refresh();
  return r;
}

export async function moveToBreweryAction(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const r = await moveIngredientToBrewery(String(id));
  if (!r.error) refresh();
  return r;
}

export async function moveToKitchenAction(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const r = await moveIngredientToKitchen(String(id));
  if (!r.error) refresh();
  return r;
}
