/**
 * Tanks and Upkeep: a tank's Upkeep record is the Equipment row linked to it
 * (Equipment.tankId). An open repair on that equipment that marks it down
 * (down, not fixed yet) makes the tank unavailable: the Brewery shows it on the
 * floor and the schedule. Read-only here; the repair is logged and fixed on
 * Upkeep. Pure.
 */

import type { ISODate } from "./dates";

/** Upkeep's area for brewery tanks. */
export const TANK_AREA = "Brewhouse";

export interface TankEquipmentIn {
  tankId: string | null;
  equipmentId: string;
  active: boolean;
  logs: { kind: string; down: boolean; fixedOn: ISODate | null; date: ISODate; title: string }[];
}

export interface TankDown {
  tankId: string;
  equipmentId: string;
  /** The earliest open repair that marked it down. */
  since: ISODate;
  title: string;
}

/** Tanks whose linked equipment has an open repair marking it down, by tank id. */
export function downTanks(rows: readonly TankEquipmentIn[]): Map<string, TankDown> {
  const out = new Map<string, TankDown>();
  for (const r of rows) {
    if (!r.tankId || !r.active) continue;
    const open = r.logs.filter((l) => l.kind === "repair" && l.down && !l.fixedOn).sort((a, b) => a.date.localeCompare(b.date));
    if (open.length) out.set(r.tankId, { tankId: r.tankId, equipmentId: r.equipmentId, since: open[0].date, title: open[0].title });
  }
  return out;
}

/** The Upkeep page, scrolled to one piece of equipment. */
export const equipmentHref = (equipmentId: string) => `/upkeep#equipment-${equipmentId}`;
