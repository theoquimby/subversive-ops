"use server";

import { parseISODate } from "@/domain/dates";
import { ONBOARDING_KINDS, PROVIDERS, parseProvider } from "@/domain/onboarding";
import { parseRecognition, shoutoutPoints, type RecognitionConfig } from "@/domain/recognition";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { inBackground } from "@/server/services/notify";
import { closeIfComplete, savePayrollProvider, startOnboarding } from "@/server/services/newHires";
import { getRecognitionConfig, saveRecognitionConfig } from "@/server/services/recognition";
import { notifyMessageReply, notifyRedemptionDecided, notifyShoutout } from "@/server/services/workforceNotify";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Res = { error?: string; ok?: string; id?: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const refresh = () => {
  revalidatePath("/team", "layout");
  revalidatePath("/my", "layout");
};

// ---- Onboarding ------------------------------------------------------------------------

const hire = z.object({
  name: z.string().trim().min(2, "Type their name.").max(80),
  email: z.union([z.literal(""), z.email("That email doesn't look right.")]).optional(),
  phone: z.string().trim().max(30).optional(),
  positionIds: z.array(z.string()).min(1, "Pick at least one position."),
  startDate: z.string().regex(ISO, "Pick a start date."),
  templateId: z.string().optional(),
});

/** Add a new person and start their checklist in one go. */
export async function addNewHire(input: z.input<typeof hire>): Promise<Res> {
  const me = await requireUser("MANAGER");
  const p = hire.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { name, email, phone, positionIds, startDate, templateId } = p.data;
  const exists = await db.employee.findFirst({ where: { name: { equals: name, mode: "insensitive" }, active: true } });
  if (exists) return { error: `${exists.name} is already on the team — start their checklist from the list below.` };
  const emp = await db.employee.create({
    data: { name, email: email || null, phone: phone?.trim() || null, startDate: parseISODate(startDate), positions: { create: positionIds.map((positionId) => ({ positionId })) } },
  });
  const r = await startOnboarding({ employeeId: emp.id, templateId: templateId || null, startDate, by: me.name });
  refresh();
  return r.error ? r : { ok: `${name} added. Give them a login so they can see their checklist.`, id: emp.id };
}

/** Start a checklist for someone already on the team (e.g. brought in by the Square team sync). */
export async function startChecklist(employeeId: string, opts: { templateId?: string; startDate?: string; fromSquare?: boolean } = {}): Promise<Res> {
  const me = await requireUser("MANAGER");
  if (opts.startDate && !ISO.test(opts.startDate)) return { error: "Pick a start date." };
  const r = await startOnboarding({ employeeId, templateId: opts.templateId ?? null, startDate: opts.startDate, by: me.name, source: opts.fromSquare ? "SQUARE" : "MANUAL" });
  refresh();
  return r;
}

/** A manager ticks any item (uniform, keys, or confirming the payroll paperwork). */
export async function setHireItem(itemId: string, done: boolean): Promise<Res | void> {
  const me = await requireUser("MANAGER");
  const item = await db.onboardingItem.findUnique({ where: { id: itemId }, select: { onboardingId: true } });
  if (!item) return { error: "That item is gone." };
  await db.onboardingItem.update({ where: { id: itemId }, data: done ? { doneAt: new Date(), doneBy: me.name } : { doneAt: null, doneBy: null } });
  await closeIfComplete(item.onboardingId);
  refresh();
}

export async function setHireStatus(onboardingId: string, status: "ACTIVE" | "DONE" | "CANCELLED"): Promise<Res> {
  await requireUser("MANAGER");
  await db.onboarding.update({ where: { id: onboardingId }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
  refresh();
  return { ok: status === "CANCELLED" ? "Checklist removed." : status === "DONE" ? "Marked done." : "Reopened." };
}

export async function setHireDue(onboardingId: string, date: string): Promise<Res | void> {
  await requireUser("MANAGER");
  if (!ISO.test(date)) return { error: "Pick a date." };
  await db.onboarding.update({ where: { id: onboardingId }, data: { dueOn: parseISODate(date) } });
  refresh();
}

// Templates: edited inline like a grid.

export async function addTemplate(name: string): Promise<Res> {
  await requireUser("MANAGER");
  const n = name.trim();
  if (!n) return { error: "Name the checklist." };
  const t = await db.onboardingTemplate.create({ data: { name: n.slice(0, 60), sort: await db.onboardingTemplate.count() } });
  refresh();
  return { ok: "Added.", id: t.id };
}

export async function setTemplateField(id: string, field: "name" | "positionIds", value: string | string[]): Promise<Res | void> {
  await requireUser("MANAGER");
  if (field === "name") {
    const n = String(value).trim();
    if (!n) return { error: "Name it." };
    await db.onboardingTemplate.update({ where: { id }, data: { name: n.slice(0, 60) } });
  } else await db.onboardingTemplate.update({ where: { id }, data: { positionIds: Array.isArray(value) ? value : [] } });
  refresh();
}

export async function deleteTemplate(id: string): Promise<Res> {
  await requireUser("MANAGER");
  if ((await db.onboardingTemplate.count({ where: { active: true } })) <= 1) return { error: "Keep at least one checklist." };
  await db.onboardingTemplate.update({ where: { id }, data: { active: false } });
  refresh();
  return { ok: "Removed. Checklists already started keep their items." };
}

const itemInput = z.object({ kind: z.enum(ONBOARDING_KINDS), title: z.string().trim().min(2, "Name the item.").max(120), detail: z.string().trim().max(300).optional(), refId: z.string().optional(), required: z.boolean(), staffCanTick: z.boolean() });

export async function addTemplateItem(templateId: string, input: z.input<typeof itemInput>): Promise<Res> {
  await requireUser("MANAGER");
  const p = itemInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  const sort = await db.onboardingTemplateItem.count({ where: { templateId } });
  await db.onboardingTemplateItem.create({ data: { templateId, sort, kind: p.data.kind, title: p.data.title, detail: p.data.detail || null, refId: p.data.refId || null, required: p.data.required, staffCanTick: p.data.kind === "TASK" ? p.data.staffCanTick : p.data.kind === "PAYROLL" } });
  refresh();
  return { ok: "Added." };
}

export async function setTemplateItemField(id: string, field: "title" | "detail" | "required" | "staffCanTick", raw: string): Promise<Res | void> {
  await requireUser("MANAGER");
  if (field === "title") {
    if (!raw.trim()) return { error: "Name the item." };
    await db.onboardingTemplateItem.update({ where: { id }, data: { title: raw.trim().slice(0, 120) } });
  } else if (field === "detail") await db.onboardingTemplateItem.update({ where: { id }, data: { detail: raw.trim().slice(0, 300) || null } });
  else await db.onboardingTemplateItem.update({ where: { id }, data: { [field]: raw === "yes" } });
  refresh();
}

export async function deleteTemplateItem(id: string): Promise<Res> {
  await requireUser("MANAGER");
  await db.onboardingTemplateItem.delete({ where: { id } });
  refresh();
  return { ok: "Removed." };
}

export async function savePayrollProviderAction(id: string, name?: string, url?: string): Promise<Res> {
  await requireUser("MANAGER");
  if (!(id in PROVIDERS)) return { error: "Pick a provider." };
  const p = parseProvider(JSON.stringify({ id, name, url }));
  await savePayrollProvider(p);
  revalidatePath("/labor", "layout");
  refresh();
  return { ok: `Payroll provider: ${p.name}.` };
}

// ---- Recognition -----------------------------------------------------------------------

const shout = z.object({ employeeId: z.string().min(1, "Pick someone."), value: z.string().max(40).optional(), body: z.string().trim().min(3, "Say what they did.").max(400), announce: z.boolean().default(false) });

/** A manager's shout-out. `announce` also posts it as a team announcement. */
export async function giveShoutout(input: z.input<typeof shout>): Promise<Res> {
  const me = await requireUser("MANAGER");
  const p = shout.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  const cfg = await getRecognitionConfig();
  const emp = await db.employee.findFirst({ where: { id: p.data.employeeId, active: true }, select: { id: true, name: true } });
  if (!emp) return { error: "Pick someone on the team." };
  const value = p.data.value && cfg.values.includes(p.data.value) ? p.data.value : null;
  const s = await db.shoutout.create({ data: { employeeId: emp.id, fromUserId: me.userId, fromName: me.name, value, body: p.data.body, points: shoutoutPoints(cfg, true) } });
  if (p.data.announce) await db.announcement.create({ data: { body: `Shout-out to ${emp.name.split(" ")[0]}${value ? ` (${value})` : ""}: ${p.data.body}`, author: me.name, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  inBackground(() => notifyShoutout(s.id));
  refresh();
  revalidatePath("/brief");
  return { ok: `Sent to ${emp.name.split(" ")[0]}.` };
}

export async function hideShoutout(id: string, hidden: boolean): Promise<Res> {
  await requireUser("MANAGER");
  await db.shoutout.update({ where: { id }, data: { hidden } });
  refresh();
  return { ok: hidden ? "Hidden." : "Shown again." };
}

export async function saveRecognition(patch: Partial<RecognitionConfig>): Promise<Res> {
  await requireUser("MANAGER");
  const cur = await getRecognitionConfig();
  await saveRecognitionConfig(parseRecognition(JSON.stringify({ ...cur, ...patch })));
  refresh();
  return { ok: "Saved." };
}

export async function addReward(name: string, cost: number): Promise<Res> {
  await requireUser("MANAGER");
  const n = name.trim();
  if (!n) return { error: "Name the reward." };
  if (!Number.isInteger(cost) || cost < 1 || cost > 100000) return { error: "Points should be a whole number." };
  await db.reward.create({ data: { name: n.slice(0, 80), cost, sort: await db.reward.count() } });
  refresh();
  return { ok: "Added." };
}

export async function setRewardField(id: string, field: "name" | "description" | "cost" | "active", raw: string): Promise<Res | void> {
  await requireUser("MANAGER");
  if (field === "cost") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return { error: "Whole points, 1 or more." };
    await db.reward.update({ where: { id }, data: { cost: n } });
  } else if (field === "active") await db.reward.update({ where: { id }, data: { active: raw === "yes" } });
  else if (field === "name") {
    if (!raw.trim()) return { error: "Name it." };
    await db.reward.update({ where: { id }, data: { name: raw.trim().slice(0, 80) } });
  } else await db.reward.update({ where: { id }, data: { description: raw.trim().slice(0, 200) || null } });
  refresh();
}

export async function decideRedemption(id: string, approve: boolean): Promise<Res> {
  const me = await requireUser("MANAGER");
  const r = await db.rewardRedemption.updateMany({ where: { id, status: "PENDING" }, data: { status: approve ? "APPROVED" : "DENIED", decidedAt: new Date(), decidedBy: me.name } });
  if (r.count === 0) return { error: "Already handled." };
  inBackground(() => notifyRedemptionDecided(id));
  refresh();
  return { ok: approve ? "Approved — hand it over." : "Not approved; points returned." };
}

// ---- Messages --------------------------------------------------------------------------

export async function replyToMessage(id: string, reply: string): Promise<Res> {
  const me = await requireUser("MANAGER");
  const text = reply.trim();
  if (text.length < 2) return { error: "Write a reply." };
  await db.staffMessage.update({ where: { id }, data: { reply: text.slice(0, 1500), repliedAt: new Date(), repliedBy: me.name, readAt: new Date(), readBy: me.name } });
  inBackground(() => notifyMessageReply(id));
  refresh();
  return { ok: "Replied." };
}

export async function markMessageRead(id: string, read: boolean): Promise<Res> {
  const me = await requireUser("MANAGER");
  await db.staffMessage.update({ where: { id }, data: read ? { readAt: new Date(), readBy: me.name } : { readAt: null, readBy: null } });
  refresh();
  return { ok: read ? "Marked read." : "Marked unread." };
}
