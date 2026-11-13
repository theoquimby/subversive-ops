"use server";

import { addDays } from "@/domain/dates";
import { parseWindows } from "@/domain/timecards";
import { hashPin, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { syncLabor } from "@/server/services/labor";
import { friendlySquareError } from "@/server/integrations/square-http";
import { businessToday } from "@/server/services/sales";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = Promise<{ error?: string } | void>;

const numberOrNull = (raw: string) => {
  const s = raw.replace(/[$,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

const yes = (raw: string) => ["yes", "true", "1", "y"].includes(raw.trim().toLowerCase());

function refresh() {
  revalidatePath("/team");
  revalidatePath("/labor");
  revalidatePath("/pnl");
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// ---- Positions -----------------------------------------------------------------

const positionFields = z.enum(["name", "area", "defaultRate", "tipPoints", "tipEligible", "salesPerHour", "minStaff", "maxStaff"]);

export async function setPositionField(id: string, field: z.infer<typeof positionFields>, raw: string): R {
  await requireUser("MANAGER");
  positionFields.parse(field);
  const value = raw.trim();
  let data: Prisma.PositionUpdateInput;
  if (field === "name") {
    if (!value) return { error: "Can't be empty" };
    data = { name: value };
  } else if (field === "area") {
    if (!["FOH", "BOH", "BAR"].includes(value)) return { error: "FOH, BOH or BAR" };
    data = { area: value };
  } else if (field === "tipEligible") {
    data = { tipEligible: yes(value) };
  } else if (field === "minStaff" || field === "maxStaff") {
    const n = numberOrNull(value);
    if (n == null || Number.isNaN(n) || n < 0 || n > 20 || !Number.isInteger(n)) return { error: "Whole number 0–20" };
    const p = await db.position.findUniqueOrThrow({ where: { id } });
    if (field === "minStaff" && n > p.maxStaff) return { error: `Min can't be over max (${p.maxStaff})` };
    if (field === "maxStaff" && n < p.minStaff) return { error: `Max can't be under min (${p.minStaff})` };
    data = { [field]: n };
  } else {
    const n = numberOrNull(value);
    if (Number.isNaN(n) || (n != null && n < 0)) return { error: "Enter a number" };
    if (field === "tipPoints") {
      if (n == null) return { error: "Enter points (0 = none)" };
      data = { tipPoints: new Prisma.Decimal(n) };
    } else {
      data = { [field]: n == null || (field === "salesPerHour" && n === 0) ? null : new Prisma.Decimal(n.toFixed(2)) };
    }
  }
  try {
    await db.position.update({ where: { id }, data });
  } catch (e) {
    if (isUnique(e)) return { error: "That name is taken" };
    throw e;
  }
  refresh();
}

export async function addPosition(name: string): R {
  await requireUser("MANAGER");
  const n = name.trim();
  if (!n) return { error: "Type a name" };
  try {
    const sort = await db.position.count();
    await db.position.create({ data: { name: n, sort } });
  } catch (e) {
    if (isUnique(e)) return { error: `"${n}" already exists` };
    throw e;
  }
  refresh();
}

export async function deletePosition(id: string): R {
  await requireUser("MANAGER");
  const [shifts, cards] = await Promise.all([db.shift.count({ where: { positionId: id } }), db.timecard.count({ where: { positionId: id } })]);
  if (shifts || cards) return { error: `Used on ${shifts} shift${shifts === 1 ? "" : "s"} and ${cards} timecard${cards === 1 ? "" : "s"} — rename it instead.` };
  await db.position.delete({ where: { id } });
  refresh();
}

// ---- Employees -----------------------------------------------------------------

const employeeFields = z.enum(["name", "hourlyRate", "isMinor", "maxHoursWeek", "active", "userId", "email", "phone"]);

export async function setEmployeeField(id: string, field: z.infer<typeof employeeFields>, raw: string): R {
  await requireUser("MANAGER");
  employeeFields.parse(field);
  const value = raw.trim();
  let data: Prisma.EmployeeUncheckedUpdateInput;
  if (field === "name") {
    if (!value) return { error: "Can't be empty" };
    data = { name: value };
  } else if (field === "email" || field === "phone") {
    data = { [field]: value || null };
  } else if (field === "isMinor" || field === "active") {
    data = { [field]: yes(value) };
  } else if (field === "userId") {
    if (value) {
      const other = await db.employee.findFirst({ where: { userId: value, id: { not: id } }, select: { name: true } });
      if (other) return { error: `That login belongs to ${other.name}` };
    }
    data = { userId: value || null };
  } else if (field === "maxHoursWeek") {
    const n = numberOrNull(value);
    if (Number.isNaN(n) || (n != null && (n <= 0 || n > 80))) return { error: "Hours 1–80, or blank" };
    data = { maxHoursWeek: n == null ? null : Math.round(n) };
  } else {
    const n = numberOrNull(value);
    if (Number.isNaN(n) || (n != null && n < 0)) return { error: "Enter a rate" };
    data = { hourlyRate: n == null ? null : new Prisma.Decimal(n.toFixed(2)) };
  }
  await db.employee.update({ where: { id }, data });
  refresh();
}

export async function addEmployee(name: string): R {
  await requireUser("MANAGER");
  const n = name.trim();
  if (!n) return { error: "Type a name" };
  await db.employee.create({ data: { name: n } });
  refresh();
}

export async function addEmployeePosition(employeeId: string, positionId: string): R {
  await requireUser("MANAGER");
  if (!positionId) return;
  await db.employeePosition.upsert({ where: { employeeId_positionId: { employeeId, positionId } }, create: { employeeId, positionId }, update: {} });
  refresh();
}

export async function removeEmployeePosition(employeeId: string, positionId: string): R {
  await requireUser("MANAGER");
  await db.employeePosition.deleteMany({ where: { employeeId, positionId } });
  refresh();
}

/** One weekday's availability as typed ("4p-10p, 11-2"); blank = unavailable that day. */
export async function setAvailabilityDay(employeeId: string, weekday: number, raw: string): R {
  await requireUser("MANAGER");
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: "Bad day" };
  const parsed = parseWindows(raw);
  if ("error" in parsed) return parsed;
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { availability: true } });
  const current = (e.availability ?? {}) as Record<string, [string, string][]>;
  const next = { ...current };
  if (parsed.length) next[String(weekday)] = parsed;
  else delete next[String(weekday)];
  await db.employee.update({ where: { id: employeeId }, data: { availability: next } });
  refresh();
}

/** Start availability from "every day, any time" so the manager only blanks out what's not. */
export async function resetAvailability(employeeId: string, mode: "clear" | "all"): R {
  await requireUser("MANAGER");
  const all = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [["00:00", "24:00"]]]));
  await db.employee.update({ where: { id: employeeId }, data: { availability: mode === "all" ? all : Prisma.JsonNull } });
  refresh();
}

// ---- Square ----------------------------------------------------------------------

export async function syncTeamFromSquare(): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  try {
    const today = businessToday();
    const r = await syncLabor(addDays(today, -14), addDays(today, 1));
    if ("skipped" in r) return { error: r.skipped };
    refresh();
    return { message: `Synced ${r.members} team members and ${r.timecards} timecards${r.positionsCreated ? `, added ${r.positionsCreated} positions` : ""}${r.keptEdited ? `; kept ${r.keptEdited} edited` : ""}.` };
  } catch (e) {
    return { error: friendlySquareError(e) };
  }
}

// ---- Announcements ----------------------------------------------------------------

export async function postAnnouncement(body: string): Promise<{ error?: string }> {
  const me = await requireUser("MANAGER");
  const text = body.trim();
  if (!text) return { error: "Write something first." };
  if (text.length > 1000) return { error: "Keep it under 1,000 characters." };
  await db.announcement.create({ data: { body: text, author: me.name } });
  revalidatePath("/team");
  revalidatePath("/schedule");
  revalidatePath("/my");
  return {};
}

export async function pinAnnouncement(id: string, pinned: boolean): R {
  await requireUser("MANAGER");
  await db.announcement.updateMany({ where: { id }, data: { pinned } });
  revalidatePath("/team");
  revalidatePath("/schedule");
  revalidatePath("/my");
}

export async function deleteAnnouncement(id: string): R {
  await requireUser("MANAGER");
  await db.announcement.deleteMany({ where: { id } });
  revalidatePath("/team");
  revalidatePath("/schedule");
  revalidatePath("/my");
}

// ---- Invite ----------------------------------------------------------------------

/**
 * One step from the team grid: create a staff login with a PIN and link it to
 * the employee. Returns the PIN to hand over (it's only shown once).
 */
export async function inviteEmployee(employeeId: string, loginName: string, pin?: string): Promise<{ error?: string; name?: string; pin?: string }> {
  await requireUser("MANAGER");
  const name = loginName.trim();
  if (!name || name.length > 40) return { error: "Pick a login name." };
  const code = pin?.trim() || String(Math.floor(1000 + Math.random() * 9000));
  if (!/^\d{4,8}$/.test(code)) return { error: "PINs are 4–8 digits." };
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
  if (!emp) return { error: "That person was removed." };
  if (emp.userId) return { error: "They already have a login." };
  const taken = await db.user.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (taken) return { error: `"${name}" is taken. Try their full name.` };
  try {
    await db.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { name, role: "STAFF", pinHash: await hashPin(code) } });
      await tx.employee.update({ where: { id: employeeId }, data: { userId: u.id } });
    });
  } catch (e) {
    if (isUnique(e)) return { error: `"${name}" is taken. Try their full name.` };
    throw e;
  }
  refresh();
  revalidatePath("/settings");
  return { name, pin: code };
}
