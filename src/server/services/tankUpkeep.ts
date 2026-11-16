import "server-only";
import { toISODate } from "@/domain/dates";
import { downTanks, TANK_AREA, type TankDown } from "@/domain/tankUpkeep";
import { db } from "../db";

/**
 * Tanks and Upkeep, linked: each tank can have one Equipment row
 * (Equipment.tankId) for its service and repairs. The Brewery reads whether a
 * tank is down for repair from here (read-only); it never writes Upkeep.
 */

/** Each tank's Upkeep record, by tank id: its equipment id and whether it's down for repair. */
export async function tankUpkeepLinks(): Promise<Map<string, { equipmentId: string; down: TankDown | null }>> {
  const [rows, down] = await Promise.all([db.equipment.findMany({ where: { tankId: { not: null } }, select: { id: true, tankId: true } }), tanksDown()]);
  return new Map(rows.map((r) => [r.tankId!, { equipmentId: r.id, down: down.get(r.tankId!) ?? null }]));
}

/**
 * Tanks unavailable because an open repair on their equipment marked it down,
 * by tank id. For the Brewery floor and schedule to show (or to keep plans off).
 */
export async function tanksDown(): Promise<Map<string, TankDown>> {
  const rows = await db.equipment.findMany({
    where: { tankId: { not: null }, logs: { some: { kind: "repair", down: true, fixedOn: null } } },
    select: { id: true, tankId: true, active: true, logs: { where: { kind: "repair", down: true, fixedOn: null }, select: { kind: true, down: true, fixedOn: true, date: true, title: true } } },
  });
  return downTanks(rows.map((r) => ({ tankId: r.tankId, equipmentId: r.id, active: r.active, logs: r.logs.map((l) => ({ kind: l.kind, down: l.down, fixedOn: l.fixedOn ? toISODate(l.fixedOn) : null, date: toISODate(l.date), title: l.title })) })));
}

/** A tank's Upkeep record: the one linked to it, made the first time (named after the tank, in the Brewhouse). */
export async function openTankUpkeep(tankId: string): Promise<{ equipmentId: string } | { error: string }> {
  const tank = await db.tank.findUnique({ where: { id: tankId }, select: { id: true, name: true, equipment: { select: { id: true } } } });
  if (!tank) return { error: "That tank no longer exists. Reload the page." };
  if (tank.equipment) return { equipmentId: tank.equipment.id };
  try {
    const e = await db.equipment.create({ data: { name: tank.name, area: TANK_AREA, tankId: tank.id }, select: { id: true } });
    return { equipmentId: e.id };
  } catch {
    // Opened twice at once: the other one made it.
    const e = await db.equipment.findUnique({ where: { tankId }, select: { id: true } });
    return e ? { equipmentId: e.id } : { error: "Couldn't open its Upkeep record. Try again." };
  }
}
