import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { after } from "next/server";
import { allFindings, AnalyticsRun, emptyFeedState, FeedState, FeedVerdict, FixedCosts, Insight, markFeed, markSeen, MODEL_IDS, ModelId, Opportunity, parseFeedState, rankFeed, Ranked, runAge } from "@/domain/analytics";
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
import { loadTimecards } from "./labor";
import { getLaborRules } from "./labor-rules";
import { buildOrderPlan, estimatedOnHandAll, forecastItems, getAdjustments, usagePerServing } from "./planning";
import { businessToday, salesByRecipe } from "./sales";
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
 * Recomputed nightly by /api/cron/daily-ops and on demand ("Refresh").
 * ANALYTICS_URL + ANALYTICS_SECRET point at the service; without them, in
 * development, `python3 analytics/cli.py` runs the same code locally
 * (ANALYTICS_PYTHON picks the interpreter, e.g. a venv with requirements.txt).
 */

const HISTORY_DAYS = 120;
const FUTURE_DAYS = 14;
const tz = () => process.env.BUSINESS_TIMEZONE || "America/New_York";

const KEY = { meta: "analytics.meta", status: "analytics.status", feed: "analytics.feed", fixed: "analytics.fixedCosts", state: "analytics.feedState" } as const;
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

// ---- Gathering ----------------------------------------------------------------------------

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Everything the models need, as plain JSON. No credentials, no personal data beyond first names on the schedule. */
export async function gatherPayload(today = businessToday()) {
  const from = addDays(today, -HISTORY_DAYS);
  const futureEnd = addDays(today, FUTURE_DAYS);
  const futureDates = dateRange(today, futureEnd);
  const snap = await loadCostingSnapshot();
  const ctx = buildContext(snap, today);
  const [kpis, events, weather, manual, futureF, accuracy, cls, rules, fixedCosts, state] = await Promise.all([
    dailyKpis(from, today, { snap }),
    db.event.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(addDays(today, 45)) } } }),
    weatherMap(from, futureEnd),
    getAdjustments(),
    dailySalesForecast(futureDates).catch((e) => (console.error("analytics: forecast failed", e), [])),
    forecastAccuracy(28).catch(() => ({ rows: [] as { date: ISODate; forecast: number; actual: number; open: boolean }[] })),
    classSettings(),
    getLaborRules(),
    getFixedCosts(),
    getFeedState(),
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
  const wasteRows = await db.wasteLog.findMany({ where: { loggedAt: { gte: zonedTime(from, 0, tz()) } }, select: { ingredientId: true, qtyBase: true, loggedAt: true, sourceRecipe: { select: { name: true } }, ingredient: { select: { name: true } } } });
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

  const days = kpis.days.map((d) => {
    const ev = evBy.get(d.date);
    const w = weather.get(d.date);
    return {
      date: d.date,
      open: d.sales > 0 && !ev?.closure,
      sales: round(d.sales),
      orders: d.orders,
      labor: round(d.labor),
      laborHours: round(d.laborHours),
      cogs: round(d.cogs),
      foodSales: round(d.group.food.sales),
      waste: round(wasteBy.get(d.date) ?? 0),
      wasteLogged: firstWaste != null && d.date >= firstWaste,
      eventMult: ev ? (ev.closure ? 0 : ev.mult) : 1,
      eventKinds: ev?.kinds ?? [],
      eventTitles: ev?.titles ?? [],
      wet: w ? isWet(w) : false,
      hasWeather: !!w,
      tempMaxC: w?.tempMaxC ?? null,
    };
  });

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

  // Items: daily qty and sales per menu recipe
  const [{ byRecipe }, saleRows, mappings] = await Promise.all([
    salesByRecipe(from, today),
    db.dailySale.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(today) } }, select: { date: true, squareId: true, qty: true, netSales: true } }),
    db.squareMapping.findMany({ where: { recipeId: { not: null }, ignored: false }, select: { squareId: true, recipeId: true } }),
  ]);
  const recipeOf = new Map(mappings.map((m) => [m.squareId, m.recipeId!]));
  const daily = new Map<string, Record<ISODate, [number, number]>>();
  for (const r of saleRows) {
    const id = recipeOf.get(r.squareId);
    if (!id) continue;
    const m = daily.get(id) ?? {};
    const d = toISODate(r.date);
    const cur = m[d] ?? [0, 0];
    m[d] = [cur[0] + r.qty.toNumber(), round(cur[1] + r.netSales.toNumber())];
    daily.set(id, m);
  }
  const items = snap.recipes
    .filter((r) => r.kind !== "PREP" && daily.has(r.id))
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
        daily: daily.get(r.id)!,
      };
    });

  // Hourly sales + labor per clock hour
  const [hourRows, cards] = await Promise.all([db.hourlySale.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(today) } } }), loadTimecards(from, today)]);
  const cardsBy = new Map<ISODate, typeof cards>();
  for (const c of cards) cardsBy.set(c.date, [...(cardsBy.get(c.date) ?? []), c]);
  const salesByHour = new Map<string, { sales: number; orders: number }>();
  for (const h of hourRows) salesByHour.set(`${toISODate(h.date)}|${h.hour}`, { sales: h.netSales.toNumber(), orders: h.orders });
  const now = new Date();
  const hourly: { date: ISODate; hour: number; sales: number; orders: number; laborHours: number; laborCost: number }[] = [];
  for (const date of dateRange(from, today)) {
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

// ---- Running ------------------------------------------------------------------------------

type RawRun = Omit<AnalyticsRun, "source" | "seconds"> & { seconds?: number };

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
    const meta = { version: run.version, computedAt: run.computedAt, timings: run.timings, source, seconds, serviceSeconds: run.seconds ?? null };
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
  const meta = parse<{ version: string; computedAt: string; timings: Record<string, number>; source: AnalyticsRun["source"]; seconds: number }>(KEY.meta);
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

export async function markFinding(item: Pick<Opportunity, "key" | "kind" | "title" | "subject" | "monthly">, verdict: FeedVerdict | "undo", snoozeDays = 14) {
  const state = await getFeedState();
  await writeJSON(KEY.state, markFeed(state, item, verdict, businessToday(), snoozeDays));
}

/**
 * The ranked feed. `remember` records what was shown (once a week per finding)
 * so it fades next time — pass it only where Max actually sees the feed.
 */
export async function insightFeed(opts: { limit?: number; remember?: boolean; run?: AnalyticsRun | null; novelty?: boolean } = {}): Promise<{ items: Ranked[]; run: AnalyticsRun | null; state: FeedState }> {
  const [run, state] = await Promise.all([opts.run !== undefined ? Promise.resolve(opts.run) : loadRun(), getFeedState()]);
  const today = businessToday();
  const ranked = rankFeed(allFindings(run), state, today, { novelty: opts.novelty ?? true });
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
  const p = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
  const compare = d.tsMape != null ? `Typical miss ${p(d.mape)} (${d.model}) vs ${p(d.tsMape)} for the main forecast.` : `Typical miss ${p(d.mape)}.`;
  return { days, model: d.model ?? "", compare };
}

/** One day's range, e.g. for a schedule or order page header ("Saturday $3,100–$3,600"). */
export async function forecastRangeFor(date: ISODate): Promise<RangeDay | null> {
  const f = await forecastRanges();
  const d = f?.days.find((x) => x.date === date);
  return d && !d.closed ? d : null;
}
