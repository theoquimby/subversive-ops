/**
 * Merging a Square team member into an Ops employee without undoing edits made in Ops.
 *
 * Rules:
 * - New people are created from Square as-is.
 * - For people we already have, Square only fills blanks (name, email, phone, pay rate).
 *   When both sides have a value and they differ, Ops wins and the difference is reported.
 * - Deactivating in Square deactivates here. Someone deactivated in Ops is never
 *   reactivated by Square; someone the sync itself deactivated is reactivated when Square
 *   has them active again.
 */

export type TeamField = "name" | "email" | "phone" | "hourlyRate";

export interface TeamDiff {
  field: TeamField;
  /** Position name for a per-position rate; omitted for the base rate. */
  position?: string;
  ops: string;
  square: string;
}

export interface OpsEmployee {
  name: string;
  email: string | null;
  phone: string | null;
  hourlyRate: number | null;
  active: boolean;
}

export interface SquareMember {
  name: string;
  email: string | null;
  phone: string | null;
  hourlyRate: number | null;
  active: boolean;
}

export interface TeamMerge {
  /** Fields to write. */
  data: Partial<OpsEmployee>;
  diffs: TeamDiff[];
  /** True when this sync deactivated them (so a later Square reactivation may undo it). */
  deactivatedBySync: boolean;
  /** True when this sync reactivated someone it had deactivated. */
  reactivated: boolean;
}

const blank = (v: string | null | undefined) => v == null || v.trim() === "";
const norm = (v: string) => v.trim().toLowerCase();
const phoneDigits = (v: string) => v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const sameRate = (a: number, b: number) => Math.abs(a - b) < 0.005;
export const rateText = (n: number) => `$${n.toFixed(2)}`;

/**
 * What to change on an existing employee (or everything, when `ops` is null),
 * plus where Square disagrees with what's been set here.
 * `syncDeactivated` = this employee was last deactivated by the sync, not by a manager.
 */
export function mergeTeamMember(ops: OpsEmployee | null, sq: SquareMember, syncDeactivated: boolean): TeamMerge {
  if (!ops) return { data: { ...sq }, diffs: [], deactivatedBySync: false, reactivated: false };
  const data: Partial<OpsEmployee> = {};
  const diffs: TeamDiff[] = [];

  if (blank(ops.name) && !blank(sq.name)) data.name = sq.name;
  else if (!blank(sq.name) && norm(ops.name) !== norm(sq.name)) diffs.push({ field: "name", ops: ops.name, square: sq.name });

  if (blank(ops.email) && !blank(sq.email)) data.email = sq.email;
  else if (!blank(ops.email) && !blank(sq.email) && norm(ops.email!) !== norm(sq.email!)) diffs.push({ field: "email", ops: ops.email!, square: sq.email! });

  if (blank(ops.phone) && !blank(sq.phone)) data.phone = sq.phone;
  else if (!blank(ops.phone) && !blank(sq.phone) && phoneDigits(ops.phone!) !== phoneDigits(sq.phone!)) diffs.push({ field: "phone", ops: ops.phone!, square: sq.phone! });

  if (ops.hourlyRate == null && sq.hourlyRate != null) data.hourlyRate = sq.hourlyRate;
  else if (ops.hourlyRate != null && sq.hourlyRate != null && !sameRate(ops.hourlyRate, sq.hourlyRate)) diffs.push({ field: "hourlyRate", ops: rateText(ops.hourlyRate), square: rateText(sq.hourlyRate) });

  let deactivatedBySync = false;
  let reactivated = false;
  if (ops.active && !sq.active) {
    data.active = false;
    deactivatedBySync = true;
  } else if (!ops.active && sq.active && syncDeactivated) {
    data.active = true;
    reactivated = true;
  }
  return { data, diffs, deactivatedBySync, reactivated };
}

/** A per-position rate: fill when blank, otherwise keep ours and report a difference. */
export function mergePositionRate(ops: number | null | undefined, square: number | null, position: string): { rate?: number; diff?: TeamDiff } {
  if (square == null) return {};
  if (ops == null) return { rate: square };
  if (!sameRate(ops, square)) return { diff: { field: "hourlyRate", position, ops: rateText(ops), square: rateText(square) } };
  return {};
}

const LABEL: Record<TeamField, string> = { name: "Name", email: "Email", phone: "Phone", hourlyRate: "Rate" };

/** "Rate (Server): $16.00 here, $15.00 in Square" */
export function describeDiff(d: TeamDiff): string {
  return `${LABEL[d.field]}${d.position ? ` (${d.position})` : ""}: ${d.ops} here, ${d.square} in Square`;
}

/** Tolerant parse of the stored `{ employeeId: TeamDiff[] }` map. */
export function parseTeamDiffs(raw: string | null | undefined): Record<string, TeamDiff[]> {
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, TeamDiff[]> = {};
    for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const ok = list.filter((d): d is TeamDiff => d && typeof d === "object" && typeof d.field === "string" && typeof d.ops === "string" && typeof d.square === "string");
      if (ok.length) out[k] = ok;
    }
    return out;
  } catch {
    return {};
  }
}
