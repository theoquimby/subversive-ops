import "server-only";
import { addDays, ISODate, parseISODate, todayIn, toISODate, weekday } from "@/domain/dates";
import { requiredForShift, validOn, type CertTypeLike } from "@/domain/certs";
import { applyRuleSettings, assignShifts, Candidate, checkCompliance, curveToBlocks, defaultBreakMinutes, LaborRules, PositionRule } from "@/domain/labor";
import {
  Availability, availabilityConflicts, clipAvailability, coverage, curveHours, dayRequirement, fitSliderToTarget, HourDemand, hourlySalesOrFallback, inclusiveDates,
  intensityFromSlider, localParts, parseAvailability, ScheduledShift, ScheduleSummary, splitLongBlocks, staffVsDemand, summarizeSchedule, weekDates, weekStartOf, zonedInstant,
} from "@/domain/schedule";
import { db, num } from "../db";
import { env } from "../env";
import { hourlySalesForecast } from "./forecasting";
import { getLaborRules, getOpeningHours } from "./labor-rules";
import { localHour } from "./sales";
import { defaultLaborPct } from "./settings";

export const TZ = env.BUSINESS_TIMEZONE;
export const MIN_SHIFT_HOURS = 4;

export const instantAt = (date: ISODate, minutes: number) => zonedInstant(date, minutes, TZ);

// ---- Shared loaders ----------------------------------------------------------------

export interface PositionView {
  id: string;
  name: string;
  color: string;
  area: string;
  defaultRate: number | null;
  /** Tip-eligible: the tipped minimum wage applies. */
  tipped: boolean;
  rule: PositionRule;
}

export interface EmployeeView {
  id: string;
  name: string;
  positionIds: string[];
  rates: Record<string, number | null>;
  isMinor: boolean;
  maxHoursWeek: number | null;
  availability?: Availability;
  userId: string | null;
}

export async function loadPositions(): Promise<PositionView[]> {
  const rows = await db.position.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    area: p.area,
    defaultRate: num(p.defaultRate),
    tipped: p.tipEligible,
    rule: { id: p.id, name: p.name, salesPerHour: num(p.salesPerHour), minStaff: p.minStaff, maxStaff: p.maxStaff },
  }));
}

export async function loadEmployees(positions: PositionView[]): Promise<EmployeeView[]> {
  const rows = await db.employee.findMany({ where: { active: true }, include: { positions: true }, orderBy: { name: "asc" } });
  const pos = new Map(positions.map((p) => [p.id, p]));
  const sortIdx = new Map(positions.map((p, i) => [p.id, i]));
  return rows.map((e) => {
    const eps = [...e.positions].sort((a, b) => (sortIdx.get(a.positionId) ?? 99) - (sortIdx.get(b.positionId) ?? 99));
    return {
      id: e.id,
      name: e.name,
      positionIds: eps.map((x) => x.positionId),
      rates: Object.fromEntries(eps.map((x) => [x.positionId, num(x.rate) ?? num(e.hourlyRate) ?? pos.get(x.positionId)?.defaultRate ?? null])),
      isMinor: e.isMinor,
      maxHoursWeek: e.maxHoursWeek,
      availability: parseAvailability(e.availability),
      userId: e.userId,
    };
  });
}

export function rateFor(e: EmployeeView | undefined, positionId: string, positions: Map<string, PositionView>): number | null {
  if (!e) return positions.get(positionId)?.defaultRate ?? null;
  return e.rates[positionId] ?? Object.values(e.rates).find((r) => r != null) ?? positions.get(positionId)?.defaultRate ?? null;
}

/** Approved time-off days per employee within [from, to]. */
async function approvedTimeOff(from: ISODate, to: ISODate) {
  const rows = await db.timeOffRequest.findMany({
    where: { status: "APPROVED", startDate: { lte: parseISODate(to) }, endDate: { gte: parseISODate(from) } },
  });
  const out = new Map<string, Set<ISODate>>();
  for (const r of rows) {
    const set = out.get(r.employeeId) ?? new Set<ISODate>();
    for (const d of inclusiveDates(toISODate(r.startDate), toISODate(r.endDate))) if (d >= from && d <= to) set.add(d);
    out.set(r.employeeId, set);
  }
  return out;
}

export interface ShiftView {
  id: string;
  employeeId: string | null;
  positionId: string;
  date: ISODate;
  startMin: number;
  endMin: number;
  breakMinutes: number;
  notes: string | null;
  published: boolean;
}

function toView(s: { id: string; employeeId: string | null; positionId: string; start: Date; end: Date; breakMinutes: number; notes: string | null; published: boolean }): ShiftView {
  const a = localParts(s.start, TZ);
  return {
    id: s.id,
    employeeId: s.employeeId,
    positionId: s.positionId,
    date: a.date,
    startMin: a.minutes,
    endMin: a.minutes + Math.round((s.end.getTime() - s.start.getTime()) / 60_000),
    breakMinutes: s.breakMinutes,
    notes: s.notes,
    published: s.published,
  };
}

const weekWhere = (monday: ISODate) => ({ start: { gte: instantAt(monday, 0), lt: instantAt(addDays(monday, 7), 0) } });

interface DayForecast {
  date: ISODate;
  sales: number;
  hours: number[];
}

async function forecastDays(dates: ISODate[], opening: Record<number, [number, number]>): Promise<DayForecast[]> {
  try {
    const f = await hourlySalesForecast(dates);
    return f.map((d) => ({ date: d.date, sales: d.qty, hours: hourlySalesOrFallback(d.hours, d.qty, opening[weekday(d.date)]) }));
  } catch (e) {
    console.error("hourly forecast failed", e);
    return dates.map((date) => ({ date, sales: 0, hours: new Array(24).fill(0) }));
  }
}

function requirementFor(days: DayForecast[], positions: PositionView[], opening: Record<number, [number, number]>, intensity: number) {
  return new Map(days.map((d) => [d.date, dayRequirement(d.hours, positions.map((p) => p.rule), opening[weekday(d.date)], intensity)]));
}

const toScheduled = (s: ShiftView, emps: Map<string, EmployeeView>, pos: Map<string, PositionView>): ScheduledShift => ({
  employeeId: s.employeeId,
  positionId: s.positionId,
  date: s.date,
  startMin: s.startMin,
  endMin: s.endMin,
  breakMinutes: s.breakMinutes,
  rate: rateFor(s.employeeId ? emps.get(s.employeeId) : undefined, s.positionId, pos),
});

// ---- Week view ------------------------------------------------------------------------

export interface WeekIssue {
  shiftId: string;
  employeeId: string | null;
  level: "block" | "warn";
  rule: string;
  message: string;
}

export interface WeekData {
  monday: ISODate;
  dates: ISODate[];
  positions: PositionView[];
  employees: EmployeeView[];
  shifts: ShiftView[];
  issues: WeekIssue[];
  summary: ScheduleSummary;
  timeOff: Record<string, ISODate[]>;
  pendingTimeOff: Record<string, ISODate[]>;
  opening: Record<number, [number, number]>;
  rules: LaborRules;
  pendingRequests: number;
  /** Weekly labor % budget (Budgets page), if set. */
  laborTarget: number | null;
  /** People needed vs scheduled per hour, per date. */
  demand: Record<ISODate, HourDemand[]>;
  autoDraft: boolean;
}

/** Active certificate types and everyone's certificates (dates only), for the "uncertified" rule. */
export interface CertCoverage {
  types: (CertTypeLike & { name: string })[];
  /** employeeId|certTypeId → certificates. */
  held: Map<string, { issuedOn: ISODate; expiresOn: ISODate | null }[]>;
}

export async function loadCertCoverage(): Promise<CertCoverage> {
  const [types, certs] = await Promise.all([
    db.certType.findMany({ where: { active: true }, select: { id: true, name: true, validityMonths: true, appliesTo: true, requiredForAll: true, requiredForMinors: true, active: true } }),
    db.certification.findMany({ select: { employeeId: true, certTypeId: true, issuedOn: true, expiresOn: true } }),
  ]);
  const held = new Map<string, { issuedOn: ISODate; expiresOn: ISODate | null }[]>();
  for (const c of certs) {
    const k = `${c.employeeId}|${c.certTypeId}`;
    held.set(k, [...(held.get(k) ?? []), { issuedOn: toISODate(c.issuedOn), expiresOn: c.expiresOn ? toISODate(c.expiresOn) : null }]);
  }
  return { types, held };
}

/** Names of certificates the position needs that this person doesn't hold in date on `date`. */
export function missingCertsFor(cov: CertCoverage | undefined, employee: Pick<EmployeeView, "id" | "isMinor"> | undefined, positionId: string, date: ISODate): string[] {
  if (!cov || !employee) return [];
  return requiredForShift(cov.types, positionId, employee.isMinor).filter((t) => !validOn(cov.held.get(`${employee.id}|${t.id}`) ?? [], date)).map((t) => t.name);
}

function complianceFor(shifts: ShiftView[], employees: EmployeeView[], positions: PositionView[], rules: LaborRules, timeOff: Map<string, Set<ISODate>>, certs?: CertCoverage): WeekIssue[] {
  const emps = new Map(employees.map((e) => [e.id, e]));
  const pos = new Map(positions.map((p) => [p.id, p]));
  const law = checkCompliance(
    shifts.map((s) => ({
      id: s.id,
      employeeId: s.employeeId,
      start: instantAt(s.date, s.startMin),
      end: instantAt(s.date, s.endMin),
      breakMinutes: s.breakMinutes,
      rate: s.employeeId ? rateFor(emps.get(s.employeeId), s.positionId, pos) : null,
      tipped: pos.get(s.positionId)?.tipped ?? false,
      day: s.date,
      missingCerts: s.employeeId ? missingCertsFor(certs, emps.get(s.employeeId), s.positionId, s.date) : [],
    })),
    employees.map((e) => ({ id: e.id, name: e.name, isMinor: e.isMinor, maxHoursWeek: e.maxHoursWeek })),
    rules,
    (d) => localHour(d, TZ),
  );
  const people = new Map(employees.map((e) => [e.id, { name: e.name, availability: e.availability, timeOff: timeOff.get(e.id) ?? new Set<ISODate>() }]));
  return [...law, ...applyRuleSettings(availabilityConflicts(shifts, people), rules)];
}

/** The week's labor % budget from the Budgets page, else the default from Settings → Pay & labor, or null. */
export async function laborTargetFor(monday: ISODate): Promise<number | null> {
  const b = await db.budget.findUnique({ where: { weekStart: parseISODate(monday) } });
  return num(b?.laborPct) ?? (await defaultLaborPct());
}

const AUTO_DRAFT_KEY = "schedule.autoDraft";

export async function getAutoDraft(): Promise<boolean> {
  return (await db.setting.findUnique({ where: { key: AUTO_DRAFT_KEY } }))?.value === "on";
}

export async function setAutoDraft(on: boolean) {
  const value = on ? "on" : "off";
  await db.setting.upsert({ where: { key: AUTO_DRAFT_KEY }, create: { key: AUTO_DRAFT_KEY, value }, update: { value } });
}

export async function loadWeek(monday: ISODate): Promise<WeekData> {
  const dates = weekDates(monday);
  const [positions, rules, opening, rows, pendingOff, pendingSwaps, laborTarget, autoDraft] = await Promise.all([
    loadPositions(),
    // Rates in force that week, so a week after January 1 uses the new minimum wage.
    getLaborRules(monday),
    // Seasonal hours: the ones in force that week.
    getOpeningHours(monday),
    db.shift.findMany({ where: weekWhere(monday), orderBy: { start: "asc" } }),
    db.timeOffRequest.findMany({ where: { status: "PENDING", startDate: { lte: parseISODate(dates[6]) }, endDate: { gte: parseISODate(monday) } } }),
    db.shiftSwap.count({ where: { status: "PENDING" } }),
    laborTargetFor(monday),
    getAutoDraft(),
  ]);
  const [employees, timeOff, days, pendingAll, certs] = await Promise.all([
    loadEmployees(positions),
    approvedTimeOff(monday, dates[6]),
    forecastDays(dates, opening),
    db.timeOffRequest.count({ where: { status: "PENDING" } }),
    loadCertCoverage(),
  ]);
  const shifts = rows.map(toView);
  const emps = new Map(employees.map((e) => [e.id, e]));
  const pos = new Map(positions.map((p) => [p.id, p]));
  const req = requirementFor(days, positions, opening, 1);
  const summary = summarizeSchedule(
    shifts.map((s) => toScheduled(s, emps, pos)),
    dates,
    new Map(days.map((d) => [d.date, d.sales])),
    new Map([...req].map(([d, m]) => [d, [...m.values()].reduce((a, c) => a + curveHours(c), 0)])),
    rules,
  );
  const pendingMap: Record<string, ISODate[]> = {};
  for (const r of pendingOff) {
    pendingMap[r.employeeId] = [...(pendingMap[r.employeeId] ?? []), ...inclusiveDates(toISODate(r.startDate), toISODate(r.endDate)).filter((d) => d >= monday && d <= dates[6])];
  }
  return {
    monday,
    dates,
    positions,
    employees,
    shifts,
    issues: complianceFor(shifts, employees, positions, rules, timeOff, certs),
    summary,
    timeOff: Object.fromEntries([...timeOff].map(([k, v]) => [k, [...v]])),
    pendingTimeOff: pendingMap,
    opening,
    rules,
    pendingRequests: pendingAll + pendingSwaps,
    laborTarget,
    demand: Object.fromEntries(dates.map((d) => [d, staffVsDemand([...(req.get(d)?.values() ?? [])], shifts.filter((s) => s.date === d))])),
    autoDraft,
  };
}

// ---- Schedule assistant ----------------------------------------------------------------

export interface PlanPreview {
  intensity: number;
  replaces: number;
  keeps: number;
  planned: (ScheduledShift & { name: string | null })[];
  summary: ScheduleSummary; // whole week after applying (published + planned)
  plannedOnly: ScheduleSummary;
  /** Weekly labor % budget, if one is set on the Budgets page. */
  laborTarget: number | null;
}

/** Everything planning needs for a week, loaded once so different intensities are cheap to try. */
async function planContext(monday: ISODate) {
  const dates = weekDates(monday);
  const [positions, rules, opening, rows, laborTarget] = await Promise.all([loadPositions(), getLaborRules(), getOpeningHours(monday), db.shift.findMany({ where: weekWhere(monday) }), laborTargetFor(monday)]);
  const [employees, timeOff, days] = await Promise.all([loadEmployees(positions), approvedTimeOff(monday, dates[6]), forecastDays(dates, opening)]);
  return { monday, dates, positions, rules, opening, rows, laborTarget, employees, timeOff, days };
}

type PlanContext = Awaited<ReturnType<typeof planContext>>;

/**
 * Forecast → people needed per position per hour → shift blocks → people.
 * Published shifts stay and count as coverage. Long shifts get the default
 * meal break from the labor rules.
 */
function buildPlan(ctx: PlanContext, intensity: number): PlanPreview {
  const { dates, positions, rules, opening, rows, employees, timeOff, days } = ctx;
  const emps = new Map(employees.map((e) => [e.id, e]));
  const pos = new Map(positions.map((p) => [p.id, p]));
  const published = rows.filter((r) => r.published).map(toView);
  const req = requirementFor(days, positions, opening, intensity);

  const blocks: { positionId: string; day: string; weekday: number; startHour: number; endHour: number }[] = [];
  for (const date of dates) {
    const byPos = req.get(date)!;
    for (const p of positions) {
      const have = coverage(published.filter((s) => s.date === date && s.positionId === p.id));
      const need = (byPos.get(p.id) ?? []).map((n, h) => Math.max(0, n - have[h]));
      for (const b of splitLongBlocks(curveToBlocks(need, MIN_SHIFT_HOURS), 8, MIN_SHIFT_HOURS)) blocks.push({ positionId: p.id, day: date, weekday: weekday(date), ...b });
    }
  }

  const existingHours = new Map<string, number>();
  const off: { employeeId: string; day: string }[] = [];
  for (const [id, set] of timeOff) for (const d of set) off.push({ employeeId: id, day: d });
  for (const s of published) {
    if (!s.employeeId) continue;
    existingHours.set(s.employeeId, (existingHours.get(s.employeeId) ?? 0) + (s.endMin - s.startMin - s.breakMinutes) / 60);
    off.push({ employeeId: s.employeeId, day: s.date }); // already working that day
  }
  const people: Candidate[] = employees
    .filter((e) => e.positionIds.length > 0)
    .map((e) => ({
      id: e.id,
      name: e.name,
      rate: Object.values(e.rates).find((r) => r != null) ?? null,
      positionIds: e.positionIds,
      isMinor: e.isMinor,
      maxHoursWeek: e.maxHoursWeek,
      availability: e.isMinor ? clipAvailability(e.availability, rules.minorLatestHour) : e.availability,
    }));

  const assigned = assignShifts(blocks, people, off, existingHours);
  const planned = assigned
    .map((a) => {
      const s: ScheduledShift = {
        employeeId: a.employeeId,
        positionId: a.positionId,
        date: a.day,
        startMin: a.startHour * 60,
        endMin: a.endHour * 60,
        breakMinutes: defaultBreakMinutes(a.endHour - a.startHour, rules),
        rate: null,
      };
      s.rate = rateFor(a.employeeId ? emps.get(a.employeeId) : undefined, a.positionId, pos);
      return { ...s, name: a.employeeId ? emps.get(a.employeeId)?.name ?? null : null };
    })
    .sort((x, y) => x.date.localeCompare(y.date) || x.startMin - y.startMin);

  const forecast = new Map(days.map((d) => [d.date, d.sales]));
  const required = new Map([...req].map(([d, m]) => [d, [...m.values()].reduce((a, c) => a + curveHours(c), 0)]));
  return {
    intensity,
    replaces: rows.length - published.length,
    keeps: published.length,
    planned,
    summary: summarizeSchedule([...published.map((s) => toScheduled(s, emps, pos)), ...planned], dates, forecast, required, rules),
    plannedOnly: summarizeSchedule(planned, dates, forecast, required, rules),
    laborTarget: ctx.laborTarget,
  };
}

/** Build a draft for the week at a given intensity (see buildPlan). */
export async function planWeek(monday: ISODate, intensity: number): Promise<PlanPreview> {
  return buildPlan(await planContext(monday), intensity);
}

/**
 * The most generous slider setting whose plan fits the week's labor % budget.
 * Null when no budget is set. `reachable` is false when even the leanest plan
 * is over budget (the leanest plan is returned then).
 */
export async function fitPlanToBudget(monday: ISODate): Promise<{ slider: number; reachable: boolean; plan: PlanPreview } | null> {
  const ctx = await planContext(monday);
  if (ctx.laborTarget == null) return null;
  const cache = new Map<number, PlanPreview>();
  const at = (v: number) => {
    if (!cache.has(v)) cache.set(v, buildPlan(ctx, intensityFromSlider(v)));
    return cache.get(v)!;
  };
  const fit = fitSliderToTarget((v) => at(v).summary.laborPct, ctx.laborTarget);
  return { ...fit, plan: at(fit.slider) };
}

export async function applyPlan(monday: ISODate, intensity: number, plan?: PlanPreview) {
  plan ??= await planWeek(monday, intensity);
  await db.$transaction([
    db.shift.deleteMany({ where: { ...weekWhere(monday), published: false } }),
    db.shift.createMany({
      data: plan.planned.map((s) => ({
        employeeId: s.employeeId,
        positionId: s.positionId,
        start: instantAt(s.date, s.startMin),
        end: instantAt(s.date, s.endMin),
        breakMinutes: s.breakMinutes,
        published: false,
      })),
    }),
  ]);
  return plan;
}

export async function publishWeek(monday: ISODate) {
  const r = await db.shift.updateMany({ where: { ...weekWhere(monday), published: false }, data: { published: true } });
  return r.count;
}

export async function clearDrafts(monday: ISODate) {
  const r = await db.shift.deleteMany({ where: { ...weekWhere(monday), published: false } });
  return r.count;
}

/**
 * For the nightly job: if auto-draft is on and next week has no shifts at
 * all, draft it, fitted to the labor % budget when one is set, otherwise at
 * the standard staffing level. Never touches a week that has any shifts.
 */
export async function autoDraftNextWeek(today: ISODate = todayIn(TZ)): Promise<{ skipped: string } | { week: ISODate; created: number; slider: number; laborPct: number | null; laborTarget: number | null }> {
  if (!(await getAutoDraft())) return { skipped: "Auto-draft is off." };
  const monday = addDays(weekStartOf(today), 7);
  const existing = await db.shift.count({ where: weekWhere(monday) });
  if (existing > 0) return { skipped: `Week of ${monday} already has ${existing} shifts.` };
  const fit = await fitPlanToBudget(monday);
  const slider = fit?.slider ?? 50;
  const plan = await applyPlan(monday, intensityFromSlider(slider), fit?.plan);
  return { week: monday, created: plan.planned.length, slider, laborPct: plan.summary.laborPct, laborTarget: plan.laborTarget };
}

/** Block-level problems for the week (for the publish guard). */
export async function weekBlockers(monday: ISODate) {
  const w = await loadWeek(monday);
  return w.issues.filter((i) => i.level === "block");
}

// ---- Staff app -------------------------------------------------------------------------

export async function employeeForUser(userId: string) {
  return db.employee.findUnique({ where: { userId }, include: { positions: { include: { position: true } } } });
}

export { toView as shiftView };

/** Does `employeeId` already work during [start, end)? */
export async function hasOverlap(employeeId: string, start: Date, end: Date, exceptShiftId?: string) {
  const n = await db.shift.count({ where: { employeeId, start: { lt: end }, end: { gt: start }, ...(exceptShiftId ? { id: { not: exceptShiftId } } : {}) } });
  return n > 0;
}

// ---- Announcements ---------------------------------------------------------------------

/** Team notes for My shifts: pinned first, then the last 30 days, newest first. */
export async function listAnnouncements(limit = 10) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const now = new Date();
  return db.announcement.findMany({
    where: { AND: [{ OR: [{ pinned: true }, { createdAt: { gte: since } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}
