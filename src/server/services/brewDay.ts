import "server-only";
import type { GravityUnit } from "@/domain/gravity";
import { db } from "../db";

/**
 * Minimal stand-in: the brew-day work owns this file and replaces it at
 * merge. Only `gravityUnit()` is here, for the floor's transfer and
 * packaging forms.
 */

const GRAVITY_UNIT_KEY = "brewery.gravityUnit";

/** The brewery's gravity unit (°Plato unless set to SG). */
export async function gravityUnit(): Promise<GravityUnit> {
  const row = await db.setting.findUnique({ where: { key: GRAVITY_UNIT_KEY } });
  return row?.value === "sg" ? "sg" : "plato";
}
