import "server-only";
import { Prisma } from "@prisma/client";
import { finishDefaults, readBrewLog } from "@/domain/brewDay";
import { adoptCachedGravity, gravityFromReadings, type Reading } from "@/domain/brewGravity";
import type { ISODate } from "@/domain/dates";
import { db, num } from "../db";
import { iso, readExtra } from "./brewery";

/**
 * A brew's OG and FG are a cache of its readings (and the brew-day log when
 * there's no reading). Every write that touches readings goes through
 * `gravityPatch`, so the two can't drift apart: deleting a reading moves OG/FG,
 * typing OG/FG makes a reading. See domain/brewGravity for the rules.
 */

export interface GravityBrew {
  extra: unknown;
  og: Prisma.Decimal | number | null;
  fg: Prisma.Decimal | number | null;
  brewLog: unknown;
  brewedOn: Date | null;
  plannedOn: Date | null;
  packagedOn: Date | null;
  createdAt: Date;
}

/** The brew-day log's OG (boil, else knock-out) and FG (packaging), if it has them. */
export function logGravity(brewLog: unknown): { logOg: number | null; logFg: number | null } {
  const log = readBrewLog(brewLog);
  if (!log) return { logOg: null, logFg: null };
  const fg = log.values.package?.fgSg;
  return { logOg: finishDefaults(log, { bbl: null }).og, logFg: typeof fg === "number" ? fg : null };
}

/**
 * Readings to save and the OG/FG worked out from them. Older OG/FG with no
 * reading behind them are kept as readings first; `change` then edits the
 * list. `packagedOn` overrides the brew's (when packaging now).
 */
export function gravityPatch(b: GravityBrew, change?: (readings: Reading[]) => Reading[], over: { packagedOn?: ISODate | null } = {}): { og: number | null; fg: number | null; readings: Reading[] } {
  const { readings } = readExtra(b.extra);
  const lg = logGravity(b.brewLog);
  const packagedOn = over.packagedOn !== undefined ? over.packagedOn : iso(b.packagedOn);
  const made = iso(b.createdAt)!;
  const kept = adoptCachedGravity(readings as Reading[], { og: num(b.og), fg: num(b.fg), ...lg, packagedOn: iso(b.packagedOn) }, {
    ogOn: iso(b.brewedOn) ?? iso(b.plannedOn) ?? made,
    fgOn: iso(b.packagedOn) ?? iso(b.brewedOn) ?? iso(b.plannedOn) ?? made,
  });
  const next = change ? change(kept) : kept;
  const g = gravityFromReadings(next, { ...lg, packagedOn });
  return { ...g, readings: next };
}

/** The brew's extra with these readings. */
export const extraWithReadings = (extra: unknown, readings: Reading[]): Prisma.InputJsonObject =>
  ({ ...((extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {}) as Record<string, unknown>), readings: readings as unknown as Prisma.InputJsonArray }) as Prisma.InputJsonObject;

const gravitySelect = { extra: true, og: true, fg: true, brewLog: true, brewedOn: true, plannedOn: true, packagedOn: true, createdAt: true } as const;

/** Work OG/FG out again from the readings and the log (after the log, packaging day or brew day changed). */
export async function syncGravity(batchId: string, tx: Prisma.TransactionClient | typeof db = db): Promise<void> {
  const b = await tx.brewBatch.findUnique({ where: { id: batchId }, select: gravitySelect });
  if (!b) return;
  const g = gravityPatch(b);
  const same = (a: number | null, c: Prisma.Decimal | null) => (a == null ? c == null : c != null && Math.abs(c.toNumber() - a) < 0.00005);
  const before = readExtra(b.extra).readings.length;
  if (same(g.og, b.og) && same(g.fg, b.fg) && before === g.readings.length) return;
  await tx.brewBatch.update({ where: { id: batchId }, data: { og: g.og, fg: g.fg, extra: extraWithReadings(b.extra, g.readings) } });
}
