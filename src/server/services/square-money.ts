import "server-only";
import { businessDate, dateRange, ISODate, parseISODate, toISODate, zonedMidnightUTC } from "@/domain/dates";
import { DiscountClass, discountKey, feeDays, netFees, parseDiscountMapping, StoredDiscount, summarizeDiscounts } from "@/domain/squareMoney";
import { cardTipRows } from "@/domain/tipSources";
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { db } from "../db";
import { env } from "../env";
import type { OrderDiscount } from "../integrations/square";
import { friendlySquareError, SquareClient } from "../integrations/square-http";
import { listPayments, listRefunds } from "../integrations/square-payments";
import { logSquareError, requireSquareClient, writeSettingJSON } from "./square";
import { storeGuestVisits } from "./guests";
import { storeSquareTips } from "./tips";
import { ignoredSquareIds } from "./sales";
import { settingValue } from "./setting-read";

/**
 * Card fees and comps & discounts from Square, per business day:
 * - discounts are written by the sales sync (the orders it already fetches);
 * - card tips (by person), fees and fee refunds by one payments pass that runs
 *   right after it in every sync (nightly, near-live, webhooks, history import).
 */

const D = (n: number, dp = 2) => new Prisma.Decimal(n.toFixed(dp));
const range = (from: ISODate, toExclusive: ISODate) => ({ gte: parseISODate(from), lt: parseISODate(toExclusive) });
const tz = () => env.BUSINESS_TIMEZONE;

// ---- Writing: discounts (from the orders sync) ------------------------------------------------

/** Who took the payment for each order already stored in the range (kept across a resync of the orders). */
export async function discountStaff(from: ISODate, toExclusive: ISODate): Promise<Map<string, string>> {
  const rows = await db.squareDiscount.findMany({ where: { date: range(from, toExclusive), teamMemberId: { not: "" } }, select: { orderId: true, teamMemberId: true }, distinct: ["orderId"] });
  return new Map(rows.map((r) => [r.orderId, r.teamMemberId]));
}

/**
 * Writes that replace the stored discounts for business dates [from,
 * toExclusive) with `lines`, and mark every day as synced (with its total, $0
 * on a day with no discounts). For the sales sync's transaction.
 */
export function discountWrites(from: ISODate, toExclusive: ISODate, lines: OrderDiscount[], staff: Map<string, string>) {
  const dates = dateRange(from, toExclusive);
  const inRange = new Set(dates);
  const rows = lines.map((l) => ({ ...l, date: businessDate(l.closedAt, tz()) })).filter((l) => inRange.has(l.date));
  const total = new Map<ISODate, number>();
  for (const r of rows) total.set(r.date, (total.get(r.date) ?? 0) + r.cents);
  const now = new Date();
  return [
    db.squareDiscount.deleteMany({ where: { date: range(from, toExclusive) } }),
    db.squareDiscount.createMany({
      data: rows.map((r) => ({
        date: parseISODate(r.date),
        orderId: r.orderId,
        name: r.name.slice(0, 255),
        squareId: r.squareId,
        itemName: r.itemName.slice(0, 255),
        teamMemberId: staff.get(r.orderId) ?? "",
        amount: D(r.cents / 100),
        qty: D(r.qty, 3),
        full: r.full,
        percentage: r.percentage,
      })),
    }),
    ...dates.map((d) => {
      const discounts = D((total.get(d) ?? 0) / 100);
      return db.squareDayMoney.upsert({ where: { date: parseISODate(d) }, create: { date: parseISODate(d), discounts, discountsSyncedAt: now }, update: { discounts, discountsSyncedAt: now } });
    }),
  ];
}

// ---- Writing: payments (tips, fees, fee refunds, who took the payment) -------------------------

/**
 * One pass over Square payments and refunds for business dates [from,
 * toExclusive): card tips by person (for tip pooling), card fees and fees
 * returned on refunds per day, and who took the payment on discounted orders.
 */
export async function syncPayments(from: ISODate, toExclusive: ISODate, client?: SquareClient) {
  const c = client ?? (await requireSquareClient());
  const dates = dateRange(from, toExclusive);
  const start = zonedMidnightUTC(from, tz()).toISOString();
  const end = zonedMidnightUTC(toExclusive, tz()).toISOString();
  const dateOf = (iso: string) => businessDate(iso, tz());
  const payments = await listPayments(c, start, end);

  // Card tips by person: same rows as before, from the same payments.
  const tipRows = cardTipRows(payments, dates, dateOf);
  await storeSquareTips("CARD", from, toExclusive, tipRows);

  // Who came in: one anonymous mark per card per day, from the same payments (see services/guests.ts).
  await storeGuestVisits(payments, dates).catch((e) => logSquareError("sales", `Card visits: ${friendlySquareError(e)}`).catch(() => undefined));

  let fees: ReturnType<typeof feeDays> | null = null;
  try {
    const refunds = await listRefunds(c, start, end);
    fees = feeDays(payments, refunds, dates, dateOf);
    const now = new Date();
    await db.$transaction(
      fees.map((f) => {
        const data = { cardFees: D(f.cardFees), feesReturned: D(f.feesReturned), feePayments: f.feePayments, feePending: f.feePending, feeVolume: D(f.feeVolume), feesSyncedAt: now };
        return db.squareDayMoney.upsert({ where: { date: parseISODate(f.date) }, create: { date: parseISODate(f.date), ...data }, update: data });
      }),
    );
  } catch (e) {
    await logSquareError("sales", `Card fees: ${friendlySquareError(e)}`).catch(() => undefined);
  }

  // Comps and discounts by the person who took the payment.
  const byMember = new Map<string, string[]>();
  for (const p of payments) {
    if (!p.orderId || !p.teamMemberId || p.status !== "COMPLETED") continue;
    byMember.set(p.teamMemberId, [...(byMember.get(p.teamMemberId) ?? []), p.orderId]);
  }
  if (byMember.size) {
    await db.$transaction([...byMember].map(([tm, orderIds]) => db.squareDiscount.updateMany({ where: { orderId: { in: orderIds }, teamMemberId: "" }, data: { teamMemberId: tm } })));
  }

  return { payments: payments.length, tips: tipRows.reduce((a, r) => a + r.amount, 0), fees: fees ? fees.reduce((s, f) => s + netFees(f), 0) : null };
}

/**
 * Same, but a failure is logged instead of thrown: tips by person and card
 * fees are extra detail, and must never stop sales or the history import.
 */
export async function syncPaymentsQuietly(from: ISODate, toExclusive: ISODate, client?: SquareClient) {
  try {
    return await syncPayments(from, toExclusive, client);
  } catch (e) {
    await logSquareError("sales", `Card tips and fees: ${friendlySquareError(e)}`).catch(() => undefined);
    return null;
  }
}

// ---- Discount names → what they count as (Settings → Money) ------------------------------------

const MAPPING_KEY = "money.discountClasses";

export async function getDiscountMapping(): Promise<Record<string, DiscountClass>> {
  // Read once per render (the P&L asks once per compared period).
  const raw = await settingValue(MAPPING_KEY);
  let v: unknown = null;
  try {
    v = raw == null ? null : JSON.parse(raw);
  } catch {}
  return parseDiscountMapping(v);
}

/** Team members linked to Square, by Square team member id (who took a discounted payment). Once per render. */
const squareStaffNames = cache(async () => {
  const staff = await db.employee.findMany({ where: { squareTeamMemberId: { not: null } }, select: { name: true, squareTeamMemberId: true } });
  return new Map(staff.map((e) => [e.squareTeamMemberId!, e.name]));
});

/** Set (or with `cls` null, clear back to the default) what one discount name counts as. */
export async function setDiscountClass(name: string, cls: DiscountClass | null) {
  const cur = await getDiscountMapping();
  const key = discountKey(name);
  if (cls) cur[key] = cls;
  else delete cur[key];
  await writeSettingJSON(MAPPING_KEY, cur);
}

/** Every discount name seen in [from, toExclusive), with how much and how often, biggest first. */
export async function discountNames(from: ISODate, toExclusive: ISODate) {
  const rows = await db.squareDiscount.groupBy({ by: ["name"], where: { date: range(from, toExclusive) }, _sum: { amount: true }, _count: { _all: true }, _max: { date: true } });
  const fullRows = await db.squareDiscount.groupBy({ by: ["name"], where: { date: range(from, toExclusive), full: true }, _count: { _all: true } });
  const full = new Map(fullRows.map((r) => [r.name, r._count._all]));
  const by = new Map<string, { name: string; amount: number; lines: number; full: number; last: ISODate }>();
  for (const r of rows) {
    const k = discountKey(r.name);
    const cur = by.get(k) ?? { name: r.name, amount: 0, lines: 0, full: 0, last: toISODate(r._max.date!) };
    cur.amount += r._sum.amount?.toNumber() ?? 0;
    cur.lines += r._count._all;
    cur.full += full.get(r.name) ?? 0;
    if (toISODate(r._max.date!) > cur.last) cur.last = toISODate(r._max.date!);
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount);
}

// ---- Reading ------------------------------------------------------------------------------------

export interface MoneyDay {
  /** Net card fees; null when the payments sync hasn't covered the day. */
  fees: number | null;
  cardFees: number | null;
  feesReturned: number | null;
  feeVolume: number | null;
  feePending: number;
  /** Comps & discounts on items that count in net sales; null when the orders sync hasn't covered the day. */
  discounts: number | null;
}

/**
 * Fees and comps & discounts for business dates [from, toExclusive): per day,
 * plus the discount breakdown (by class, reason, item and staff). Discounts on
 * items marked "Ignore" are left out, as they are from net sales.
 */
export async function moneyForRange(from: ISODate, toExclusive: ISODate) {
  const [days, rows, ignored, mapping, staff] = await Promise.all([
    db.squareDayMoney.findMany({ where: { date: range(from, toExclusive) } }),
    db.squareDiscount.findMany({ where: { date: range(from, toExclusive) } }),
    ignoredSquareIds(),
    getDiscountMapping(),
    squareStaffNames(),
  ]);
  const names = staff;
  const stored: StoredDiscount[] = rows.map((r) => ({
    date: toISODate(r.date),
    name: r.name,
    squareId: r.squareId,
    itemName: r.itemName,
    teamMemberId: r.teamMemberId,
    amount: r.amount.toNumber(),
    qty: r.qty.toNumber(),
    full: r.full,
    percentage: r.percentage,
  }));
  const summary = summarizeDiscounts(stored, mapping, { ignored: new Set(ignored), staffName: (id) => names.get(id) ?? "Not on the team list" });
  const byDay = new Map<ISODate, MoneyDay>();
  for (const d of days) {
    const date = toISODate(d.date);
    const synced = d.feesSyncedAt != null && d.cardFees != null;
    byDay.set(date, {
      fees: synced ? Math.round((d.cardFees!.toNumber() - (d.feesReturned?.toNumber() ?? 0)) * 100) / 100 : null,
      cardFees: synced ? d.cardFees!.toNumber() : null,
      feesReturned: synced ? d.feesReturned?.toNumber() ?? 0 : null,
      feeVolume: synced ? d.feeVolume?.toNumber() ?? 0 : null,
      feePending: d.feePending,
      discounts: d.discountsSyncedAt != null ? summary.byDay.get(date)?.total ?? 0 : null,
    });
  }
  return { byDay, summary, mapping };
}

export type RangeMoney = Awaited<ReturnType<typeof moneyForRange>>;

/** Totals over some days of a range: null when none of them is synced; `missing` = days not synced. */
export function moneyTotals(m: RangeMoney, dates: ISODate[]) {
  let fees: number | null = null;
  let cardFees = 0;
  let returned = 0;
  let volume = 0;
  let discounts: number | null = null;
  let feesMissing = 0;
  let discountsMissing = 0;
  let pending = 0;
  for (const d of dates) {
    const x = m.byDay.get(d);
    if (x?.fees != null) {
      fees = (fees ?? 0) + x.fees;
      cardFees += x.cardFees ?? 0;
      returned += x.feesReturned ?? 0;
      volume += x.feeVolume ?? 0;
      pending += x.feePending;
    } else feesMissing++;
    if (x?.discounts != null) discounts = (discounts ?? 0) + x.discounts;
    else discountsMissing++;
  }
  return { fees, cardFees, feesReturned: returned, feeVolume: volume, feePending: pending, feesMissing, discounts, discountsMissing };
}
