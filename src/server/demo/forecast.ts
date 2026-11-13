/**
 * Forecasting demo data: ~90 days of past weather for Catskill plus two weeks
 * of forecast (only when the weather table is empty, so rain-learning works
 * offline), ~6 past events whose sales bumps are written into the existing
 * DailySale/HourlySale rows, ~8 upcoming events, and one manual adjustment
 * with a reason.
 *
 * Idempotent: weather only into an empty table; events (and the sales scaling
 * that goes with them) only when there are no events yet. No "server-only"
 * import — this also runs from the CLI.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { addDays, dateRange, ISODate, parseISODate, todayIn, weekday } from "../../domain/dates";
import { nthWeekday } from "../../domain/events";

const D = (n: number) => new Prisma.Decimal(n);

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The `dow` (0=Sun) on or before `d`. */
const onOrBefore = (d: ISODate, dow: number) => addDays(d, -((weekday(d) - dow + 7) % 7));
/** The `dow` (0=Sun) on or after `d`. */
const onOrAfter = (d: ISODate, dow: number) => addDays(d, (dow - weekday(d) + 7) % 7);

async function scaleSales(db: PrismaClient, date: ISODate, factor: number) {
  const where = { date: parseISODate(date) };
  const [daily, hourly] = await Promise.all([db.dailySale.findMany({ where }), db.hourlySale.findMany({ where })]);
  await db.$transaction([
    ...daily.map((r) =>
      db.dailySale.update({
        where: { date_squareId: { date: r.date, squareId: r.squareId } },
        data: { qty: D(Math.round(r.qty.toNumber() * factor)), netSales: D(Math.round(r.netSales.toNumber() * factor * 100) / 100) },
      }),
    ),
    ...hourly.map((r) =>
      db.hourlySale.update({
        where: { date_hour: { date: r.date, hour: r.hour } },
        data: { netSales: D(Math.round(r.netSales.toNumber() * factor * 100) / 100), orders: Math.max(1, Math.round(r.orders * factor)) },
      }),
    ),
  ]);
}

export async function seedForecast(db: PrismaClient): Promise<void> {
  const today = todayIn(process.env.BUSINESS_TIMEZONE || "America/New_York");
  const rand = prng(4417);

  // ---- Weather -------------------------------------------------------------------
  if ((await db.weatherDay.count()) === 0) {
    const rows: Prisma.WeatherDayCreateManyInput[] = [];
    const wet: ISODate[] = [];
    for (const date of dateRange(addDays(today, -90), addDays(today, 14))) {
      const doy = (parseISODate(date).getTime() - Date.UTC(parseISODate(date).getUTCFullYear(), 0, 1)) / 86_400_000;
      const normalHigh = 15.5 + 13 * Math.cos((2 * Math.PI * (doy - 200)) / 365);
      const high = Math.round((normalHigh + (rand() - 0.5) * 8) * 10) / 10;
      const low = Math.round((high - 8 - rand() * 4) * 10) / 10;
      const r = rand();
      const precip = r < 0.13 ? 5 + Math.round(rand() * 180) / 10 : r < 0.3 ? Math.round(rand() * 45) / 10 : 0;
      const code = precip >= 5 ? (high < 2 ? 73 : rand() < 0.15 ? 95 : 63) : precip > 0 ? (high < 2 ? 71 : 61) : rand() < 0.45 ? 3 : rand() < 0.5 ? 2 : 0;
      if (precip >= 5 && date < today) wet.push(date);
      rows.push({ date: parseISODate(date), tempMaxC: D(high), tempMinC: D(low), precipMm: D(precip), code, forecast: date >= today, fetchedAt: new Date(Date.now() - 7 * 86_400_000) });
    }
    await db.weatherDay.createMany({ data: rows });
    // Rainy days were a bit quieter, so there's something to learn.
    for (const d of wet) await scaleSales(db, d, 0.84 + rand() * 0.06);
  }

  // ---- Events ---------------------------------------------------------------------
  if ((await db.event.count()) > 0) return;

  const avoidTue = (d: ISODate) => (weekday(d) === 2 ? addDays(d, 1) : d);
  const past: { date: ISODate; title: string; kind: string; impact: number; startTime?: string; endTime?: string; notes?: string; actualLift: number }[] = [
    { date: onOrBefore(addDays(today, -40), 6), title: "Oktoberfest", kind: "FESTIVAL", impact: 1.5, startTime: "12:00", endTime: "21:00", notes: "Steins, brats and the oompah band out back.", actualLift: 1.85 },
    { date: avoidTue(onOrBefore(addDays(today, -33), 3)), title: "Knicks vs Celtics", kind: "GAME", impact: 1.2, startTime: "19:30", notes: "On every screen, sound on.", actualLift: 1.36 },
    { date: onOrBefore(addDays(today, -26), 5), title: "Live music: The Mammoth Lanterns", kind: "MUSIC", impact: 1.15, startTime: "20:00", endTime: "23:00", actualLift: 1.22 },
    { date: onOrBefore(addDays(today, -19), 4), title: "Private event: Hudson Valley Realtors", kind: "PRIVATE", impact: 1.3, startTime: "17:00", endTime: "20:00", notes: "Back room buyout.", actualLift: 1.42 },
    { date: avoidTue(onOrBefore(addDays(today, -12), 1)), title: "Knicks vs Heat", kind: "GAME", impact: 1.2, startTime: "19:30", actualLift: 1.31 },
    { date: onOrBefore(addDays(today, -6), 5), title: "Live music: Bluegrass night", kind: "MUSIC", impact: 1.15, startTime: "19:00", endTime: "22:00", actualLift: 1.18 },
  ];
  for (const e of past) await scaleSales(db, e.date, e.actualLift);

  const thanksgiving = nthWeekday(Number(today.slice(0, 4)), 11, 4, 4);
  const upcoming: { date: ISODate; title: string; kind: string; impact: number; startTime?: string; endTime?: string; notes?: string }[] = [
    { date: avoidTue(onOrAfter(addDays(today, 4), 3)), title: "Knicks vs 76ers", kind: "GAME", impact: 1.2, startTime: "19:30", notes: "Wing specials during the game." },
    { date: onOrAfter(addDays(today, 7), 6), title: "Live music: The Mammoth Lanterns", kind: "MUSIC", impact: 1.15, startTime: "20:00", endTime: "23:00" },
    ...(thanksgiving > today ? [{ date: thanksgiving, title: "Thanksgiving", kind: "CLOSURE", impact: 0, notes: "Closed — happy Thanksgiving." }] : []),
    { date: onOrAfter(addDays(today, 15), 0), title: "Knicks vs Heat", kind: "GAME", impact: 1.2, startTime: "15:30" },
    { date: onOrAfter(addDays(today, 19), 4), title: "Private event: Catskill Rotary holiday party", kind: "PRIVATE", impact: 1.35, startTime: "18:00", endTime: "21:00", notes: "Back room closed to the public 6–9pm." },
    { date: onOrAfter(addDays(today, 25), 3), title: "Knicks vs Nets", kind: "GAME", impact: 1.2, startTime: "19:30" },
    { date: onOrAfter(addDays(today, 26), 4), title: "Live music: Bluegrass night", kind: "MUSIC", impact: 1.15, startTime: "19:00", endTime: "22:00" },
    { date: onOrAfter(addDays(today, 28), 6), title: "Winter Bierfest", kind: "FESTIVAL", impact: 1.6, startTime: "12:00", endTime: "21:00", notes: "Winter warmers, a firepit and German bites. Free entry." },
  ];
  await db.event.createMany({
    data: [...past, ...upcoming].map((e) => ({
      date: parseISODate(e.date),
      title: e.title,
      kind: e.kind,
      impact: D(e.impact),
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
      notes: e.notes ?? null,
    })),
  });

  // ---- A manual adjustment with a reason ----------------------------------------------
  const busDay = onOrAfter(addDays(today, 2), 0);
  const read = async (key: string) => {
    const s = await db.setting.findUnique({ where: { key } });
    return s ? (JSON.parse(s.value) as Record<string, unknown>) : {};
  };
  const write = (key: string, v: Record<string, unknown>) => db.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } });
  await write("forecast.adjustments", { ...(await read("forecast.adjustments")), [busDay]: 1.15 });
  await write("forecast.reasons", { ...(await read("forecast.reasons")), [busDay]: "Bus tour from Albany booked for lunch" });
}
