import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { after } from "next/server";
import { allFindings, AnalyticsRun, emptyFeedState, FeedState, FeedVerdict, FixedCosts, Insight, markFeed, markSeen, MODEL_IDS, ModelId, Opportunity, parseFeedState, runAge } from "@/domain/analytics";
import { buildActions, completeThrough, DEFAULT_RANGE, type LabAction, type LabFinding, parseRange, RANGE_PRESETS, rangeFrom, type RangePreset } from "@/domain/lab";
import { blockCost, blockHours } from "@/domain/timecards";
import { addDays, businessDate, dateRange, ISODate, parseISODate, toISODate, weekday } from "@/domain/dates";
import { isWet } from "@/domain/forecast";
import { groupOf } from "@/domain/revenueClass";
import { shiftPaidHours, weekStartOf } from "@/domain/schedule";
import { laborByHour, zonedTime } from "@/domain/timecards";
import { db, num } from "../db";
import { buildContext, loadCostingSnapshot, safeCost } from "./costing";
import { dailySalesForecast, forecastAccuracy, weatherMap } from "./forecasting";
import { classSettings, recipeClasses } from "./insights";
import { dailyKpis } from "./kpis";
import { kegFindings } from "./kegs";
import { loadTimecards } from "./labor";
import { getLaborRules, getOpeningHours } from "./labor-rules";
import { buildOrderPlan, estimatedOnHandAll, forecastItems, getAdjustments, usagePerServing } from "./planning";
import { businessToday, dailyNetSalesExcludingIgnored, lastSquareSync, salesByRecipe, squareCatalogMeta } from "./sales";
import { loadWeek } from "./scheduling";
import { lastCountPeriod, varianceReport } from "./variance";

/**
 * Insights: gathers the numbers (this side owns the database), sends them to
 * the Python analytics service (`analytics/`, a separate Vercel project) and
 * caches what comes back in Setting rows so pages read it instantly:
 *
 *   analytics.meta        { computedAt, source, seconds, timings, version }
 *   analytics.<model>     one Insight per model (menu, price, forecast, …)
 *   analytics.feed        the insight feed's findings
 *   analytics.status      last attempt / error (pages say "Insights update overnight")
 *   analytics.fixedCosts  rent, utilities, insurance, other (Insights page form)
 *   analytics.feedState   Done / Not useful / Snooze, what's been shown, learned weights
 *
 *   analytics.range       which stretch of history every model uses ("3y" by default; Insights Lab picks it)
 *
 * The range covers daily totals and weekly item sales (so 3–4 years teach
 * seasons and price responses); hourly detail is the last 26 weeks (schedules
 * change) and item-by-day detail the last 120 days. Today, and a day whose
 * last sync ran before closing, are left out. The payload stays ~1 MB.
 *
 * Recomputed nightly by /api/cron/daily-ops and on demand ("Refresh").
 * ANALYTICS_URL + ANALYTICS_SECRET point at the service; without them, in
 * development, `python3 analytics/cli.py` runs the same code locally
 * (ANALYTICS_PYTHON picks the interpreter, e.g. a venv with requirements.txt).
 */

/** Item-by-day and full daily KPI detail (food cost, waste…) cover this many days; the rest of the range is daily totals. */
const DETAIL_DAYS = 120;
const HOURLY_WEEKS = 26;
const MAX_ITEMS = 150;
const FUTURE_DAYS = 14;
const tz = () => process.env.BUSINESS_TIMEZONE || "America/New_York";

const KEY = { meta: "analytics.meta", status: "analytics.status", feed: "analytics.feed", fixed: "analytics.fixedCosts", state: "analytics.feedState", range: "analytics.range" } as const;
const modelKey = (m: ModelId) => `analytics.${m}`;

async function readJSON<T>(key: string): Promise<T | null> {
  const s = await db.setting.findUnique({ where: { key } });
  if (!s) return null;
  try {
    return JSON.parse(s.value) as T;
  } catch {
    return null;
  }
}

async function writeJSON(key: string, value: unknown) {
  const v = JSON.stringify(value);
  await db.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

// ---- Settings: fixed costs ---------------------------------------------------------------

export async function getFixedCosts(): Promise<FixedCosts | null> {
  return readJSON<FixedCosts>(KEY.fixed);
}

export async function saveFixedCosts(f: FixedCosts) {
  await writeJSON(KEY.fixed, f);
}

// ---- Settings: data range ------------------------------------------------------------------

export async function getRange(): Promise<RangePreset> {
  const s = await db.setting.findUnique({ where: { key: KEY.range } });
  return s ? parseRange(s.value) : DEFAULT_RANGE;
}

export async function saveRange(preset: RangePreset) {
  if (!RANGE_PRESETS.some((p) => p.id === preset)) throw new Error("Unknown range");
  await writeJSON(KEY.range, { preset });
}

/** The first business date with Square sales (the oldest history there is). */
async function firstSaleDate(): Promise<ISODate | null> {
  const r = await db.hourlySale.findFirst({ orderBy: { date: "asc" }, where: { netSales: { gt: 0 } }, select: { date: true } });
  return r ? toISODate(r.date) : null;
}

// ---- Gathering ----------------------------------------------------------------------------

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Everything the models need, as plain JSON. No credentials, no personal data beyond first names on the schedule. */
export async function gatherPayload(today = businessToday(), opts: { range?: RangePreset } = {}) {
  const [preset, firstSale, lastSync] = await Promise.all([opts.range ? Promise.resolve(opts.range) : getRange(), firstSaleDate(), lastSquareSync()]);
  const from = rangeFrom(preset, today, firstSale);
  // Today is in progress; a day whose last sync ran before ~3am hasn't seen closing either.
  const through = completeThrough(today, lastSync ? businessDate(new Date(lastSync.getTime() - 3 * 3_600_000), tz()) : null);
  const end = addDays(through, 1);
  const detailFrom = from > addDays(end, -DETAIL_DAYS) ? from : addDays(end, -DETAIL_DAYS);
  const hourFrom = from > addDays(end, -7 * HOURLY_WEEKS) ? from : addDays(end, -7 * HOURLY_WEEKS);
  const futureEnd = addDays(today, FUTURE_DAYS);
  const futureDates = dateRange(today, futureEnd);
  const snap = await loadCostingSnapshot();
  const ctx = buildContext(snap, today);
  const [kpis, events, weather, manual, futureF, accuracy, cls, rules, fixedCosts, state, openingHours, older] = await Promise.all([
    dailyKpis(detailFrom, end, { snap }),
    db.event.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(addDays(today, 45)) } } }),
    weatherMap(from, futureEnd),
    getAdjustments(),
    dailySalesForecast(futureDates).catch((e) => (console.error("analytics: forecast failed", e), [])),
    forecastAccuracy(84).catch(() => ({ rows: [] as { date: ISODate; forecast: number; actual: number; open: boolean }[] })),
    classSettings(),
    getLaborRules(),
    getFixedCosts(),
    getFeedState(),
    getOpeningHours(),
    olderDays(from, detailFrom),
  ]);
  const classes = recipeClasses(snap, cls);

  // Events per date
  const evBy = new Map<ISODate, { mult: number; kinds: string[]; titles: string[]; closure: boolean }>();
  for (const e of events) {
    const d = toISODate(e.date);
    const cur = evBy.get(d) ?? { mult: 1, kinds: [], titles: [], closure: false };
    if (e.kind === "CLOSURE") cur.closure = true;
    else cur.mult *= e.impact.toNumber();
    cur.kinds.push(e.kind);
    cur.titles.push(e.title);
    evBy.set(d, cur);
  }

  // Waste per business day at today's cost
  const wasteRows = await db.wasteLog.findMany({ where: { loggedAt: { gte: zonedTime(detailFrom, 0, tz()) } }, select: { ingredientId: true, qtyBase: true, loggedAt: true, sourceRecipe: { select: { name: true } }, ingredient: { select: { name: true } } } });
  const wasteBy = new Map<ISODate, number>();
  const wasteItems = new Map<string, number>();
  for (const w of wasteRows) {
    const c = (ctx.ingredients.get(w.ingredientId)?.costPerBase ?? 0) * w.qtyBase.toNumber();
    const d = businessDate(w.loggedAt, tz());
    wasteBy.set(d, (wasteBy.get(d) ?? 0) + c);
    const name = w.sourceRecipe?.name ?? w.ingredient.name;
    if (businessDate(w.loggedAt, tz()) >= addDays(today, -28)) wasteItems.set(name, (wasteItems.get(name) ?? 0) + c);
  }
  const firstWaste = [...wasteBy.keys()].sort()[0] ?? null;

  const dayRow = (date: ISODate, x: { sales: number; orders: number | null; labor: number; laborHours: number; cogs: number; foodSales: number; synced: boolean }) => {
    const ev = evBy.get(date);
    const w = weather.get(date);
    return {
      date,
      open: x.sales > 0 && !ev?.closure,
      sales: round(x.sales),
      orders: x.orders ?? 0,
      labor: round(x.labor),
      laborHours: round(x.laborHours),
      cogs: round(x.cogs),
      foodSales: round(x.foodSales),
      waste: round(wasteBy.get(date) ?? 0),
      wasteLogged: firstWaste != null && date >= firstWaste,
      eventMult: ev ? (ev.closure ? 0 : ev.mult) : 1,
      eventKinds: ev?.kinds ?? [],
      eventTitles: ev?.titles ?? [],
      wet: w ? isWet(w) : false,
      hasWeather: !!w,
      tempMaxC: w?.tempMaxC ?? null,
      synced: x.synced,
    };
  };
  const days = [
    ...older.map((o) => dayRow(o.date, { ...o, cogs: 0, foodSales: 0 })),
    ...kpis.days.map((d) => dayRow(d.date, { sales: d.sales, orders: d.orders, labor: d.labor, laborHours: d.laborHours, cogs: d.cogs, foodSales: d.group.food.sales, synced: d.salesSynced })),
  ];

  const future = futureF.map((f) => {
    const ev = evBy.get(f.date);
    return {
      date: f.date,
      eventMult: f.drivers.eventFactor * f.drivers.manual,
      closure: f.drivers.eventFactor === 0,
      eventKinds: ev?.kinds ?? [],
      eventTitles: ev?.titles ?? [],
      wet: f.drivers.weather ? isWet(f.drivers.weather) : false,
      tempMaxC: f.drivers.weather?.tempMaxC ?? null,
      tsForecast: round(f.qty, 0),
      manual: manual.get(f.date) ?? 1,
    };
  });
  const futureEvents = [...evBy].filter(([d]) => d >= futureEnd).map(([date, e]) => ({ date, eventKinds: e.kinds }));

  // Items: weekly qty and sales over the whole range (price responses need years), daily for the last 120 days.
  // Square items linked to a recipe come with plate costs; the best sellers not linked yet come as Square items
  // (no cost — the models use a typical one and say so), so price findings work before setup is finished.
  const [{ byRecipe }, saleRows, mappings, catalog, weeklyRows] = await Promise.all([
    salesByRecipe(detailFrom, end),
    db.dailySale.findMany({ where: { date: { gte: parseISODate(detailFrom), lt: parseISODate(end) } }, select: { date: true, squareId: true, name: true, qty: true, netSales: true } }),
    db.squareMapping.findMany({ select: { squareId: true, recipeId: true, ignored: true } }),
    squareCatalogMeta(),
    db.$queryRaw<{ squareId: string; week: Date; qty: number; sales: number }[]>`
      SELECT "squareId", date_trunc('week', date)::date AS week, SUM(qty)::float AS qty, SUM("netSales")::float AS sales
      FROM "DailySale" WHERE date >= ${parseISODate(from)} AND date < ${parseISODate(end)}
      GROUP BY 1, 2`,
  ]);
  const mapOf = new Map(mappings.map((m) => [m.squareId, m]));
  const keyOf = (squareId: string) => {
    const m = mapOf.get(squareId);
    if (m?.ignored) return null;
    return m?.recipeId ?? `sq:${squareId}`;
  };
  const add = (store: Map<string, Record<string, [number, number]>>, id: string, k: string, q: number, v: number) => {
    const m = store.get(id) ?? {};
    const cur = m[k] ?? [0, 0];
    m[k] = [round(cur[0] + q, 3), round(cur[1] + v)];
    store.set(id, m);
  };
  const daily = new Map<string, Record<ISODate, [number, number]>>();
  const weekly = new Map<string, Record<ISODate, [number, number]>>();
  const names = new Map<string, string>();
  for (const r of saleRows) {
    const id = keyOf(r.squareId);
    if (!id) continue;
    add(daily, id, toISODate(r.date), r.qty.toNumber(), r.netSales.toNumber());
    if (id.startsWith("sq:")) names.set(id, r.name);
  }
  const totals = new Map<string, number>();
  for (const r of weeklyRows) {
    const id = keyOf(r.squareId);
    if (!id) continue;
    add(weekly, id, toISODate(r.week), Number(r.qty), Number(r.sales));
    totals.set(id, (totals.get(id) ?? 0) + Number(r.sales));
  }
  const linked = snap.recipes
    .filter((r) => r.kind !== "PREP" && (daily.has(r.id) || weekly.has(r.id)))
    .map((r) => {
      const c = safeCost(ctx, r.id);
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        category: r.category,
        group: groupOf(classes.get(r.id) ?? "food"),
        price: num(r.menuPrice),
        unitCost: "error" in c ? null : round(c.totalCost, 4),
        costIncomplete: "error" in c ? true : c.incomplete,
        linked: true,
        daily: daily.get(r.id) ?? {},
        weekly: weekly.get(r.id) ?? {},
      };
    });
  const unlinked = [...totals]
    .filter(([id, total]) => id.startsWith("sq:") && total > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, Math.max(0, MAX_ITEMS - linked.length))
    .map(([id]) => {
      const sq = id.slice(3);
      const meta = catalog[sq];
      const category = meta?.category ?? null;
      return {
        id,
        name: names.get(id) ?? meta?.baseName ?? "Square item",
        kind: "MENU",
        category,
        group: /beer|draft|tap|cider|wine|seltzer|cocktail|drink|bev|soda|slushy/i.test(`${category ?? ""} ${names.get(id) ?? ""}`) ? "beverage" : "food",
        price: meta?.price ?? null,
        unitCost: null,
        costIncomplete: true,
        linked: false,
        daily: daily.get(id) ?? {},
        weekly: weekly.get(id) ?? {},
      };
    });
  const items = [...linked, ...unlinked];

  // Hourly sales + labor per clock hour (last 26 weeks)
  const [hourRows, cards] = await Promise.all([db.hourlySale.findMany({ where: { date: { gte: parseISODate(hourFrom), lt: parseISODate(end) } } }), loadTimecards(hourFrom, end)]);
  const cardsBy = new Map<ISODate, typeof cards>();
  for (const c of cards) cardsBy.set(c.date, [...(cardsBy.get(c.date) ?? []), c]);
  const salesByHour = new Map<string, { sales: number; orders: number }>();
  for (const h of hourRows) salesByHour.set(`${toISODate(h.date)}|${h.hour}`, { sales: h.netSales.toNumber(), orders: h.orders });
  const now = new Date();
  const hourly: { date: ISODate; hour: number; sales: number; orders: number; laborHours: number; laborCost: number }[] = [];
  for (const date of dateRange(hourFrom, end)) {
    const cs = cardsBy.get(date) ?? [];
    const lab = laborByHour(cs.map((c) => ({ start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes, rate: c.rate })), zonedTime(date, 0, tz()), rules.employerBurdenPct, now);
    for (let h = 0; h < 24; h++) {
      const s = salesByHour.get(`${date}|${h}`);
      if (!s && lab.hours[h] === 0) continue;
      hourly.push({ date, hour: h, sales: round(s?.sales ?? 0), orders: s?.orders ?? 0, laborHours: round(lab.hours[h], 3), laborCost: round(lab.cost[h]) });
    }
  }

  // Usage per ingredient per day (history), per serving, and lost margin per base unit
  const { perServing } = usagePerServing(ctx);
  const usage = new Map<string, Record<ISODate, number>>();
  const marginNum = new Map<string, number>();
  const marginDen = new Map<string, number>();
  const cm = new Map(items.map((i) => [i.id, i.price != null && i.unitCost != null ? i.price - i.unitCost : null]));
  for (const [recipeId, series] of byRecipe) {
    const per = perServing.get(recipeId);
    if (!per) continue;
    let servings = 0;
    for (const [d, q] of series) {
      servings += q;
      for (const [ing, qty] of per) {
        const u = usage.get(ing) ?? {};
        u[d] = (u[d] ?? 0) + q * qty;
        usage.set(ing, u);
      }
    }
    const m = cm.get(recipeId);
    if (m == null || m <= 0) continue;
    for (const [ing, qty] of per) {
      if (qty <= 0) continue;
      marginNum.set(ing, (marginNum.get(ing) ?? 0) + servings * (m / qty));
      marginDen.set(ing, (marginDen.get(ing) ?? 0) + servings);
    }
  }
  const use28 = (ing: string) => Object.entries(usage.get(ing) ?? {}).filter(([d]) => d >= addDays(today, -28)).reduce((s, [, v]) => s + v, 0) / 28;

  // Order lines: today's suggestion per supplier, with the forecast use over each cover window
  const onHand = await estimatedOnHandAll();
  const suppliers = await db.supplier.findMany({ where: { active: true }, select: { id: true, name: true } });
  const ingredients: Record<string, unknown>[] = [];
  const ingCat = new Map(snap.ingredients.map((i) => [i.id, i]));
  const itemForecast = await forecastItems(dateRange(today, addDays(today, 21)));
  for (const s of suppliers) {
    try {
      const plan = await buildOrderPlan(s.id);
      // What this order has to cover: delivery → the delivery after. Stock at delivery is the planner's projection.
      const window = dateRange(plan.deliveryDate, plan.coverUntil);
      for (const l of plan.lines) {
        const ing = ingCat.get(l.ingredientId);
        const st = onHand.get(l.ingredientId);
        const f = window.map((d) => itemForecast.items.reduce((sum, it) => sum + (it.days.find((x) => x.date === d)?.qty ?? 0) * (perServing.get(it.recipeId)?.get(l.ingredientId) ?? 0), 0));
        ingredients.push({
          id: l.ingredientId,
          name: l.ingredientName,
          supplier: s.name,
          category: ing?.category ?? "Other",
          baseUnit: ing?.baseUnit,
          purchaseUnit: l.purchaseUnit,
          packQty: l.packQtyBase,
          packCost: l.unitPrice,
          onHand: round(Math.max(0, l.projectedAtDelivery), 3),
          onHandKnown: st?.known ?? false,
          forecast: f.map((x) => round(x, 3)),
          coverDays: window.length,
          currentPacks: l.suggestedUnits,
          marginPerBase: marginDen.get(l.ingredientId) ? round(marginNum.get(l.ingredientId)! / marginDen.get(l.ingredientId)!, 6) : 0,
          usage: Object.fromEntries(Object.entries(usage.get(l.ingredientId) ?? {}).map(([d, v]) => [d, round(v, 3)])),
        });
      }
    } catch (e) {
      console.error("analytics: order plan failed", s.name, e);
    }
  }

  // Supplier price history, with what's spent on each product a month
  const products = await db.supplierProduct.findMany({ where: { active: true }, select: { id: true, description: true, packQtyBase: true, ingredientId: true, supplier: { select: { name: true } }, ingredient: { select: { name: true, preferredProductId: true } } } });
  const priceHistory = products
    .map((p) => {
      const pts = (snap.priceHistory.get(p.id) ?? []).map((r) => [r.date, r.price] as [ISODate, number]);
      const pack = num(p.packQtyBase);
      const last = pts.at(-1)?.[1] ?? null;
      const spend = p.ingredientId && pack && last ? use28(p.ingredientId) * 30.4 * (last / pack) : 0;
      return { productId: p.id, product: p.description, ingredient: p.ingredient?.name ?? null, supplier: p.supplier.name, points: pts, monthlySpend: round(spend) };
    })
    .filter((p) => p.points.length >= 2);

  // Margin gap and beer pour yield from the last two counts
  let variance: Record<string, unknown> | null = null;
  const beer: Record<string, unknown>[] = [];
  try {
    const period = await lastCountPeriod();
    if (period) {
      const v = await varianceReport(period.start.id, period.end.id);
      variance = { from: v.from, to: v.to, days: v.days, unexplainedCost: round(v.unexplainedCost), rows: v.rows.filter((r) => (r.unexplainedCost ?? 0) > 0).map((r) => ({ name: r.name, unexplainedCost: round(r.unexplainedCost!), category: r.category })) };
      for (const r of v.rows) {
        if (r.group !== "beverage" || !/beer|keg/i.test(`${r.category} ${r.name}`) || r.actual == null) continue;
        // Menu value of a ml of this beer: the beer items' price per ml poured.
        const users = items.filter((i) => perServing.get(i.id)?.get(r.ingredientId));
        const ppb = users.length ? users.reduce((s, i) => s + (i.price ?? 0) / perServing.get(i.id)!.get(r.ingredientId)!, 0) / users.length : 0;
        beer.push({ id: r.ingredientId, name: r.name.replace(/\s*\(keg\)/i, ""), theoretical: round(r.theoretical, 1), actual: round(r.actual, 1), costPerBase: r.unitCost, pricePerBase: round(ppb, 6), days: v.days });
      }
    }
  } catch (e) {
    console.error("analytics: variance failed", e);
  }

  // Invoice lines billed over the expected price, still open
  const overBilled = await db.invoiceLine.findMany({ where: { status: { in: ["PRICE", "PRICE_QTY"] }, invoice: { status: { not: "APPROVED" } } }, select: { qty: true, unitPrice: true, expectedPrice: true } });
  const invoices = {
    priceIssues: overBilled.length,
    priceIssueDollars: round(overBilled.reduce((s, l) => s + Math.max(0, (l.unitPrice.toNumber() - (num(l.expectedPrice) ?? l.unitPrice.toNumber())) * l.qty.toNumber()), 0)),
  };

  // This week's schedule (overtime) and next week's (labor vs forecast)
  let schedule: Record<string, unknown> | null = null;
  try {
    const thisWeek = await loadWeek(weekStartOf(today));
    const nextWeek = weekday(today) >= 4 || weekday(today) === 0 ? await loadWeek(addDays(weekStartOf(today), 7)) : thisWeek;
    const hours = new Map<string, number>();
    for (const sh of thisWeek.shifts) if (sh.employeeId) hours.set(sh.employeeId, (hours.get(sh.employeeId) ?? 0) + shiftPaidHours(sh));
    const people = thisWeek.employees
      .map((e) => ({ name: e.name.split(/\s+/)[0], hours: round(hours.get(e.id) ?? 0, 1), rate: Object.values(e.rates).find((r) => r != null) ?? null }))
      .filter((p) => p.hours > 0);
    schedule = {
      weekStart: nextWeek.monday,
      people,
      forecastSales: round(nextWeek.summary.sales),
      cost: round(nextWeek.summary.cost),
      laborTarget: nextWeek.laborTarget,
      avgRate: nextWeek.summary.hours ? round(nextWeek.summary.cost / nextWeek.summary.hours) : null,
    };
  } catch (e) {
    console.error("analytics: schedule failed", e);
  }

  // Stock on hand at cost, and daily use at cost
  const inventory = snap.ingredients
    .map((i) => {
      const st = onHand.get(i.id);
      const cpb = ctx.ingredients.get(i.id)?.costPerBase ?? null;
      if (!st?.known || cpb == null) return null;
      return { name: i.name, category: i.category, onHandValue: round(Math.max(0, st.qty) * cpb), dailyUsageValue: round(use28(i.id) * cpb, 3) };
    })
    .filter(Boolean);

  const reviews = (await db.review.findMany({ where: { postedAt: { gte: zonedTime(from, 0, tz()) } }, select: { postedAt: true, rating: true, themes: true } })).map((r) => ({ date: businessDate(r.postedAt, tz()), rating: r.rating, themes: r.themes }));

  const actions = Object.entries(state.marks)
    .filter(([, m]) => m.status === "done")
    .map(([key, m]) => ({ key, kind: m.kind, subject: m.subject ?? null, doneAt: m.at, title: m.title }));

  return {
    asOf: today,
    window: { preset, from, through, firstSale },
    openingHours,
    days,
    future,
    futureEvents,
    tsBacktest: accuracy.rows.filter((r) => r.open).map((r) => ({ date: r.date, forecast: round(r.forecast), actual: round(r.actual) })),
    items,
    hourly,
    ingredients,
    priceHistory,
    variance,
    beer,
    invoices,
    schedule,
    inventory,
    reviews,
    actions,
    wasteTop: [...wasteItems].map(([name, cost]) => ({ name, cost: round(cost) })).sort((a, b) => b.cost - a.cost).slice(0, 5),
    fixedCosts: fixedCosts ? Object.fromEntries(Object.entries(fixedCosts).filter(([, v]) => v != null)) : null,
    burdenPct: rules.employerBurdenPct,
    minCrew: 2,
  };
}

export type AnalyticsPayload = Awaited<ReturnType<typeof gatherPayload>>;

/** Daily totals before the detailed window: net sales and orders from Square, wages from timecards. */
async function olderDays(from: ISODate, toExclusive: ISODate) {
  if (from >= toExclusive) return [];
  const [net, orders, cards, rules] = await Promise.all([
    dailyNetSalesExcludingIgnored(from, toExclusive),
    db.hourlySale.groupBy({ by: ["date"], where: { date: { gte: parseISODate(from), lt: parseISODate(toExclusive) } }, _sum: { orders: true } }),
    loadTimecards(from, toExclusive),
    getLaborRules(),
  ]);
  const now = new Date();
  const labor = new Map<ISODate, { cost: number; hours: number }>();
  for (const c of cards) {
    const b = { start: c.clockIn, end: c.clockOut, breakMinutes: c.breakMinutes, rate: c.rate };
    const cur = labor.get(c.date) ?? { cost: 0, hours: 0 };
    cur.cost += blockCost(b, rules.employerBurdenPct, now);
    cur.hours += blockHours(b, now);
    labor.set(c.date, cur);
  }
  const ord = new Map(orders.map((o) => [toISODate(o.date), o._sum.orders ?? 0]));
  return dateRange(from, toExclusive).map((date) => ({ date, sales: Math.max(0, net.get(date) ?? 0), orders: ord.get(date) ?? 0, labor: labor.get(date)?.cost ?? 0, laborHours: labor.get(date)?.hours ?? 0, synced: net.has(date) }));
}

// ---- Running ------------------------------------------------------------------------------

type RawRun = Omit<AnalyticsRun, "source" | "seconds"> & { seconds?: number; data?: Record<string, unknown> };

async function callService(payload: AnalyticsPayload, models?: ModelId[]): Promise<{ run: RawRun; source: AnalyticsRun["source"] }> {
  const body = JSON.stringify({ models: models ?? null, data: payload });
  const url = process.env.ANALYTICS_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.ANALYTICS_SECRET?.trim();
  if (url && secret) {
    const res = await fetch(`${url}/api/analyze`, { method: "POST", headers: { "content-type": "application/json", "x-analytics-secret": secret }, body, cache: "no-store", signal: AbortSignal.timeout(58_000) });
    if (!res.ok) throw new Error(`Analytics service answered ${res.status}`);
    return { run: (await res.json()) as RawRun, source: "service" };
  }
  if (process.env.VERCEL) throw new Error("ANALYTICS_URL and ANALYTICS_SECRET aren't set");
  return { run: await runLocal(body), source: "local" };
}

/** Development: the same Python code via python3 (ANALYTICS_PYTHON overrides the interpreter). */
function runLocal(body: string): Promise<RawRun> {
  const py = process.env.ANALYTICS_PYTHON || "python3";
  const cli = path.join(process.cwd(), "analytics", "cli.py");
  return new Promise((resolve, reject) => {
    const p = spawn(py, [cli], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => (p.kill(), reject(new Error("Local analytics timed out"))), 120_000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => (clearTimeout(timer), reject(e)));
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`python exited ${code}: ${err.slice(-400)}`));
      try {
        resolve(JSON.parse(out) as RawRun);
      } catch (e) {
        reject(e);
      }
    });
    p.stdin.end(body);
  });
}

export interface AnalyticsStatus {
  lastAttempt: string | null;
  lastOk: string | null;
  error: string | null;
  running?: string | null;
}

/** Gather, run every model, cache the results. Never throws: failures are recorded in analytics.status. */
export async function refreshAnalytics(opts: { models?: ModelId[] } = {}): Promise<{ ok: true; seconds: number; source: AnalyticsRun["source"] } | { error: string }> {
  const started = Date.now();
  const status = (await readJSON<AnalyticsStatus>(KEY.status)) ?? { lastAttempt: null, lastOk: null, error: null };
  await writeJSON(KEY.status, { ...status, lastAttempt: new Date().toISOString(), running: new Date().toISOString() });
  try {
    const payload = await gatherPayload();
    const { run, source } = await callService(payload, opts.models);
    const seconds = (Date.now() - started) / 1000;
    const meta = { version: run.version, computedAt: run.computedAt, timings: run.timings, source, seconds, serviceSeconds: run.seconds ?? null, window: payload.window, data: run.data ?? null, bytes: JSON.stringify(payload).length };
    await Promise.all([
      ...MODEL_IDS.filter((m) => run.results[m]).map((m) => writeJSON(modelKey(m), run.results[m])),
      run.results.feed ? writeJSON(KEY.feed, run.results.feed) : Promise.resolve(),
      writeJSON(KEY.meta, meta),
      writeJSON(KEY.status, { lastAttempt: status.lastAttempt, lastOk: new Date().toISOString(), error: null, running: null }),
    ]);
    return { ok: true, seconds, source };
  } catch (e) {
    const message = (e as Error).name === "TimeoutError" ? "The analytics service timed out" : (e as Error).message || "Analytics failed";
    console.error("analytics refresh failed", e);
    await writeJSON(KEY.status, { ...status, lastAttempt: new Date().toISOString(), error: message, running: null }).catch(() => {});
    return { error: message };
  }
}

/** The cached run (null before the first one). Fast: a handful of Setting reads. */
export async function loadRun(): Promise<AnalyticsRun | null> {
  const keys = [KEY.meta, KEY.feed, ...MODEL_IDS.map(modelKey)];
  const rows = await db.setting.findMany({ where: { key: { in: keys } } });
  const by = new Map(rows.map((r) => [r.key, r.value]));
  const parse = <T,>(k: string): T | undefined => {
    const v = by.get(k);
    if (!v) return undefined;
    try {
      return JSON.parse(v) as T;
    } catch {
      return undefined;
    }
  };
  const meta = parse<{ version: string; computedAt: string; timings: Record<string, number>; source: AnalyticsRun["source"]; seconds: number; window?: AnalyticsRun["window"]; data?: AnalyticsRun["data"] }>(KEY.meta);
  if (!meta) return null;
  const results: AnalyticsRun["results"] = {};
  for (const m of MODEL_IDS) {
    const r = parse<Insight>(modelKey(m));
    if (r) results[m] = r;
  }
  results.feed = parse(KEY.feed);
  return { ...meta, results };
}

export async function analyticsStatus(): Promise<AnalyticsStatus> {
  return (await readJSON<AnalyticsStatus>(KEY.status)) ?? { lastAttempt: null, lastOk: null, error: null };
}

/**
 * For page views: if the cache is missing or older than ~36 hours and nothing
 * has been tried in the last hour, refresh after the response is sent.
 */
export async function refreshIfStale(run: AnalyticsRun | null) {
  if (!runAge(run?.computedAt).stale) return;
  const st = await analyticsStatus();
  const last = st.lastAttempt ? Date.now() - new Date(st.lastAttempt).getTime() : Infinity;
  if (last < 3_600_000) return;
  try {
    after(() => refreshAnalytics().then(() => undefined));
  } catch {
    void refreshAnalytics();
  }
}

// ---- Feed ---------------------------------------------------------------------------------

export async function getFeedState(): Promise<FeedState> {
  const s = await db.setting.findUnique({ where: { key: KEY.state } });
  return s ? parseFeedState(s.value) : emptyFeedState();
}

export async function markFinding(item: Pick<Opportunity, "key" | "kind" | "title" | "subject" | "monthly"> & { parts?: string[] }, verdict: FeedVerdict | "undo", snoozeDays = 14) {
  let state = await getFeedState();
  const today = businessToday();
  state = markFeed(state, item, verdict, today, snoozeDays);
  // A merged action marks every finding it was built from, so none of them comes back alone.
  for (const k of item.parts ?? []) {
    if (k === item.key) continue;
    const marks = { ...state.marks };
    if (verdict === "undo") delete marks[k];
    else marks[k] = { ...state.marks[item.key], kind: item.kind };
    state = { ...state, marks };
  }
  await writeJSON(KEY.state, state);
}

/**
 * The ranked action list: findings merged by root cause, rated and ranked
 * (see buildActions). `remember` records what was shown (once a week per
 * finding) so it fades next time — pass it only where Max actually sees it.
 */
export async function insightFeed(opts: { limit?: number; remember?: boolean; run?: AnalyticsRun | null; novelty?: boolean } = {}): Promise<{ items: LabAction[]; run: AnalyticsRun | null; state: FeedState }> {
  const [run, state, kegs] = await Promise.all([opts.run !== undefined ? Promise.resolve(opts.run) : loadRun(), getFeedState(), kegFindings()]);
  const today = businessToday();
  // Keg run-outs are worked out here (live kegs + Square), not by the Python service.
  const ranked = buildActions([...allFindings(run), ...kegs] as LabFinding[], state, today, { novelty: opts.novelty ?? true });
  const items = ranked.slice(0, opts.limit ?? 20);
  if (opts.remember && items.length) {
    const top = items.slice(0, Math.min(items.length, 5));
    const save = () => getFeedState().then((s) => writeJSON(KEY.state, markSeen(s, top, today)));
    try {
      after(save);
    } catch {
      await save();
    }
  }
  return { items, run, state };
}

/** Findings Max marked Done or Not useful, newest first (for the "Handled" list). */
export function handled(state: FeedState) {
  return Object.entries(state.marks)
    .map(([key, m]) => ({ key, ...m }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

// ---- Forecast ranges for other pages --------------------------------------------------------

export interface RangeDay {
  date: ISODate;
  closed: boolean;
  low: number;
  mid: number;
  high: number;
}

/** The statistical forecast's daily 80% ranges (today onward), plus a one-line accuracy comparison. */
export async function forecastRanges(): Promise<{ days: RangeDay[]; model: string; compare: string } | null> {
  const r = await readJSON<Insight>(modelKey("forecast"));
  if (!r || r.status !== "ok") return null;
  const d = r.details as { days?: RangeDay[]; model?: string; mape?: number | null; tsMape?: number | null };
  const today = businessToday();
  const days = (d.days ?? []).filter((x) => x.date >= today);
  const p = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
  const compare = d.mape == null ? "" : d.tsMape != null ? `Lately within about ${p(Math.min(d.mape, d.tsMape))} on a typical day.` : `Lately within about ${p(d.mape)} on a typical day.`;
  return { days, model: d.model ?? "", compare };
}

/** One day's range, e.g. for a schedule or order page header ("Saturday $3,100–$3,600"). */
export async function forecastRangeFor(date: ISODate): Promise<RangeDay | null> {
  const f = await forecastRanges();
  const d = f?.days.find((x) => x.date === date);
  return d && !d.closed ? d : null;
}

// ---- What unlocks each model ----------------------------------------------------------------

export interface SetupStep {
  label: string;
  done: boolean;
  /** "12 of 60" */
  progress?: string;
  href: string;
  cta: string;
}

/** For the Lab tiles that need data: exactly what to do, how far along it is, and where. */
export async function labSetup(): Promise<Record<"menu" | "orders" | "waste" | "costs" | "events" | "fixed" | "timecards", SetupStep[]>> {
  const since = parseISODate(addDays(businessToday(), -90));
  const [top, recipes, pricedIngredients, ingredients, counts, packs, waste, events, fixed, cards, invoices] = await Promise.all([
    db.dailySale.groupBy({ by: ["squareId"], where: { date: { gte: since } }, _sum: { netSales: true }, orderBy: { _sum: { netSales: "desc" } }, take: 60 }),
    db.recipe.count({ where: { kind: { not: "PREP" } } }),
    db.ingredient.count({ where: { OR: [{ preferredProductId: { not: null } }, { products: { some: {} } }] } }),
    db.ingredient.count(),
    db.stockCount.count({ where: { completed: true } }),
    db.supplierProduct.count({ where: { active: true, packQtyBase: { gt: 0 } } }),
    db.wasteLog.count({ where: { loggedAt: { gte: since } } }),
    db.event.count(),
    getFixedCosts(),
    db.timecard.count({ where: { clockIn: { gte: since } } }),
    db.invoice.count(),
  ]);
  const ids = top.map((t) => t.squareId);
  const linkedTop = ids.length ? await db.squareMapping.count({ where: { squareId: { in: ids }, OR: [{ recipeId: { not: null } }, { ignored: true }] } }) : 0;
  const of = (a: number, b: number) => `${a} of ${b}`;
  return {
    menu: [
      { label: "Build recipes for what you sell", done: recipes >= 3, progress: `${recipes} so far`, href: "/menu", cta: "Menu costs" },
      { label: "Link your best-selling Square items to recipes", done: ids.length > 0 && linkedTop >= Math.min(ids.length, 20), progress: of(linkedTop, ids.length), href: "/sales/square-menu", cta: "Menu from Square" },
      { label: "Give ingredients a supplier price", done: ingredients > 0 && pricedIngredients >= ingredients * 0.8, progress: of(pricedIngredients, ingredients), href: "/ingredients", cta: "Ingredients" },
    ],
    orders: [
      { label: "Add supplier products with pack sizes", done: packs > 0, progress: `${packs} so far`, href: "/prices", cta: "Prices" },
      { label: "Do a stock count", done: counts > 0, progress: `${counts} done`, href: "/count", cta: "Count" },
      { label: "Link Square items to recipes (to know what each sale uses)", done: linkedTop >= Math.min(ids.length, 20) && ids.length > 0, progress: of(linkedTop, ids.length), href: "/sales/square-menu", cta: "Menu from Square" },
    ],
    waste: [{ label: "Log waste for two weeks", done: waste >= 14, progress: `${waste} in 90 days`, href: "/waste", cta: "Log waste" }],
    costs: [
      { label: "Bring in supplier prices or invoices", done: packs > 0 || invoices > 0, progress: `${packs} products, ${invoices} invoices`, href: "/prices", cta: "Prices" },
      { label: "Do two stock counts", done: counts >= 2, progress: `${counts} done`, href: "/count", cta: "Count" },
    ],
    events: [{ label: "Add game nights, music and festivals", done: events > 0, progress: `${events} so far`, href: "/events", cta: "Events" }],
    fixed: [{ label: "Enter rent, utilities and insurance", done: !!fixed && Object.values(fixed).some((v) => (v ?? 0) > 0), href: "/insights#lab-story", cta: "Add them" }],
    timecards: [{ label: "Clock in and out on Square", done: cards >= 20, progress: `${cards} timecards in 90 days`, href: "/labor", cta: "Timecards" }],
  };
}
