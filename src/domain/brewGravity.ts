/**
 * A brew's gravity has one source: its readings (kept in BrewBatch.extra), with
 * the brew-day log as a fallback. OG and FG on the brew are a cache written
 * from them. Pure.
 *
 * - OG: the first reading marked OG, else the brew-day log's OG.
 * - FG: the latest reading marked FG or taken on or after packaging (a reading
 *   marked FG wins a same-day tie), else the brew-day log's FG.
 */

import type { ISODate } from "./dates";

export interface Reading {
  on: ISODate;
  sg: number;
  kind: "og" | "fg" | "reading";
  note: string | null;
}

const close = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && Math.abs(a - b) < 0.0005;
const byDay = (a: Reading, b: Reading) => a.on.localeCompare(b.on);

export function gravityFromReadings(readings: readonly Reading[], o: { logOg?: number | null; logFg?: number | null; packagedOn?: ISODate | null }): { og: number | null; fg: number | null } {
  const ogs = readings.filter((r) => r.kind === "og").sort(byDay);
  const og = ogs[0]?.sg ?? o.logOg ?? null;
  const fgs = readings
    .filter((r) => r.kind === "fg" || (o.packagedOn != null && r.on >= o.packagedOn))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => byDay(a.r, b.r) || (a.r.kind === "fg" ? 1 : 0) - (b.r.kind === "fg" ? 1 : 0) || a.i - b.i);
  const fg = fgs.length ? fgs[fgs.length - 1].r.sg : o.logFg ?? null;
  return { og, fg };
}

/**
 * Older brews (and imports) have an OG or FG with no reading behind it. Keep it
 * as a reading before anything is worked out again, so nothing is lost: only
 * when no reading of that kind exists and readings or the log don't already
 * give it. An FG that some reading already holds (a reading after packaging)
 * isn't copied, so moving the packaging day can still change the FG.
 */
export function adoptCachedGravity(
  readings: readonly Reading[],
  cache: { og: number | null; fg: number | null; logOg?: number | null; logFg?: number | null; packagedOn?: ISODate | null },
  dates: { ogOn: ISODate; fgOn: ISODate },
): Reading[] {
  const now = gravityFromReadings(readings, cache);
  const out = [...readings];
  if (cache.og != null && !readings.some((r) => r.kind === "og") && !close(now.og, cache.og)) out.push({ on: dates.ogOn, sg: cache.og, kind: "og", note: "OG typed before readings were kept" });
  if (cache.fg != null && !readings.some((r) => r.kind === "fg" || close(r.sg, cache.fg)) && !close(now.fg, cache.fg)) out.push({ on: dates.fgOn, sg: cache.fg, kind: "fg", note: "FG typed before readings were kept" });
  return out.sort(byDay);
}

/** OG or FG typed on the brew: one reading of that kind in place of any there were (none when cleared). */
export function typedGravity(readings: readonly Reading[], kind: "og" | "fg", sg: number | null, on: ISODate): Reading[] {
  const out = readings.filter((r) => r.kind !== kind);
  if (sg != null) out.push({ on, sg, kind, note: "Typed" });
  return out.sort(byDay);
}

/** The day a typed OG or FG goes on: OG on its first OG reading or the brew day; FG after every other reading and packaging. */
export function typedGravityDate(readings: readonly Reading[], kind: "og" | "fg", d: { brewedOn: ISODate | null; plannedOn: ISODate | null; packagedOn: ISODate | null; today: ISODate }): ISODate {
  if (kind === "og") return readings.filter((r) => r.kind === "og").sort(byDay)[0]?.on ?? d.brewedOn ?? d.plannedOn ?? d.today;
  const days = [...readings.map((r) => r.on), d.packagedOn].filter((x): x is ISODate => !!x).sort();
  return days[days.length - 1] ?? d.today;
}

/** The list without one reading (the first that is the same day, gravity and kind). */
export function removeReading(readings: readonly Reading[], target: Reading): Reading[] {
  const i = readings.findIndex((r) => r.on === target.on && r.kind === target.kind && close(r.sg, target.sg));
  return i < 0 ? [...readings] : readings.filter((_, j) => j !== i);
}
