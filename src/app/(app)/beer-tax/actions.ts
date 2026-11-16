"use server";

import { parsePeriod, type Form, type Freq } from "@/domain/beerTax";
import { parseISODate } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { TAX_SETTINGS_KEY, taxSettings } from "@/server/services/beerTax";
import { businessToday } from "@/server/services/sales";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = Promise<{ error?: string } | void>;

function refresh() {
  revalidatePath("/beer-tax");
  revalidatePath("/");
  revalidatePath("/brief");
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), "Pick a date");
const form = z.enum(["federal", "brop", "ny"]);

const adjustment = z.object({
  date: isoDate,
  kind: z.enum(["packaged", "removed", "returned", "loss"]),
  gallons: z.string(),
  unit: z.enum(["gal", "bbl"]),
  beerId: z.string().optional(),
  note: z.string().max(300).optional(),
});

export async function addAdjustment(input: z.input<typeof adjustment>): R {
  const s = await requireUser("MANAGER");
  const p = adjustment.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  const n = Number(p.data.gallons.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return { error: "How much, as a number above 0" };
  const gallons = p.data.unit === "bbl" ? n * 31 : n;
  await db.beerTaxAdjustment.create({
    data: { date: parseISODate(p.data.date), kind: p.data.kind, gallons: Math.round(gallons * 100) / 100, beerId: p.data.beerId || null, note: p.data.note?.trim() || null, userName: s.name },
  });
  refresh();
}

export async function deleteAdjustment(id: string): R {
  await requireUser("MANAGER");
  await db.beerTaxAdjustment.delete({ where: { id } }).catch(() => null);
  refresh();
}

export async function markFiled(input: { form: Form; period: string; filedOn: string; amount: string; note?: string }): R {
  const s = await requireUser("MANAGER");
  const f = form.safeParse(input.form);
  const p = parsePeriod(input.period);
  if (!f.success || !p) return { error: "Reload the page and try again" };
  if (!isoDate.safeParse(input.filedOn).success || input.filedOn > businessToday()) return { error: "Pick the date you filed, up to today" };
  const raw = input.amount.replace(/[$,\s]/g, "");
  const amount = raw ? Number(raw) : null;
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) return { error: "Amount paid, in dollars (0 is fine)" };
  const data = { periodEnd: parseISODate(p.end), filedOn: parseISODate(input.filedOn), amount, note: input.note?.trim().slice(0, 300) || null, userName: s.name };
  await db.beerTaxFiling.upsert({ where: { form_periodStart: { form: f.data, periodStart: parseISODate(p.start) } }, create: { form: f.data, periodStart: parseISODate(p.start), ...data }, update: data });
  refresh();
}

export async function unmarkFiled(id: string): R {
  await requireUser("MANAGER");
  await db.beerTaxFiling.delete({ where: { id } }).catch(() => null);
  refresh();
}

const settingFields = z.enum(["federalRate", "nyRate", "nyCredit", "freq.federal", "freq.brop", "freq.ny", "due.federal", "due.brop", "due.ny"]);

export async function setTaxSetting(field: z.infer<typeof settingFields>, raw: string): R {
  await requireUser("MANAGER");
  settingFields.parse(field);
  const s = await taxSettings();
  const v = raw.trim().replace(/[$,\s]/g, "");
  if (field === "federalRate" || field === "nyRate") {
    const n = Number(v);
    if (!v || !Number.isFinite(n) || n < 0 || n > (field === "federalRate" ? 100 : 10)) return { error: "A rate in dollars" };
    s[field] = n;
  } else if (field === "nyCredit") {
    s.nyCredit = v === "yes";
  } else if (field.startsWith("freq.")) {
    if (!["month", "quarter", "year"].includes(v)) return { error: "Pick how often" };
    s.freq[field.slice(5) as Form] = v as Freq;
  } else {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 120) return { error: "Days, 0–120" };
    s.dueDays[field.slice(4) as Form] = n;
  }
  const value = JSON.stringify(s);
  await db.setting.upsert({ where: { key: TAX_SETTINGS_KEY }, create: { key: TAX_SETTINGS_KEY, value }, update: { value } });
  refresh();
}
