import "server-only";
import { addDays, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import { inclusiveDates, shiftLabel, shiftPaidHours, weekStartOf } from "@/domain/schedule";
import { appendLog, autoApproveDecision, parseSwapRules, swapEligibility, type Eligibility, type SwapKind, type SwapRules, type SwapShift } from "@/domain/swaps";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { getLaborRules } from "./labor-rules";
import { localHour } from "./sales";
import { instantAt, loadCertCoverage, loadEmployees, loadPositions, missingCertsFor, rateFor, shiftView, TZ, type CertCoverage, type EmployeeView, type PositionView, type ShiftView } from "./scheduling";

/**
 * Shift swaps & pickups. Every claim is checked with the schedule's own rules
 * (domain/swaps.ts → checkCompliance) against the taker's week. Approval is a
 * manager's call unless Settings say a clean swap can go straight through.
 */

export const SWAP_RULES_KEY = "swaps.rules";

export async function getSwapRules(): Promise<SwapRules> {
  return parseSwapRules((await db.setting.findUnique({ where: { key: SWAP_RULES_KEY } }))?.value);
}

export async function saveSwapRules(r: SwapRules) {
  const value = JSON.stringify(r);
  await db.setting.upsert({ where: { key: SWAP_RULES_KEY }, create: { key: SWAP_RULES_KEY, value }, update: { value } });
}

// ---- Week context ---------------------------------------------------------------------

interface WeekCtx {
  monday: ISODate;
  shifts: ShiftView[];
  employees: Map<string, EmployeeView>;
  positions: Map<string, PositionView>;
  timeOff: Map<string, Set<ISODate>>;
  certs: CertCoverage;
  rules: Awaited<ReturnType<typeof getLaborRules>>;
}

/** Loads a workweek once per request; pass the same cache to check many shifts. */
export type WeekCache = Map<ISODate, Promise<WeekCtx>>;
export const weekCache = (): WeekCache => new Map();

async function loadCtx(monday: ISODate): Promise<WeekCtx> {
  const end = addDays(monday, 6);
  const positions = await loadPositions();
  const [rules, employees, rows, off, certs] = await Promise.all([
    getLaborRules(monday),
    loadEmployees(positions),
    db.shift.findMany({ where: { employeeId: { not: null }, start: { gte: instantAt(monday, 0), lt: instantAt(addDays(monday, 7), 0) } } }),
    db.timeOffRequest.findMany({ where: { status: "APPROVED", startDate: { lte: parseISODate(end) }, endDate: { gte: parseISODate(monday) } } }),
    loadCertCoverage(),
  ]);
  const timeOff = new Map<string, Set<ISODate>>();
  for (const r of off) {
    const set = timeOff.get(r.employeeId) ?? new Set<ISODate>();
    for (const d of inclusiveDates(toISODate(r.startDate), toISODate(r.endDate))) set.add(d);
    timeOff.set(r.employeeId, set);
  }
  return { monday, shifts: rows.map(shiftView), employees: new Map(employees.map((e) => [e.id, e])), positions: new Map(positions.map((p) => [p.id, p])), timeOff, certs, rules };
}

const ctxFor = (cache: WeekCache, date: ISODate) => {
  const m = weekStartOf(date);
  if (!cache.has(m)) cache.set(m, loadCtx(m));
  return cache.get(m)!;
};

const asSwapShift = (s: ShiftView): SwapShift => ({ id: s.id, positionId: s.positionId, date: s.date, startMin: s.startMin, endMin: s.endMin, breakMinutes: s.breakMinutes });

/**
 * Can `employeeId` take `shift`? `givesBack` is a shift of theirs that leaves
 * their week in a trade.
 */
export async function checkTaker(shift: ShiftView, employeeId: string, cache: WeekCache, givesBack?: string | null): Promise<Eligibility> {
  const ctx = await ctxFor(cache, shift.date);
  const e = ctx.employees.get(employeeId);
  if (!e) return { eligible: false, reasons: ["Not an active team member"], warnings: [], hoursBefore: 0, hoursAfter: 0 };
  const week = ctx.shifts.filter((s) => s.employeeId === employeeId && s.id !== shift.id && s.id !== givesBack).map(asSwapShift);
  return swapEligibility(
    asSwapShift(shift),
    {
      id: e.id,
      name: e.name,
      positionIds: e.positionIds,
      isMinor: e.isMinor,
      maxHoursWeek: e.maxHoursWeek,
      availability: e.availability,
      timeOff: ctx.timeOff.get(e.id) ?? new Set(),
      rate: rateFor(e, shift.positionId, ctx.positions),
      missingCerts: missingCertsFor(ctx.certs, e, shift.positionId, shift.date),
      weekShifts: week,
    },
    ctx.rules,
    { instant: instantAt, localHour: (d) => localHour(d, TZ), tipped: ctx.positions.get(shift.positionId)?.tipped ?? false },
  );
}

/** Everyone active who could take the shift, best first (eligible, then fewest hours). */
export async function candidatesFor(shift: ShiftView, excludeIds: string[], cache: WeekCache) {
  const ctx = await ctxFor(cache, shift.date);
  const out: { id: string; name: string; check: Eligibility }[] = [];
  for (const e of ctx.employees.values()) {
    if (excludeIds.includes(e.id) || !e.positionIds.includes(shift.positionId)) continue;
    out.push({ id: e.id, name: e.name, check: await checkTaker(shift, e.id, cache) });
  }
  return out.sort((a, b) => Number(b.check.eligible) - Number(a.check.eligible) || a.check.warnings.length - b.check.warnings.length || a.check.hoursBefore - b.check.hoursBefore || a.name.localeCompare(b.name));
}

// ---- Applying ---------------------------------------------------------------------------

type Res = { error?: string; ok?: string; swapId?: string; auto?: boolean };

const hoursUntil = (start: Date) => (start.getTime() - Date.now()) / 3_600_000;

/** Move the shift(s) for an approved swap. Refuses if anything changed underneath. */
async function applyApproved(tx: Prisma.TransactionClient, sw: { id: string; kind: string; shiftId: string; requesterId: string; takerId: string | null; offeredShiftId: string | null }) {
  const kind = sw.kind as SwapKind;
  if (kind === "DROP") {
    const r = await tx.shift.updateMany({ where: { id: sw.shiftId, employeeId: sw.requesterId }, data: { employeeId: null } });
    return r.count === 1;
  }
  if (!sw.takerId) return false;
  if (kind === "PICKUP") {
    const r = await tx.shift.updateMany({ where: { id: sw.shiftId, employeeId: null }, data: { employeeId: sw.takerId } });
    return r.count === 1;
  }
  const a = await tx.shift.updateMany({ where: { id: sw.shiftId, employeeId: sw.requesterId }, data: { employeeId: sw.takerId } });
  if (a.count !== 1) return false;
  if (kind === "SWAP") {
    if (!sw.offeredShiftId) return false;
    const b = await tx.shift.updateMany({ where: { id: sw.offeredShiftId, employeeId: sw.takerId }, data: { employeeId: sw.requesterId } });
    if (b.count !== 1) return false;
  }
  return true;
}

class Conflict extends Error {}

/** Approve inside a transaction; closes other open offers on the same shift(s). */
async function approve(swapId: string, by: string, auto: boolean, why?: string): Promise<boolean> {
  try {
    await db.$transaction(async (tx) => {
      const sw = await tx.shiftSwap.findUnique({ where: { id: swapId } });
      if (!sw || sw.status !== "PENDING") throw new Conflict();
      if (!(await applyApproved(tx, sw))) throw new Conflict();
      await tx.shiftSwap.update({ where: { id: swapId }, data: { status: "APPROVED", decidedAt: new Date(), decidedBy: by, autoApproved: auto, log: appendLog(sw.log, by, auto ? `Approved automatically — ${why ?? "passed every check"}` : "Approved") as unknown as Prisma.InputJsonValue } });
      const touched = [sw.shiftId, sw.offeredShiftId].filter((x): x is string => !!x);
      const others = await tx.shiftSwap.findMany({ where: { id: { not: swapId }, status: "PENDING", OR: [{ shiftId: { in: touched } }, { offeredShiftId: { in: touched } }] } });
      for (const o of others) await tx.shiftSwap.update({ where: { id: o.id }, data: { status: "CANCELLED", decidedAt: new Date(), log: appendLog(o.log, "Ops", "Closed — the shift changed hands another way") as unknown as Prisma.InputJsonValue } });
    });
    return true;
  } catch (e) {
    if (e instanceof Conflict) return false;
    throw e;
  }
}

/** After a claim: approve now when the rules allow, otherwise leave it for a manager. */
async function maybeAutoApprove(swapId: string): Promise<boolean> {
  const sw = await db.shiftSwap.findUnique({ where: { id: swapId }, include: { shift: true, offeredShift: true } });
  if (!sw || sw.status !== "PENDING" || !sw.takerId || !sw.claimedAt) return false;
  const rules = await getSwapRules();
  const cache = weekCache();
  const checks = [await checkTaker(shiftView(sw.shift), sw.takerId, cache, sw.offeredShiftId)];
  if (sw.kind === "SWAP" && sw.offeredShift) checks.push(await checkTaker(shiftView(sw.offeredShift), sw.requesterId, cache, sw.shiftId));
  const d = autoApproveDecision(rules, sw.kind as SwapKind, checks, hoursUntil(sw.shift.start));
  if (!d.auto) return false;
  return approve(swapId, "Ops", true, d.why);
}

// ---- Staff actions -----------------------------------------------------------------------

export async function postShift(me: { id: string; name: string }, shiftId: string, kind: "GIVE" | "SWAP" | "DROP", opts: { askId?: string | null; note?: string | null }): Promise<Res> {
  const s = await db.shift.findUnique({ where: { id: shiftId }, include: { swaps: { where: { status: "PENDING" } } } });
  if (!s || s.employeeId !== me.id) return { error: "That isn't your shift." };
  if (!s.published) return { error: "That shift isn't on the published schedule yet." };
  if (s.start <= new Date()) return { error: "That shift has already started." };
  if (s.swaps.length) return { error: "This shift is already up for a swap." };
  if (kind === "DROP" && !(await getSwapRules()).allowDrop) return { error: "Dropping shifts is turned off — offer it to a teammate instead." };
  let askId: string | null = null;
  if (opts.askId && kind !== "DROP") {
    const other = await db.employee.findFirst({ where: { id: opts.askId, active: true }, select: { id: true } });
    if (!other || other.id === me.id) return { error: "Pick someone on the team." };
    const check = await checkTaker(shiftView(s), other.id, weekCache());
    if (kind === "GIVE" && !check.eligible) return { error: `They can't take it: ${check.reasons.join(", ").toLowerCase()}.` };
    askId = other.id;
  }
  const what = kind === "DROP" ? "Asked to drop it" : kind === "SWAP" ? "Offered it as a trade" : "Offered it up";
  const sw = await db.shiftSwap.create({
    data: { shiftId, requesterId: me.id, takerId: askId, kind, note: opts.note?.trim().slice(0, 300) || null, log: appendLog([], me.name, askId ? `${what} — asked one person` : what) as unknown as Prisma.InputJsonValue },
  });
  return { ok: kind === "DROP" ? "Sent to your manager. It's yours until they approve." : askId ? "Asked. You'll hear when they answer." : "Posted. Teammates who can take it will see it.", swapId: sw.id };
}

/** Take a posted shift (or answer an ask). For a trade, `offeredShiftId` is the claimer's shift they give back. */
export async function claimSwap(me: { id: string; name: string }, swapId: string, offeredShiftId?: string | null): Promise<Res> {
  const sw = await db.shiftSwap.findUnique({ where: { id: swapId }, include: { shift: true } });
  if (!sw || sw.status !== "PENDING" || sw.kind === "DROP" || sw.kind === "PICKUP") return { error: "That's no longer up for grabs." };
  if (sw.requesterId === me.id) return { error: "That's your own shift." };
  if (sw.takerId && sw.takerId !== me.id) return { error: "Someone already took it." };
  if (sw.claimedAt) return { error: "Already claimed — waiting on a manager." };
  if (sw.shift.start <= new Date()) return { error: "That shift has already started." };
  const cache = weekCache();
  let offered: Awaited<ReturnType<typeof db.shift.findUnique>> = null;
  if (sw.kind === "SWAP") {
    if (!offeredShiftId) return { error: "Pick one of your shifts to trade." };
    offered = await db.shift.findUnique({ where: { id: offeredShiftId } });
    if (!offered || offered.employeeId !== me.id || !offered.published || offered.start <= new Date()) return { error: "Pick one of your upcoming shifts." };
    const back = await checkTaker(shiftView(offered), sw.requesterId, cache, sw.shiftId);
    if (!back.eligible) return { error: `They can't work that one: ${back.reasons.join(", ").toLowerCase()}.` };
  }
  const check = await checkTaker(shiftView(sw.shift), me.id, cache, offered?.id);
  if (!check.eligible) return { error: `You can't take this one: ${check.reasons.join(", ").toLowerCase()}.` };
  const r = await db.shiftSwap.updateMany({
    where: { id: swapId, status: "PENDING", claimedAt: null, OR: [{ takerId: null }, { takerId: me.id }] },
    data: { takerId: me.id, claimedAt: new Date(), offeredShiftId: offered?.id ?? null, log: appendLog(sw.log, me.name, offered ? `Offered to trade for ${tradeLabel(shiftView(offered))}` : "Said they'll take it") as unknown as Prisma.InputJsonValue },
  });
  if (r.count === 0) return { error: "Someone already took it." };
  const auto = await maybeAutoApprove(swapId);
  return { ok: auto ? "Done — it's yours. It's on your schedule now." : "Claimed. A manager will confirm.", swapId, auto };
}

const tradeLabel = (v: ShiftView) => `${new Date(`${v.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} ${shiftLabel(v.startMin, v.endMin)}`;

/** Say no to a direct ask: it goes back to being yours, nobody asked. */
export async function declineAsk(me: { id: string; name: string }, swapId: string): Promise<Res> {
  const sw = await db.shiftSwap.findUnique({ where: { id: swapId } });
  if (!sw || sw.status !== "PENDING" || sw.takerId !== me.id || sw.claimedAt) return { error: "That ask was already handled." };
  await db.shiftSwap.update({ where: { id: swapId }, data: { status: "CANCELLED", decidedAt: new Date(), log: appendLog(sw.log, me.name, "Said they can't") as unknown as Prisma.InputJsonValue } });
  return { ok: "Okay — we've let them know.", swapId };
}

export async function cancelOwnSwap(me: { id: string; name: string }, swapId: string): Promise<Res> {
  const sw = await db.shiftSwap.findUnique({ where: { id: swapId } });
  if (!sw || sw.status !== "PENDING" || (sw.requesterId !== me.id && !(sw.kind === "PICKUP" && sw.takerId === me.id))) return { error: "That request was already handled." };
  await db.shiftSwap.update({ where: { id: swapId }, data: { status: "CANCELLED", decidedAt: new Date(), log: appendLog(sw.log, me.name, "Withdrew it") as unknown as Prisma.InputJsonValue } });
  return { ok: "Withdrawn — the shift stays as it was.", swapId };
}

/** Pick up an open shift: straight onto your schedule, or a request when pickups need approval. */
export async function pickUpOpen(me: { id: string; name: string }, shiftId: string): Promise<Res> {
  const s = await db.shift.findUnique({ where: { id: shiftId }, include: { swaps: { where: { status: "PENDING", kind: "PICKUP" } } } });
  if (!s || s.employeeId || !s.published) return { error: "Someone already took that shift." };
  if (s.start <= new Date()) return { error: "That shift has already started." };
  if (s.swaps.length) return { error: "Someone already asked for that shift." };
  const check = await checkTaker(shiftView(s), me.id, weekCache());
  if (!check.eligible) return { error: `You can't take this one: ${check.reasons.join(", ").toLowerCase()}.` };
  const rules = await getSwapRules();
  const d = autoApproveDecision(rules, "PICKUP", [check], hoursUntil(s.start));
  const sw = await db.shiftSwap.create({ data: { shiftId, requesterId: me.id, takerId: me.id, kind: "PICKUP", claimedAt: new Date(), log: appendLog([], me.name, "Picked up the open shift") as unknown as Prisma.InputJsonValue } });
  if (!d.auto) return { ok: "Asked. A manager will confirm.", swapId: sw.id };
  if (await approve(sw.id, "Ops", true, d.why)) return { ok: "It's yours. See you then!", swapId: sw.id, auto: true };
  await db.shiftSwap.update({ where: { id: sw.id }, data: { status: "CANCELLED", log: appendLog(sw.log, "Ops", "Someone else got there first") as unknown as Prisma.InputJsonValue } });
  return { error: "Someone already took that shift." };
}

// ---- Manager ------------------------------------------------------------------------------

export async function decideSwapRequest(swapId: string, approveIt: boolean, by: string, takerOverride?: string | null): Promise<Res> {
  const sw = await db.shiftSwap.findUnique({ where: { id: swapId }, include: { shift: true } });
  if (!sw || sw.status !== "PENDING") return { error: "That request was already handled." };
  if (!approveIt) {
    await db.shiftSwap.update({ where: { id: swapId }, data: { status: "DENIED", decidedAt: new Date(), decidedBy: by, log: appendLog(sw.log, by, "Not approved") as unknown as Prisma.InputJsonValue } });
    return { ok: "Not approved — they'll be told.", swapId };
  }
  if (sw.kind !== "DROP") {
    const taker = takerOverride ?? sw.takerId;
    if (!taker) return { error: "Pick who takes the shift." };
    const check = await checkTaker(shiftView(sw.shift), taker, weekCache(), sw.offeredShiftId);
    if (check.reasons.includes("Already working then") || check.reasons.includes("On approved time off")) return { error: `Can't: ${check.reasons.join(", ").toLowerCase()}.` };
    if (taker !== sw.takerId) {
      await db.shiftSwap.update({ where: { id: swapId }, data: { takerId: taker, claimedAt: sw.claimedAt ?? new Date(), log: appendLog(sw.log, by, "Picked who takes it") as unknown as Prisma.InputJsonValue } });
    }
  }
  if (!(await approve(swapId, by, false))) return { error: "The shift changed since this was asked — check the schedule." };
  return { ok: sw.kind === "DROP" ? "Approved. The shift is now open for anyone to pick up." : "Approved. The schedule is updated.", swapId };
}

/** Shift view + position for lists. */
export function swapShiftLine(s: { start: Date; end: Date; breakMinutes: number; id: string; employeeId: string | null; positionId: string; notes: string | null; published: boolean }) {
  const v = shiftView(s);
  return { ...v, label: shiftLabel(v.startMin, v.endMin), hours: shiftPaidHours(v) };
}
