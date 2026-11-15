import type { PrismaClient } from "@prisma/client";
import { addDays, todayIn } from "@/domain/dates";

/**
 * Shift notes demo: a couple of weeks of end-of-shift handoffs, with last
 * night's close carrying 86'd items, comps, a short drawer and a fix so the
 * morning brief and Overview have something to show. Clears its own rows first.
 */
export async function seedShiftNotes(db: PrismaClient, timeZone = process.env.BUSINESS_TIMEZONE || "America/New_York") {
  await db.shiftNote.deleteMany({});
  const today = todayIn(timeZone);
  const users = await db.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true } });
  const by = (role: string) => users.find((u) => u.role === role) ?? users[0];
  const mgr = by("MANAGER");
  const staff = by("STAFF");
  const d = (n: number) => new Date(`${addDays(today, n)}T00:00:00.000Z`);
  const at = (n: number, h: number) => new Date(Date.parse(`${addDays(today, n)}T00:00:00.000Z`) + (h + 5) * 3600_000);
  const rows = [
    { date: d(-1), shift: "close", author: staff, at: at(-1, 23), eightySixed: ["Wings", "New York Nectar"], tags: ["Slammed", "Ice machine"], comps: "Burger came out cold, comped it", compsAmount: 18, cash: "Left $200 float", cashOverShort: -6, maintenance: "Ice machine dripping under the bar", issues: null, notes: "Trivia ran long. Walk-in is low on lemons." },
    { date: d(-1), shift: "open", author: mgr, at: at(-1, 13), eightySixed: [], tags: ["Steady"], comps: null, compsAmount: null, cash: null, cashOverShort: 0, maintenance: null, issues: "Sysco was 40 minutes late", notes: null },
    { date: d(-2), shift: "close", author: staff, at: at(-2, 22), eightySixed: ["Fries"], tags: ["Quiet"], comps: null, compsAmount: null, cash: null, cashOverShort: 0, maintenance: null, issues: null, notes: "Quiet night, deep-cleaned the fryer." },
    { date: d(-3), shift: "close", author: staff, at: at(-3, 23), eightySixed: ["Pretzel", "Wings"], tags: ["Slammed", "Big party", "Short-staffed"], comps: "Birthday dessert", compsAmount: 9, cash: null, cashOverShort: 2, maintenance: null, issues: "Party of 14 walked in, no reservation", notes: null },
    { date: d(-5), shift: "close", author: mgr, at: at(-5, 22), eightySixed: [], tags: ["Draft lines"], comps: null, compsAmount: null, cash: null, cashOverShort: 0, maintenance: "Line 4 foaming, swapped the coupler", issues: null, notes: null, handled: true },
    { date: d(-8), shift: "close", author: staff, at: at(-8, 23), eightySixed: ["Wings"], tags: ["Steady"], comps: null, compsAmount: null, cash: null, cashOverShort: -1, maintenance: null, issues: null, notes: null },
  ];
  for (const r of rows) {
    await db.shiftNote.create({
      data: {
        date: r.date,
        shift: r.shift,
        authorId: r.author?.id ?? null,
        authorName: r.author?.name ?? "Staff",
        eightySixed: r.eightySixed,
        tags: r.tags,
        comps: r.comps,
        compsAmount: r.compsAmount,
        cash: r.cash,
        cashOverShort: r.cashOverShort,
        maintenance: r.maintenance,
        issues: r.issues,
        notes: r.notes,
        createdAt: r.at,
        handledAt: "handled" in r && r.handled ? r.at : null,
        handledBy: "handled" in r && r.handled ? mgr?.name ?? null : null,
      },
    });
  }
}
