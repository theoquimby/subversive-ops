/**
 * Tips from Square: per-person card tips (Payment.tip_money by the team
 * member who took the payment) and declared cash tips
 * (Timecard.declared_cash_tip_money), merged with values a manager typed
 * over them, then split between the people in the pool. Pure.
 */

import type { ISODate } from "./dates";
import type { TipShare } from "./labor";
import { splitPool, TipMethod } from "./tips";

export type TipKind = "CARD" | "CASH";
/** Pool everything, or let each person in the pool keep their own. */
export type TipMode = "POOL" | "KEEP";
/** teamMemberId for tips Square doesn't link to anyone. */
export const UNLINKED = "";

const cents = (n: number) => Math.round(n * 100) / 100;

// ---- Sync: Square records → one row per day, kind and team member ----------------------

export interface PaymentTip {
  id: string;
  createdAt: string;
  status: string;
  tipCents: number;
  teamMemberId: string | null;
}

export interface CashDeclaration {
  timecardId: string;
  startAt: string;
  teamMemberId: string;
  cashCents: number;
}

export interface SquareTipRow {
  date: ISODate;
  kind: TipKind;
  teamMemberId: string;
  /** Dollars. */
  amount: number;
  count: number;
}

/**
 * Rows to store for the synced days `dates`. Every day gets an UNLINKED row
 * (zero when everything is linked), which also records that the day was
 * synced. Records outside `dates` and duplicates (same id) are ignored, so
 * re-syncing a day always produces the same rows.
 */
function rowsFor<T>(kind: TipKind, items: T[], dates: ISODate[], key: (t: T) => { id: string; date: ISODate; teamMemberId: string | null; cents: number } | null): SquareTipRow[] {
  const days = new Set(dates);
  const seen = new Set<string>();
  const acc = new Map<string, SquareTipRow>();
  for (const d of dates) acc.set(`${d}|${UNLINKED}`, { date: d, kind, teamMemberId: UNLINKED, amount: 0, count: 0 });
  for (const item of items) {
    const k = key(item);
    if (!k || !days.has(k.date) || seen.has(k.id) || !k.cents) continue;
    seen.add(k.id);
    const tm = k.teamMemberId || UNLINKED;
    const id = `${k.date}|${tm}`;
    const row = acc.get(id) ?? { date: k.date, kind, teamMemberId: tm, amount: 0, count: 0 };
    row.amount = cents(row.amount + k.cents / 100);
    row.count++;
    acc.set(id, row);
  }
  return [...acc.values()].sort((a, b) => a.date.localeCompare(b.date) || a.teamMemberId.localeCompare(b.teamMemberId));
}

/** Card tips per day and team member. Only COMPLETED payments count (APPROVED is an open tab whose tip can still change). */
export function cardTipRows(payments: PaymentTip[], dates: ISODate[], dateOf: (iso: string) => ISODate): SquareTipRow[] {
  return rowsFor("CARD", payments, dates, (p) => (p.status === "COMPLETED" ? { id: p.id, date: dateOf(p.createdAt), teamMemberId: p.teamMemberId, cents: p.tipCents } : null));
}

/** Declared cash tips per day (the day the timecard started) and team member. */
export function cashTipRows(cards: CashDeclaration[], dates: ISODate[], dateOf: (iso: string) => ISODate): SquareTipRow[] {
  return rowsFor("CASH", cards, dates, (c) => ({ id: c.timecardId, date: dateOf(c.startAt), teamMemberId: c.teamMemberId, cents: c.cashCents }));
}

// ---- Read: stored rows for a period → per-employee Square values -----------------------

export interface SquareTipsInPeriod {
  /** By employee id. */
  card: Map<string, number>;
  cash: Map<string, number>;
  /** Not linked to anyone we know (or days only the older daily total covers). */
  pooledCard: number;
  pooledCash: number;
  cardDays: number;
  cashDays: number;
  /** Days only covered by the daily card-tip total from orders (synced before per-person tips). */
  fallbackDays: number;
  ofDays: number;
}

/**
 * Sum stored rows over `dates`. Team members map to employees through
 * `employeeOf`; unknown ones go to the pooled line. Days with no CARD rows
 * fall back to the daily card-tip total (Setting tips.<date>), pooled.
 */
export function squareTipsFor(rows: { date: ISODate; kind: string; teamMemberId: string; amount: number }[], dayCardTotals: Map<ISODate, number>, dates: ISODate[], employeeOf: (teamMemberId: string) => string | null): SquareTipsInPeriod {
  const inRange = new Set(dates);
  const out: SquareTipsInPeriod = { card: new Map(), cash: new Map(), pooledCard: 0, pooledCash: 0, cardDays: 0, cashDays: 0, fallbackDays: 0, ofDays: dates.length };
  const cardDays = new Set<ISODate>();
  const cashDays = new Set<ISODate>();
  for (const r of rows) {
    if (!inRange.has(r.date) || (r.kind !== "CARD" && r.kind !== "CASH")) continue;
    const card = r.kind === "CARD";
    (card ? cardDays : cashDays).add(r.date);
    const emp = r.teamMemberId ? employeeOf(r.teamMemberId) : null;
    if (emp) {
      const m = card ? out.card : out.cash;
      m.set(emp, cents((m.get(emp) ?? 0) + r.amount));
    } else if (card) out.pooledCard = cents(out.pooledCard + r.amount);
    else out.pooledCash = cents(out.pooledCash + r.amount);
  }
  for (const d of dates) {
    if (cardDays.has(d)) continue;
    const t = dayCardTotals.get(d);
    if (t == null) continue;
    out.pooledCard = cents(out.pooledCard + t);
    out.fallbackDays++;
  }
  out.cardDays = cardDays.size;
  out.cashDays = cashDays.size;
  return out;
}

// ---- Merge with manual values ----------------------------------------------------------

export interface TipOverrides {
  card?: Record<string, number>;
  cash?: Record<string, number>;
  pooledCard?: number;
  pooledCash?: number;
}

export interface TipValue {
  value: number;
  /** What Square says (0 when it has nothing). */
  square: number;
  manual: boolean;
}

export interface TipLine {
  employeeId: string;
  card: TipValue;
  cash: TipValue;
}

export interface TipInputs {
  lines: TipLine[];
  pooledCard: TipValue;
  pooledCash: TipValue;
}

const val = (square: number, manual: number | undefined): TipValue => (manual != null && Number.isFinite(manual) ? { value: cents(manual), square: cents(square), manual: true } : { value: cents(square), square: cents(square), manual: false });

/**
 * One line per person (everyone in `people` plus anyone Square or a manual
 * value has tips for). A manual value always wins over Square's, so a re-sync
 * can change what Square says but never what was typed.
 */
export function mergeTipInputs(square: Pick<SquareTipsInPeriod, "card" | "cash" | "pooledCard" | "pooledCash">, overrides: TipOverrides | null | undefined, people: string[]): TipInputs {
  const o = overrides ?? {};
  const ids = new Set([...people, ...square.card.keys(), ...square.cash.keys(), ...Object.keys(o.card ?? {}), ...Object.keys(o.cash ?? {})]);
  const lines = [...ids].map((id) => ({ employeeId: id, card: val(square.card.get(id) ?? 0, o.card?.[id]), cash: val(square.cash.get(id) ?? 0, o.cash?.[id]) }));
  return { lines, pooledCard: val(square.pooledCard, o.pooledCard), pooledCash: val(square.pooledCash, o.pooledCash) };
}

/** Set (number) or clear (null → back to Square's value) one manual value. Returns a new object. */
export function setOverride(overrides: TipOverrides | null | undefined, target: { kind: TipKind; employeeId: string | null }, value: number | null): TipOverrides {
  const o: TipOverrides = { card: { ...(overrides?.card ?? {}) }, cash: { ...(overrides?.cash ?? {}) }, pooledCard: overrides?.pooledCard, pooledCash: overrides?.pooledCash };
  const v = value == null ? undefined : cents(value);
  if (target.employeeId == null) {
    if (target.kind === "CARD") o.pooledCard = v;
    else o.pooledCash = v;
  } else {
    const m = target.kind === "CARD" ? o.card! : o.cash!;
    if (v == null) delete m[target.employeeId];
    else m[target.employeeId] = v;
  }
  if (o.pooledCard == null) delete o.pooledCard;
  if (o.pooledCash == null) delete o.pooledCash;
  return o;
}

export const manualCount = (o: TipOverrides | null | undefined) => Object.keys(o?.card ?? {}).length + Object.keys(o?.cash ?? {}).length + (o?.pooledCard != null ? 1 : 0) + (o?.pooledCash != null ? 1 : 0);

// ---- Split -------------------------------------------------------------------------------

export interface PersonTips {
  employeeId: string;
  hours: number;
  weightedPoints: number;
  /** Kept directly (KEEP mode) plus their share of the pool. */
  card: number;
  cash: number;
  amount: number;
}

export interface TipPlan {
  people: PersonTips[];
  cardTotal: number;
  cashTotal: number;
  total: number;
  cardPool: number;
  cashPool: number;
  /** People with tips in Square but no hours in a tip-eligible role: their tips went into the pool. */
  movedToPool: { employeeId: string; card: number; cash: number }[];
  /** Tips with nobody in the pool to receive them. */
  unshared: number;
}

/**
 * Split card and cash tips separately (same shares), so each person's total
 * says how much is card (through payroll) and how much is cash. In KEEP mode
 * a person in the pool keeps their own tips; tips of people outside the pool
 * (owner, manager, untipped roles) are pooled instead. Cents always add up.
 */
export function planTips(inputs: TipInputs, shares: TipShare[], method: TipMethod, cardMode: TipMode, cashMode: TipMode): TipPlan {
  const inPool = new Set(shares.filter((s) => s.hours > 0).map((s) => s.employeeId));
  let cardPool = inputs.pooledCard.value;
  let cashPool = inputs.pooledCash.value;
  const kept = new Map<string, { card: number; cash: number }>();
  const moved: TipPlan["movedToPool"] = [];
  for (const l of inputs.lines) {
    const mine = inPool.has(l.employeeId);
    const keepCard = mine && cardMode === "KEEP" ? l.card.value : 0;
    const keepCash = mine && cashMode === "KEEP" ? l.cash.value : 0;
    cardPool += l.card.value - keepCard;
    cashPool += l.cash.value - keepCash;
    if (keepCard || keepCash) kept.set(l.employeeId, { card: keepCard, cash: keepCash });
    if (!mine && (l.card.value || l.cash.value)) moved.push({ employeeId: l.employeeId, card: l.card.value, cash: l.cash.value });
  }
  cardPool = cents(Math.max(0, cardPool));
  cashPool = cents(Math.max(0, cashPool));
  const cardSplit = new Map(splitPool(cardPool, shares, method).map((s) => [s.employeeId, s]));
  const cashSplit = new Map(splitPool(cashPool, shares, method).map((s) => [s.employeeId, s]));
  const ids = new Set([...cardSplit.keys(), ...kept.keys()]);
  const people: PersonTips[] = [...ids].map((id) => {
    const c = cardSplit.get(id);
    const k = kept.get(id) ?? { card: 0, cash: 0 };
    const card = cents(k.card + (c?.amount ?? 0));
    const cash = cents(k.cash + (cashSplit.get(id)?.amount ?? 0));
    return { employeeId: id, hours: c?.hours ?? 0, weightedPoints: c?.weightedPoints ?? 0, card, cash, amount: cents(card + cash) };
  });
  const cardTotal = cents(inputs.pooledCard.value + inputs.lines.reduce((a, l) => a + l.card.value, 0));
  const cashTotal = cents(inputs.pooledCash.value + inputs.lines.reduce((a, l) => a + l.cash.value, 0));
  const shared = cents(people.reduce((a, p) => a + p.amount, 0));
  return { people, cardTotal, cashTotal, total: cents(cardTotal + cashTotal), cardPool, cashPool, movedToPool: moved, unshared: cents(Math.max(0, cardTotal + cashTotal - shared)) };
}

// ---- New York notes ------------------------------------------------------------------------

const MANAGERIAL = /\b(owner|manager|gm|general manager|supervisor|admin|administrator|bookkeep\w*|director|partner)\b/i;
const NO_GUEST_SERVICE = /\b(cook|chef|dish\w*|prep|porter|kitchen|cellar|packaging|maintenance|production)\b/i;

export interface PoolWarning {
  kind: "managerial" | "no-guest-service";
  positions: string[];
}

/**
 * Tip-eligible positions with pool hours whose name suggests a role that
 * New York doesn't let share a tip pool. A name check only: the manager
 * decides, and fixes it by marking the position not tip-eligible on Team.
 */
export function poolWarnings(positionsInPool: string[]): PoolWarning[] {
  const names = [...new Set(positionsInPool)].sort();
  const managerial = names.filter((n) => MANAGERIAL.test(n));
  const back = names.filter((n) => !MANAGERIAL.test(n) && NO_GUEST_SERVICE.test(n));
  const out: PoolWarning[] = [];
  if (managerial.length) out.push({ kind: "managerial", positions: managerial });
  if (back.length) out.push({ kind: "no-guest-service", positions: back });
  return out;
}
