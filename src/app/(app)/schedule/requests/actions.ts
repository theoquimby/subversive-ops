"use server";

import { addDays, toISODate } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { requestHours } from "@/server/services/payroll";
import { instantAt } from "@/server/services/scheduling";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifyTimeOffDecided } from "@/server/services/notify";
import { decideSwapRequest, getSwapRules, saveSwapRules } from "@/server/services/swaps";
import { notifySwapOutcome } from "@/server/services/workforceNotify";
import { parseSwapRules, type SwapRules } from "@/domain/swaps";

type Res = { error?: string; ok?: string };

const done = () => {
  revalidatePath("/schedule", "layout");
  revalidatePath("/my");
  revalidatePath("/labor");
};

/**
 * Approve or deny a time-off request. On approval, `openShifts` unassigns the
 * person's shifts on those days (they become open shifts others can pick up),
 * and paid leave (SICK/PTO) gets its hours fixed: the hours given, else the
 * hours they were scheduled, worked out before their shifts are opened up.
 */
export async function decideTimeOff(id: string, approve: boolean, opts: { openShifts?: boolean; hours?: number | null; reason?: string } = {}): Promise<Res> {
  await requireUser("MANAGER");
  const r = await db.timeOffRequest.findUnique({ where: { id } });
  if (!r || r.status !== "PENDING") return { error: "That request was already handled." };
  if (!approve) {
    // An optional word on why goes out with the "not approved" message (it isn't stored).
    const reason = typeof opts.reason === "string" ? opts.reason.trim().slice(0, 300) || null : null;
    await db.timeOffRequest.update({ where: { id }, data: { status: "DENIED" } });
    done();
    after(() => notifyTimeOffDecided(id, reason).then(() => undefined));
    return { ok: reason ? "Time off denied. They'll get your reason with the message." : "Time off denied." };
  }
  if (opts.hours != null && (!Number.isFinite(opts.hours) || opts.hours < 0 || opts.hours > 400)) return { error: "Hours should be 0–400." };
  const hours = r.type === "UNPAID" ? null : opts.hours ?? (await requestHours(r));
  const range = { gte: instantAt(toISODate(r.startDate), 0), lt: instantAt(addDays(toISODate(r.endDate), 1), 0) };
  const opened = await db.$transaction(async (tx) => {
    await tx.timeOffRequest.update({ where: { id }, data: { status: "APPROVED", hours: hours == null ? null : new Prisma.Decimal(hours.toFixed(2)) } });
    return opts.openShifts ? tx.shift.updateMany({ where: { employeeId: r.employeeId, start: range }, data: { employeeId: null } }) : { count: 0 };
  });
  done();
  after(() => notifyTimeOffDecided(id).then(() => undefined));
  const paid = hours != null ? ` ${r.type === "SICK" ? "Sick" : "PTO"}: ${hours}h.` : "";
  return { ok: `Time off approved.${opened.count ? ` ${opened.count} shift${opened.count === 1 ? " is" : "s are"} now open for others to pick up.` : ""}${paid}` };
}

/** Approve: the shift moves to the taker (chosen here if nobody offered). */
export async function decideSwap(id: string, approve: boolean, takerId?: string | null): Promise<Res> {
  const me = await requireUser("MANAGER");
  const r = await decideSwapRequest(id, approve, me.name, takerId);
  done();
  if (!r.error) after(() => notifySwapOutcome(id).then(() => undefined));
  return r;
}

/** Auto-approve and pickup rules for swaps (Requests → Swap rules). */
export async function saveSwapSettings(patch: Partial<SwapRules>): Promise<Res> {
  await requireUser("MANAGER");
  const cur = await getSwapRules();
  const next = parseSwapRules(JSON.stringify({ ...cur, ...patch }));
  await saveSwapRules(next);
  revalidatePath("/schedule/requests");
  return { ok: "Saved." };
}
