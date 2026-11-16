"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { inBackground } from "@/server/services/notify";
import { closeIfComplete } from "@/server/services/newHires";
import { balanceFor, getRecognitionConfig } from "@/server/services/recognition";
import { employeeForUser } from "@/server/services/scheduling";
import { notifyManagersNote, notifyShoutout } from "@/server/services/workforceNotify";
import { shoutoutPoints } from "@/domain/recognition";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Res = { error?: string; ok?: string };
const NOT_LINKED = { error: "Your login isn't linked to a team member yet." };

async function me() {
  const s = await requireUser();
  const e = await employeeForUser(s.userId);
  return e ? { session: s, e } : null;
}

// ---- Onboarding ------------------------------------------------------------------------

/** Tick (or untick) one of your own checklist items — only the ones meant for you to tick. */
export async function tickMyItem(itemId: string, done: boolean): Promise<Res> {
  const m = await me();
  if (!m) return NOT_LINKED;
  const item = await db.onboardingItem.findUnique({ where: { id: itemId }, include: { onboarding: { select: { id: true, employeeId: true, status: true } } } });
  if (!item || item.onboarding.employeeId !== m.e.id) return { error: "That isn't on your checklist." };
  if (!(item.staffCanTick || item.kind === "PAYROLL")) return { error: "A manager ticks this one off." };
  await db.onboardingItem.update({ where: { id: itemId }, data: done ? { doneAt: new Date(), doneBy: m.e.name } : { doneAt: null, doneBy: null } });
  if (done && (await closeIfComplete(item.onboarding.id))) inBackground(() => notifyManagersNote({ subject: `${m.e.name} finished onboarding`, title: `${m.e.name.split(" ")[0]} finished their checklist`, line: "Every must-do on their new-hire checklist is done.", path: "/team/onboarding", tag: `onboarding-${item.onboarding.id}` }));
  revalidatePath("/my", "layout");
  revalidatePath("/team/onboarding");
  return { ok: done ? "Ticked off." : "Unticked." };
}

const emergency = z.object({
  name: z.string().trim().min(2, "Add their name.").max(80),
  phone: z.string().trim().min(7, "Add a phone number.").max(30).regex(/^[\d\s()+.-]+$/, "That phone number doesn't look right."),
  relation: z.string().trim().max(40).optional(),
});

/** Who to call in an emergency. Name, phone and relationship only. */
export async function saveEmergencyContact(input: { name: string; phone: string; relation?: string }): Promise<Res> {
  const m = await me();
  if (!m) return NOT_LINKED;
  const p = emergency.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  await db.employee.update({ where: { id: m.e.id }, data: { emergencyName: p.data.name, emergencyPhone: p.data.phone, emergencyRelation: p.data.relation || null } });
  const ob = await db.onboarding.findFirst({ where: { employeeId: m.e.id, status: "ACTIVE" }, select: { id: true } });
  if (ob && (await closeIfComplete(ob.id))) inBackground(() => notifyManagersNote({ subject: `${m.e.name} finished onboarding`, title: `${m.e.name.split(" ")[0]} finished their checklist`, line: "Every must-do on their new-hire checklist is done.", path: "/team/onboarding", tag: `onboarding-${ob.id}` }));
  revalidatePath("/my", "layout");
  revalidatePath("/team/onboarding");
  return { ok: "Saved. Only managers can see this." };
}

// ---- Shout-outs & rewards ----------------------------------------------------------------

const shout = z.object({ employeeId: z.string().min(1, "Pick someone."), value: z.string().max(40).optional(), body: z.string().trim().min(3, "Say what they did.").max(400) });

/** Thank a teammate (when peer shout-outs are on). */
export async function givePeerShoutout(input: { employeeId: string; value?: string; body: string }): Promise<Res> {
  const m = await me();
  if (!m) return NOT_LINKED;
  const cfg = await getRecognitionConfig();
  if (!cfg.peerShoutouts && m.session.role !== "MANAGER") return { error: "Shout-outs from teammates are turned off." };
  const p = shout.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  if (p.data.employeeId === m.e.id) return { error: "Nice try — pick a teammate." };
  const to = await db.employee.findFirst({ where: { id: p.data.employeeId, active: true }, select: { id: true } });
  if (!to) return { error: "Pick someone on the team." };
  const s = await db.shoutout.create({
    data: { employeeId: to.id, fromUserId: m.session.userId, fromName: m.e.name, value: p.data.value && cfg.values.includes(p.data.value) ? p.data.value : null, body: p.data.body, points: shoutoutPoints(cfg, m.session.role === "MANAGER") },
  });
  inBackground(() => notifyShoutout(s.id));
  revalidatePath("/my", "layout");
  revalidatePath("/team/recognition");
  return { ok: "Sent. Thanks for noticing." };
}

/** Swap points for a reward; a manager hands it over. */
export async function redeemReward(rewardId: string): Promise<Res> {
  const m = await me();
  if (!m) return NOT_LINKED;
  const cfg = await getRecognitionConfig();
  if (!cfg.pointsEnabled) return { error: "Points are turned off." };
  const reward = await db.reward.findFirst({ where: { id: rewardId, active: true } });
  if (!reward) return { error: "That reward isn't available." };
  if ((await balanceFor(m.e.id)) < reward.cost) return { error: "Not enough points yet." };
  await db.rewardRedemption.create({ data: { employeeId: m.e.id, rewardId, points: reward.cost } });
  inBackground(() => notifyManagersNote({ subject: `${m.e.name} asked for ${reward.name}`, title: `${m.e.name.split(" ")[0]} wants ${reward.name}`, line: `${reward.cost} points. Approve it on Shout-outs.`, path: "/team/recognition", tag: `reward-${rewardId}` }));
  revalidatePath("/my/kudos");
  revalidatePath("/team/recognition");
  return { ok: "Asked. A manager will hand it over." };
}

// ---- Messages to managers ---------------------------------------------------------------

const msg = z.object({ kind: z.enum(["QUESTION", "IDEA", "CONCERN", "OTHER"]), body: z.string().trim().min(3, "Write a few words.").max(1500), anonymous: z.boolean().default(false) });

export async function sendStaffMessage(input: { kind: "QUESTION" | "IDEA" | "CONCERN" | "OTHER"; body: string; anonymous?: boolean }): Promise<Res> {
  const m = await me();
  if (!m) return NOT_LINKED;
  const p = msg.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  // Anonymity is for ideas and concerns; a question needs a name to answer.
  const anonymous = p.data.anonymous && (p.data.kind === "IDEA" || p.data.kind === "CONCERN");
  const row = await db.staffMessage.create({ data: { employeeId: m.e.id, kind: p.data.kind, body: p.data.body, anonymous } });
  const who = anonymous ? "Someone on the team" : m.e.name.split(" ")[0];
  const label = { QUESTION: "asked", IDEA: "has an idea", CONCERN: "raised a concern", OTHER: "wrote" }[p.data.kind];
  inBackground(() => notifyManagersNote({ subject: `${who} ${label}`, title: `${who} ${label}`, line: p.data.body.slice(0, 200), path: "/team/messages", tag: `msg-${row.id}` }));
  revalidatePath("/my/message");
  revalidatePath("/team/messages");
  return { ok: anonymous ? "Sent — your name won't show to managers." : "Sent. You'll see the reply here." };
}
