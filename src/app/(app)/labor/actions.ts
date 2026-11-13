"use server";

import { businessDate } from "@/domain/dates";
import { LaborRules, RULE_IDS, RuleId, RuleSetting } from "@/domain/labor";
import { ADJUSTMENT_KINDS, AdjustmentKind, payPeriodFor, signedAdjustment } from "@/domain/payroll";
import { localMinutes, parseClock, zonedTime } from "@/domain/timecards";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { getLaborRules, saveLaborRules } from "@/server/services/labor-rules";
import { approvePayPeriod, dateIsLocked, unlockPayPeriod } from "@/server/services/payroll";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = Promise<{ error?: string } | void>;
const tz = () => env.BUSINESS_TIMEZONE;
const MAX_SHIFT_H = 16;
const LOCKED = "This pay period is approved. Unlock it first to make changes.";
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

/** Inline timecard edit. Marks the card as manually edited so the Square sync leaves it alone. */
export async function setTimecardField(id: string, field: z.infer<typeof fields>, raw: string): R {
  await requireUser("MANAGER");
  fields.parse(field);
  const value = raw.trim();
  const tc = await db.timecard.findUniqueOrThrow({ where: { id } });
  if (tc.approvedAt) return { error: LOCKED };
  const data: Prisma.TimecardUncheckedUpdateInput = { manuallyEdited: true };
  const date = businessDate(tc.clockIn, tz());
  if (field === "employeeId") {
    if (!value) return { error: "Pick someone" };
    data.employeeId = value;
  } else if (field === "positionId") {
    data.positionId = value || null;
  } else if (field === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: "Pick a day" };
    if (await dateIsLocked(value)) return { error: "That day is in an approved pay period." };
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
      if ((out.getTime() - clockIn.getTime()) / 3_600_000 > MAX_SHIFT_H) return { error: `Over ${MAX_SHIFT_H}h, check the times` };
      data.clockOut = out;
    }
    data.clockIn = clockIn;
  } else if (field === "clockOut") {
    if (!value) data.clockOut = null;
    else {
      const m = parseClock(value);
      if (m == null) return { error: "Type a time like 10p or 22:00" };
      const out = outAfter(tc.clockIn, m);
      if ((out.getTime() - tc.clockIn.getTime()) / 3_600_000 > MAX_SHIFT_H) return { error: `Over ${MAX_SHIFT_H}h, check the times` };
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
  date: isoDate.or(z.literal("")).refine((s) => !!s, "Pick a day"),
  clockIn: z.string().min(1, "Clock-in time?"),
  clockOut: z.string().optional(),
  breakMinutes: z.coerce.number().min(0).max(240).optional(),
});

export async function addTimecard(input: z.input<typeof addSchema>): Promise<{ error?: string; ok?: boolean }> {
  await requireUser("MANAGER");
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (await dateIsLocked(v.date)) return { error: LOCKED };
  const inMin = parseClock(v.clockIn);
  if (inMin == null) return { error: "Clock-in: type a time like 4p" };
  const clockIn = zonedTime(v.date, inMin, tz());
  let clockOut: Date | null = null;
  if (v.clockOut?.trim()) {
    const outMin = parseClock(v.clockOut);
    if (outMin == null) return { error: "Clock-out: type a time like 10p" };
    clockOut = outAfter(clockIn, outMin);
    if ((clockOut.getTime() - clockIn.getTime()) / 3_600_000 > MAX_SHIFT_H) return { error: `Over ${MAX_SHIFT_H}h, check the times` };
  }
  let positionId = v.positionId || null;
  if (!positionId) {
    // Default to the person's only/first position.
    positionId = (await db.employeePosition.findFirst({ where: { employeeId: v.employeeId }, select: { positionId: true } }))?.positionId ?? null;
  }
  await db.timecard.create({ data: { employeeId: v.employeeId, positionId, clockIn, clockOut, breakMinutes: v.breakMinutes ?? 0, source: "MANUAL", manuallyEdited: true } });
  refresh();
  return { ok: true };
}

export async function deleteTimecard(id: string): R {
  await requireUser("MANAGER");
  const tc = await db.timecard.findUnique({ where: { id }, select: { approvedAt: true } });
  if (tc?.approvedAt) return { error: LOCKED };
  await db.timecard.deleteMany({ where: { id } });
  refresh();
}

// ---- Pay periods -------------------------------------------------------------------

async function periodOf(start: string) {
  if (!isoDate.safeParse(start).success) return null;
  return payPeriodFor(start, await getLaborRules());
}

export async function approvePeriod(start: string): Promise<{ error?: string; ok?: string }> {
  const me = await requireUser("MANAGER");
  const p = await periodOf(start);
  if (!p) return { error: "Bad period." };
  const snap = await approvePayPeriod(p, me.name);
  refresh();
  return { ok: `Approved: ${snap.rows.length} people, timecards locked.` };
}

export async function unlockPeriod(start: string): Promise<{ error?: string; ok?: string }> {
  await requireUser("MANAGER");
  const p = await periodOf(start);
  if (!p) return { error: "Bad period." };
  await unlockPayPeriod(p);
  refresh();
  return { ok: "Unlocked. Approve it again once you're done." };
}

// ---- Adjustments -------------------------------------------------------------------

const adjSchema = z.object({
  employeeId: z.string().min(1, "Pick someone"),
  date: isoDate,
  kind: z.enum(ADJUSTMENT_KINDS),
  amount: z.string().min(1, "Amount?"),
  note: z.string().max(200).optional(),
});

const parseMoney = (raw: string) => {
  const s = raw.replace(/[$,\s]/g, "");
  const n = Number(s);
  return s && Number.isFinite(n) ? n : null;
};

export async function addAdjustment(input: z.input<typeof adjSchema>): Promise<{ error?: string; ok?: boolean }> {
  const me = await requireUser("MANAGER");
  const p = adjSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const amount = parseMoney(p.data.amount);
  if (amount == null || amount === 0 || Math.abs(amount) > 100_000) return { error: "Enter an amount" };
  if (await dateIsLocked(p.data.date)) return { error: LOCKED };
  await db.payAdjustment.create({
    data: { employeeId: p.data.employeeId, date: new Date(`${p.data.date}T00:00:00Z`), kind: p.data.kind, amount: new Prisma.Decimal(signedAdjustment(p.data.kind, amount).toFixed(2)), note: p.data.note?.trim() || null, createdBy: me.name },
  });
  refresh();
  return { ok: true };
}

const adjFields = z.enum(["employeeId", "kind", "amount", "note"]);

export async function setAdjustmentField(id: string, field: z.infer<typeof adjFields>, raw: string): R {
  await requireUser("MANAGER");
  adjFields.parse(field);
  const a = await db.payAdjustment.findUniqueOrThrow({ where: { id } });
  if (await dateIsLocked(a.date.toISOString().slice(0, 10))) return { error: LOCKED };
  const data: Prisma.PayAdjustmentUncheckedUpdateInput = {};
  if (field === "employeeId") {
    if (!raw) return { error: "Pick someone" };
    data.employeeId = raw;
  } else if (field === "kind") {
    const k = z.enum(ADJUSTMENT_KINDS).safeParse(raw);
    if (!k.success) return { error: "Pick a kind" };
    data.kind = k.data;
    data.amount = new Prisma.Decimal(signedAdjustment(k.data, a.amount.toNumber()).toFixed(2));
  } else if (field === "amount") {
    const n = parseMoney(raw);
    if (n == null || n === 0 || Math.abs(n) > 100_000) return { error: "Enter an amount" };
    data.amount = new Prisma.Decimal(signedAdjustment(a.kind as AdjustmentKind, n).toFixed(2));
  } else {
    data.note = raw.trim() || null;
  }
  await db.payAdjustment.update({ where: { id }, data });
  refresh();
}

export async function deleteAdjustment(id: string): R {
  await requireUser("MANAGER");
  const a = await db.payAdjustment.findUnique({ where: { id } });
  if (!a) return;
  if (await dateIsLocked(a.date.toISOString().slice(0, 10))) return { error: LOCKED };
  await db.payAdjustment.delete({ where: { id } });
  refresh();
}

// ---- Labor rules ---------------------------------------------------------------

type NumericRule = { [K in keyof LaborRules]: LaborRules[K] extends number ? K : never }[keyof LaborRules];

const RULE_LIMITS: Record<NumericRule, [number, number, "pct" | "num"]> = {
  minimumWage: [0, 100, "num"],
  tippedMinimumWage: [0, 100, "num"],
  weeklyOvertimeHours: [1, 80, "num"],
  overtimeMultiplier: [1, 3, "num"],
  spreadOfHours: [1, 24, "num"],
  callInMinHours: [0, 12, "num"],
  minRestHours: [0, 24, "num"],
  maxShiftHours: [1, 24, "num"],
  minorMaxDailyHours: [1, 24, "num"],
  minorLatestHour: [0, 24, "num"],
  employerBurdenPct: [0, 100, "pct"],
  mealBreakAfterHours: [1, 24, "num"],
  mealBreakMinutes: [0, 120, "num"],
  sickHoursWorkedPerHour: [1, 200, "num"],
  sickAnnualCapHours: [0, 200, "num"],
};

function done() {
  revalidatePath("/", "layout");
}

export async function saveLaborRule(field: NumericRule, raw: string): R {
  await requireUser("MANAGER");
  const limits = RULE_LIMITS[field];
  if (!limits) return { error: "Unknown rule" };
  const n = Number(raw.replace(/[$%,\s]/g, ""));
  if (!raw.trim() || !Number.isFinite(n) || n < limits[0] || n > limits[1]) return { error: `Enter ${limits[0]}–${limits[1]}` };
  await saveLaborRules({ [field]: limits[2] === "pct" ? n / 100 : n });
  done();
}

export async function savePayPeriod(field: "payPeriod" | "payPeriodAnchor", raw: string): R {
  await requireUser("MANAGER");
  if (field === "payPeriod") {
    if (raw !== "WEEKLY" && raw !== "BIWEEKLY") return { error: "Weekly or every two weeks" };
    await saveLaborRules({ payPeriod: raw });
  } else {
    if (!isoDate.safeParse(raw).success) return { error: "Pick a date" };
    // Always store the Monday of that week.
    await saveLaborRules({ payPeriodAnchor: payPeriodFor(raw, { payPeriod: "WEEKLY", payPeriodAnchor: raw }).start });
  }
  done();
}

/** Switch a compliance rule on/off or between block and warn. */
export async function saveRuleSetting(id: RuleId, raw: string): R {
  await requireUser("MANAGER");
  if (!RULE_IDS.includes(id)) return { error: "Unknown rule" };
  const rules = await getLaborRules();
  const next: RuleSetting = raw === "off" ? { on: false } : raw === "block" || raw === "warn" ? { on: true, level: raw } : {};
  if (!("on" in next)) return { error: "Off, warn or block" };
  await saveLaborRules({ ruleSettings: { ...rules.ruleSettings, [id]: next } });
  done();
}
