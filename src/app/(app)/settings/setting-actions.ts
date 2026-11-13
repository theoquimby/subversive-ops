"use server";

/**
 * Settings → every sub-page's inline saves. Where a setting already had an
 * action on the page that uses it (invoices, insights, prices…), this calls
 * that same action so the side effects (re-matching invoices, refreshing
 * Insights) stay identical, then refreshes Settings too.
 */

import { saveBevTarget } from "@/app/(app)/menu/draft-beer/actions";
import { saveAccountField, saveAutoApprove, savePricesOnApprove, saveSalesTaxRate, saveTolerance } from "@/app/(app)/invoices/actions";
import { saveFixedCost, setRange } from "@/app/(app)/insights/actions";
import { savePriceAlertThreshold } from "@/app/(app)/prices/actions";
import { saveCutoff } from "@/app/(app)/ordering/actions";
import { setScheduleAutoDraft } from "@/app/(app)/schedule/actions";
import { seasonProblem, weekProblem, type SeasonalHours, type WeekHours } from "@/domain/openingHours";
import type { RangePreset } from "@/domain/lab";
import { hashPin, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { getSeasonalHours, saveOpeningHours, saveSeasonalHours } from "@/server/services/labor-rules";
import { saveReviewSetting, SETTING_TONE } from "@/server/services/reviews";
import { findTown, saveBusinessField, saveDefaultLaborPct, saveLocation, type ContactField, type WeatherLocation } from "@/server/services/settings";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = { error?: string };

const refresh = () => revalidatePath("/settings", "layout");
const pass = async (p: Promise<R | void | undefined>): Promise<R> => {
  const r = await p;
  refresh();
  return r && r.error ? { error: r.error } : {};
};
const percent = (raw: string) => Number(raw.trim().replace(/%$/, "").trim());

// ---- Business ---------------------------------------------------------------------------

const contactRules: Record<ContactField, z.ZodType<string>> = {
  name: z.string().min(1, "The business needs a name").max(80, "Keep the name under 80 characters"),
  address: z.string().max(200, "Keep the address under 200 characters"),
  phone: z.string().max(30, "That's too long for a phone number").refine((v) => v === "" || (/^[\d\s()+.\-x]+$/i.test(v) && v.replace(/\D/g, "").length >= 7), "Enter a phone number, like (518) 555-0100"),
  email: z.string().max(120).refine((v) => v === "" || z.string().email().safeParse(v).success, "That email address doesn't look right"),
  website: z.string().max(200).refine((v) => v === "" || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v), "Enter a web address, like subversivebrewing.com"),
};

export async function saveContact(field: ContactField, raw: string): Promise<R> {
  await requireUser("MANAGER");
  const rule = contactRules[field];
  if (!rule) return { error: "Unknown field" };
  const p = rule.safeParse(raw.trim());
  if (!p.success) return { error: p.error.issues[0].message };
  await saveBusinessField(field, p.data);
  refresh();
  revalidatePath("/", "layout");
  return {};
}

const weekSchema = z.record(z.string().regex(/^[0-6]$/), z.tuple([z.number().int(), z.number().int()]));
const toWeek = (w: z.infer<typeof weekSchema>): WeekHours => Object.fromEntries(Object.entries(w).map(([d, h]) => [Number(d), h]));

export async function saveHours(hours: Record<string, [number, number]>): Promise<R> {
  await requireUser("MANAGER");
  const p = weekSchema.safeParse(hours);
  if (!p.success) return { error: "Those hours don't look right." };
  const week = toWeek(p.data);
  const problem = weekProblem(week);
  if (problem) return { error: problem };
  await saveOpeningHours(week);
  refresh();
  revalidatePath("/schedule");
  revalidatePath("/sales");
  return {};
}

const seasonSchema = z.object({ id: z.string().max(40).optional(), label: z.string().trim().max(40, "Keep the name short"), from: z.string(), to: z.string(), hours: weekSchema });

export async function saveSeason(input: z.input<typeof seasonSchema>): Promise<R & { id?: string }> {
  await requireUser("MANAGER");
  const p = seasonSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const season: SeasonalHours = { id: p.data.id || Math.random().toString(36).slice(2, 10), label: p.data.label, from: p.data.from, to: p.data.to, hours: toWeek(p.data.hours) };
  const problem = seasonProblem(season);
  if (problem) return { error: problem };
  const all = await getSeasonalHours();
  const i = all.findIndex((s) => s.id === season.id);
  if (i >= 0) all[i] = season;
  else {
    if (all.length >= 6) return { error: "Six seasons is the most — remove one first." };
    all.push(season);
  }
  await saveSeasonalHours(all);
  refresh();
  revalidatePath("/schedule");
  return { id: season.id };
}

export async function deleteSeason(id: string): Promise<R> {
  await requireUser("MANAGER");
  await saveSeasonalHours((await getSeasonalHours()).filter((s) => s.id !== id));
  refresh();
  revalidatePath("/schedule");
  return {};
}

export async function searchTown(q: string) {
  await requireUser("MANAGER");
  const query = q.trim();
  if (query.length < 2) return { error: "Type at least two letters of the town." };
  return findTown(query.slice(0, 80));
}

const locSchema = z.object({ lat: z.number().min(-90, "Latitude is between -90 and 90").max(90, "Latitude is between -90 and 90"), lon: z.number().min(-180, "Longitude is between -180 and 180").max(180, "Longitude is between -180 and 180"), label: z.string().trim().min(1, "Give the place a name, like Catskill, NY").max(80) });

export async function saveWeatherLocation(loc: WeatherLocation): Promise<R> {
  await requireUser("MANAGER");
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return { error: "Type numbers for latitude and longitude, like 42.2173 and -73.8646" };
  const p = locSchema.safeParse(loc);
  if (!p.success) return { error: p.error.issues[0].message };
  await saveLocation(p.data);
  refresh();
  revalidatePath("/sales");
  return {};
}

// ---- People & pay -------------------------------------------------------------------------

/** True when this user is the only active manager (so demoting or switching them off would lock everyone out). */
async function isLastManager(userId: string) {
  const managers = await db.user.findMany({ where: { role: "MANAGER", active: true }, select: { id: true } });
  return managers.length === 1 && managers[0].id === userId;
}

export async function setUserRole(userId: string, role: string): Promise<R> {
  const me = await requireUser("MANAGER");
  const r = z.enum(["MANAGER", "STAFF"]).safeParse(role);
  if (!r.success) return { error: "Pick Staff or Manager" };
  if (userId === me.userId && r.data !== "MANAGER") return { error: "You can't take away your own manager access." };
  if (r.data === "STAFF" && (await isLastManager(userId))) return { error: "This is the only manager left — make someone else a manager first." };
  await db.user.update({ where: { id: userId }, data: { role: r.data } });
  refresh();
  return {};
}

export async function setUserPin(userId: string, pin: string): Promise<R> {
  await requireUser("MANAGER");
  if (!/^\d{4,8}$/.test(pin.trim())) return { error: "A PIN is 4 to 8 digits" };
  await db.user.update({ where: { id: userId }, data: { pinHash: await hashPin(pin.trim()), failedPinAttempts: 0, lockedUntil: null } });
  refresh();
  return {};
}

export async function setUserActive(userId: string, active: boolean): Promise<R> {
  const me = await requireUser("MANAGER");
  if (userId === me.userId) return { error: "You can't switch off your own login." };
  if (!active && (await isLastManager(userId))) return { error: "This is the only manager left — make someone else a manager first." };
  await db.user.update({ where: { id: userId }, data: { active } });
  refresh();
  return {};
}

export async function renameUser(userId: string, raw: string): Promise<R> {
  await requireUser("MANAGER");
  const name = raw.trim();
  if (!name) return { error: "Name is required" };
  if (name.length > 60) return { error: "Keep the name under 60 characters" };
  try {
    await db.user.update({ where: { id: userId }, data: { name } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Someone already has that name." };
    throw e;
  }
  refresh();
  return {};
}

export async function saveLaborTarget(raw: string): Promise<R> {
  await requireUser("MANAGER");
  if (raw.trim() === "") {
    await saveDefaultLaborPct(null);
  } else {
    const n = percent(raw);
    if (!Number.isFinite(n) || n < 5 || n > 60) return { error: "Enter a percent from 5 to 60, like 28" };
    await saveDefaultLaborPct(n / 100);
  }
  refresh();
  revalidatePath("/schedule");
  return {};
}

export const saveScheduleAutoDraft = async (on: boolean) => pass(setScheduleAutoDraft(on));

// ---- Food & ordering ----------------------------------------------------------------------

export async function saveFoodTarget(raw: string): Promise<R> {
  await requireUser("MANAGER");
  const n = percent(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n < 5 || n > 80) return { error: "Enter a percent from 5 to 80, like 30" };
  const value = String(n / 100);
  await db.setting.upsert({ where: { key: "costing.targetFoodCostPct" }, create: { key: "costing.targetFoodCostPct", value }, update: { value } });
  revalidatePath("/", "layout");
  return {};
}

export const saveDrinkTarget = async (raw: string) => pass(saveBevTarget(raw));
export const saveSpike = async (raw: string) => pass(savePriceAlertThreshold(raw));
export const saveSupplierCutoff = async (supplierId: string, field: "time" | "daysBefore" | "autoDraft", value: string) => pass(saveCutoff(supplierId, field, value));

const supplierField = z.discriminatedUnion("field", [
  z.object({ field: z.literal("name"), value: z.string().trim().min(1, "Name is required").max(80) }),
  z.object({ field: z.literal("email"), value: z.string().trim().max(120).refine((v) => v === "" || z.string().email().safeParse(v).success, "That email address doesn't look right") }),
  z.object({ field: z.literal("leadTimeDays"), value: z.string().trim() }),
  z.object({ field: z.literal("minOrder"), value: z.string().trim() }),
  z.object({ field: z.literal("kind"), value: z.enum(["DISTRIBUTOR", "LOCAL"]) }),
  z.object({ field: z.literal("notes"), value: z.string().trim().max(500) }),
]);

export async function saveSupplierField(id: string, field: string, value: string): Promise<R> {
  await requireUser("MANAGER");
  const p = supplierField.safeParse({ field, value });
  if (!p.success) return { error: p.error.issues[0].message };
  let data: Prisma.SupplierUpdateInput;
  switch (p.data.field) {
    case "leadTimeDays": {
      const n = Number(p.data.value);
      if (!Number.isInteger(n) || n < 0 || n > 14) return { error: "Enter whole days, 0 to 14" };
      data = { leadTimeDays: n };
      break;
    }
    case "minOrder": {
      const n = Number(p.data.value.replace(/[$,]/g, ""));
      if (p.data.value !== "" && (!Number.isFinite(n) || n < 0)) return { error: "Enter a dollar amount, or leave blank for none" };
      data = { minOrder: p.data.value === "" || n === 0 ? null : new Prisma.Decimal(n.toFixed(2)) };
      break;
    }
    case "email":
      data = { email: p.data.value || null };
      break;
    case "notes":
      data = { notes: p.data.value || null };
      break;
    default:
      data = { [p.data.field]: p.data.value };
  }
  try {
    await db.supplier.update({ where: { id }, data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Another supplier has that name." };
    throw e;
  }
  refresh();
  revalidatePath("/ordering");
  return {};
}

export async function saveDeliveryDays(id: string, days: number[]): Promise<R> {
  await requireUser("MANAGER");
  const p = z.array(z.number().int().min(0).max(6)).max(7).safeParse(days);
  if (!p.success) return { error: "Pick delivery days" };
  await db.supplier.update({ where: { id }, data: { deliveryDays: [...new Set(p.data)].sort() } });
  refresh();
  revalidatePath("/ordering");
  return {};
}

export async function addSupplier(raw: string): Promise<R & { id?: string }> {
  await requireUser("MANAGER");
  const name = raw.trim();
  if (!name) return { error: "Type the supplier's name" };
  if (name.length > 80) return { error: "Keep the name under 80 characters" };
  const existing = await db.supplier.findUnique({ where: { name } });
  if (existing?.active) return { error: "That supplier is already on the list." };
  const s = existing ? await db.supplier.update({ where: { id: existing.id }, data: { active: true } }) : await db.supplier.create({ data: { name, kind: "LOCAL" } });
  refresh();
  revalidatePath("/ordering");
  return { id: s.id };
}

export async function setSupplierActive(id: string, active: boolean): Promise<R> {
  await requireUser("MANAGER");
  await db.supplier.update({ where: { id }, data: { active } });
  refresh();
  revalidatePath("/ordering");
  revalidatePath("/prices");
  return {};
}

// ---- Money ----------------------------------------------------------------------------------

export const saveTax = async (raw: string) => pass(saveSalesTaxRate(raw));
export const saveTol = async (kind: "price" | "qty", raw: string) => pass(saveTolerance(kind, raw.replace(/^\$/, "")));
export const saveAuto = async (on: boolean) => pass(saveAutoApprove(on));
export const savePricesOnApproveSetting = async (on: boolean) => pass(savePricesOnApprove(on));
export const saveTerms = async (raw: string) => pass(saveAccountField("termsDays", raw));
export const saveFixed = async (field: "rent" | "utilities" | "insurance" | "other", raw: string) => pass(saveFixedCost(field, raw));

// ---- Insights & reviews ----------------------------------------------------------------------

export async function saveRangeSetting(preset: string): Promise<R & { note?: string }> {
  const r = await setRange(preset as RangePreset);
  refresh();
  // A refresh that couldn't reach the analytics service still saved the choice.
  if (r.error?.startsWith("Saved")) return { note: r.error };
  return r.error ? { error: r.error } : {};
}

export async function saveTone(raw: string): Promise<R> {
  await requireUser("MANAGER");
  const v = raw.trim();
  if (v.length > 600) return { error: "Keep it under 600 characters — a few short notes work best." };
  await saveReviewSetting(SETTING_TONE, v);
  refresh();
  revalidatePath("/reviews");
  return {};
}
