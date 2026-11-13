"use server";

import { parseISODate } from "@/domain/dates";
import { parseWindows } from "@/domain/timecards";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { inBackground, notifyStaffRequest } from "@/server/services/notify";
import { businessToday } from "@/server/services/sales";
import { employeeForUser, hasOverlap } from "@/server/services/scheduling";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Res = { error?: string; ok?: string };

async function me() {
  const s = await requireUser();
  const e = await employeeForUser(s.userId);
  return e;
}

const done = () => {
  revalidatePath("/my");
  revalidatePath("/schedule", "layout");
};

export async function pickUpShift(shiftId: string): Promise<Res> {
  const e = await me();
  if (!e) return { error: "Your login isn't linked to a team member yet." };
  const s = await db.shift.findUnique({ where: { id: shiftId } });
  if (!s || s.employeeId || !s.published) return { error: "Someone already took that shift." };
  if (s.start < new Date()) return { error: "That shift has already started." };
  if (!e.positions.some((p) => p.positionId === s.positionId)) return { error: "That shift is for a position you're not set up for." };
  if (await hasOverlap(e.id, s.start, s.end)) return { error: "You're already working then." };
  // Only take it if it's still open (two people tapping at once).
  const r = await db.shift.updateMany({ where: { id: shiftId, employeeId: null }, data: { employeeId: e.id } });
  if (r.count === 0) return { error: "Someone already took that shift." };
  done();
  return { ok: "It's yours. See you then!" };
}

export async function requestSwap(shiftId: string, takerId: string | null): Promise<Res> {
  const e = await me();
  if (!e) return { error: "Your login isn't linked to a team member yet." };
  const s = await db.shift.findUnique({ where: { id: shiftId }, include: { swaps: { where: { status: "PENDING" } } } });
  if (!s || s.employeeId !== e.id) return { error: "That isn't your shift." };
  if (s.swaps.length) return { error: "You've already asked to swap this shift." };
  if (takerId) {
    const ok = await db.employeePosition.findUnique({ where: { employeeId_positionId: { employeeId: takerId, positionId: s.positionId } } });
    if (!ok) return { error: "They can't work that position." };
  }
  const swap = await db.shiftSwap.create({ data: { shiftId, requesterId: e.id, takerId } });
  inBackground(() => notifyStaffRequest({ swapId: swap.id }));
  done();
  return { ok: takerId ? "Asked your manager to approve the swap." : "Posted. Anyone who can cover it can offer, then your manager approves." };
}

export async function offerToTake(swapId: string): Promise<Res> {
  const e = await me();
  if (!e) return { error: "Your login isn't linked to a team member yet." };
  const sw = await db.shiftSwap.findUnique({ where: { id: swapId }, include: { shift: true } });
  if (!sw || sw.status !== "PENDING" || sw.takerId) return { error: "Someone already offered." };
  if (sw.requesterId === e.id) return { error: "That's your own shift." };
  if (!e.positions.some((p) => p.positionId === sw.shift.positionId)) return { error: "That shift is for a position you're not set up for." };
  if (await hasOverlap(e.id, sw.shift.start, sw.shift.end)) return { error: "You're already working then." };
  await db.shiftSwap.update({ where: { id: swapId }, data: { takerId: e.id } });
  done();
  return { ok: "Offered. Your manager will confirm." };
}

export async function cancelSwap(swapId: string): Promise<Res> {
  const e = await me();
  if (!e) return { error: "Your login isn't linked to a team member yet." };
  await db.shiftSwap.deleteMany({ where: { id: swapId, status: "PENDING", requesterId: e.id } });
  done();
  return { ok: "Swap request cancelled." };
}

const timeOff = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first day."),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the last day."),
  note: z.string().max(300).optional(),
  type: z.enum(["PTO", "SICK", "UNPAID"]).default("UNPAID"),
  hours: z.string().optional(),
});

export async function requestTimeOff(input: { start: string; end: string; note?: string; type?: "PTO" | "SICK" | "UNPAID"; hours?: string }): Promise<Res> {
  const e = await me();
  if (!e) return { error: "Your login isn't linked to a team member yet." };
  const p = timeOff.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { start, end, note, type } = p.data;
  if (end < start) return { error: "The last day is before the first day." };
  // Sick time can be logged for a day already started or just past (called in sick); other leave is asked in advance.
  const earliest = type === "SICK" ? businessToday().slice(0, 8) + "01" : businessToday();
  if (start < earliest) return { error: type === "SICK" ? "Sick time can go back to the start of this month." : "Pick days from today on." };
  let hours: number | null = null;
  if (type !== "UNPAID" && p.data.hours?.trim()) {
    hours = Number(p.data.hours.replace(/h(ours?)?$/i, "").trim());
    if (!Number.isFinite(hours) || hours <= 0 || hours > 400) return { error: "Hours should be a number like 6 or 7.5 (or blank for your scheduled hours)." };
  }
  const req = await db.timeOffRequest.create({
    data: { employeeId: e.id, startDate: parseISODate(start), endDate: parseISODate(end), type, hours: hours == null ? null : new Prisma.Decimal(hours.toFixed(2)), note: note?.trim() || null },
  });
  inBackground(() => notifyStaffRequest({ timeOffId: req.id }));
  done();
  return { ok: "Requested. You'll see it here once it's approved." };
}

export async function cancelTimeOff(id: string): Promise<Res> {
  const e = await me();
  if (!e) return { error: "Your login isn't linked to a team member yet." };
  await db.timeOffRequest.deleteMany({ where: { id, employeeId: e.id, status: "PENDING" } });
  done();
  return { ok: "Request withdrawn." };
}

/** One weekday of your own availability, typed like "4p-10p, 11-2"; blank = can't work that day. */
export async function setMyAvailability(weekday: number, raw: string): Promise<{ error?: string } | void> {
  const e = await me();
  if (!e) return { error: "Your login isn't linked to a team member yet." };
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: "Bad day" };
  const parsed = parseWindows(raw);
  if ("error" in parsed) return parsed;
  const current = (e.availability ?? {}) as Record<string, [string, string][]>;
  const next = { ...current };
  if (parsed.length) next[String(weekday)] = parsed;
  else delete next[String(weekday)];
  await db.employee.update({ where: { id: e.id }, data: { availability: next } });
  revalidatePath("/my");
  revalidatePath("/team");
  revalidatePath("/schedule", "layout");
}

/** Start setting availability ("any time, every day") or go back to "not set" (always available). */
export async function resetMyAvailability(mode: "all" | "clear"): Promise<Res> {
  const e = await me();
  if (!e) return { error: "Your login isn't linked to a team member yet." };
  const all = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [["00:00", "24:00"]]]));
  await db.employee.update({ where: { id: e.id }, data: { availability: mode === "all" ? all : Prisma.JsonNull } });
  revalidatePath("/my");
  revalidatePath("/team");
  revalidatePath("/schedule", "layout");
  return { ok: mode === "all" ? "Now blank out the times you can't work." : "Cleared. You'll be treated as available any time." };
}
