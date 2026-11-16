import "server-only";
import { addDays, ISODate, parseISODate, toISODate } from "@/domain/dates";
import { rankTasks, spendSince, UPKEEP_PRESETS, warrantyState, type DueState } from "@/domain/upkeep";
import { db, num } from "../db";
import { businessToday } from "./sales";

/**
 * Upkeep: equipment, the jobs that come round every N days and the repair
 * log. Feeds /upkeep, the jobs staff can tick on /checklists, and overdue
 * jobs and open repairs on the Overview and in the brief.
 */

const SEEDED_KEY = "upkeep.seeded";
const iso = (d: Date | null) => (d ? toISODate(d) : null);

/** First visit: the usual taproom + kitchen equipment and jobs, once. */
export async function ensureUpkeepPresets() {
  const seeded = await db.setting.findUnique({ where: { key: SEEDED_KEY } });
  if (seeded) return;
  await db.setting.upsert({ where: { key: SEEDED_KEY }, create: { key: SEEDED_KEY, value: new Date().toISOString() }, update: {} });
  if ((await db.equipment.count()) > 0) return;
  let sort = 0;
  for (const e of UPKEEP_PRESETS) {
    await db.equipment.create({
      data: {
        name: e.name,
        area: e.area,
        tasks: { create: e.tasks.map((t) => ({ title: t.title, everyDays: t.everyDays, staffCanDo: !!t.staffCanDo, howTo: t.howTo ?? null, sort: sort++ })) },
      },
    });
  }
}

export async function upkeepBoard(today: ISODate = businessToday()) {
  const yearAgo = addDays(today, -365);
  const [equipment, tasks, logs] = await Promise.all([
    db.equipment.findMany({ orderBy: [{ area: "asc" }, { name: "asc" }] }),
    db.upkeepTask.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }], include: { equipment: { select: { name: true } } } }),
    db.upkeepLog.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 400, include: { equipment: { select: { name: true } } } }),
  ]);
  const ranked = rankTasks(
    tasks.map((t) => ({ id: t.id, title: t.title, everyDays: t.everyDays, lastDoneOn: iso(t.lastDoneOn), active: t.active, staffCanDo: t.staffCanDo, vendor: t.vendor, howTo: t.howTo, equipmentId: t.equipmentId, equipment: t.equipment?.name ?? null })),
    today,
  );
  const logViews = logs.map((l) => ({
    id: l.id,
    date: toISODate(l.date),
    kind: l.kind,
    title: l.title,
    taskId: l.taskId,
    equipmentId: l.equipmentId,
    equipment: l.equipment?.name ?? null,
    cost: num(l.cost),
    vendor: l.vendor,
    down: l.down,
    fixedOn: iso(l.fixedOn),
    note: l.note,
    userName: l.userName,
  }));
  const spend = spendSince(logViews, yearAgo);
  const lastBy = new Map<string, string>();
  for (const l of logViews) if (l.equipmentId && !lastBy.has(l.equipmentId)) lastBy.set(l.equipmentId, l.date);
  const equipmentViews = equipment.map((e) => ({
    id: e.id,
    name: e.name,
    area: e.area,
    make: e.make,
    model: e.model,
    serial: e.serial,
    vendor: e.vendor,
    vendorPhone: e.vendorPhone,
    installedOn: iso(e.installedOn),
    warrantyUntil: iso(e.warrantyUntil),
    warranty: warrantyState(today, iso(e.warrantyUntil)),
    notes: e.notes,
    active: e.active,
    spend12: spend.byEquipment.get(e.id) ?? 0,
    lastLog: lastBy.get(e.id) ?? null,
    tasks: ranked.filter((t) => t.equipmentId === e.id).length,
    down: logViews.some((l) => l.equipmentId === e.id && l.kind === "repair" && l.down && !l.fixedOn),
  }));
  const count = (s: DueState) => ranked.filter((t) => t.state === s).length;
  return {
    today,
    tasks: ranked,
    inactiveTasks: tasks.filter((t) => !t.active).map((t) => ({ id: t.id, title: t.title, equipment: t.equipment?.name ?? null })),
    equipment: equipmentViews,
    logs: logViews,
    openRepairs: logViews.filter((l) => l.kind === "repair" && l.down && !l.fixedOn),
    summary: { overdue: count("overdue"), dueToday: count("today"), soon: count("soon"), unknown: count("unknown"), spend12: spend.total },
  };
}
export type UpkeepBoard = Awaited<ReturnType<typeof upkeepBoard>>;
export type UpkeepTaskView = UpkeepBoard["tasks"][number];
export type EquipmentView = UpkeepBoard["equipment"][number];
export type UpkeepLogView = UpkeepBoard["logs"][number];

/** Jobs staff can do that are due today or overdue — shown under the checklists. */
export async function staffJobsDue(today: ISODate = businessToday()) {
  const tasks = await db.upkeepTask.findMany({ where: { active: true, staffCanDo: true }, include: { equipment: { select: { name: true } } } });
  return rankTasks(
    tasks.map((t) => ({ id: t.id, title: t.title, everyDays: t.everyDays, lastDoneOn: iso(t.lastDoneOn), active: t.active, howTo: t.howTo, equipment: t.equipment?.name ?? null })),
    today,
  ).filter((t) => t.state === "overdue" || t.state === "today");
}

/** For the Overview / brief: overdue jobs and equipment down for repair. */
export async function upkeepNeedsYou(today: ISODate = businessToday()) {
  const [tasks, down] = await Promise.all([
    db.upkeepTask.findMany({ where: { active: true, lastDoneOn: { not: null } }, select: { id: true, title: true, everyDays: true, lastDoneOn: true, active: true } }),
    db.upkeepLog.findMany({ where: { kind: "repair", down: true, fixedOn: null }, select: { title: true, date: true, equipment: { select: { name: true } } }, orderBy: { date: "asc" } }),
  ]);
  const overdue = rankTasks(tasks.map((t) => ({ ...t, lastDoneOn: iso(t.lastDoneOn) })), today).filter((t) => t.state === "overdue");
  return { overdue, down: down.map((d) => ({ title: d.title, equipment: d.equipment?.name ?? null, since: toISODate(d.date) })) };
}

/** Log a recurring job as done and move its clock on (only ever forward). */
export async function markTaskDone(taskId: string, date: ISODate, by: { userId?: string | null; userName: string }, extra: { cost?: number | null; vendor?: string | null; note?: string | null } = {}) {
  const t = await db.upkeepTask.findUnique({ where: { id: taskId } });
  if (!t) return null;
  const when = parseISODate(date);
  await db.$transaction([
    db.upkeepLog.create({ data: { date: when, kind: "done", taskId, equipmentId: t.equipmentId, title: t.title, cost: extra.cost ?? null, vendor: extra.vendor ?? t.vendor ?? null, note: extra.note ?? null, userId: by.userId ?? null, userName: by.userName } }),
    ...(!t.lastDoneOn || t.lastDoneOn < when ? [db.upkeepTask.update({ where: { id: taskId }, data: { lastDoneOn: when } })] : []),
  ]);
  return t;
}

/** After a "done" log is removed, the job's last-done date falls back to the latest one left. */
export async function recomputeLastDone(taskId: string) {
  const last = await db.upkeepLog.findFirst({ where: { taskId, kind: "done" }, orderBy: { date: "desc" }, select: { date: true } });
  await db.upkeepTask.update({ where: { id: taskId }, data: { lastDoneOn: last?.date ?? null } });
}
