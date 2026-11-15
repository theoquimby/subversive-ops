import "server-only";
import type { CostRecipe } from "@/domain/costing";
import { addDays, dateRange, ISODate, parseISODate, toISODate, weekday } from "@/domain/dates";
import { forecastSeries } from "@/domain/forecast";
import {
  coverWindow,
  DEFAULT_PREP_SETTINGS,
  defaultPrepUnit,
  estimatePrepOnHand,
  groupByStation,
  planPrep,
  prepEventLabel,
  prepUsage,
  serviceShareAfter,
  type PrepDay,
  type PrepDayEvent,
  type PrepGroup,
  type PrepItemSettings,
  type PrepLine,
  type PrepRounding,
  type PrepUnit,
} from "@/domain/prep";
import { matchSaleNames } from "@/domain/salesNameMatch";
import { toBase, type BaseUnit } from "@/domain/units";
import { db, num } from "../db";
import { env } from "../env";
import { buildContext, loadCostingSnapshot } from "./costing";
import { getOpeningHours } from "./labor-rules";
import { eventsForPrepBetween, type PrepEvent } from "./privateEvents";
import { businessToday, squareLinks } from "./sales";

const HISTORY_DAYS = 70;
/** Days forecast from the prep date: enough for a 4-day cover and a week of shelf life. */
const HORIZON = 10;
const COVER_KEY = "prep.coverDays";

// ---- Settings ------------------------------------------------------------------

export async function getCoverDays(): Promise<number> {
  const s = await db.setting.findUnique({ where: { key: COVER_KEY } });
  const n = s ? Number(s.value) : 2;
  return Number.isFinite(n) && n >= 1 && n <= 4 ? Math.round(n) : 2;
}

export async function setCoverDays(n: number) {
  const value = String(Math.min(4, Math.max(1, Math.round(n))));
  await db.setting.upsert({ where: { key: COVER_KEY }, create: { key: COVER_KEY, value }, update: { value } });
}

const ROUNDINGS = new Set<PrepRounding>(["batch", "half", "exact"]);

export async function loadPrepSettings(): Promise<Map<string, PrepItemSettings>> {
  const rows = await db.prepSetting.findMany();
  return new Map(
    rows.map((r) => [
      r.recipeId,
      {
        onList: r.onList,
        parBase: num(r.parBase),
        shelfLifeDays: r.shelfLifeDays,
        rounding: ROUNDINGS.has(r.rounding as PrepRounding) ? (r.rounding as PrepRounding) : "batch",
        station: r.station,
        unit: r.unitName ? ({ name: r.unitName, baseQty: num(r.unitBase) ?? 0, container: r.unitBase != null } as PrepUnit) : null,
      },
    ]),
  );
}

/** Prep recipes (active, with lines) and their settings; the unit is resolved for standard names. */
export async function loadPrepItems() {
  const [recipes, settings] = await Promise.all([
    db.recipe.findMany({ where: { active: true, kind: "PREP", lines: { some: {} } }, select: { id: true, name: true, category: true, yieldQty: true, yieldUnit: true, yieldBase: true, notes: true }, orderBy: { name: "asc" } }),
    loadPrepSettings(),
  ]);
  return recipes.map((r) => {
    const base = r.yieldBase as BaseUnit;
    const lite = { yieldQty: r.yieldQty.toNumber(), yieldUnit: r.yieldUnit, yieldBase: base };
    // A "batch" of one each is a plated portion (side of fries), not prep: off the list until someone turns it on.
    const portion = base === "each" && lite.yieldQty === 1;
    const s = { ...DEFAULT_PREP_SETTINGS, onList: !portion, ...(settings.get(r.id) ?? {}) };
    let unit: PrepUnit = defaultPrepUnit(lite);
    if (s.unit && s.unit.container && s.unit.baseQty > 0) unit = s.unit;
    else if (s.unit && !s.unit.container) {
      try {
        unit = { name: s.unit.name, baseQty: toBase(1, s.unit.name, base) };
      } catch {
        // A unit that no longer fits (the batch unit changed): fall back to the default.
      }
    }
    return { id: r.id, name: r.name, category: r.category, notes: r.notes, base, ...lite, settings: { ...s, unit, station: s.station ?? r.category ?? null } };
  });
}

// ---- Sales by recipe, with a name fallback --------------------------------------

export interface SalesSource {
  /** Square items linked to a recipe on the Sales page. */
  linked: number;
  /** Square item names matched to a recipe by name (no link yet). */
  guessed: { sale: string; recipe: string }[];
  /** Days of sales history used. */
  days: number;
}

/**
 * Servings per sold recipe per day. Linked Square items count as linked; items
 * with no link are matched by name onto recipes that have no links at all, so
 * a half-linked menu doesn't count anything twice.
 */
export async function servingsByRecipe(from: ISODate, toExclusive: ISODate) {
  const [rows, mappings, sold] = await Promise.all([
    db.dailySale.findMany({ where: { date: { gte: parseISODate(from), lt: parseISODate(toExclusive) } }, select: { date: true, squareId: true, name: true, qty: true } }),
    squareLinks(),
    db.recipe.findMany({ where: { active: true, kind: { in: ["MENU", "MODIFIER"] } }, select: { id: true, name: true } }),
  ]);
  const mapped = new Map(mappings.map((m) => [m.squareId, m]));
  const linkedRecipes = new Set(mappings.filter((m) => m.recipeId && !m.ignored).map((m) => m.recipeId!));
  const unlinkedNames = [...new Set(rows.filter((r) => !mapped.get(r.squareId)?.recipeId && !mapped.get(r.squareId)?.ignored).map((r) => r.name))];
  const guesses = matchSaleNames(unlinkedNames, sold.filter((r) => !linkedRecipes.has(r.id)));
  const byRecipe = new Map<string, Map<ISODate, number>>();
  const openDays = new Set<ISODate>();
  for (const r of rows) {
    const date = toISODate(r.date);
    const q = r.qty.toNumber();
    if (q > 0) openDays.add(date);
    const m = mapped.get(r.squareId);
    if (m?.ignored) continue;
    const recipeId = m?.recipeId ?? guesses.get(r.name)?.recipeId;
    if (!recipeId) continue;
    const s = byRecipe.get(recipeId) ?? new Map<ISODate, number>();
    s.set(date, (s.get(date) ?? 0) + q);
    byRecipe.set(recipeId, s);
  }
  const source: SalesSource = {
    linked: mappings.filter((m) => m.recipeId && !m.ignored).length,
    guessed: [...guesses].map(([sale, g]) => ({ sale, recipe: g.recipeName })).sort((a, b) => a.recipe.localeCompare(b.recipe)),
    days: openDays.size,
  };
  return { byRecipe, openDays, source };
}

/** Item-level forecast for each date (same model as ordering: weekday baseline × trend × events/weather/manual × season). */
async function forecastServings(dates: ISODate[], today: ISODate, booked: readonly PrepEvent[] = []) {
  const { demandDrivers, pastEventDays, seasonalFactors } = await import("./forecasting");
  const from = addDays(today, -HISTORY_DAYS);
  const [{ byRecipe, openDays, source }, drivers, eventDays, seasonal] = await Promise.all([
    servingsByRecipe(from, today),
    demandDrivers(dates),
    pastEventDays(from, today),
    seasonalFactors(dates),
  ]);
  const baselineDays = new Set([...openDays].filter((d) => !eventDays.has(d)));
  // A booked event with a menu is prepped from its own portions; take its calendar lift out of
  // the walk-in forecast so the party isn't counted twice.
  const explicit = new Set(booked.filter((e) => e.calendarEventId && e.items.length > 0).map((e) => e.calendarEventId!));
  const walkInFactor = (x: { total: number; events: { id: string; impact: number }[] }) => {
    let t = x.total;
    for (const e of x.events) if (explicit.has(e.id) && e.impact > 0) t /= e.impact;
    return t;
  };
  const adjustments = new Map([...drivers].map(([d, x]) => [d, walkInFactor(x) * (seasonal.factors.get(d) ?? 1)]));
  const perDate = new Map<ISODate, Map<string, number>>(dates.map((d) => [d, new Map()]));
  for (const [recipeId, history] of byRecipe) {
    for (const f of forecastSeries({ history, openDays: baselineDays, asOf: today, dates, adjustments })) {
      if (f.qty > 0) perDate.get(f.date)!.set(recipeId, f.qty);
    }
  }
  return { perDate, history: byRecipe, openDays, source };
}

// ---- The list ------------------------------------------------------------------

const hourFmt = () => new Intl.DateTimeFormat("en-US", { timeZone: env.BUSINESS_TIMEZONE, hour: "numeric", minute: "numeric", hourCycle: "h23" });
function localHour(d: Date): number {
  const parts = hourFmt().formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}
const businessDateOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: env.BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export interface PrepListItem extends PrepLine {
  category: string;
  countedAt: string | null;
  countedBy: string | null;
}

export interface PrepList {
  prepDate: ISODate;
  today: ISODate;
  coverDays: number;
  window: ISODate[];
  lines: PrepListItem[];
  groups: (PrepGroup & { lines: PrepListItem[] })[];
  source: SalesSource;
  problems: string[];
  /** Average forecast use per open day over the horizon, per prep recipe (base units) — the setup table shows it. */
  avgDaily: Map<string, number>;
  /** Booked private events in the cover window (their portions are in the amounts). */
  events: PrepEvent[];
}

export async function buildPrepList(prepDateIn?: ISODate): Promise<PrepList> {
  const today = businessToday();
  const prepDate = prepDateIn && prepDateIn >= today && prepDateIn <= addDays(today, 7) ? prepDateIn : today;
  const forecastDates = dateRange(today, addDays(prepDate, HORIZON));
  const booked = await eventsForPrepBetween(today, addDays(prepDate, HORIZON));
  const [items, snap, coverDays, fc, hours, counts, dones, waste] = await Promise.all([
    loadPrepItems(),
    loadCostingSnapshot(),
    getCoverDays(),
    forecastServings(forecastDates, today, booked),
    getOpeningHours(today),
    db.prepCount.findMany({ where: { countedAt: { gte: new Date(Date.now() - 60 * 86400_000) } }, orderBy: { countedAt: "desc" } }),
    db.prepDone.findMany({ where: { day: { gte: addDays(today, -21), lte: prepDate } }, orderBy: { doneAt: "asc" } }),
    db.wasteLog.findMany({ where: { sourceRecipeId: { not: null }, loggedAt: { gte: new Date(Date.now() - 60 * 86400_000) } }, select: { sourceRecipeId: true, sourceQty: true, sourceUnit: true, batchId: true, id: true, loggedAt: true } }),
  ]);
  const ctx = buildContext(snap, today);
  // Prep items off the list are walked through like plated items, so what's inside them still counts.
  const prepIds = new Set(items.filter((i) => i.settings.onList).map((i) => i.id));
  const usage = prepUsage(ctx, prepIds);
  const names = new Map(snap.recipes.map((r) => [r.id, r.name]));

  // Daily prep use per date: actual sales for days gone, the forecast from today on.
  const servingsOn = (date: ISODate): Map<string, number> => {
    if (date >= today) return fc.perDate.get(date) ?? new Map();
    const out = new Map<string, number>();
    for (const [rid, series] of fc.history) {
      const v = series.get(date);
      if (v) out.set(rid, v);
    }
    return out;
  };
  const useOn = new Map<ISODate, Map<string, number>>();
  const prepUseOn = (date: ISODate) => {
    const hit = useOn.get(date);
    if (hit) return hit;
    const out = new Map<string, number>();
    for (const [sold, n] of servingsOn(date)) for (const [p, q] of usage.perServing.get(sold) ?? []) out.set(p, (out.get(p) ?? 0) + n * q);
    // Booked parties between now and the prep date eat into what's on hand too.
    if (date >= today && date < prepDate)
      for (const e of booked) if (e.date === date) for (const it of e.items) for (const [p, q] of usage.perServing.get(it.recipeId) ?? []) out.set(p, (out.get(p) ?? 0) + it.portions * q);
    useOn.set(date, out);
    return out;
  };

  const lastCount = new Map<string, (typeof counts)[number]>();
  for (const c of counts) if (!lastCount.has(c.recipeId)) lastCount.set(c.recipeId, c);
  const doneToday = new Map(dones.filter((d) => d.day === prepDate).map((d) => [d.recipeId, d]));
  const recipeById = new Map(items.map((i) => [i.id, i]));

  const wasteEntries = new Map<string, { recipeId: string; base: number; at: Date }>();
  for (const w of waste) {
    const key = w.batchId ?? w.id;
    if (wasteEntries.has(key) || !w.sourceRecipeId || w.sourceQty == null) continue;
    const r = recipeById.get(w.sourceRecipeId);
    if (!r) continue;
    try {
      wasteEntries.set(key, { recipeId: r.id, base: toBase(w.sourceQty.toNumber(), w.sourceUnit ?? r.yieldUnit, r.base), at: w.loggedAt });
    } catch {
      // Logged in a unit that doesn't convert; leave it out.
    }
  }

  const planItems = items.filter((i) => i.settings.onList).map((i) => {
    const count = lastCount.get(i.id);
    // Without a count, start from what was made in the last few days (it may still be there).
    const lookback = Math.min(7, i.settings.shelfLifeDays ?? 3);
    const sinceDate: ISODate = count ? businessDateOf(count.countedAt) : addDays(prepDate, -lookback);
    const sinceAt = count?.countedAt ?? null;
    const before = (day: ISODate) => day < prepDate;
    const made = dones.filter((d) => d.recipeId === i.id && before(d.day) && (sinceAt ? d.doneAt > sinceAt : d.day >= sinceDate));
    const madeSince = made.reduce((s, d) => s + d.qtyBase.toNumber(), 0);
    // Use between the count (or the first batch made since) and the start of the prep date.
    const startDate = count ? sinceDate : made[0]?.day ?? null;
    let usedSince = 0;
    if (startDate) {
      for (const d of dateRange(startDate, prepDate)) {
        const share = count && d === startDate ? serviceShareAfter(localHour(count.countedAt), hours[weekday(d)]) : 1;
        usedSince += (prepUseOn(d).get(i.id) ?? 0) * share;
      }
      // Sub-prep used by batches of other prep items made since.
      for (const d of dones) {
        if (!before(d.day) || (sinceAt ? d.doneAt <= sinceAt : d.day < startDate)) continue;
        const per = usage.perBatch.get(d.recipeId)?.get(i.id);
        const parent = recipeById.get(d.recipeId);
        if (!per || !parent) continue;
        const batchBase = toBase(parent.yieldQty, parent.yieldUnit, parent.base);
        if (batchBase > 0) usedSince += per * (d.qtyBase.toNumber() / batchBase);
      }
    }
    const wastedSince = [...wasteEntries.values()].filter((w) => w.recipeId === i.id && (sinceAt ? w.at > sinceAt : startDate ? businessDateOf(w.at) >= startDate : false)).reduce((s, w) => s + w.base, 0);
    const est = estimatePrepOnHand({ countBase: count ? count.qtyBase.toNumber() : null, madeSince, usedSince, wastedSince });
    const done = doneToday.get(i.id);
    const recipe: CostRecipe = ctx.recipes.get(i.id) ?? { id: i.id, name: i.name, yieldQty: i.yieldQty, yieldUnit: i.yieldUnit, yieldBase: i.base, menuPrice: null, lines: [] };
    return {
      recipe,
      settings: i.settings,
      onHandBase: est.qty,
      onHandKnown: est.known || made.length > 0,
      done: done ? { qtyBase: done.qtyBase.toNumber(), by: done.doneBy, at: done.doneAt.toISOString() } : null,
    };
  });

  const eventsOn = (date: ISODate): PrepDayEvent[] =>
    booked.filter((e) => e.date === date && e.items.length > 0).map((e) => ({ label: prepEventLabel(e.title, e.headcount), portions: new Map(e.items.map((it) => [it.recipeId, it.portions])) }));
  const days: PrepDay[] = dateRange(prepDate, addDays(prepDate, HORIZON)).map((date) => ({ date, servings: fc.perDate.get(date) ?? new Map(), events: eventsOn(date) }));
  const planned = planPrep({ prepDate, today, days, coverDays, items: planItems, usage, names });
  const lines: PrepListItem[] = planned.map((l) => {
    const i = recipeById.get(l.recipeId)!;
    const c = lastCount.get(l.recipeId);
    return { ...l, category: i.category, countedAt: c?.countedAt.toISOString() ?? null, countedBy: c?.countedBy ?? null };
  });

  const avgDaily = new Map<string, number>();
  const openDates = days.filter((d) => d.servings.size > 0).map((d) => d.date);
  for (const i of items) {
    const tot = openDates.reduce((s, d) => s + (prepUseOn(d).get(i.id) ?? 0), 0);
    avgDaily.set(i.id, openDates.length ? tot / openDates.length : 0);
  }

  const window = coverWindow(days, coverDays);

  return {
    prepDate,
    today,
    coverDays,
    window,
    lines,
    groups: groupByStation(lines.filter((l) => l.status === "make")) as PrepList["groups"],
    source: fc.source,
    problems: usage.problems,
    avgDaily,
    events: booked.filter((e) => window.includes(e.date)),
  };
}

// ---- Feed for other pages (morning brief) ----------------------------------------

export interface PrepSummary {
  date: ISODate;
  /** Items to make on the date (done ones included). */
  toMake: number;
  done: number;
  /** Items with no prep count yet. */
  notCounted: number;
  /** Counted items that run out during the first service day if nothing is made. */
  runningOut: number;
  /** Most urgent first. */
  top: { recipeId: string; name: string; amount: string; why: string; station: string | null; done: boolean }[];
  href: string;
}

/**
 * A few lines for a morning brief: how many prep items to make on `date`
 * (default today), how many are done, and the most urgent ones.
 */
export async function prepSummary(date?: ISODate, limit = 5): Promise<PrepSummary> {
  const list = await buildPrepList(date);
  const make = list.lines.filter((l) => l.status === "make");
  return {
    date: list.prepDate,
    toMake: make.length,
    done: make.filter((l) => l.done).length,
    notCounted: list.lines.filter((l) => !l.onHandKnown && l.status !== "nodata").length,
    // Only counted items: an uncounted one reads as zero on hand, which isn't "running out".
    runningOut: make.filter((l) => !l.done && l.onHandKnown && l.runsOutIn != null && l.runsOutIn < 1).length,
    top: make.filter((l) => !l.done).slice(0, limit).map((l) => ({ recipeId: l.recipeId, name: l.name, amount: l.amountText, why: l.why, station: l.station, done: !!l.done })),
    href: list.prepDate === list.today ? "/prep" : `/prep?day=${list.prepDate}`,
  };
}

// ---- One recipe, scaled ------------------------------------------------------------

export async function prepRecipe(recipeId: string) {
  const r = await db.recipe.findFirst({
    where: { id: recipeId, active: true },
    include: { lines: { orderBy: { sort: "asc" }, include: { ingredient: { select: { name: true } }, subRecipe: { select: { id: true, name: true, kind: true } } } } },
  });
  if (!r) return null;
  const items = await loadPrepItems();
  const item = items.find((i) => i.id === recipeId);
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    notes: r.notes,
    yieldQty: r.yieldQty.toNumber(),
    yieldUnit: r.yieldUnit,
    yieldBase: r.yieldBase as BaseUnit,
    settings: item?.settings ?? { ...DEFAULT_PREP_SETTINGS, unit: defaultPrepUnit({ yieldQty: r.yieldQty.toNumber(), yieldUnit: r.yieldUnit, yieldBase: r.yieldBase as BaseUnit }) },
    lines: r.lines.map((l) => ({ qty: l.qty.toNumber(), unit: l.unit, name: l.ingredient?.name ?? l.subRecipe?.name ?? "—", subRecipeId: l.subRecipe?.kind === "PREP" ? l.subRecipe.id : null })),
  };
}
