"use server";

import { parseISODate } from "@/domain/dates";
import { parseWindows } from "@/domain/timecards";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { inBackground, notifyStaffRequest } from "@/server/services/notify";
import { cancelOwnSwap, claimSwap, declineAsk, pickUpOpen, postShift } from "@/server/services/swaps";
import { notifyShiftOffer, notifySwapClaimed } from "@/server/services/workforceNotify";
import { businessToday } from "@/server/services/sales";
import { employeeForUser } from "@/server/services/scheduling";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Res = { error?: string; ok?: string; swapId?: string; auto?: boolean };

async function me() {
  const s = await requireUser();
  const e = await employeeForUser(s.userId);
  return e;
}

const done = () => {
  revalidatePath("/my", "layout");
  revalidatePath("/schedule", "layout");
};

async function staffMe() {
  const e = await me();
  return e ? { id: e.id, name: e.name } : null;
}
const NOT_LINKED = { error: "Your login isn't linked to a team member yet." };

export async function pickUpShift(shiftId: string): Promise<Res> {
  const e = await staffMe();
  if (!e) return NOT_LINKED;
  const r = await pickUpOpen(e, shiftId);
  if (r.swapId && !r.error) inBackground(() => notifySwapClaimed(r.swapId!, !!r.auto));
  done();
  return r;
}

/** Offer one of your shifts: give it away, trade it, or ask to drop it. `askId` asks one person directly. */
export async function requestSwap(shiftId: string, takerId: string | null, kind: "GIVE" | "SWAP" | "DROP" = "GIVE", note?: string): Promise<Res> {
  const e = await staffMe();
  if (!e) return NOT_LINKED;
  const r = await postShift(e, shiftId, kind, { askId: takerId, note });
  if (r.swapId) inBackground(() => (kind === "DROP" ? notifyStaffRequest({ swapId: r.swapId! }) : notifyShiftOffer(r.swapId!)));
  done();
  return r;
}

/** Take a posted shift; for a trade, pass the shift of yours you give back. */
export async function offerToTake(swapId: string, offeredShiftId?: string | null): Promise<Res> {
  const e = await staffMe();
  if (!e) return NOT_LINKED;
  const r = await claimSwap(e, swapId, offeredShiftId);
  if (r.swapId && !r.error) inBackground(() => notifySwapClaimed(r.swapId!, !!r.auto));
  done();
  return r;
}

export async function declineSwapAsk(swapId: string): Promise<Res> {
  const e = await staffMe();
  if (!e) return NOT_LINKED;
  const r = await declineAsk(e, swapId);
  done();
  return r;
}

export async function cancelSwap(swapId: string): Promise<Res> {
  const e = await staffMe();
  if (!e) return NOT_LINKED;
  const r = await cancelOwnSwap(e, swapId);
  done();
  return r;
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
  revalidatePath("/my", "layout");
  revalidatePath("/team");
  revalidatePath("/schedule", "layout");
}

/** Start setting availability ("any time, every day") or go back to "not set" (always available). */
export async function resetMyAvailability(mode: "all" | "clear"): Promise<Res> {
  const e = await me();
  if (!e) return { error: "Your login isn't linked to a team member yet." };
  const all = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [["00:00", "24:00"]]]));
  await db.employee.update({ where: { id: e.id }, data: { availability: mode === "all" ? all : Prisma.JsonNull } });
  revalidatePath("/my", "layout");
  revalidatePath("/team");
  revalidatePath("/schedule", "layout");
  return { ok: mode === "all" ? "Now blank out the times you can't work." : "Cleared. You'll be treated as available any time." };
}
