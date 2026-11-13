"use server";

import { businessDate } from "@/domain/dates";
import type { LaborRules } from "@/domain/labor";
import { localMinutes, parseClock, zonedTime } from "@/domain/timecards";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { saveLaborRules } from "@/server/services/labor-rules";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = Promise<{ error?: string } | void>;
const tz = () => env.BUSINESS_TIMEZONE;
const MAX_SHIFT_H = 16;

function refresh() {
  revalidatePath("/labor");
  revalidatePath("/pnl");
}

/** Clock-out on the clock-in's business day, rolling past midnight for late closes. */
function outAfter(clockIn: Date, minutes: number) {
  const date = businessDate(clockIn, tz());
  let out = zonedTime(date, minutes, tz());
  if (out <= clockIn) out = zonedTime(date, minutes + 24 * 60, tz());
  return out;
}

const fields = z.enum(["employeeId", "positionId", "date", "clockIn", "clockOut", "breakMinutes", "hourlyRate"]);

export async function setTimecardField(id: string, field: z.infer<typeof fields>, raw: string): R {
  await requireUser("MANAGER");
  fields.parse(field);
  const value = raw.trim();
  const tc = await db.timecard.findUniqueOrThrow({ where: { id } });
  const data: Prisma.TimecardUncheckedUpdateInput = {};
  const date = businessDate(tc.clockIn, tz());
  if (field === "employeeId") {
    if (!value) return { error: "Pick someone" };
    data.employeeId = value;
  } else if (field === "positionId") {
    data.positionId = value || null;
  } else if (field === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: "Pick a day" };
    const inMin = localMinutes(tc.clockIn, tz());
    data.clockIn = zonedTime(value, inMin, tz());
    if (tc.clockOut) data.clockOut = new Date(data.clockIn.getTime() + (tc.clockOut.getTime() - tc.clockIn.getTime()));
  } else if (field === "clockIn") {
    const m = parseClock(value);
    if (m == null) return { error: "Type a time like 4p or 16:00" };
    const clockIn = zonedTime(date, m, tz());
    if (tc.clockOut) {
      // Keep the same clock-out time of day, re-anchored after the new start.
      const out = outAfter(clockIn, localMinutes(tc.clockOut, tz()));
      if ((out.getTime() - clockIn.getTime()) / 3_600_000 > MAX_SHIFT_H) return { error: `Over ${MAX_SHIFT_H}h — check the times` };
      data.clockOut = out;
    }
    data.clockIn = clockIn;
  } else if (field === "clockOut") {
    if (!value) data.clockOut = null;
    else {
      const m = parseClock(value);
      if (m == null) return { error: "Type a time like 10p or 22:00" };
      const out = outAfter(tc.clockIn, m);
      if ((out.getTime() - tc.clockIn.getTime()) / 3_600_000 > MAX_SHIFT_H) return { error: `Over ${MAX_SHIFT_H}h — check the times` };
      data.clockOut = out;
    }
  } else if (field === "breakMinutes") {
    const n = value ? Number(value.replace(/m(in)?s?$/i, "")) : 0;
    if (!Number.isFinite(n) || n < 0 || n > 240) return { error: "Minutes, 0–240" };
    data.breakMinutes = Math.round(n);
  } else {
    const s = value.replace(/[$,\s]/g, "");
    const n = s ? Number(s) : null;
    if (n != null && (!Number.isFinite(n) || n < 0 || n > 500)) return { error: "Enter a rate" };
    data.hourlyRate = n == null ? null : new Prisma.Decimal(n.toFixed(2));
  }
  await db.timecard.update({ where: { id }, data });
  refresh();
}

const addSchema = z.object({
  employeeId: z.string().min(1, "Pick someone"),
  positionId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day"),
  clockIn: z.string().min(1, "Clock-in time?"),
  clockOut: z.string().optional(),
  breakMinutes: z.coerce.number().min(0).max(240).optional(),
});

export async function addTimecard(input: z.input<typeof addSchema>): Promise<{ error?: string; ok?: boolean }> {
  await requireUser("MANAGER");
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const inMin = parseClock(v.clockIn);
  if (inMin == null) return { error: "Clock-in: type a time like 4p" };
  const clockIn = zonedTime(v.date, inMin, tz());
  let clockOut: Date | null = null;
  if (v.clockOut?.trim()) {
    const outMin = parseClock(v.clockOut);
    if (outMin == null) return { error: "Clock-out: type a time like 10p" };
    clockOut = outAfter(clockIn, outMin);
    if ((clockOut.getTime() - clockIn.getTime()) / 3_600_000 > MAX_SHIFT_H) return { error: `Over ${MAX_SHIFT_H}h — check the times` };
  }
  let positionId = v.positionId || null;
  if (!positionId) {
    // Default to the person's only/first position.
    positionId = (await db.employeePosition.findFirst({ where: { employeeId: v.employeeId }, select: { positionId: true } }))?.positionId ?? null;
  }
  await db.timecard.create({ data: { employeeId: v.employeeId, positionId, clockIn, clockOut, breakMinutes: v.breakMinutes ?? 0, source: "MANUAL" } });
  refresh();
  return { ok: true };
}

export async function deleteTimecard(id: string): R {
  await requireUser("MANAGER");
  await db.timecard.delete({ where: { id } });
  refresh();
}

// ---- Labor rules ---------------------------------------------------------------

const RULE_LIMITS: Record<keyof LaborRules, [number, number, "pct" | "num"]> = {
  minimumWage: [0, 100, "num"],
  weeklyOvertimeHours: [1, 80, "num"],
  overtimeMultiplier: [1, 3, "num"],
  spreadOfHours: [1, 24, "num"],
  callInMinHours: [0, 12, "num"],
  minRestHours: [0, 24, "num"],
  maxShiftHours: [1, 24, "num"],
  minorMaxDailyHours: [1, 24, "num"],
  minorLatestHour: [0, 24, "num"],
  employerBurdenPct: [0, 100, "pct"],
};

export async function saveLaborRule(field: keyof LaborRules, raw: string): R {
  await requireUser("MANAGER");
  const limits = RULE_LIMITS[field];
  if (!limits) return { error: "Unknown rule" };
  const n = Number(raw.replace(/[$%,\s]/g, ""));
  if (!raw.trim() || !Number.isFinite(n) || n < limits[0] || n > limits[1]) return { error: `Enter ${limits[0]}–${limits[1]}` };
  await saveLaborRules({ [field]: limits[2] === "pct" ? n / 100 : n });
  revalidatePath("/", "layout");
}
