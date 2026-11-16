"use server";

import { asShift, LINKABLE_PAGES, parseWeekdays, runDateFor } from "@/domain/checklists";
import { parseISODate } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessHour } from "@/server/services/checklists";
import { businessToday } from "@/server/services/sales";
import { markTaskDone } from "@/server/services/upkeep";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = Promise<{ error?: string } | void>;

function refresh() {
  revalidatePath("/checklists");
  revalidatePath("/checklists/setup");
  revalidatePath("/");
  revalidatePath("/brief");
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Staff may only work on the run a list covers right now (tonight's close
 * stays open until 5am); managers can fix any day.
 */
async function openRun(templateId: string, date: string, role: "MANAGER" | "STAFF") {
  isoDate.parse(date);
  const t = await db.checklistTemplate.findUnique({ where: { id: templateId }, select: { id: true, shift: true } });
  if (!t) return { error: "That list was deleted. Reload the page." } as const;
  if (role !== "MANAGER" && date !== runDateFor(t.shift, businessToday(), businessHour())) return { error: "That day's list is closed. Ask a manager to fix it." } as const;
  const run = await db.checklistRun.upsert({ where: { templateId_date: { templateId, date: parseISODate(date) } }, create: { templateId, date: parseISODate(date) }, update: {} });
  return { run } as const;
}

// ---- Running a list ------------------------------------------------------------------------

export async function tickItem(templateId: string, date: string, itemId: string, done: boolean): R {
  const s = await requireUser();
  const o = await openRun(templateId, date, s.role);
  if ("error" in o) return { error: o.error };
  if (o.run.signedOffAt) return { error: "This list is signed off. Undo the sign-off to change it." };
  const item = await db.checklistItem.findFirst({ where: { id: itemId, templateId }, select: { id: true } });
  if (!item) return { error: "That step was removed. Reload the page." };
  if (done) {
    await db.checklistTick.upsert({ where: { runId_itemId: { runId: o.run.id, itemId } }, create: { runId: o.run.id, itemId, userId: s.userId, userName: s.name }, update: {} });
  } else {
    await db.checklistTick.deleteMany({ where: { runId: o.run.id, itemId } });
  }
  refresh();
}

export async function signOff(templateId: string, date: string, note: string): R {
  const s = await requireUser();
  const o = await openRun(templateId, date, s.role);
  if ("error" in o) return { error: o.error };
  await db.checklistRun.update({ where: { id: o.run.id }, data: { signedOffAt: new Date(), signedOffBy: s.userId, signedOffName: s.name, note: note.trim().slice(0, 500) || null } });
  refresh();
}

export async function undoSignOff(templateId: string, date: string): R {
  const s = await requireUser();
  isoDate.parse(date);
  const run = await db.checklistRun.findUnique({ where: { templateId_date: { templateId, date: parseISODate(date) } } });
  if (!run) return;
  if (s.role !== "MANAGER" && run.signedOffBy !== s.userId) return { error: "Only the person who signed it, or a manager, can undo it." };
  await db.checklistRun.update({ where: { id: run.id }, data: { signedOffAt: null, signedOffBy: null, signedOffName: null } });
  refresh();
}

/** An upkeep job staff can do (draft lines, fryer boil-out), ticked from the checklists page. */
export async function jobDone(taskId: string): R {
  const s = await requireUser();
  const t = await db.upkeepTask.findUnique({ where: { id: taskId }, select: { staffCanDo: true } });
  if (!t) return { error: "That job was removed. Reload the page." };
  if (!t.staffCanDo && s.role !== "MANAGER") return { error: "A manager logs this one." };
  await markTaskDone(taskId, businessToday(), { userId: s.userId, userName: s.name });
  refresh();
  revalidatePath("/upkeep");
}

// ---- Setting lists up (managers) -------------------------------------------------------------

export async function addTemplate(name: string): R {
  await requireUser("MANAGER");
  const n = name.trim().slice(0, 80);
  if (!n) return { error: "Give it a name" };
  const max = await db.checklistTemplate.aggregate({ _max: { sort: true } });
  const shift = /open/i.test(n) ? "open" : /mid/i.test(n) ? "mid" : "close";
  await db.checklistTemplate.create({ data: { name: n, shift, sort: (max._max.sort ?? 0) + 1 } });
  refresh();
}

const templateFields = z.enum(["name", "shift", "active", "weekdays"]);

export async function setTemplateField(id: string, field: z.infer<typeof templateFields>, raw: string): R {
  await requireUser("MANAGER");
  templateFields.parse(field);
  const v = raw.trim();
  if (field === "name") {
    if (!v) return { error: "Can't be empty" };
    await db.checklistTemplate.update({ where: { id }, data: { name: v.slice(0, 80) } });
  } else if (field === "shift") {
    await db.checklistTemplate.update({ where: { id }, data: { shift: asShift(v) } });
  } else if (field === "active") {
    await db.checklistTemplate.update({ where: { id }, data: { active: v === "yes" } });
  } else {
    const days = parseWeekdays(v);
    if (!days) return { error: "Days like “Mon, Thu”, or blank for every day" };
    await db.checklistTemplate.update({ where: { id }, data: { weekdays: days } });
  }
  refresh();
}

export async function setTemplatePosition(id: string, positionId: string, on: boolean): R {
  await requireUser("MANAGER");
  const t = await db.checklistTemplate.findUnique({ where: { id }, select: { positionIds: true } });
  if (!t) return { error: "That list was deleted." };
  const next = on ? [...new Set([...t.positionIds, positionId])] : t.positionIds.filter((p) => p !== positionId);
  await db.checklistTemplate.update({ where: { id }, data: { positionIds: next } });
  refresh();
}

export async function deleteTemplate(id: string): R {
  await requireUser("MANAGER");
  await db.checklistTemplate.delete({ where: { id } }).catch(() => null);
  refresh();
}

export async function addItem(templateId: string, title: string): R {
  await requireUser("MANAGER");
  const t = title.trim().slice(0, 160);
  if (!t) return { error: "Type the step first" };
  const max = await db.checklistItem.aggregate({ where: { templateId }, _max: { sort: true } });
  await db.checklistItem.create({ data: { templateId, title: t, sort: (max._max.sort ?? 0) + 1 } });
  refresh();
}

const itemFields = z.enum(["title", "detail", "href", "weekdays", "active"]);

export async function setItemField(id: string, field: z.infer<typeof itemFields>, raw: string): R {
  await requireUser("MANAGER");
  itemFields.parse(field);
  const v = raw.trim();
  if (field === "title") {
    if (!v) return { error: "Can't be empty" };
    await db.checklistItem.update({ where: { id }, data: { title: v.slice(0, 160) } });
  } else if (field === "detail") {
    await db.checklistItem.update({ where: { id }, data: { detail: v ? v.slice(0, 400) : null } });
  } else if (field === "href") {
    if (v && !LINKABLE_PAGES.some((p) => p.href === v)) return { error: "Pick a page from the list" };
    await db.checklistItem.update({ where: { id }, data: { href: v || null } });
  } else if (field === "active") {
    await db.checklistItem.update({ where: { id }, data: { active: v === "yes" } });
  } else {
    const days = parseWeekdays(v);
    if (!days) return { error: "Days like “Sun, Wed”, or blank for every day" };
    await db.checklistItem.update({ where: { id }, data: { weekdays: days } });
  }
  refresh();
}

export async function moveItem(id: string, dir: -1 | 1): R {
  await requireUser("MANAGER");
  const it = await db.checklistItem.findUnique({ where: { id }, select: { templateId: true } });
  if (!it) return;
  const all = await db.checklistItem.findMany({ where: { templateId: it.templateId }, orderBy: [{ sort: "asc" }, { id: "asc" }], select: { id: true } });
  const i = all.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.$transaction(all.map((x, k) => db.checklistItem.update({ where: { id: x.id }, data: { sort: k } })));
  refresh();
}

export async function deleteItem(id: string): R {
  await requireUser("MANAGER");
  await db.checklistItem.delete({ where: { id } }).catch(() => null);
  refresh();
}
