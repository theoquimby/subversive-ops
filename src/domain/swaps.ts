/**
 * Shift swaps & pickups: who may take a shift, whether a claim can be approved
 * automatically, and the plain-English history. Pure — the server loads the
 * week and calls these. Compliance reuses checkCompliance (NY rules, overtime,
 * minors, certificates) and availabilityConflicts (time off, availability), so
 * a swap is held to exactly the rules the schedule board uses.
 */

import type { ISODate } from "./dates";
import { checkCompliance, type LaborRules, type ShiftLike } from "./labor";
import { availabilityConflicts, type Availability } from "./schedule";

export type SwapKind = "GIVE" | "SWAP" | "DROP" | "PICKUP";

export const SWAP_KIND_LABEL: Record<SwapKind, string> = {
  GIVE: "Give away",
  SWAP: "Trade",
  DROP: "Drop",
  PICKUP: "Pick up",
};

export interface SwapShift {
  id: string;
  positionId: string;
  date: ISODate;
  startMin: number;
  endMin: number;
  breakMinutes: number;
}

export interface SwapCandidate {
  id: string;
  name: string;
  positionIds: string[];
  isMinor: boolean;
  maxHoursWeek: number | null;
  availability?: Availability;
  timeOff: Set<ISODate>;
  /** Their pay rate for the shift's position (minimum-wage check). */
  rate: number | null;
  /** Certificates the shift's position needs that they don't hold in date that day. */
  missingCerts: string[];
  /** Their other shifts the same workweek (the one they'd give back in a trade left out). */
  weekShifts: SwapShift[];
}

export interface Eligibility {
  eligible: boolean;
  /** Why they can't take it (shown to the manager, and to staff as "can't take this"). */
  reasons: string[];
  /** Things to know that don't stop it (outside availability, a clopen). */
  warnings: string[];
  hoursBefore: number;
  hoursAfter: number;
}

/** Rules that are about the shift itself, not who works it — the same for anyone, so they never decide eligibility. */
const SHIFT_ONLY = new Set(["times", "call-in", "long-shift", "meal-break"]);
/** Rules that stop someone taking a shift; everything else is a warning. */
const DISQUALIFY = new Set(["overlap", "time-off", "minor-hours", "minor-late", "overtime", "max-hours", "uncertified"]);

const paid = (s: { startMin: number; endMin: number; breakMinutes: number }) => Math.max(0, (s.endMin - s.startMin - s.breakMinutes) / 60);

/**
 * Can `c` take `shift`? Runs the same compliance checks as the schedule on their
 * week with and without the shift and keeps only what the shift adds.
 */
export function swapEligibility(
  shift: SwapShift,
  c: SwapCandidate,
  rules: LaborRules,
  opts: { instant: (date: ISODate, minutes: number) => Date; localHour: (d: Date) => number; tipped?: boolean },
): Eligibility {
  const hoursBefore = c.weekShifts.reduce((a, s) => a + paid(s), 0);
  const hoursAfter = hoursBefore + paid(shift);
  if (!c.positionIds.includes(shift.positionId)) {
    return { eligible: false, reasons: ["Not set up for this position"], warnings: [], hoursBefore, hoursAfter };
  }
  const toLike = (s: SwapShift): ShiftLike => ({
    id: s.id,
    employeeId: c.id,
    start: opts.instant(s.date, s.startMin),
    end: opts.instant(s.date, s.endMin),
    breakMinutes: s.breakMinutes,
    rate: s.id === shift.id ? c.rate : null,
    tipped: opts.tipped ?? false,
    day: s.date,
    missingCerts: s.id === shift.id ? c.missingCerts : [],
  });
  const emp = [{ id: c.id, name: c.name, isMinor: c.isMinor, maxHoursWeek: c.maxHoursWeek }];
  const others = c.weekShifts.filter((s) => s.id !== shift.id);
  const without = checkCompliance(others.map(toLike), emp, rules, opts.localHour);
  const withIt = checkCompliance([...others, shift].map(toLike), emp, rules, opts.localHour);
  const people = new Map([[c.id, { name: c.name, availability: c.availability, timeOff: c.timeOff }]]);
  const avail = availabilityConflicts([{ ...shift, employeeId: c.id }], people);

  const added = [...withIt, ...avail].filter((v) => {
    if (SHIFT_ONLY.has(v.rule)) return false;
    if (v.shiftId === shift.id) return true;
    // Hours rules land on the week's last shift: any extra hours over the line count against taking it.
    if (v.rule === "overtime" || v.rule === "max-hours") return true;
    // Other rules about a neighbouring shift (a clopen, an overlap) count only if this shift caused them.
    return !without.some((w) => w.rule === v.rule && w.shiftId === v.shiftId);
  });
  const reasons: string[] = [];
  const warnings: string[] = [];
  for (const v of added) {
    const text = plain(v.rule, v.message, hoursAfter);
    const list = v.level === "block" || DISQUALIFY.has(v.rule) ? reasons : warnings;
    if (!list.includes(text)) list.push(text);
  }
  return { eligible: reasons.length === 0, reasons, warnings, hoursBefore, hoursAfter };
}

/** Short, person-neutral wording ("Would go into overtime (42h)") — the list already says who. */
function plain(rule: string, message: string, hoursAfter: number): string {
  switch (rule) {
    case "overlap":
      return "Already working then";
    case "time-off":
      return "On approved time off";
    case "overtime":
      return `Would go into overtime (${Number(hoursAfter.toFixed(1))}h that week)`;
    case "max-hours":
      return `Over their weekly max (${Number(hoursAfter.toFixed(1))}h)`;
    case "minor-hours":
      return "Over the daily limit for a minor";
    case "minor-late":
      return "Too late a finish for a minor";
    case "uncertified":
      return message.replace(/^.*? has no valid /, "No valid ").replace(/ on this day$/, "");
    case "availability":
      return "Outside the times they said they can work";
    case "rest":
      return "Short turnaround from their last shift";
    case "min-wage":
      return "Their rate is under minimum wage";
    default:
      return message;
  }
}

// ---- Auto-approve -----------------------------------------------------------------

export interface SwapRules {
  /** off: a manager approves every swap. eligible: approve straight away when the taker passes every check. clean: …and has no warnings either. */
  autoApprove: "off" | "eligible" | "clean";
  /** Never auto-approve inside this many hours of the shift starting. */
  minNoticeHours: number;
  /** Open shifts: first eligible person to tap gets it (true) or a manager approves pickups (false). */
  openShiftsInstant: boolean;
  /** Let staff drop a shift (a manager always approves a drop). */
  allowDrop: boolean;
}

export const DEFAULT_SWAP_RULES: SwapRules = { autoApprove: "off", minNoticeHours: 24, openShiftsInstant: true, allowDrop: true };

export function parseSwapRules(raw: string | null | undefined): SwapRules {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<SwapRules>) : {};
    return {
      autoApprove: v.autoApprove === "eligible" || v.autoApprove === "clean" ? v.autoApprove : "off",
      minNoticeHours: Number.isFinite(v.minNoticeHours) && v.minNoticeHours! >= 0 && v.minNoticeHours! <= 336 ? Math.round(v.minNoticeHours!) : DEFAULT_SWAP_RULES.minNoticeHours,
      openShiftsInstant: typeof v.openShiftsInstant === "boolean" ? v.openShiftsInstant : DEFAULT_SWAP_RULES.openShiftsInstant,
      allowDrop: typeof v.allowDrop === "boolean" ? v.allowDrop : DEFAULT_SWAP_RULES.allowDrop,
    };
  } catch {
    return { ...DEFAULT_SWAP_RULES };
  }
}

/**
 * Should a claim go through without a manager? Drops always need one (someone
 * has to cover). For a trade both people must pass.
 */
export function autoApproveDecision(
  rules: SwapRules,
  kind: SwapKind,
  checks: Eligibility[],
  hoursUntilStart: number,
): { auto: boolean; why: string } {
  if (kind === "DROP") return { auto: false, why: "A manager approves every drop." };
  if (kind === "PICKUP") {
    if (!rules.openShiftsInstant) return { auto: false, why: "A manager approves open-shift pickups." };
    return checks.every((c) => c.eligible) ? { auto: true, why: "Open shifts go to the first person who can take them." } : { auto: false, why: "Not eligible." };
  }
  if (rules.autoApprove === "off") return { auto: false, why: "A manager approves every swap." };
  if (hoursUntilStart < rules.minNoticeHours) return { auto: false, why: `Under ${rules.minNoticeHours}h before the shift — a manager approves it.` };
  if (!checks.every((c) => c.eligible)) return { auto: false, why: "Doesn't pass the checks." };
  if (rules.autoApprove === "clean" && checks.some((c) => c.warnings.length > 0)) return { auto: false, why: "Has warnings — a manager approves it." };
  return { auto: true, why: "Passed every check, so it was approved automatically." };
}

// ---- History ----------------------------------------------------------------------

export interface SwapLogEntry {
  at: string;
  by: string;
  what: string;
}

export function parseSwapLog(raw: unknown): SwapLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is SwapLogEntry => !!e && typeof e === "object" && typeof (e as SwapLogEntry).at === "string" && typeof (e as SwapLogEntry).what === "string").map((e) => ({ at: e.at, by: String(e.by ?? ""), what: e.what }));
}

export const appendLog = (raw: unknown, by: string, what: string, at = new Date()): SwapLogEntry[] => [...parseSwapLog(raw), { at: at.toISOString(), by, what }];

export type SwapStage = "open" | "asked" | "claimed" | "approved" | "denied" | "cancelled";

/** Where a swap is: posted with nobody yet, asked of one person, claimed and waiting on a manager, or decided. */
export function swapStage(s: { status: string; takerId: string | null; claimedAt: Date | string | null }): SwapStage {
  if (s.status === "APPROVED") return "approved";
  if (s.status === "DENIED") return "denied";
  if (s.status === "CANCELLED") return "cancelled";
  if (!s.takerId) return "open";
  return s.claimedAt ? "claimed" : "asked";
}

/** Prisma filter for swaps a manager has to decide: claimed (incl. pickups) or a drop. Open offers aren't theirs yet. */
export const NEEDS_MANAGER = { status: "PENDING" as const, OR: [{ claimedAt: { not: null } }, { kind: "DROP" }] };

export const STAGE_LABEL: Record<SwapStage, string> = {
  open: "Up for grabs",
  asked: "Waiting on them",
  claimed: "Waiting on a manager",
  approved: "Approved",
  denied: "Not approved",
  cancelled: "Withdrawn",
};
