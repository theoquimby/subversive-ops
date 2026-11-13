"use server";

import { BEER_COLORS, displayCode, KEG_SIZE_LIST, normalizeCode, placeLabel, type KegActionId } from "@/domain/kegs";
import { cleanAreaName } from "@/domain/storageAreas";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { checkKegStock } from "@/server/services/keg-alerts";
import { doKegAction, findKegByScan, freshCodes, kegCard, KEG_ACTIONS, kegConfig, nextKegOf, saveKegConfig, undoKegEvents, type DoActionResult, type KegCard } from "@/server/services/kegs";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const refresh = () => revalidatePath("/kegs", "layout");

// ---- Scanning (staff and managers) -------------------------------------------------------------

/** What a scan or typed code points at. */
export async function lookupKeg(text: string): Promise<{ id: string; code: string; card: KegCard } | { error: string }> {
  await requireUser();
  const t = String(text ?? "").slice(0, 500);
  if (!t.trim()) return { error: "Type the code on the sticker." };
  const hit = await findKegByScan(t);
  if (!hit) return { error: `No keg with the code ${displayCode(normalizeCode(t).slice(0, 12)) || t.trim().slice(0, 20)}. Check the sticker, or a manager can add it.` };
  const card = await kegCard(hit.id);
  return card ? { id: hit.id, code: hit.code, card } : { error: "That keg was removed." };
}

export async function loadKegCard(id: string): Promise<KegCard | null> {
  await requireUser();
  return kegCard(id);
}

const actionSchema = z.object({
  kegId: z.string().min(1),
  action: z.enum(KEG_ACTIONS as [KegActionId, ...KegActionId[]]),
  tapLine: z.number().int().min(1).max(99).nullish(),
  area: z.string().trim().max(60).nullish(),
  spotId: z.string().nullish(),
  spotNote: z.string().trim().max(80).nullish(),
  accountId: z.string().nullish(),
  beerId: z.string().nullish(),
  batchCode: z.string().trim().max(40).nullish(),
  filledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  bestBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  note: z.string().trim().max(300).nullish(),
  clientId: z.string().max(64).nullish(),
  groupId: z.string().max(64).nullish(),
  at: z.number().nullish(),
});
export type KegActionForm = z.infer<typeof actionSchema>;

export async function kegAction(input: KegActionForm): Promise<DoActionResult & { card?: KegCard | null }> {
  const me = await requireUser();
  const v = actionSchema.safeParse(input);
  if (!v.success) return { error: "Something's missing. Try again." };
  const d = v.data;
  const r = await doKegAction({ userId: me.userId, name: me.name }, { ...d, area: d.area ? cleanAreaName(d.area) : d.area });
  if ("error" in r) return r;
  if (d.action === "KICK") {
    const k = await db.keg.findUnique({ where: { id: d.kegId }, select: { beerId: true } });
    const ev = await db.kegEvent.findUnique({ where: { id: r.eventId }, select: { fromPlace: true } });
    checkKegStock(k?.beerId ?? null, { kicked: { where: ev?.fromPlace ?? null, who: me.name } });
  } else if (d.action === "TAP" || d.action === "OUT") {
    const k = await db.keg.findUnique({ where: { id: d.kegId }, select: { beerId: true } });
    checkKegStock(k?.beerId ?? null);
  }
  refresh();
  return { ...r, card: await kegCard(d.kegId) };
}

export async function undoKegAction(ref: { eventId?: string; groupId?: string }) {
  const me = await requireUser();
  const r = await undoKegEvents({ userId: me.userId, role: me.role }, ref);
  refresh();
  return r;
}

/** Full kegs of a beer to put on next, oldest first, with exactly where they are. */
export async function replacementsFor(beerId: string, excludeId?: string) {
  await requireUser();
  return nextKegOf(beerId, excludeId);
}

// ---- Managers: kegs ------------------------------------------------------------------------------

const newKegsSchema = z.object({ count: z.number().int().min(1).max(200), sizeId: z.string(), owner: z.enum(["OURS", "DEPOSIT", "BORROWED"]), area: z.string().trim().max(60).nullish() });

/** Add N empty kegs with fresh codes (then print their labels). */
export async function addKegs(input: z.infer<typeof newKegsSchema>): Promise<{ ok: true; codes: string[] } | { error: string }> {
  const me = await requireUser("MANAGER");
  const v = newKegsSchema.safeParse(input);
  if (!v.success) return { error: "Between 1 and 200 kegs at a time." };
  if (!KEG_SIZE_LIST.some((s) => s.id === v.data.sizeId)) return { error: "Pick a size." };
  const codes = await freshCodes(v.data.count);
  await db.$transaction(async (tx) => {
    for (const code of codes) {
      const k = await tx.keg.create({ data: { code, sizeId: v.data.sizeId, owner: v.data.owner, area: v.data.area || null } });
      await tx.kegEvent.create({ data: { kegId: k.id, userId: me.userId, userName: me.name, action: "CREATED", toStatus: "EMPTY", toPlace: placeLabel({ area: k.area }) } });
    }
  });
  refresh();
  return { ok: true, codes };
}

const kegFieldSchema = z.object({
  id: z.string(),
  field: z.enum(["sizeId", "owner", "notes", "label", "legacyCode", "active", "spotNote"]),
  value: z.string().max(300),
});

export async function setKegField(id: string, field: z.infer<typeof kegFieldSchema>["field"], value: string): Promise<{ error?: string }> {
  const me = await requireUser("MANAGER");
  const v = kegFieldSchema.safeParse({ id, field, value });
  if (!v.success) return { error: "That doesn't look right." };
  const raw = v.data.value.trim();
  let data: Prisma.KegUpdateInput;
  switch (field) {
    case "sizeId": if (!KEG_SIZE_LIST.some((s) => s.id === raw)) return { error: "Pick a size." }; data = { sizeId: raw }; break;
    case "owner": if (!["OURS", "DEPOSIT", "BORROWED"].includes(raw)) return { error: "Pick who owns it." }; data = { owner: raw as "OURS" }; break;
    case "active": data = { active: raw === "true" }; break;
    case "legacyCode": data = { legacyCode: raw || null }; break;
    default: data = { [field]: raw || null };
  }
  try {
    await db.keg.update({ where: { id }, data });
    await db.kegEvent.create({ data: { kegId: id, userId: me.userId, userName: me.name, action: "EDITED", note: `${field}: ${raw || "—"}`.slice(0, 300) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Another keg already has that old code." };
    throw e;
  }
  refresh();
  return {};
}

// ---- Managers: beers -----------------------------------------------------------------------------

export async function addBeer(name: string, squareName?: string): Promise<{ ok: true; id: string } | { error: string }> {
  await requireUser("MANAGER");
  const n = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!n) return { error: "Name the beer." };
  const { guessBeerColor } = await import("@/domain/kegs");
  try {
    const b = await db.beer.create({ data: { name: n, color: guessBeerColor(n), squareNames: squareName?.trim() ? [squareName.trim()] : [] } });
    refresh();
    return { ok: true, id: b.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "That beer is already on the list." };
    throw e;
  }
}

export async function setBeerField(id: string, field: "name" | "style" | "color" | "squareNames" | "minFull" | "house" | "active" | "ingredientId" | "recipeId", raw: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const value = String(raw ?? "").trim();
  let data: Prisma.BeerUpdateInput;
  switch (field) {
    case "name": if (!value) return { error: "Can't be empty" }; data = { name: value.slice(0, 80) }; break;
    case "style": data = { style: value.slice(0, 60) || null }; break;
    case "color": if (!BEER_COLORS.some((c) => c.id === value)) return { error: "Pick a color" }; data = { color: value }; break;
    case "squareNames": data = { squareNames: value.split(/\s*[;,\n]\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 12) }; break;
    case "minFull": { const n = Number(value); if (!Number.isInteger(n) || n < 0 || n > 50) return { error: "A whole number, 0–50" }; data = { minFull: n }; break; }
    case "house": data = { house: value === "true" }; break;
    case "active": data = { active: value === "true" }; break;
    case "ingredientId": data = { ingredientId: value || null }; break;
    case "recipeId": {
      if (value && !(await db.recipe.findFirst({ where: { id: value, kind: "PREP" }, select: { id: true } }))) return { error: "Pick a prep recipe" };
      data = { recipeId: value || null };
      break;
    }
  }
  try {
    await db.beer.update({ where: { id }, data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Another beer has that name" };
    throw e;
  }
  refresh();
  return {};
}

// ---- Managers: spots, accounts, settings ----------------------------------------------------------

export async function addSpot(area: string, name: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const a = cleanAreaName(area), n = cleanAreaName(name);
  if (!a || !n) return { error: "Name the spot." };
  const last = await db.kegSpot.findFirst({ where: { area: a }, orderBy: { sort: "desc" } });
  try {
    await db.kegSpot.create({ data: { area: a, name: n, sort: (last?.sort ?? 0) + 1 } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "That spot already exists." };
    throw e;
  }
  refresh();
  return {};
}

export async function renameSpot(id: string, name: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const n = cleanAreaName(name);
  if (!n) return { error: "Can't be empty" };
  try {
    await db.kegSpot.update({ where: { id }, data: { name: n } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "That spot already exists." };
    throw e;
  }
  refresh();
  return {};
}

export async function removeSpot(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await db.kegSpot.delete({ where: { id } }).catch(() => undefined);
  refresh();
  return {};
}

export async function addAccount(name: string): Promise<{ ok: true; id: string } | { error: string }> {
  await requireUser("MANAGER");
  const n = String(name ?? "").trim().slice(0, 100);
  if (!n) return { error: "Name the account." };
  try {
    const a = await db.kegAccount.create({ data: { name: n } });
    refresh();
    return { ok: true, id: a.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "That account is already on the list." };
    throw e;
  }
}

export async function setAccountField(id: string, field: "name" | "kind" | "contact" | "email" | "phone" | "address" | "notes" | "active", raw: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const value = String(raw ?? "").trim().slice(0, 300);
  if (field === "name" && !value) return { error: "Can't be empty" };
  if (field === "email" && value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return { error: "That isn't an email" };
  try {
    await db.kegAccount.update({ where: { id }, data: field === "active" ? { active: value === "true" } : { [field]: value || (field === "kind" ? "bar" : null) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Another account has that name" };
    throw e;
  }
  refresh();
  return {};
}

const configSchema = z.object({ tapLines: z.number().int().min(1).max(60).optional(), tapArea: z.string().trim().min(1).max(60).optional(), coldArea: z.string().trim().min(1).max(60).optional(), fillDays: z.number().int().min(1).max(60).optional() });

export async function saveConfig(patch: z.infer<typeof configSchema>): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const v = configSchema.safeParse(patch);
  if (!v.success) return { error: "That number doesn't look right." };
  await saveKegConfig(v.data);
  refresh();
  return {};
}

/** Pour size for a Square variation name ("Full Pour" → 16). Blank removes the override. */
export async function savePour(variation: string, raw: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const k = String(variation ?? "").trim().toLowerCase();
  if (!k) return { error: "Name the pour." };
  const cfg = await kegConfig();
  const pours = { ...cfg.pours };
  if (!raw.trim()) delete pours[k];
  else {
    const n = Number(raw.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 200) return { error: "Ounces, 0–200 (0 = not from a keg)" };
    pours[k] = n;
  }
  await saveKegConfig({ pours });
  refresh();
  return {};
}
