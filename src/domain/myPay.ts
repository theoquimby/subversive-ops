/**
 * A staff member's own "this pay period so far": hours from their timecards
 * plus what's still scheduled, and tips — actual where a tip pool is
 * finalized, otherwise an estimate from their recent tips per hour. Always
 * labelled an estimate: payroll is what counts.
 */

export interface MyPayInput {
  /** Hours on timecards so far this period (open cards count up to now). */
  workedHours: number;
  /** Published shifts still ahead this period. */
  scheduledHours: number;
  /** Tips from finalized pools in this period. */
  finalizedTips: number;
  /** Hours those finalized pools covered (so they aren't estimated again). */
  finalizedHours: number;
  /** Their tips per hour over recent finalized pools; null when there's no history. */
  recentRate: number | null;
  /** Their positions earn tips at all. */
  tipped: boolean;
}

export interface MyPay {
  workedHours: number;
  scheduledHours: number;
  /** worked + scheduled. */
  projectedHours: number;
  tips: { finalized: number; estimate: number; total: number; basis: "finalized" | "estimate" | "mixed" | "none" };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function myPay(i: MyPayInput): MyPay {
  const projectedHours = r2(i.workedHours + i.scheduledHours);
  if (!i.tipped) return { workedHours: r2(i.workedHours), scheduledHours: r2(i.scheduledHours), projectedHours, tips: { finalized: 0, estimate: 0, total: 0, basis: "none" } };
  const unpooled = Math.max(0, i.workedHours - i.finalizedHours);
  const estimate = i.recentRate != null ? r2(unpooled * i.recentRate) : 0;
  const basis = i.finalizedTips > 0 && estimate > 0 ? "mixed" : i.finalizedTips > 0 ? "finalized" : estimate > 0 ? "estimate" : "none";
  return { workedHours: r2(i.workedHours), scheduledHours: r2(i.scheduledHours), projectedHours, tips: { finalized: r2(i.finalizedTips), estimate, total: r2(i.finalizedTips + estimate), basis } };
}

/** Tips per hour from someone's recent finalized allocations (null with under 4 hours of history). */
export function recentTipRate(allocations: { amount: number; hours: number }[]): number | null {
  const hours = allocations.reduce((a, x) => a + x.hours, 0);
  if (hours < 4) return null;
  return allocations.reduce((a, x) => a + x.amount, 0) / hours;
}

/** A card left open more than this long is a forgotten clock-out, not a 20-hour shift. */
export const STALE_OPEN_HOURS = 16;

/** Paid hours of one card for the staff estimate: open cards count up to now, unless they're stale (then 0 until a manager fixes them). */
export function cardHours(c: { clockIn: Date; clockOut: Date | null; breakMinutes: number }, now: Date): { hours: number; stale: boolean } {
  if (!c.clockOut) {
    const open = (now.getTime() - c.clockIn.getTime()) / 3_600_000;
    if (open > STALE_OPEN_HOURS) return { hours: 0, stale: true };
    return { hours: Math.max(0, open), stale: false };
  }
  return { hours: Math.max(0, (c.clockOut.getTime() - c.clockIn.getTime()) / 3_600_000 - c.breakMinutes / 60), stale: false };
}
