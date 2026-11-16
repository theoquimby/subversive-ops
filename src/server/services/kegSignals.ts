import "server-only";
import { cache } from "react";
import type { AttentionItem } from "@/domain/attention";
import type { ISODate } from "@/domain/dates";
import { cycles, fleetStats, notSeenLately, outTooLong, weeklyFleet, type FleetStats } from "@/domain/kegFleet";
import { fleetLoad, kegAttentionItems, kegLook, kegSignalFindings, kegWeek, loadWeeks, scanGap, signalWeek, type FleetLoad, type KegLook, type KegWeek, type ScanGap } from "@/domain/kegSignals";
import type { LabFinding } from "@/domain/lab";
import { db } from "../db";
import { fleetData, fleetNeedsLook } from "./kegFleet";
import { kegConfig } from "./kegs";
import { businessToday } from "./sales";

/**
 * The keg fleet for the places that sum up the business: the Overview's
 * "Needs you" and the morning brief (kegNeedsYou), the weekly brief and the
 * Insights keg tile (kegSignals), and the Insights feed (kegFleetFindings).
 * The counting is in domain/kegFleet and domain/kegSignals.
 */

/**
 * Kegs out too long and kegs not seen lately, as "Needs you" items. Reads one
 * row per keg, not the whole history. Empty with no kegs.
 */
export async function kegNeedsYou(today: ISODate = businessToday()): Promise<AttentionItem[]> {
  return kegAttentionItems(today, kegLook(await fleetNeedsLook()));
}

export interface KegSignals {
  today: ISODate;
  /** The first day of keg history. */
  first: ISODate;
  look: KegLook;
  /** The week the weekly brief looks back on. */
  week: KegWeek;
  gap: ScanGap;
  load: FleetLoad | null;
  stats: FleetStats;
}

/**
 * Everything above from one read of the keg history; null until there is any.
 * Read at most once per server render (the Insights page asks for it from the
 * feed and from the keg tile).
 */
export const kegSignals = cache(async (): Promise<KegSignals | null> => {
  const [{ events, kegs, today, first }, cfg] = await Promise.all([fleetData(), kegConfig()]);
  if (!first) return null;
  const cs = cycles(events, kegs);
  return {
    today,
    first,
    look: kegLook({ out: outTooLong(kegs, events, today, cfg.overdueDays), idle: notSeenLately(kegs, events, today, cfg.idleDays), overdueDays: cfg.overdueDays, idleDays: cfg.idleDays }),
    week: kegWeek(events, cs, signalWeek(today)),
    gap: scanGap(cs, today),
    load: fleetLoad(weeklyFleet(events, kegs, loadWeeks(today))),
    stats: fleetStats(cs, kegs, today),
  };
});

let findingsCache: { at: number; key: string; items: LabFinding[] } | null = null;

/**
 * The scan gap and fleet slack or strain for the Insights feed. Worked out
 * again when a keg is scanned or the day changes, else at most every 10
 * minutes. Never throws (the feed must not fail on kegs).
 */
export async function kegFleetFindings(): Promise<LabFinding[]> {
  try {
    const last = await db.kegEvent.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!last) return [];
    const key = `${last.id}|${businessToday()}`;
    if (findingsCache && findingsCache.key === key && Date.now() - findingsCache.at < 600_000) return findingsCache.items;
    const s = await kegSignals();
    const items = s ? kegSignalFindings(s.gap, s.load) : [];
    findingsCache = { at: Date.now(), key, items };
    return items;
  } catch (e) {
    console.error("keg fleet findings skipped", (e as Error).message);
    return [];
  }
}
