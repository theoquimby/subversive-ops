"use server";

import { parseISODate } from "@/domain/dates";
import { parseEvery } from "@/domain/upkeep";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { markTaskDone, recomputeLastDone } from "@/server/services/upkeep";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = Promise<{ error?: string } | void>;

function refresh() {
  revalidatePath("/upkeep");
  revalidatePath("/checklists");
  revalidatePath("/");
  revalidatePath("/brief");
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), "Pick a date");
const money = (raw: string): number | null | "bad" => {
  const v = raw.replace(/[$,\s]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : "bad";
};

// ---- Jobs ----------------------------------------------------------------------------------

export async function addTask(title: string, equipmentId?: string): R {
  await requireUser("MANAGER");
  const t = title.trim().slice(0, 120);
  if (!t) return { error: "Name the job" };
  const max = await db.upkeepTask.aggregate({ _max: { sort: true } });
  await db.upkeepTask.create({ data: { title: t, everyDays: 30, equipmentId: equipmentId || null, sort: (max._max.sort ?? 0) + 1 } });
  refresh();
}

const taskFields = z.enum(["title", "everyDays", "equipmentId", "staffCanDo", "vendor", "howTo", "active", "lastDoneOn"]);

export async function setTaskField(id: string, field: z.infer<typeof taskFields>, raw: string): R {
  const s = await requireUser("MANAGER");
  taskFields.parse(field);
  const v = raw.trim();
  switch (field) {
    case "title":
      if (!v) return { error: "Can't be empty" };
      await db.upkeepTask.update({ where: { id }, data: { title: v.slice(0, 120) } });
      break;
    case "everyDays": {
      const d = parseEvery(v);
      if (!d) return { error: "Like “14”, “2 weeks”, “3 months” or “yearly”" };
      await db.upkeepTask.update({ where: { id }, data: { everyDays: d } });
      break;
    }
    case "equipmentId":
      await db.upkeepTask.update({ where: { id }, data: { equipmentId: v || null } });
      break;
    case "staffCanDo":
    case "active":
      await db.upkeepTask.update({ where: { id }, data: { [field]: v === "yes" } });
      break;
    case "lastDoneOn": {
      // Setting it by hand logs it, so the history and the clock agree.
      if (!v) return { error: "Pick the date it was last done" };
      const d = isoDate.safeParse(v);
      if (!d.success || v > businessToday()) return { error: "Pick a date up to today" };
      await markTaskDone(id, v, { userId: s.userId, userName: s.name }, { note: "Last done date entered by hand" });
      break;
    }
    default:
      await db.upkeepTask.update({ where: { id }, data: { [field]: v ? v.slice(0, 400) : null } });
  }
  refresh();
}

export async function taskDone(id: string, input: { date?: string; cost?: string; vendor?: string; note?: string } = {}): R {
  const s = await requireUser("MANAGER");
  const date = input.date || businessToday();
  if (!isoDate.safeParse(date).success || date > businessToday()) return { error: "Pick a date up to today" };
  const cost = money(input.cost ?? "");
  if (cost === "bad") return { error: "Cost should be a dollar amount" };
  const t = await markTaskDone(id, date, { userId: s.userId, userName: s.name }, { cost, vendor: input.vendor?.trim() || null, note: input.note?.trim().slice(0, 500) || null });
  if (!t) return { error: "That job was removed. Reload the page." };
  refresh();
}

export async function deleteTask(id: string): R {
  await requireUser("MANAGER");
  await db.upkeepTask.delete({ where: { id } }).catch(() => null);
  refresh();
}

// ---- Equipment ---------------------------------------------------------------------------

export async function addEquipment(name: string): R {
  await requireUser("MANAGER");
  const n = name.trim().slice(0, 80);
  if (!n) return { error: "Name it" };
  const area = /keg|tap|draft|glycol|ice|bar/i.test(n) ? "Bar" : /brew|tank|fermenter|mash|kettle/i.test(n) ? "Brewhouse" : /hvac|roof|boiler|water|alarm|extinguisher/i.test(n) ? "Building" : "Kitchen";
  await db.equipment.create({ data: { name: n, area } });
  refresh();
}

const equipFields = z.enum(["name", "area", "make", "model", "serial", "vendor", "vendorPhone", "installedOn", "warrantyUntil", "notes", "active"]);

export async function setEquipmentField(id: string, field: z.infer<typeof equipFields>, raw: string): R {
  await requireUser("MANAGER");
  equipFields.parse(field);
  const v = raw.trim();
  if (field === "name" || field === "area") {
    if (!v) return { error: "Can't be empty" };
    await db.equipment.update({ where: { id }, data: { [field]: v.slice(0, 80) } });
  } else if (field === "installedOn" || field === "warrantyUntil") {
    if (v && !isoDate.safeParse(v).success) return { error: "Pick a date" };
    await db.equipment.update({ where: { id }, data: { [field]: v ? parseISODate(v) : null } });
  } else if (field === "active") {
    await db.equipment.update({ where: { id }, data: { active: v === "yes" } });
  } else {
    await db.equipment.update({ where: { id }, data: { [field]: v ? v.slice(0, 400) : null } });
  }
  refresh();
}

export async function deleteEquipment(id: string): R {
  await requireUser("MANAGER");
  await db.equipment.delete({ where: { id } }).catch(() => null);
  refresh();
}

// ---- Repairs and the log ------------------------------------------------------------------

const repair = z.object({
  equipmentId: z.string().optional(),
  title: z.string().trim().min(1, "Say what happened").max(160),
  date: isoDate,
  kind: z.enum(["repair", "service", "note"]),
  cost: z.string().optional(),
  vendor: z.string().max(120).optional(),
  down: z.boolean().optional(),
  note: z.string().max(1000).optional(),
});

export async function logRepair(input: z.input<typeof repair>): R {
  const s = await requireUser("MANAGER");
  const p = repair.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  const d = p.data;
  if (d.date > businessToday()) return { error: "Pick a date up to today" };
  const cost = money(d.cost ?? "");
  if (cost === "bad") return { error: "Cost should be a dollar amount" };
  await db.upkeepLog.create({
    data: { date: parseISODate(d.date), kind: d.kind, equipmentId: d.equipmentId || null, title: d.title, cost, vendor: d.vendor?.trim() || null, down: d.kind === "repair" && !!d.down, note: d.note?.trim() || null, userId: s.userId, userName: s.name },
  });
  refresh();
}

export async function markFixed(logId: string): R {
  await requireUser("MANAGER");
  await db.upkeepLog.update({ where: { id: logId }, data: { fixedOn: parseISODate(businessToday()) } });
  refresh();
}

export async function setLogCost(logId: string, raw: string): R {
  await requireUser("MANAGER");
  const cost = money(raw);
  if (cost === "bad") return { error: "A dollar amount" };
  await db.upkeepLog.update({ where: { id: logId }, data: { cost } });
  refresh();
}

export async function deleteLog(logId: string): R {
  await requireUser("MANAGER");
  const l = await db.upkeepLog.findUnique({ where: { id: logId }, select: { taskId: true, kind: true } });
  if (!l) return;
  await db.upkeepLog.delete({ where: { id: logId } });
  if (l.taskId && l.kind === "done") await recomputeLastDone(l.taskId);
  refresh();
}
