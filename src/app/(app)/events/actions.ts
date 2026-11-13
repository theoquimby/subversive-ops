"use server";

import { ISODate, parseISODate } from "@/domain/dates";
import { cleanTitle, isEventKind, parseClockTime, parseImpactPct, repeatDates } from "@/domain/events";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { addHolidays, applyLearnedImpact, createEvents } from "@/server/services/events";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = Promise<{ error?: string; message?: string }>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function refresh() {
  revalidatePath("/events");
  revalidatePath("/sales");
}

const addSchema = z.object({
  dates: z.array(isoDate).max(60),
  repeatUntil: isoDate.nullable().optional(),
  title: z.string().max(120),
  kind: z.string(),
  startTime: z.string().max(10).optional().default(""),
  endTime: z.string().max(10).optional().default(""),
  impactPct: z.string().max(10).optional().default(""),
  notes: z.string().max(500).optional().default(""),
});

export async function addEvents(input: z.input<typeof addSchema>): R {
  await requireUser("MANAGER");
  const p = addSchema.safeParse(input);
  if (!p.success) return { error: "Check the dates and fields." };
  const v = p.data;
  const title = cleanTitle(v.title);
  if (!title) return { error: "Give the event a name." };
  if (!isEventKind(v.kind)) return { error: "Pick a kind." };
  if (v.dates.length === 0) return { error: "Pick at least one date." };
  const start = parseClockTime(v.startTime);
  const end = parseClockTime(v.endTime);
  if (start === undefined || end === undefined) return { error: "Times look like 7pm or 19:30." };
  const impact = parseImpactPct(v.impactPct);
  if (impact == null) return { error: "Impact is a percent, like +30 or -20." };
  let dates: ISODate[] = [...new Set(v.dates)];
  if (v.repeatUntil) dates = [...new Set(dates.flatMap((d) => repeatDates(d, v.repeatUntil!)))];
  if (dates.length > 60) return { error: "That's more than 60 dates — add them in smaller batches." };
  const n = await createEvents(dates.sort().map((date) => ({ date, title, kind: v.kind as never, impact, startTime: start, endTime: end, notes: v.notes })));
  refresh();
  return { message: n === dates.length ? `Added ${n} event${n === 1 ? "" : "s"}.` : `Added ${n}; ${dates.length - n} were already on the list.` };
}

export async function setEventField(id: string, field: "title" | "kind" | "startTime" | "endTime" | "impact" | "notes" | "date", raw: string): Promise<{ error?: string } | void> {
  await requireUser("MANAGER");
  const value = raw.trim();
  let data: Prisma.EventUpdateInput;
  switch (field) {
    case "title": {
      const t = cleanTitle(value);
      if (!t) return { error: "Can't be empty" };
      if (t.length > 120) return { error: "Keep it under 120 characters" };
      data = { title: t };
      break;
    }
    case "kind":
      if (!isEventKind(value)) return { error: "Unknown kind" };
      data = value === "CLOSURE" ? { kind: value, impact: new Prisma.Decimal(0) } : { kind: value };
      if (value !== "CLOSURE") {
        const cur = await db.event.findUnique({ where: { id }, select: { impact: true } });
        if (cur && cur.impact.toNumber() === 0) data.impact = new Prisma.Decimal(1);
      }
      break;
    case "startTime":
    case "endTime": {
      const t = parseClockTime(value);
      if (t === undefined) return { error: "Use a time like 7pm or 19:30" };
      data = { [field]: t };
      break;
    }
    case "impact": {
      const m = parseImpactPct(value);
      if (m == null) return { error: "A percent, like +30 or -20" };
      data = { impact: new Prisma.Decimal(m) };
      break;
    }
    case "notes":
      if (value.length > 500) return { error: "Keep notes under 500 characters" };
      data = { notes: value || null };
      break;
    case "date":
      if (!isoDate.safeParse(value).success) return { error: "Pick a date" };
      data = { date: parseISODate(value) };
      break;
  }
  try {
    await db.event.update({ where: { id }, data });
  } catch {
    return { error: "That event no longer exists" };
  }
  refresh();
}

export async function deleteEvent(id: string): R {
  await requireUser("MANAGER");
  await db.event.deleteMany({ where: { id } });
  refresh();
  return {};
}

export async function addHolidaysFor(year: number): R {
  await requireUser("MANAGER");
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return { error: "Pick a year." };
  const n = await addHolidays(year);
  refresh();
  return { message: n ? `Added ${n} holidays for ${year}.` : `${year}'s holidays are already on the list.` };
}

export async function applyLearned(series: string): R {
  await requireUser("MANAGER");
  const r = await applyLearnedImpact(series);
  if ("error" in r) return { error: r.error };
  refresh();
  return { message: `Updated ${r.updated} upcoming event${r.updated === 1 ? "" : "s"}.` };
}
