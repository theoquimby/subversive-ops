/**
 * Versioned New York wage rules, so the minimum wage and the tipped cash wage
 * switch on their effective date (January 1) without anyone editing Settings.
 *
 * Region: "upstate" = New York State outside New York City, Long Island and
 * Westchester (Catskill, Greene County). Tipped = food service workers' cash
 * wage under the hospitality wage order (minimum wage minus the tip credit).
 *
 * Status:
 *   - "enacted": in statute / published by NY DOL.
 *   - "estimated": from 2027 the rate is indexed to inflation and published by
 *     NY DOL each autumn; until it's confirmed here, the value is our estimate.
 *
 * This is a convenience, not legal advice. The operator must verify every
 * figure against the NY Department of Labor before relying on it.
 */

import type { ISODate } from "./dates";

export type WageStatus = "enacted" | "estimated";

export interface WageRuleVersion {
  /** First business date the rates apply. */
  effective: ISODate;
  minimumWage: number;
  tippedMinimumWage: number;
  status: WageStatus;
  note: string;
}

/** Upstate NY. Keep sorted by effective date. Add a row when NY DOL publishes the next rate. */
export const NY_UPSTATE_WAGES: readonly WageRuleVersion[] = [
  { effective: "2024-01-01", minimumWage: 15.0, tippedMinimumWage: 10.0, status: "enacted", note: "NY Labor Law §652 (2023 budget)." },
  { effective: "2025-01-01", minimumWage: 15.5, tippedMinimumWage: 10.35, status: "enacted", note: "NY Labor Law §652 (2023 budget)." },
  { effective: "2026-01-01", minimumWage: 16.0, tippedMinimumWage: 10.7, status: "enacted", note: "NY Labor Law §652 (2023 budget)." },
  {
    effective: "2027-01-01",
    minimumWage: 16.5,
    tippedMinimumWage: 11.0,
    status: "estimated",
    note: "From 2027 the rate is indexed to inflation (CPI-W) and published by NY DOL each autumn. This figure is an estimate — replace it with the published rate.",
  },
];

export interface WageLookup {
  current: WageRuleVersion | null;
  /** The next scheduled change after `date`, if any. */
  next: WageRuleVersion | null;
}

/** The rate in force on `date` and the next one coming. */
export function wageRulesOn(date: ISODate, table: readonly WageRuleVersion[] = NY_UPSTATE_WAGES): WageLookup {
  const sorted = [...table].sort((a, b) => a.effective.localeCompare(b.effective));
  let current: WageRuleVersion | null = null;
  let next: WageRuleVersion | null = null;
  for (const v of sorted) {
    if (v.effective <= date) current = v;
    else if (!next) next = v;
  }
  return { current, next };
}

/** Rules with the minimum and tipped wage taken from the table for `date` (unchanged if the table has nothing yet). */
export function applyWageTable<R extends { minimumWage: number; tippedMinimumWage: number }>(rules: R, date: ISODate, table: readonly WageRuleVersion[] = NY_UPSTATE_WAGES): R {
  const { current } = wageRulesOn(date, table);
  return current ? { ...rules, minimumWage: current.minimumWage, tippedMinimumWage: current.tippedMinimumWage } : rules;
}

/** Review is due when it has never happened, is over a year old, or predates the latest rate change. */
export function reviewDue(lastReviewed: ISODate | null, today: ISODate, table: readonly WageRuleVersion[] = NY_UPSTATE_WAGES): { due: boolean; reason: string | null } {
  if (!lastReviewed) return { due: true, reason: "Labor rules haven't been reviewed yet." };
  const { current } = wageRulesOn(today, table);
  if (current && lastReviewed < current.effective) return { due: true, reason: `Rates changed on ${current.effective}, after the last review.` };
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  if (lastReviewed < yearAgo) return { due: true, reason: "Last review was over a year ago." };
  return { due: false, reason: null };
}
