/**
 * Labor demo data: positions, a 12-person team (one minor), ~10 weeks of
 * timecards that follow the seeded sales pattern (closed Tuesdays, busy
 * weekends), and hour-by-hour sales derived from the daily totals.
 *
 * Idempotent and cooperative: positions upsert by name (existing ones kept);
 * the team is only created when there are no employees yet; timecards are
 * only generated for days that have none (using whoever is on the team);
 * hourly sales only when that table is empty. No "server-only" import — this also runs from the CLI.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { addDays, dateRange, ISODate, parseISODate, todayIn, toISODate, weekday } from "../../domain/dates";
import { hourlyShape, splitCents } from "../../domain/pnl";
import { zonedTime } from "../../domain/timecards";

// Same defaults as getOpeningHours() in services/labor-rules.ts (0=Sun; Tuesday closed).
const OPENING_HOURS: Record<number, [number, number]> = { 0: [12, 19], 1: [16, 20], 3: [16, 20], 4: [16, 20], 5: [16, 21], 6: [12, 21] };

const D = (n: number) => new Prisma.Decimal(n.toFixed(2));

const POSITIONS = [
  { name: "Server", area: "FOH", color: "#2563eb", defaultRate: 10.7, tipPoints: 1, tipEligible: true, salesPerHour: 300, minStaff: 1, maxStaff: 4 },
  { name: "Bartender", area: "BAR", color: "#d97706", defaultRate: 11, tipPoints: 1.2, tipEligible: true, salesPerHour: 350, minStaff: 1, maxStaff: 3 },
  { name: "Line cook", area: "BOH", color: "#dc2626", defaultRate: 19, tipPoints: 0, tipEligible: false, salesPerHour: 400, minStaff: 1, maxStaff: 3 },
  { name: "Dishwasher", area: "BOH", color: "#64748b", defaultRate: 16.5, tipPoints: 0, tipEligible: false, salesPerHour: 900, minStaff: 1, maxStaff: 2 },
  { name: "Expo", area: "FOH", color: "#16a34a", defaultRate: 16.5, tipPoints: 0.5, tipEligible: true, salesPerHour: 700, minStaff: 0, maxStaff: 1 },
] as const;

type PosName = (typeof POSITIONS)[number]["name"];

const evenings = { "1": [["15:00", "22:00"]], "3": [["15:00", "22:00"]], "4": [["15:00", "22:00"]], "5": [["15:00", "23:00"]] } as Record<string, [string, string][]>;

const TEAM: { name: string; rate: number; positions: [PosName, number?][]; isMinor?: boolean; maxHoursWeek?: number; availability?: Record<string, [string, string][]>; login?: string }[] = [
  { name: "Maya Ortiz", rate: 11, positions: [["Bartender"], ["Server", 10.7]] },
  { name: "Jake Brennan", rate: 11.5, positions: [["Bartender"]] },
  { name: "Lena Fischer", rate: 11, positions: [["Bartender"], ["Server", 10.7]], maxHoursWeek: 30 },
  { name: "Priya Shah", rate: 10.7, positions: [["Server"]] },
  { name: "Tom Keller", rate: 10.7, positions: [["Server"]], maxHoursWeek: 28 },
  { name: "Hannah Lee", rate: 10.7, positions: [["Server"], ["Expo", 16.5]] },
  { name: "Nate Collins", rate: 16.5, positions: [["Expo"], ["Server", 10.7]], maxHoursWeek: 25 },
  { name: "Carlos Mendez", rate: 23, positions: [["Line cook"]], login: "Line" },
  { name: "Dana Russo", rate: 20, positions: [["Line cook"]] },
  { name: "Eli Park", rate: 18.5, positions: [["Line cook"], ["Dishwasher", 16.5]], availability: evenings },
  { name: "Rosa Alvarez", rate: 16.5, positions: [["Dishwasher"]] },
  {
    name: "Sam Whitaker", rate: 16, positions: [["Dishwasher"]], isMinor: true, maxHoursWeek: 18,
    availability: { "0": [["11:00", "20:00"]], "5": [["16:00", "22:00"]], "6": [["11:00", "22:00"]] },
  },
];

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const tzOf = () => process.env.BUSINESS_TIMEZONE || "America/New_York";

export async function seedLabor(db: PrismaClient): Promise<void> {
  const tz = tzOf();
  const today = todayIn(tz);
  const from = addDays(today, -70);
  const rand = rng(1907);

  // ---- Positions ----
  const posId = new Map<PosName, string>();
  for (const [i, p] of POSITIONS.entries()) {
    const data = { area: p.area, color: p.color, defaultRate: D(p.defaultRate), tipPoints: D(p.tipPoints), tipEligible: p.tipEligible, salesPerHour: D(p.salesPerHour), minStaff: p.minStaff, maxStaff: p.maxStaff, sort: i };
    const row = await db.position.upsert({ where: { name: p.name }, create: { name: p.name, ...data }, update: {} });
    posId.set(p.name, row.id);
  }

  // ---- Hourly sales from daily totals ----
  const ignored = new Set((await db.squareMapping.findMany({ where: { ignored: true }, select: { squareId: true } })).map((m) => m.squareId));
  const daily = await db.dailySale.groupBy({ by: ["date", "squareId"], where: { date: { gte: new Date(`${from}T00:00:00Z`) } }, _sum: { netSales: true } });
  const salesByDay = new Map<ISODate, number>();
  for (const d of daily) {
    if (ignored.has(d.squareId)) continue;
    const k = toISODate(d.date);
    salesByDay.set(k, (salesByDay.get(k) ?? 0) + (d._sum.netSales?.toNumber() ?? 0));
  }
  if ((await db.hourlySale.count()) === 0) {
    const rows: Prisma.HourlySaleCreateManyInput[] = [];
    for (const [date, total] of salesByDay) {
      const hours = OPENING_HOURS[weekday(date)];
      if (!hours || total <= 0) continue;
      const shape = hourlyShape(hours[0], hours[1]).map((w) => w * (0.85 + rand() * 0.3));
      splitCents(total, shape).forEach((amount, hour) => {
        if (amount <= 0) return;
        rows.push({ date: new Date(`${date}T00:00:00Z`), hour, netSales: D(amount), orders: Math.max(1, Math.round(amount / (27 + rand() * 9))) });
      });
    }
    await db.hourlySale.createMany({ data: rows });
  }

  // ---- Team (only into an empty table, so another feature's demo team is kept) ----
  if ((await db.employee.count()) === 0) {
    const users = new Map((await db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.name, u.id]));
    for (const t of TEAM) {
      await db.employee.create({
        data: {
          name: t.name,
          hourlyRate: D(t.rate),
          isMinor: t.isMinor ?? false,
          maxHoursWeek: t.maxHoursWeek ?? null,
          availability: t.availability ?? Prisma.JsonNull,
          userId: t.login ? (users.get(t.login) ?? null) : null,
          positions: { create: t.positions.map(([p, rate]) => ({ positionId: posId.get(p)!, rate: rate != null ? D(rate) : null })) },
        },
      });
    }
  }
  const posName = new Map([...posId].map(([n, id]) => [id, n]));
  const team = (await db.employee.findMany({ where: { active: true }, include: { positions: true }, orderBy: { name: "asc" } })).map((e) => ({
    id: e.id,
    // Primary position first (the order they were assigned in).
    positions: e.positions.map((p) => posName.get(p.positionId)).filter((n): n is PosName => !!n),
    isMinor: e.isMinor,
    maxHours: e.maxHoursWeek ?? 40,
    availability: (e.availability ?? undefined) as Record<string, [string, string][]> | undefined,
  }));

  // ---- Timecards, only for days that have none (keeps any hand-made or other demo cards) ----
  const existing = await db.timecard.findMany({ where: { clockIn: { gte: zonedTime(from, 0, tz) } }, select: { clockIn: true } });
  const covered = new Set(existing.map((t) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(t.clockIn)));

  // Typical sales per weekday, for days without sales yet (today).
  const avg = new Map<number, number[]>();
  for (const [d, s] of salesByDay) avg.set(weekday(d), [...(avg.get(weekday(d)) ?? []), s]);
  const typical = (d: ISODate) => {
    const xs = avg.get(weekday(d)) ?? [];
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1500;
  };

  const now = new Date();
  const cards: Prisma.TimecardCreateManyInput[] = [];
  const weekHours = new Map<string, number>();
  let week = "";
  for (const date of dateRange(from, addDays(today, 1))) {
    const hours = OPENING_HOURS[weekday(date)];
    if (!hours || covered.has(date)) continue;
    const monday = addDays(date, -((weekday(date) + 6) % 7));
    if (monday !== week) {
      week = monday;
      weekHours.clear();
    }
    const [o, c] = hours;
    const sales = salesByDay.get(date) ?? typical(date);
    const peak = Math.max(o, 16);
    const shifts: [PosName, number, number][] = [
      ["Server", o - 0.5, c + 0.5],
      ["Bartender", o - 0.5, c + 0.75],
      ["Line cook", o - 1, c + 0.5],
      ["Dishwasher", Math.max(o, 15), c + 1],
    ];
    if (sales > 1700) shifts.push(["Server", peak, c + 0.5]);
    if (sales > 2600) shifts.push(["Server", Math.max(o, 17), c]);
    if (sales > 2100) shifts.push(["Bartender", peak, c + 0.5]);
    if (sales > 1500) shifts.push(["Line cook", peak - 0.5, c + 0.5]);
    if (sales > 2300 && c - 17 >= 3) shifts.push(["Expo", 17, c]);

    const busy = new Set<string>();
    for (const [pos, s0, e0] of shifts) {
      const len = e0 - s0;
      const fits = team.filter((p) => {
        if (!p.positions.includes(pos) || busy.has(p.id)) return false;
        if ((weekHours.get(p.id) ?? 0) + len > p.maxHours) return false;
        if (p.isMinor && (len > 8 || e0 > 22)) return false;
        if (p.availability) {
          const win = p.availability[String(weekday(date))] ?? [];
          const hm = (x: string) => Number(x.slice(0, 2)) + Number(x.slice(3)) / 60;
          if (!win.some(([a, b]) => hm(a) <= s0 && hm(b) >= e0)) return false;
        }
        return true;
      });
      // Primary position holders first, then fewest hours, with a little randomness.
      fits.sort((a, b) => Number(a.positions[0] !== pos) - Number(b.positions[0] !== pos) || (weekHours.get(a.id) ?? 0) - (weekHours.get(b.id) ?? 0) + (rand() - 0.5) * 6);
      const who = fits[0];
      if (!who) continue;
      busy.add(who.id);
      weekHours.set(who.id, (weekHours.get(who.id) ?? 0) + len);
      const jitter = () => Math.round((rand() - 0.5) * 16);
      const clockIn = zonedTime(date, Math.round(s0 * 60) + jitter(), tz);
      const clockOut = zonedTime(date, Math.round(e0 * 60) + jitter() + 5, tz);
      if (clockIn > now) continue;
      cards.push({
        employeeId: who.id,
        positionId: posId.get(pos)!,
        clockIn,
        clockOut: clockOut > now ? null : clockOut,
        breakMinutes: len > 6 ? 30 : 0,
        source: "MANUAL",
      });
    }
  }
  await db.timecard.createMany({ data: cards });

  // One-off pay adjustment last week, so the payroll export shows the column.
  if ((await db.payAdjustment.count()) === 0) {
    const someone = await db.employee.findFirst({ where: { active: true }, orderBy: { name: "asc" } });
    if (someone) await db.payAdjustment.create({ data: { employeeId: someone.id, date: parseISODate(addDays(today, -7)), kind: "BONUS", amount: D(50), note: "Covered a double on short notice", createdBy: "Max" } });
  }
}
