"use server";

import { addDays } from "@/domain/dates";
import { intensityFromSlider, weekStartOf } from "@/domain/schedule";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { applyPlan, clearDrafts, fitPlanToBudget, hasOverlap, instantAt, planWeek, publishWeek, setAutoDraft, shiftView, weekBlockers } from "@/server/services/scheduling";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifySchedulePublished, notifyShiftChanged, shiftSnapshot } from "@/server/services/notify";
import { z } from "zod";
import { parseImpactPct } from "@/domain/events";
import { setManualAdjustment } from "@/server/services/forecasting";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const shiftInput = z
  .object({
    employeeId: z.string().nullable(),
    positionId: z.string().min(1),
    date: isoDate,
    startMin: z.number().int().min(0).max(36 * 60),
    endMin: z.number().int().min(0).max(36 * 60),
    breakMinutes: z.number().int().min(0).max(240),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((s) => s.endMin > s.startMin, { message: "The shift has to end after it starts." })
  .refine((s) => s.endMin - s.startMin <= 16 * 60, { message: "Shifts can't be longer than 16 hours." });

type Res = { error?: string; id?: string };

const done = () => revalidatePath("/schedule", "layout");

/** Tell the people involved when a *published* shift changes (after the response is sent). */
async function snapshotIfPublished(id: string) {
  const s = await db.shift.findUnique({ where: { id }, select: { published: true } });
  return s?.published ? shiftSnapshot(id) : null;
}
const notifyChange = (id: string, before: Awaited<ReturnType<typeof shiftSnapshot>> | null) => {
  if (before) after(() => notifyShiftChanged(id, before).then(() => undefined));
};

export async function createShift(input: z.input<typeof shiftInput>): Promise<Res> {
  await requireUser("MANAGER");
  const p = shiftInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the shift." };
  const s = p.data;
  const row = await db.shift.create({
    data: { employeeId: s.employeeId, positionId: s.positionId, start: instantAt(s.date, s.startMin), end: instantAt(s.date, s.endMin), breakMinutes: s.breakMinutes, notes: s.notes || null },
  });
  done();
  return { id: row.id };
}

export async function updateShift(id: string, input: z.input<typeof shiftInput>): Promise<Res> {
  await requireUser("MANAGER");
  const p = shiftInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the shift." };
  const s = p.data;
  const exists = await db.shift.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { error: "That shift was deleted." };
  const before = await snapshotIfPublished(id);
  await db.shift.update({
    where: { id },
    data: { employeeId: s.employeeId, positionId: s.positionId, start: instantAt(s.date, s.startMin), end: instantAt(s.date, s.endMin), breakMinutes: s.breakMinutes, notes: s.notes || null },
  });
  done();
  notifyChange(id, before);
  return { id };
}

/** Drag & drop: same times, new person and/or day. */
export async function moveShift(id: string, to: { employeeId: string | null; date: string; startMin: number; endMin: number }): Promise<Res> {
  await requireUser("MANAGER");
  const shift = await db.shift.findUnique({ where: { id } });
  if (!shift) return { error: "That shift was deleted." };
  if (!isoDate.safeParse(to.date).success) return { error: "Bad date." };
  let positionId = shift.positionId;
  if (to.employeeId) {
    const eps = await db.employeePosition.findMany({ where: { employeeId: to.employeeId } });
    if (eps.length && !eps.some((e) => e.positionId === positionId)) positionId = eps[0].positionId;
  }
  const start = instantAt(to.date, to.startMin);
  const end = instantAt(to.date, to.endMin);
  if (to.employeeId && (await hasOverlap(to.employeeId, start, end, id))) return { error: "They're already working then." };
  const before = await snapshotIfPublished(id);
  await db.shift.update({ where: { id }, data: { employeeId: to.employeeId, positionId, start, end } });
  done();
  notifyChange(id, before);
  return { id };
}

export async function deleteShift(id: string): Promise<Res> {
  await requireUser("MANAGER");
  const before = await snapshotIfPublished(id);
  await db.shift.deleteMany({ where: { id } });
  done();
  notifyChange(id, before);
  return {};
}

export async function duplicateShift(id: string, date: string): Promise<Res> {
  await requireUser("MANAGER");
  const s = await db.shift.findUnique({ where: { id } });
  if (!s || !isoDate.safeParse(date).success) return { error: "That shift was deleted." };
  const v = shiftView(s);
  const row = await db.shift.create({
    data: { employeeId: s.employeeId, positionId: s.positionId, start: instantAt(date, v.startMin), end: instantAt(date, v.endMin), breakMinutes: s.breakMinutes, notes: s.notes },
  });
  done();
  return { id: row.id };
}

export async function previewSchedule(monday: string, slider: number) {
  await requireUser("MANAGER");
  if (!isoDate.safeParse(monday).success) return { error: "Bad week." };
  return { plan: await planWeek(weekStartOf(monday), intensityFromSlider(slider)) };
}

export async function applySchedule(monday: string, slider: number): Promise<Res & { created?: number }> {
  await requireUser("MANAGER");
  if (!isoDate.safeParse(monday).success) return { error: "Bad week." };
  const plan = await applyPlan(weekStartOf(monday), intensityFromSlider(slider));
  done();
  return { created: plan.planned.length };
}

export async function publishSchedule(monday: string, override: boolean): Promise<Res & { published?: number; blockers?: number }> {
  await requireUser("MANAGER");
  if (!isoDate.safeParse(monday).success) return { error: "Bad week." };
  const wk = weekStartOf(monday);
  if (!override) {
    const blockers = await weekBlockers(wk);
    if (blockers.length) return { blockers: blockers.length };
  }
  const n = await publishWeek(wk);
  done();
  if (n > 0) after(() => notifySchedulePublished(wk).then(() => undefined));
  return { published: n };
}

export async function clearDraftShifts(monday: string): Promise<Res & { removed?: number }> {
  await requireUser("MANAGER");
  if (!isoDate.safeParse(monday).success) return { error: "Bad week." };
  const n = await clearDrafts(weekStartOf(monday));
  done();
  return { removed: n };
}

/** Copy last week's shifts into this week as drafts (same local times). */
export async function copyPreviousWeek(monday: string): Promise<Res & { created?: number }> {
  await requireUser("MANAGER");
  if (!isoDate.safeParse(monday).success) return { error: "Bad week." };
  const wk = weekStartOf(monday);
  const prev = await db.shift.findMany({ where: { start: { gte: instantAt(addDays(wk, -7), 0), lt: instantAt(wk, 0) } } });
  if (!prev.length) return { error: "Last week has no shifts to copy." };
  await db.shift.createMany({
    data: prev.map((s) => {
      const v = shiftView(s);
      const date = addDays(v.date, 7);
      return { employeeId: s.employeeId, positionId: s.positionId, start: instantAt(date, v.startMin), end: instantAt(date, v.endMin), breakMinutes: s.breakMinutes, notes: s.notes, published: false };
    }),
  });
  done();
  return { created: prev.length };
}

/** The slider setting whose plan fits the week's labor % budget. */
export async function fitScheduleToBudget(monday: string) {
  await requireUser("MANAGER");
  if (!isoDate.safeParse(monday).success) return { error: "Bad week." };
  const r = await fitPlanToBudget(weekStartOf(monday));
  if (!r) return { error: "No labor % budget for this week. Set one on the Budgets page." };
  return r;
}

/** Turn the weekend auto-draft of next week's schedule on or off. */
export async function setScheduleAutoDraft(on: boolean): Promise<Res> {
  await requireUser("MANAGER");
  await setAutoDraft(on);
  done();
  return {};
}

const nudgeSchema = z.object({ date: isoDate, pct: z.string().max(10), reason: z.string().max(200) });

/** Nudge one day's sales forecast from the schedule ("+15" / "-20", blank clears), with why. */
export async function nudgeForecast(input: z.input<typeof nudgeSchema>): Promise<Res> {
  await requireUser("MANAGER");
  const p = nudgeSchema.safeParse(input);
  if (!p.success) return { error: "Check the adjustment." };
  const m = parseImpactPct(p.data.pct);
  if (m == null || m <= 0) return { error: "Enter a percent between −99 and +500, like +15 or −20." };
  if (m !== 1 && !p.data.reason.trim()) return { error: "Add a short reason, like “festival” or “road closed”." };
  await setManualAdjustment(p.data.date, m === 1 ? null : m, p.data.reason);
  done();
  revalidatePath("/sales");
  return {};
}
