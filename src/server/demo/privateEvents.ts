import { Prisma, type PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { addDays, parseISODate, type ISODate } from "@/domain/dates";
import { forecastImpact, quoteTotals } from "@/domain/privateEvents";

/**
 * Private events demo: two per-person packages built from the menu, and seven
 * bookings across the pipeline (an inquiry nobody has quoted, a follow-up due,
 * a quote with the deposit due in two days, a buyout with the deposit in, a
 * confirmed holiday party on the calendar, one done and one lost). Clears its
 * own rows first; only touches calendar events it created.
 */

const D = (n: number) => new Prisma.Decimal(n);

export async function seedPrivateEvents(db: PrismaClient, today: ISODate): Promise<void> {
  const old = await db.privateEvent.findMany({ select: { calendarEventId: true } });
  const calIds = old.map((o) => o.calendarEventId).filter((x): x is string => !!x);
  if (calIds.length) await db.event.deleteMany({ where: { id: { in: calIds } } });
  await db.privateEvent.deleteMany({});
  await db.privateEventPackage.deleteMany({});

  const recipes = await db.recipe.findMany({ where: { active: true, kind: "MENU" }, select: { id: true, name: true, menuPrice: true } });
  const byName = (n: string) => recipes.find((r) => r.name === n);
  const items = (list: [string, number][]) =>
    list.map(([n, per], i) => ({ r: byName(n), per, i })).filter((x) => x.r).map((x) => ({ recipeId: x.r!.id, perGuest: D(x.per), sort: x.i }));

  const buffet = await db.privateEventPackage.create({
    data: {
      name: "Taproom buffet",
      description: "Burgers (beef and Impossible), wings, pretzels with beer cheese, frites and Caesar salad, served buffet-style for two hours.",
      pricePerPerson: D(34),
      sort: 1,
      items: { create: items([["Classic Burger", 0.5], ["Impossible Classic", 0.2], ["Wings (10)", 0.3], ["Bavarian Pretzel", 0.25], ["Frites", 0.5], ["Caesar Salad", 0.25]]) },
    },
  });
  const sliders = await db.privateEventPackage.create({
    data: {
      name: "Sliders & snacks",
      description: "Lil burgers, chicken tenders, pretzels and fry cones — passed or on a table.",
      pricePerPerson: D(22),
      sort: 2,
      items: { create: items([["Lil Burger", 1], ["Chicken Tenders", 0.3], ["Bavarian Pretzel", 0.25], ["Frites", 0.4]]) },
    },
  });

  const token = () => randomBytes(32).toString("base64url");
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  type Booking = Prisma.PrivateEventCreateInput & { lines?: Prisma.PrivateEventLineCreateWithoutPrivateEventInput[]; pays?: { amount: number; kind: string; method: string; on: ISODate }[] };
  const pkgLine = (p: { id: string; name: string; pricePerPerson: Prisma.Decimal }) => ({ kind: "PACKAGE", packageId: p.id, label: p.name, qty: D(1), perPerson: true, unitPrice: p.pricePerPerson, sort: 1 });
  const itemLine = (n: string, qty: number, perPerson: boolean, sort: number) => {
    const r = byName(n);
    return r ? { kind: "ITEM", recipeId: r.id, label: r.name, qty: D(qty), perPerson, unitPrice: r.menuPrice ?? D(0), sort } : null;
  };

  const bookings: Booking[] = [
    {
      clientName: "Pat Hennessey", company: "Catskill Rotary holiday party", clientEmail: "pat.hennessey@example.com", clientPhone: "(518) 555-0142", type: "CORPORATE", stage: "CONFIRMED",
      date: parseISODate(addDays(today, 19)), startTime: "18:00", endTime: "21:00", space: "Back room", headcount: 40,
      barKind: "TICKETS", drinkTickets: 80, ticketPrice: D(7), roomFee: D(150),
      depositDueOn: parseISODate(addDays(today, -14)), balanceDueOn: parseISODate(addDays(today, 16)), quoteSentAt: daysAgo(24), quoteViewedAt: daysAgo(23), acceptedAt: daysAgo(22), acceptedName: "Pat Hennessey", quoteToken: token(),
      notes: "Two gluten-free guests. Santa arrives 7:30 — keep the side door clear.", quoteNote: "Includes two hours of buffet and two drink tickets per guest. Back room is yours 6–9pm.",
      lines: [pkgLine(buffet)], pays: [{ amount: 700, kind: "DEPOSIT", method: "CHECK", on: addDays(today, -15) }],
    },
    {
      clientName: "Dana Morgan", company: "Morgan & Lee rehearsal dinner", clientEmail: "dana.morgan@example.com", type: "REHEARSAL", stage: "QUOTED",
      date: parseISODate(addDays(today, 33)), startTime: "18:30", endTime: "21:30", space: "Back room", headcount: 30,
      barKind: "OPEN_TAB", barAmount: D(900), roomFee: D(200),
      depositDueOn: parseISODate(addDays(today, 2)), balanceDueOn: parseISODate(addDays(today, 30)), quoteSentAt: daysAgo(5), quoteViewedAt: daysAgo(4), quoteToken: token(),
      lines: [itemLine("Bavarian Pretzel", 4, false, 1), itemLine("Figgy Piggy Burger", 1, true, 2), itemLine("Caesar Salad", 0.5, true, 3)].filter(Boolean) as Prisma.PrivateEventLineCreateWithoutPrivateEventInput[],
      notes: "Wedding is Saturday at the Beattie-Powers house.",
    },
    {
      clientName: "Rob Alvarez", company: "Hudson Valley Realtors buyout", clientEmail: "rob@example.com", type: "BUYOUT", stage: "DEPOSIT",
      date: parseISODate(addDays(today, 10)), startTime: "17:00", endTime: "22:00", space: "Whole taproom", headcount: 90,
      barKind: "MINIMUM", barAmount: D(2500), roomFee: D(500), depositAmount: D(1500),
      depositDueOn: parseISODate(addDays(today, -6)), balanceDueOn: parseISODate(addDays(today, 7)), quoteSentAt: daysAgo(12), quoteViewedAt: daysAgo(12), acceptedAt: daysAgo(11), acceptedName: "Robert Alvarez", quoteToken: token(),
      lines: [pkgLine(sliders)], pays: [{ amount: 1500, kind: "DEPOSIT", method: "CARD", on: addDays(today, -8) }],
    },
    { clientName: "Jen Walsh", company: "Jen's 40th", clientPhone: "(845) 555-0199", type: "PARTY", stage: "INQUIRY", date: parseISODate(addDays(today, 27)), headcount: 25, space: "Patio", createdAt: daysAgo(3), notes: "Asked about the patio heaters." },
    { clientName: "Sam Ortiz", company: "Catskill Tech team night", clientEmail: "sam@example.com", type: "CORPORATE", stage: "INQUIRY", date: parseISODate(addDays(today, 45)), headcount: 18, followUpOn: parseISODate(today), createdAt: daysAgo(1), notes: "Wants a quote for sliders + tickets. Call back after their budget meeting." },
    {
      clientName: "Leah Chen", company: "Greene County Bar Association", type: "CORPORATE", stage: "DONE", date: parseISODate(addDays(today, -22)), startTime: "17:30", endTime: "20:00", space: "Back room", headcount: 35,
      barKind: "TICKETS", drinkTickets: 70, ticketPrice: D(7), quoteSentAt: daysAgo(50), acceptedAt: daysAgo(48), acceptedName: "Leah Chen", quoteToken: token(),
      lines: [pkgLine(sliders)], pays: [{ amount: 400, kind: "DEPOSIT", method: "CARD", on: addDays(today, -45) }, { amount: 1450.68, kind: "BALANCE", method: "CARD", on: addDays(today, -22) }],
    },
    { clientName: "Kim Park", company: "Park–Rossi wedding", type: "WEDDING", stage: "LOST", date: parseISODate(addDays(today, 60)), headcount: 120, space: "Whole taproom", lostReason: "Went with a venue that does ceremonies.", createdAt: daysAgo(30), lines: [pkgLine(buffet)] },
  ];

  const ownerId = (await db.user.findFirst({ where: { role: "MANAGER" }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
  for (const b of bookings) {
    const { lines, pays, ...data } = b;
    const e = await db.privateEvent.create({
      data: {
        ...data,
        owner: ownerId ? { connect: { id: ownerId } } : undefined,
        lines: lines?.length ? { create: lines.map((l, j) => ({ ...l, sort: j + 1 })) } : undefined,
        payments: pays?.length ? { create: pays.map((p) => ({ amount: D(p.amount), kind: p.kind, method: p.method, paidOn: parseISODate(p.on) })) } : undefined,
      },
      include: { lines: true },
    });
    // Confirmed and done bookings sit on the events calendar, like the app keeps them.
    if ((e.stage === "CONFIRMED" || e.stage === "DONE") && e.date) {
      const q = quoteTotals({
        headcount: e.headcount,
        lines: e.lines.map((l) => ({ label: l.label, qty: l.qty.toNumber(), perPerson: l.perPerson, unitPrice: l.unitPrice.toNumber(), unitCost: null })),
        roomFee: e.roomFee.toNumber(),
        bar: { kind: e.barKind as "TICKETS", tickets: e.drinkTickets, ticketPrice: e.ticketPrice.toNumber(), amount: e.barAmount.toNumber() },
        serviceChargePct: 0.2, taxPct: 0.08, depositPct: 0.25, depositAmount: null, barCostPct: 0.25,
      });
      const ev = await db.event.create({
        data: { date: e.date, title: `Private event: ${e.company ?? e.clientName}`, kind: "PRIVATE", startTime: e.startTime, endTime: e.endTime, impact: D(forecastImpact({ eventSales: q.food + q.bar, headcount: e.headcount, buyout: e.space === "Whole taproom", baseline: 3200 })), notes: `${e.headcount} guests · ${e.space}. Managed in Private events.` },
      });
      await db.privateEvent.update({ where: { id: e.id }, data: { calendarEventId: ev.id } });
    }
  }
}
