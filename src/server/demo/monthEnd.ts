import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

/**
 * Month-end demo: what the Square sync, counts, tip pools and payroll would
 * have left behind for the last ~5 months, so the close has something to show.
 * - tax.<date> (8% on all but a sliver of sales) and tips.<date> per day with sales,
 *   plus card tips in SquareTip;
 * - a completed stock count on the last day of each of the last 4 months (area "Month-end demo");
 * - two-week tip pools, finalized up to the middle of last month;
 * - two-week pay periods, approved up to the same point.
 * Run after the base demo and seedFees (it reads their sales). Clears its own rows first.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000));
const D = (n: number, dp = 2) => new Prisma.Decimal(n.toFixed(dp));

export async function seedMonthEnd(db: PrismaClient, today = iso(new Date())) {
  const firstThisMonth = `${today.slice(0, 7)}-01`;
  const start = (() => {
    const d = day(firstThisMonth);
    d.setUTCMonth(d.getUTCMonth() - 5);
    return iso(d);
  })();

  // ---- Tax and tips per day, from the stored sales.
  const sales = await db.hourlySale.groupBy({ by: ["date"], where: { date: { gte: day(start), lt: day(today) } }, _sum: { netSales: true } });
  const settings: { key: string; value: string }[] = [];
  const cardTips: Prisma.SquareTipCreateManyInput[] = [];
  for (const s of sales) {
    const date = iso(s.date);
    const net = s._sum.netSales?.toNumber() ?? 0;
    if (net <= 0) continue;
    const r = rng(Number(date.replace(/-/g, "")) ^ 0x5eed);
    const nonTaxable = net * (0.01 + r() * 0.03);
    // A handful of older days never got tax stored (an old sync), so the close has something to flag.
    if (!(date < addDays(start, 20) && r() < 0.15)) settings.push({ key: `tax.${date}`, value: ((net - nonTaxable) * 0.08).toFixed(2) });
    const tips = net * (0.15 + r() * 0.04);
    settings.push({ key: `tips.${date}`, value: tips.toFixed(2) });
    cardTips.push({ date: s.date, kind: "CARD", teamMemberId: "", amount: D(tips * 0.88), count: Math.round(net / 40) });
  }
  const keys = settings.map((s) => s.key);
  await db.setting.deleteMany({ where: { key: { in: keys } } });
  await db.setting.createMany({ data: settings });
  await db.squareTip.deleteMany({ where: { date: { gte: day(start), lt: day(today) }, kind: "CARD" } });
  await db.squareTip.createMany({ data: cardTips });

  // ---- Month-end counts.
  await db.stockCount.deleteMany({ where: { area: "Month-end demo" } });
  const ingredients = await db.ingredient.findMany({ where: { active: true }, select: { id: true, baseUnit: true, preferredProduct: { select: { packQtyBase: true } } } });
  const manager = await db.user.findFirst({ where: { role: "MANAGER" }, select: { id: true } });
  for (let i = 1; i <= 4; i++) {
    const d = day(firstThisMonth);
    d.setUTCMonth(d.getUTCMonth() - i + 1);
    const last = addDays(iso(d), -1);
    const r = rng(Number(last.replace(/-/g, "")));
    await db.stockCount.create({
      data: {
        takenAt: new Date(`${last}T15:30:00Z`),
        userId: manager?.id,
        area: "Month-end demo",
        completed: true,
        lines: {
          create: ingredients.map((ing) => {
            const pack = ing.preferredProduct?.packQtyBase?.toNumber() ?? (ing.baseUnit === "each" ? 12 : 1000);
            return { ingredientId: ing.id, qtyBase: D(pack * (0.4 + r() * 2.2) * (1 + (i === 1 ? 0.06 : 0)), 4) };
          }),
        },
      },
    });
  }

  // ---- Tip pools and pay periods: two weeks each, Monday to Sunday, finalized / approved up to mid last month.
  const lastMonth = (() => {
    const d = day(firstThisMonth);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return iso(d);
  })();
  const cutoff = addDays(lastMonth, 17);
  let mon = start;
  while (day(mon).getUTCDay() !== 1) mon = addDays(mon, 1);
  const people = await db.employee.findMany({ where: { active: true }, select: { id: true }, take: 6 });
  await db.tipPeriod.deleteMany({ where: { startDate: { gte: day(start) } } });
  await db.payPeriod.deleteMany({ where: { startDate: { gte: day(start) } } });
  const tipByDay = new Map(cardTips.map((t) => [iso(t.date as Date), Number(t.amount)]));
  for (let a = mon; addDays(a, 13) < cutoff; a = addDays(a, 14)) {
    const b = addDays(a, 13);
    let card = 0;
    for (let x = a; x <= b; x = addDays(x, 1)) card += tipByDay.get(x) ?? 0;
    const share = card / Math.max(1, people.length);
    await db.tipPeriod.create({
      data: {
        startDate: day(a),
        endDate: day(b),
        totalTips: D(card),
        cardTips: D(card),
        cashTips: D(0),
        method: "HOURS",
        finalized: true,
        allocations: { create: people.map((p) => ({ employeeId: p.id, hours: D(60), points: D(0), amount: D(share), cardAmount: D(share), cashAmount: D(0) })) },
      },
    });
    await db.payPeriod.create({ data: { startDate: day(a), endDate: day(b), status: "APPROVED", approvedBy: "Max", approvedAt: new Date(`${addDays(b, 2)}T14:00:00Z`) } });
  }
}
