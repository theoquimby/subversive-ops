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
import { planWeekCopy } from "@/domain/shiftEntry";
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

const weekRange = (monday: string) => ({ start: { gte: instantAt(monday, 0), lt: instantAt(addDays(monday, 7), 0) } });

/** What copying `from`'s week onto `to`'s week would add, skipping shifts already there. */
async function weekCopyPlan(from: string, to: string) {
  const src = weekStartOf(from);
  const dst = weekStartOf(to);
  const [source, existing] = await Promise.all([db.shift.findMany({ where: weekRange(src), orderBy: { start: "asc" } }), db.shift.findMany({ where: weekRange(dst) })]);
  const days = Math.round((Date.parse(dst) - Date.parse(src)) / 86_400_000);
  const plan = planWeekCopy(
    source.map((s) => ({ ...shiftView(s), notes: s.notes })),
    existing.map((s) => shiftView(s)),
    days,
  );
  return { ...plan, total: source.length };
}

/** How many shifts a copy would add, for the confirm step. */
export async function previewWeekCopy(from: string, to: string): Promise<Res & { create?: number; skipped?: number; total?: number }> {
  await requireUser("MANAGER");
  if (!isoDate.safeParse(from).success || !isoDate.safeParse(to).success) return { error: "Bad week." };
  if (weekStartOf(from) === weekStartOf(to)) return { error: "Pick a different week to copy from." };
  const p = await weekCopyPlan(from, to);
  return { create: p.create.length, skipped: p.skipped, total: p.total };
}

/**
 * Copy one week's shifts onto another as drafts (same local times). Shifts the
 * target already has (same person, day and start) are skipped, so a second
 * click can't double the week. Returns the new ids for Undo.
 */
export async function copyWeek(from: string, to: string): Promise<Res & { created?: number; skipped?: number; ids?: string[] }> {
  await requireUser("MANAGER");
  if (!isoDate.safeParse(from).success || !isoDate.safeParse(to).success) return { error: "Bad week." };
  if (weekStartOf(from) === weekStartOf(to)) return { error: "Pick a different week to copy from." };
  const p = await weekCopyPlan(from, to);
  if (!p.total) return { error: "That week has no shifts to copy." };
  const rows = await db.shift.createManyAndReturn({
    data: p.create.map((s) => ({ employeeId: s.employeeId, positionId: s.positionId, start: instantAt(s.date, s.startMin), end: instantAt(s.date, s.endMin), breakMinutes: s.breakMinutes, notes: s.notes, published: false })),
    select: { id: true },
  });
  done();
  return { created: rows.length, skipped: p.skipped, ids: rows.map((r) => r.id) };
}

/** Undo: delete shifts just created. Only drafts go; anything published since stays. */
export async function removeNewShifts(ids: string[]): Promise<Res & { removed?: number }> {
  await requireUser("MANAGER");
  const p = z.array(z.string().min(1)).max(2000).safeParse(ids);
  if (!p.success) return { error: "Nothing to undo." };
  const r = await db.shift.deleteMany({ where: { id: { in: p.data }, published: false } });
  done();
  return { removed: r.count };
}

/** Copy one shift onto other days (same times). Days where the person already works then are skipped. */
export async function copyShiftTo(id: string, dates: string[]): Promise<Res & { ids?: string[]; skipped?: string[] }> {
  await requireUser("MANAGER");
  const d = z.array(isoDate).min(1).max(14).safeParse(dates);
  if (!d.success) return { error: "Pick a day to copy to." };
  const s = await db.shift.findUnique({ where: { id } });
  if (!s) return { error: "That shift was deleted." };
  const v = shiftView(s);
  const ids: string[] = [];
  const skipped: string[] = [];
  for (const date of [...new Set(d.data)]) {
    const start = instantAt(date, v.startMin);
    const end = instantAt(date, v.endMin);
    if (s.employeeId && (await hasOverlap(s.employeeId, start, end))) {
      skipped.push(date);
      continue;
    }
    const row = await db.shift.create({ data: { employeeId: s.employeeId, positionId: s.positionId, start, end, breakMinutes: s.breakMinutes, notes: s.notes } });
    ids.push(row.id);
  }
  done();
  return { ids, skipped };
}

/** Undo a delete: put the shift back as it was (published or draft). */
export async function restoreShift(input: z.input<typeof shiftInput> & { published: boolean }): Promise<Res> {
  await requireUser("MANAGER");
  const p = shiftInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the shift." };
  const s = p.data;
  const row = await db.shift.create({
    data: { employeeId: s.employeeId, positionId: s.positionId, start: instantAt(s.date, s.startMin), end: instantAt(s.date, s.endMin), breakMinutes: s.breakMinutes, notes: s.notes || null, published: input.published === true },
  });
  done();
  return { id: row.id };
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
