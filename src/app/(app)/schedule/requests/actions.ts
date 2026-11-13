"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { hasOverlap } from "@/server/services/scheduling";
import { revalidatePath } from "next/cache";

type Res = { error?: string; ok?: string };

const done = () => {
  revalidatePath("/schedule", "layout");
  revalidatePath("/my");
};

export async function decideTimeOff(id: string, approve: boolean): Promise<Res> {
  await requireUser("MANAGER");
  const r = await db.timeOffRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: approve ? "APPROVED" : "DENIED" } });
  if (!r.count) return { error: "That request was already handled." };
  done();
  return { ok: approve ? "Time off approved." : "Time off denied." };
}

/** Approve: the shift moves to the taker (chosen here if nobody offered). */
export async function decideSwap(id: string, approve: boolean, takerId?: string | null): Promise<Res> {
  await requireUser("MANAGER");
  const sw = await db.shiftSwap.findUnique({ where: { id }, include: { shift: true } });
  if (!sw || sw.status !== "PENDING") return { error: "That request was already handled." };
  if (!approve) {
    await db.shiftSwap.update({ where: { id }, data: { status: "DENIED" } });
    done();
    return { ok: "Swap denied." };
  }
  const taker = takerId ?? sw.takerId;
  if (!taker) return { error: "Pick who takes the shift." };
  if (await hasOverlap(taker, sw.shift.start, sw.shift.end, sw.shiftId)) return { error: "They're already working then." };
  await db.$transaction([
    db.shift.update({ where: { id: sw.shiftId }, data: { employeeId: taker } }),
    db.shiftSwap.update({ where: { id }, data: { status: "APPROVED", takerId: taker } }),
  ]);
  done();
  return { ok: "Swap approved." };
}
