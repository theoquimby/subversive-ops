import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

/**
 * Card fees and comps & discounts demo: for every day with sales in the last
 * 120 days, Square-like card fees (about 2.6% of card payments, most sales on
 * card, the odd refund giving a fee back) and a handful of discounts on items
 * that sold that day (comps, spills, staff meals, happy hour). A step up in
 * the last week makes "What moved" speak. Clears its own rows first.
 */

const REASONS = [
  { name: "Comp", full: true, share: 0.25 },
  { name: "Manager comp", full: true, share: 0.1 },
  { name: "Spill", full: true, share: 0.1 },
  { name: "Staff meal", full: false, share: 0.2 },
  { name: "Happy hour", full: false, share: 0.35 },
];

/** Small deterministic random, so the demo looks the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export async function seedFees(db: PrismaClient) {
  const today = new Date();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 120));
  const [days, items, members] = await Promise.all([
    db.hourlySale.groupBy({ by: ["date"], where: { date: { gte: from } }, _sum: { netSales: true } }),
    db.dailySale.findMany({ where: { date: { gte: from }, netSales: { gt: 0 }, qty: { gt: 0 } }, select: { date: true, squareId: true, name: true, qty: true, netSales: true } }),
    db.employee.findMany({ where: { squareTeamMemberId: { not: null } }, select: { squareTeamMemberId: true }, take: 4 }),
  ]);
  await db.squareDiscount.deleteMany({ where: { orderId: { startsWith: "demo-" } } });
  await db.squareDayMoney.deleteMany({ where: { date: { gte: from } } });
  const byDay = new Map<string, typeof items>();
  for (const i of items) {
    const k = i.date.toISOString().slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }
  const tms = members.map((m) => m.squareTeamMemberId!);
  const lastWeek = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 8));
  const D = (n: number) => new Prisma.Decimal(n.toFixed(2));
  const rows: Prisma.SquareDiscountCreateManyInput[] = [];
  const now = new Date();
  for (const d of days) {
    const date = d.date.toISOString().slice(0, 10);
    const sales = d._sum.netSales?.toNumber() ?? 0;
    if (sales <= 0) continue;
    const r = rng(Number(date.replace(/-/g, "")));
    const recent = d.date >= lastWeek;
    // Card share of sales + tips, and the effective rate (a bit higher lately: more keyed-in cards).
    const volume = sales * (0.8 + r() * 0.1) * 1.18;
    const rate = (recent ? 0.0295 : 0.0262) + (r() - 0.5) * 0.002;
    const fees = volume * rate;
    const returned = r() < 0.15 ? 0.4 + r() * 1.2 : 0;
    // Comps & discounts: 2–3% of sales, more lately.
    let left = sales * (recent ? 0.045 : 0.024) * (0.7 + r() * 0.6);
    const pool = (byDay.get(date) ?? []).filter((i) => i.netSales.toNumber() / Math.max(1, i.qty.toNumber()) > 2);
    let total = 0;
    let n = 0;
    while (left > 1 && pool.length && n < 30) {
      const item = pool[Math.floor(r() * pool.length)];
      const reason = REASONS.find((x, idx) => r() < x.share || idx === REASONS.length - 1)!;
      const unit = item.netSales.toNumber() / Math.max(1, item.qty.toNumber());
      const amount = Math.min(left, reason.full ? unit : unit * 0.5);
      rows.push({ date: d.date, orderId: `demo-${date}-${n}`, name: reason.name, squareId: item.squareId, itemName: item.name, teamMemberId: tms.length ? tms[Math.floor(r() * tms.length)] : "", amount: D(amount), qty: new Prisma.Decimal(1), full: reason.full, percentage: reason.full ? "100" : reason.name === "Staff meal" ? "50" : null });
      total += amount;
      left -= amount;
      n++;
    }
    await db.squareDayMoney.create({
      data: { date: d.date, cardFees: D(fees), feesReturned: D(returned), feePayments: Math.round(volume / 38), feePending: 0, feeVolume: D(volume), feesSyncedAt: now, discounts: D(total), discountsSyncedAt: now },
    });
  }
  if (rows.length) await db.squareDiscount.createMany({ data: rows });
}
