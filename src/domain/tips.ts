/**
 * Tip pooling: turn worked hours into pool shares, split the pool, and export.
 */

import { allocateTips, TipShare } from "./labor";

export type TipMethod = "HOURS" | "POINTS";

export interface WorkedHours {
  employeeId: string;
  positionId: string | null;
  hours: number;
}

export interface TipPosition {
  id: string;
  tipPoints: number;
  tipEligible: boolean;
}

/**
 * One share per employee + position, for tip-eligible positions only.
 * Hours with no position use `fallbackPosition(employeeId)` (their main role).
 */
export function tipShares(worked: WorkedHours[], positions: TipPosition[], fallbackPosition: (employeeId: string) => string | null = () => null): (TipShare & { positionId: string })[] {
  const pos = new Map(positions.map((p) => [p.id, p]));
  const acc = new Map<string, TipShare & { positionId: string }>();
  for (const w of worked) {
    const pid = w.positionId ?? fallbackPosition(w.employeeId);
    const p = pid ? pos.get(pid) : undefined;
    if (!p || !p.tipEligible || w.hours <= 0) continue;
    const key = `${w.employeeId}|${p.id}`;
    const cur = acc.get(key) ?? { employeeId: w.employeeId, positionId: p.id, hours: 0, points: p.tipPoints };
    cur.hours += w.hours;
    acc.set(key, cur);
  }
  return [...acc.values()].map((s) => ({ ...s, hours: Math.round(s.hours * 100) / 100 }));
}

export interface EmployeeTip {
  employeeId: string;
  hours: number;
  /** hours × points (POINTS) or hours (HOURS) */
  weightedPoints: number;
  amount: number;
}

/** Split `total` and roll shares up to one line per employee. Cents always add up to the total. */
export function splitPool(total: number, shares: TipShare[], method: TipMethod): EmployeeTip[] {
  const lines = allocateTips(Math.max(0, total), shares, method);
  const by = new Map<string, EmployeeTip>();
  for (const l of lines) {
    const cur = by.get(l.employeeId) ?? { employeeId: l.employeeId, hours: 0, weightedPoints: 0, amount: 0 };
    cur.hours += l.hours;
    cur.weightedPoints += l.weightedPoints;
    cur.amount = Math.round((cur.amount + l.amount) * 100) / 100;
    by.set(l.employeeId, cur);
  }
  return [...by.values()];
}

/** Effective tip rate per hour worked. */
export const perHour = (t: { amount: number; hours: number }) => (t.hours > 0 ? t.amount / t.hours : 0);

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function tipsCsv(rows: { name: string; hours: number; points: number; amount: number; card?: number; cash?: number }[], meta: { start: string; end: string; method: TipMethod; total: number }): string {
  // Periods with tips from Square also say how much of each person's total is card (payroll) and cash.
  const split = rows.some((r) => r.card != null || r.cash != null);
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0).toFixed(2);
  const lines = [
    ["Employee", "Hours", meta.method === "POINTS" ? "Weighted points" : "Share basis (hours)", "Tips", ...(split ? ["Card tips", "Cash tips"] : []), "Period start", "Period end"].map(csvCell).join(","),
    ...rows.map((r) => [r.name, r.hours.toFixed(2), r.points.toFixed(2), r.amount.toFixed(2), ...(split ? [(r.card ?? 0).toFixed(2), (r.cash ?? 0).toFixed(2)] : []), meta.start, meta.end].map(csvCell).join(",")),
    ["Total", sum((r) => r.hours), "", meta.total.toFixed(2), ...(split ? [sum((r) => r.card ?? 0), sum((r) => r.cash ?? 0)] : []), "", ""].map(csvCell).join(","),
  ];
  return lines.join("\n") + "\n";
}
