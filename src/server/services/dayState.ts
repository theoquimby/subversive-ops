import "server-only";
import { cache } from "react";
import { dayState, syncedThroughDate, type DayState, type DayStateContext } from "@/domain/dayState";
import { parseISODate, toISODate, weekday, type ISODate } from "@/domain/dates";
import { hoursOn } from "@/domain/openingHours";
import { db } from "../db";
import { env } from "../env";
import { getRegularHours, getSeasonalHours } from "./labor-rules";
import { businessToday, lastSquareSync } from "./sales";

/**
 * What a page needs to tell a closed day from one whose sales aren't in yet:
 * the last full Square sync, the opening hours in force, and the closures on
 * the calendar between `from` and today. Once per render.
 */
export const dayStateContext = cache(async (from: ISODate): Promise<DayStateContext> => {
  const today = businessToday();
  const [lastSync, regular, seasons, closures] = await Promise.all([
    lastSquareSync(),
    getRegularHours(),
    getSeasonalHours(),
    db.event.findMany({ where: { kind: "CLOSURE", date: { gte: parseISODate(from <= today ? from : today), lte: parseISODate(today) } }, select: { date: true } }),
  ]);
  return {
    today,
    syncedThrough: syncedThroughDate(today, lastSync, env.BUSINESS_TIMEZONE),
    isOpenDay: (date) => hoursOn(date, regular, seasons)[weekday(date)] != null,
    closures: new Set(closures.map((c) => toISODate(c.date))),
  };
});

/** A state for each day, from the days' own sales. */
export async function dayStates<T extends { date: ISODate; sales: number }>(days: readonly T[]): Promise<Map<ISODate, DayState>> {
  if (!days.length) return new Map();
  const from = days.reduce((m, d) => (d.date < m ? d.date : m), days[0].date);
  const ctx = await dayStateContext(from);
  return new Map(days.map((d) => [d.date, dayState(d, ctx)]));
}
