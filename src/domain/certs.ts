/**
 * Training & certifications: who needs which certificate, whether what they
 * hold is still good, and how the team is doing overall. Pure functions —
 * the services load rows and hand plain data in.
 *
 * Dates are business dates (YYYY-MM-DD). A certificate is good up to and
 * including its expiry date; the day after, it's expired.
 */

import { addDays, daysBetween, ISODate } from "./dates";

export type CertStatus = "valid" | "expiring" | "expired" | "missing" | "not-required";

/** Days before expiry that a certificate counts as "expiring". */
export const EXPIRING_DAYS = 30;

export interface CertTypeLike {
  id: string;
  name: string;
  validityMonths: number | null;
  /** Position ids that must hold it. */
  appliesTo: string[];
  requiredForAll: boolean;
  requiredForMinors: boolean;
  isAnnualTraining?: boolean;
  active: boolean;
}

export interface PersonLike {
  id: string;
  positionIds: string[];
  isMinor: boolean;
}

export interface CertLike {
  id: string;
  employeeId: string;
  certTypeId: string;
  issuedOn: ISODate;
  /** Null = never expires. */
  expiresOn: ISODate | null;
  verified: boolean;
}

// ---- Expiry ---------------------------------------------------------------------

/** Add calendar months, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: ISODate, months: number): ISODate {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + months;
  const d = Number(date.slice(8, 10));
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** When a certificate issued on `issuedOn` expires: the override if given, else issued + validity, else never (null). */
export function expiryFor(issuedOn: ISODate, validityMonths: number | null | undefined, override?: ISODate | null): ISODate | null {
  if (override) return override;
  if (validityMonths == null || validityMonths <= 0) return null;
  return addMonths(issuedOn, validityMonths);
}

// ---- Requirements ---------------------------------------------------------------

export type RequirementReason = "everyone" | "minor" | "position";

/** Why a person needs this type, or null when they don't. */
export function requirementReason(type: CertTypeLike, person: Pick<PersonLike, "positionIds" | "isMinor">): RequirementReason | null {
  if (!type.active) return null;
  if (type.requiredForAll) return "everyone";
  if (type.requiredForMinors && person.isMinor) return "minor";
  if (type.appliesTo.some((p) => person.positionIds.includes(p))) return "position";
  return null;
}

export const isRequired = (type: CertTypeLike, person: Pick<PersonLike, "positionIds" | "isMinor">) => requirementReason(type, person) != null;

/** The types a person must hold, given their positions and minor flag. */
export function requiredFor<T extends CertTypeLike>(types: T[], person: Pick<PersonLike, "positionIds" | "isMinor">): T[] {
  return types.filter((t) => isRequired(t, person));
}

/**
 * Types needed to work a shift in a position: the position's own certificates,
 * plus working papers for a minor. Everyone-type training (harassment prevention)
 * doesn't stop someone working a shift, so it isn't checked here.
 */
export function requiredForShift<T extends CertTypeLike>(types: T[], positionId: string, isMinor: boolean): T[] {
  return types.filter((t) => t.active && (t.appliesTo.includes(positionId) || (t.requiredForMinors && isMinor)));
}

// ---- Status ---------------------------------------------------------------------

/** The certificate that counts: the one that runs longest (never-expiring wins), latest issue as tiebreak. */
export function currentCert<C extends Pick<CertLike, "issuedOn" | "expiresOn">>(certs: C[]): C | null {
  let best: C | null = null;
  for (const c of certs) {
    if (!best) { best = c; continue; }
    const a = c.expiresOn ?? "9999-12-31";
    const b = best.expiresOn ?? "9999-12-31";
    if (a > b || (a === b && c.issuedOn > best.issuedOn)) best = c;
  }
  return best;
}

export interface CellStatus<C = CertLike> {
  status: CertStatus;
  required: boolean;
  cert: C | null;
  expiresOn: ISODate | null;
  /** Days from today to expiry (negative once expired); null when it never expires or there's no certificate. */
  daysLeft: number | null;
}

/** Status of one person × one type, from all their certificates of that type. */
export function certStatus<C extends CertLike>(certs: C[], required: boolean, today: ISODate, warnDays = EXPIRING_DAYS): CellStatus<C> {
  // Certificates dated in the future (a class booked next week) don't count yet.
  const cert = currentCert(certs.filter((c) => c.issuedOn <= today));
  if (!cert) return { status: required ? "missing" : "not-required", required, cert: null, expiresOn: null, daysLeft: null };
  if (cert.expiresOn == null) return { status: "valid", required, cert, expiresOn: null, daysLeft: null };
  const daysLeft = daysBetween(today, cert.expiresOn);
  const status: CertStatus = daysLeft < 0 ? "expired" : daysLeft <= warnDays ? "expiring" : "valid";
  return { status, required, cert, expiresOn: cert.expiresOn, daysLeft };
}

/** True when some certificate covers `date` (issued on or before, expiring on or after). */
export function validOn(certs: Pick<CertLike, "issuedOn" | "expiresOn">[], date: ISODate): boolean {
  return certs.some((c) => c.issuedOn <= date && (c.expiresOn == null || c.expiresOn >= date));
}

export interface MatrixRow<C extends CertLike = CertLike> {
  employeeId: string;
  cells: Record<string, CellStatus<C>>;
}

/** Status for every person × every type. */
export function buildMatrix<C extends CertLike>(people: PersonLike[], types: CertTypeLike[], certs: C[], today: ISODate, warnDays = EXPIRING_DAYS): MatrixRow<C>[] {
  const by = new Map<string, C[]>();
  for (const c of certs) {
    const k = `${c.employeeId}|${c.certTypeId}`;
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  return people.map((p) => ({
    employeeId: p.id,
    cells: Object.fromEntries(types.map((t) => [t.id, certStatus(by.get(`${p.id}|${t.id}`) ?? [], isRequired(t, p), today, warnDays)])),
  }));
}

export interface ComplianceSummary {
  /** Required person × type pairs. */
  required: number;
  /** Required pairs covered today (valid or expiring). */
  ok: number;
  expiring: number;
  expired: number;
  missing: number;
  /** ok / required, or null when nothing is required. */
  pct: number | null;
}

/** Roll up statuses. Only required cells count; optional certificates never hurt the score. */
export function compliance(cells: Pick<CellStatus<unknown>, "status" | "required">[]): ComplianceSummary {
  const out: ComplianceSummary = { required: 0, ok: 0, expiring: 0, expired: 0, missing: 0, pct: null };
  for (const c of cells) {
    if (!c.required) continue;
    out.required++;
    if (c.status === "valid" || c.status === "expiring") out.ok++;
    if (c.status === "expiring") out.expiring++;
    if (c.status === "expired") out.expired++;
    if (c.status === "missing") out.missing++;
  }
  out.pct = out.required ? out.ok / out.required : null;
  return out;
}

/** A person is compliant when every required certificate is in date. */
export const personCompliant = (cells: Pick<CellStatus<unknown>, "status" | "required">[]) => cells.every((c) => !c.required || c.status === "valid" || c.status === "expiring");

/** The soonest expiry among certificates still in date, or null. */
export function nextExpiry(cells: Pick<CellStatus<unknown>, "status" | "expiresOn">[]): ISODate | null {
  let best: ISODate | null = null;
  for (const c of cells) if ((c.status === "valid" || c.status === "expiring") && c.expiresOn && (!best || c.expiresOn < best)) best = c.expiresOn;
  return best;
}

/** The worst status in a list, for a one-chip summary: expired > missing > expiring > valid. */
export function worstStatus(cells: Pick<CellStatus<unknown>, "status" | "required">[]): CertStatus {
  const req = cells.filter((c) => c.required);
  for (const s of ["expired", "missing", "expiring"] as const) if (req.some((c) => c.status === s)) return s;
  return req.length ? "valid" : "not-required";
}

// ---- Reminders ------------------------------------------------------------------

export type ReminderStage = "30" | "7" | "expired";

/**
 * Which reminder a certificate is due for today: 30 days out, 7 days out, or
 * expired. Returns the most urgent stage reached, so a missed run still sends
 * one message (not every stage at once).
 */
export function reminderStage(expiresOn: ISODate | null, today: ISODate): ReminderStage | null {
  if (!expiresOn) return null;
  const d = daysBetween(today, expiresOn);
  if (d < 0) return "expired";
  if (d <= 7) return "7";
  if (d <= 30) return "30";
  return null;
}

/** Key for "this reminder was sent" bookkeeping. */
export const reminderKey = (certId: string, stage: ReminderStage) => `${certId}:${stage}`;

/** Drop sent-keys for certificates no longer around, keeping the list bounded. */
export function pruneReminderKeys(keys: string[], liveCertIds: Set<string>): string[] {
  return keys.filter((k) => liveCertIds.has(k.split(":")[0]));
}

/** Expired reminders only go out for a while after expiry, so an old lapse doesn't nag forever. */
export const EXPIRED_REMINDER_WINDOW = 14;
export const withinExpiredWindow = (expiresOn: ISODate, today: ISODate) => expiresOn >= addDays(today, -EXPIRED_REMINDER_WINDOW);

// ---- Checklists -----------------------------------------------------------------

export type AssignmentState = "signed-off" | "ready" | "overdue" | "in-progress" | "not-started";

/** Where a checklist stands: all ticked and signed off, all ticked (waiting on a manager), overdue, started or not. */
export function assignmentState(a: { dueOn: ISODate | null; signedOffAt: unknown | null }, done: number, total: number, today: ISODate): AssignmentState {
  if (a.signedOffAt) return "signed-off";
  if (total > 0 && done >= total) return "ready";
  if (a.dueOn && a.dueOn < today) return "overdue";
  return done > 0 ? "in-progress" : "not-started";
}

/** Fraction of steps done (0..1); an empty checklist counts as done. */
export const progress = (done: number, total: number) => (total ? Math.min(1, done / total) : 1);

// ---- Presets --------------------------------------------------------------------

export interface CertPreset {
  name: string;
  description: string;
  issuer: string;
  validityMonths: number | null;
  /** Positions it applies to by default, matched on position name or area. */
  positions: { names?: RegExp; areas?: string[] };
  requiredForAll?: boolean;
  requiredForMinors?: boolean;
  isAnnualTraining?: boolean;
  /** Off by default: shown in the matrix but nobody is required to hold it. */
  optional?: boolean;
}

/** New York starting points. Max should confirm each one; all of it is editable. */
export const NY_CERT_PRESETS: CertPreset[] = [
  {
    name: "ATAP",
    description: "NY State Liquor Authority Alcohol Training Awareness Program. Helps the bar's defense if a sale to a minor or visibly intoxicated guest happens.",
    issuer: "NY State Liquor Authority (approved provider)",
    validityMonths: 36,
    positions: { names: /bar|server/i, areas: ["BAR"] },
  },
  {
    name: "ServSafe Food Handler",
    description: "Basic food safety for anyone handling food.",
    issuer: "ServSafe (National Restaurant Association)",
    validityMonths: 36,
    positions: { areas: ["BOH"], names: /cook|kitchen|prep|line/i },
  },
  {
    name: "ServSafe Food Protection Manager",
    description: "Manager-level food safety certification. Optional here; some counties ask for one certified person per shift.",
    issuer: "ServSafe (National Restaurant Association)",
    validityMonths: 60,
    positions: {},
    optional: true,
  },
  {
    name: "Allergen awareness",
    description: "Recognising the major allergens and avoiding cross-contact.",
    issuer: "ServSafe Allergens or in-house",
    validityMonths: 36,
    positions: { areas: ["BOH"], names: /cook|kitchen|prep|line|server|expo/i },
  },
  {
    name: "First aid / CPR",
    description: "Optional. Good to have at least one person on each shift.",
    issuer: "American Red Cross / AHA",
    validityMonths: 24,
    positions: {},
    optional: true,
  },
  {
    name: "Sexual harassment prevention",
    description: "Interactive training every employee must complete every year (NY Labor Law §201-g).",
    issuer: "NY State model training or equivalent",
    validityMonths: 12,
    positions: {},
    requiredForAll: true,
    isAnnualTraining: true,
  },
  {
    name: "Working papers (minors)",
    description: "NY employment certificate for workers under 18, issued by their school. Keep a copy on file.",
    issuer: "School district (NY State Education Dept.)",
    validityMonths: null,
    positions: {},
    requiredForMinors: true,
  },
];

/** Position ids a preset applies to, from the business's own positions. */
export function presetPositions(preset: CertPreset, positions: { id: string; name: string; area: string }[]): string[] {
  if (preset.optional) return [];
  const { names, areas } = preset.positions;
  return positions.filter((p) => (names && names.test(p.name)) || (areas && areas.includes(p.area))).map((p) => p.id);
}
