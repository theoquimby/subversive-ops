import "server-only";
import { CostingContext, explodeUsage } from "@/domain/costing";
import { addDays, dateRange, daysBetween, ISODate, nextWeekdayOnOrAfter, parseISODate, toISODate, todayIn, zonedMidnightUTC } from "@/domain/dates";
import { DayForecast, forecastSeries } from "@/domain/forecast";
import { CutoffRule, cutoffRule, estimateOnHand, hoursUntil, nextCutoff, OrderSuggestion, shouldAutoDraft, suggestLine } from "@/domain/ordering";
import { dayDate } from "@/lib/format";
import { Prisma } from "@prisma/client";
import { db, num } from "../db";
import { env } from "../env";
import { buildContext, loadCostingSnapshot, priceAsOf } from "./costing";
import { businessToday, salesByRecipe } from "./sales";

const HISTORY_DAYS = 70;

// ---- Forecast adjustments (events, closures) ---------------------------------

const ADJ_KEY = "forecast.adjustments";

export async function getAdjustments(): Promise<Map<ISODate, number>> {
  const s = await db.setting.findUnique({ where: { key: ADJ_KEY } });
  return new Map(Object.entries(s ? (JSON.parse(s.value) as Record<string, number>) : {}));
}

export async function setAdjustment(date: ISODate, multiplier: number | null) {
  const adj = await getAdjustments();
  if (multiplier == null || multiplier === 1) adj.delete(date);
  else adj.set(date, multiplier);
  const value = JSON.stringify(Object.fromEntries(adj));
  await db.setting.upsert({ where: { key: ADJ_KEY }, create: { key: ADJ_KEY, value }, update: { value } });
}

// ---- Forecast ---------------------------------------------------------------

export interface ItemForecast {
  recipeId: string;
  name: string;
  days: DayForecast[];
  total: number;
}

export async function forecastItems(dates: ISODate[]) {
  const today = businessToday();
  const { demandDrivers, pastEventDays, seasonalFactors } = await import("./forecasting");
  const from = addDays(today, -HISTORY_DAYS);
  const [{ byRecipe, openDays }, drivers, recipes, eventDays, seasonal] = await Promise.all([
    salesByRecipe(from, today),
    demandDrivers(dates),
    db.recipe.findMany({ where: { active: true, kind: { in: ["MENU", "MODIFIER"] } }, select: { id: true, name: true } }),
    pastEventDays(from, today),
    seasonalFactors(dates),
  ]);
  // Past event days (festivals, closures, big games) would skew a "usual Saturday", so they're left out of baselines.
  const baselineDays = new Set([...openDays].filter((d) => !eventDays.has(d)));
  // Events, weather and manual tweaks move item demand the same way they move sales;
  // item history is too short for its own seasonality, so it borrows the store's.
  const adjustments = new Map([...drivers].map(([d, x]) => [d, x.total * (seasonal.factors.get(d) ?? 1)]));
  const items: ItemForecast[] = recipes
    .map((r) => {
      const days = forecastSeries({ history: byRecipe.get(r.id) ?? new Map(), openDays: baselineDays, asOf: today, dates, adjustments });
      return { recipeId: r.id, name: r.name, days, total: days.reduce((s, d) => s + d.qty, 0) };
    })
    .filter((i) => i.total > 0)
    .sort((a, b) => b.total - a.total);
  return { items, adjustments: await getAdjustments(), drivers, hasHistory: openDays.size > 0, historyDays: openDays.size, eventDaysExcluded: openDays.size - baselineDays.size, seasonal: seasonal.active };
}

// ---- Order plan ---------------------------------------------------------------

export interface OrderPlan {
  supplier: { id: string; name: string; email: string | null; minOrder: number | null };
  today: ISODate;
  deliveryDate: ISODate;
  coverUntil: ISODate; // exclusive
  lines: OrderSuggestion[];
  total: number;
  problems: string[];
  onHandNotes: Map<string, string>;
}

/** Delivery date and cover window for a supplier, from its delivery days and lead time. */
export function deliveryWindow(s: { deliveryDays: number[]; leadTimeDays: number }, today: ISODate) {
  const earliest = addDays(today, Math.max(0, s.leadTimeDays));
  const deliveryDate = nextWeekdayOnOrAfter(earliest, s.deliveryDays) ?? earliest;
  const coverUntil = nextWeekdayOnOrAfter(addDays(deliveryDate, 1), s.deliveryDays) ?? addDays(deliveryDate, 7);
  return { deliveryDate, coverUntil };
}

export async function buildOrderPlan(supplierId: string, override?: { deliveryDate?: ISODate; coverUntil?: ISODate }): Promise<OrderPlan> {
  const plans = await computePlans([{ supplierId, override }]);
  const plan = plans.get(supplierId);
  if (!plan) throw new Error("Supplier not found");
  return plan;
}

/**
 * Suggested orders for several suppliers at once (each for its next delivery), sharing
 * one costing snapshot, forecast and stock estimate — what the Ordering table shows.
 */
export async function buildOrderPlans(supplierIds: string[]): Promise<Map<string, OrderPlan>> {
  return computePlans(supplierIds.map((supplierId) => ({ supplierId })));
}

async function computePlans(requests: { supplierId: string; override?: { deliveryDate?: ISODate; coverUntil?: ISODate } }[]): Promise<Map<string, OrderPlan>> {
  const out = new Map<string, OrderPlan>();
  if (requests.length === 0) return out;
  const today = businessToday();
  const suppliers = await db.supplier.findMany({
    where: { id: { in: requests.map((r) => r.supplierId) } },
    include: { products: { where: { active: true, ingredientId: { not: null } }, include: { ingredient: true } } },
  });
  if (suppliers.length === 0) return out;
  const rules = await loadCutoffRules();
  const now = localNow();

  const jobs = suppliers.map((supplier) => {
    const override = requests.find((r) => r.supplierId === supplier.id)?.override;
    // Default to the next delivery whose order cutoff hasn't passed (falls back to lead time alone).
    let win = deliveryWindow(supplier, today);
    if (!override?.deliveryDate) {
      const next = now.date === today ? nextCutoff(supplier.deliveryDays, cutoffRule(rules[supplier.id], supplier.leadTimeDays), now.date, now.time) : null;
      if (next) win = { deliveryDate: next.deliveryDate, coverUntil: nextWeekdayOnOrAfter(addDays(next.deliveryDate, 1), supplier.deliveryDays) ?? addDays(next.deliveryDate, 7) };
    }
    const deliveryDate = override?.deliveryDate ?? win.deliveryDate;
    const coverUntil = override?.coverUntil ?? win.coverUntil;
    // Only one product per ingredient is ordered from a supplier: the preferred one, else the first.
    const byIngredient = new Map<string, (typeof supplier.products)[number]>();
    for (const p of supplier.products) {
      const ing = p.ingredient!;
      const cur = byIngredient.get(ing.id);
      if (!cur || ing.preferredProductId === p.id) byIngredient.set(ing.id, p);
    }
    return { supplier, deliveryDate, coverUntil, byIngredient };
  });
  const allIngredients = [...new Set(jobs.flatMap((j) => [...j.byIngredient.keys()]))];

  const snap = await loadCostingSnapshot();
  const ctx = buildContext(snap, today);
  const { perServing, problems } = usagePerServing(ctx);

  // One forecast over the longest window; each plan reads its own dates from it.
  const lastCover = jobs.map((j) => j.coverUntil).sort().at(-1)!;
  const [{ items }, stock, pars] = await Promise.all([forecastItems(dateRange(today, lastCover)), estimateStock(allIngredients, perServing, today), loadPars()]);

  const usageBetween = (ingredientId: string, from: ISODate, to: ISODate) => {
    let total = 0;
    for (const it of items) {
      const per = perServing.get(it.recipeId)?.get(ingredientId);
      if (!per) continue;
      for (const d of it.days) if (d.date >= from && d.date < to) total += d.qty * per;
    }
    return total;
  };

  for (const { supplier, deliveryDate, coverUntil, byIngredient } of jobs) {
    const ingredientIds = [...byIngredient.keys()];
    const incoming = await incomingBy(ingredientIds, deliveryDate);
    const forecastDates = dateRange(today, coverUntil);
    const onHandNotes = new Map<string, string>();
    const lines: OrderSuggestion[] = [];
    for (const [ingredientId, product] of byIngredient) {
      const ing = product.ingredient!;
      const st = stock.get(ingredientId)!;
      onHandNotes.set(ingredientId, st.countedOn ? `counted ${st.countedOn}` : "not counted yet");
      lines.push(
        suggestLine(
          {
            supplierProductId: product.id,
            ingredientId,
            ingredientName: ing.name,
            description: product.description,
            purchaseUnit: product.purchaseUnit,
            packQtyBase: num(product.packQtyBase),
            unitPrice: priceAsOf(snap.priceHistory.get(product.id), today),
            safetyPct: ing.safetyPct.toNumber(),
          },
          {
            onHandNow: st.qty,
            onHandKnown: st.known,
            usageUntilDelivery: usageBetween(ingredientId, today, deliveryDate),
            usageDuringCover: usageBetween(ingredientId, deliveryDate, coverUntil),
            incomingBeforeDelivery: incoming.get(ingredientId) ?? 0,
            parLevel: pars[ingredientId] ?? null,
            dailyUsage: forecastDates.map((d) => usageBetween(ingredientId, d, addDays(d, 1))),
            daysUntilDelivery: Math.max(0, daysBetween(today, deliveryDate)),
            coverDays: Math.max(0, daysBetween(deliveryDate, coverUntil)),
          },
        ),
      );
    }
    const rank = (l: OrderSuggestion) => (l.status === "runs-out" ? 2 : l.suggestedUnits > 0 ? 1 : 0);
    lines.sort((a, b) => rank(b) - rank(a) || a.ingredientName.localeCompare(b.ingredientName));
    out.set(supplier.id, {
      supplier: { id: supplier.id, name: supplier.name, email: supplier.email, minOrder: num(supplier.minOrder) },
      today,
      deliveryDate,
      coverUntil,
      lines,
      total: lines.reduce((s, l) => s + (l.lineCost ?? 0), 0),
      problems,
      onHandNotes,
    });
  }
  return out;
}

async function latestCounts(ingredientIds: string[]) {
  const lines = await db.stockCountLine.findMany({
    where: { ingredientId: { in: ingredientIds }, count: { completed: true } },
    include: { count: { select: { takenAt: true } } },
    orderBy: { count: { takenAt: "desc" } },
  });
  const out = new Map<string, { qty: number; date: ISODate; at: Date }>();
  for (const l of lines) {
    if (out.has(l.ingredientId)) continue;
    out.set(l.ingredientId, { qty: l.qtyBase.toNumber(), date: toISODate(l.count.takenAt), at: l.count.takenAt });
  }
  return out;
}

/**
 * Deliveries since each ingredient's last count: checked-in PO lines, plus
 * approved invoices that weren't billed against a checked-in order (an invoice
 * with no PO is the only record those goods arrived). Invoices count as
 * received at midday on the invoice date.
 */
async function receivedSince(ingredientIds: string[], counts: Map<string, { at: Date }>) {
  const [rows, invoiceLines] = await Promise.all([
    db.purchaseOrderLine.findMany({
      where: { order: { status: "RECEIVED" }, product: { ingredientId: { in: ingredientIds } } },
      include: { order: { select: { receivedAt: true } }, product: { select: { ingredientId: true, packQtyBase: true } } },
    }),
    db.invoiceLine.findMany({
      where: {
        invoice: { status: "APPROVED", OR: [{ orderId: null }, { order: { status: { not: "RECEIVED" } } }] },
        product: { ingredientId: { in: ingredientIds } },
      },
      include: { invoice: { select: { invoiceDate: true } }, product: { select: { ingredientId: true, packQtyBase: true } } },
    }),
  ]);
  const out = new Map<string, number>();
  const add = (id: string, at: Date, qtyBase: number) => {
    const since = counts.get(id)?.at;
    if (!since || at <= since) return;
    out.set(id, (out.get(id) ?? 0) + qtyBase);
  };
  for (const r of rows) {
    if (!r.order.receivedAt) continue;
    add(r.product.ingredientId!, r.order.receivedAt, (num(r.receivedQty) ?? r.qty.toNumber()) * (num(r.product.packQtyBase) ?? 0));
  }
  for (const l of invoiceLines) {
    if (!l.product?.ingredientId) continue;
    const at = new Date(zonedMidnightUTC(toISODate(l.invoice.invoiceDate), env.BUSINESS_TIMEZONE).getTime() + 12 * 3600_000);
    add(l.product.ingredientId, at, l.qty.toNumber() * (num(l.product.packQtyBase) ?? 0));
  }
  return out;
}

async function wasteSince(ingredientIds: string[], counts: Map<string, { at: Date }>) {
  const rows = await db.wasteLog.findMany({ where: { ingredientId: { in: ingredientIds } } });
  const out = new Map<string, number>();
  for (const r of rows) {
    const since = counts.get(r.ingredientId)?.at;
    if (!since || r.loggedAt <= since) continue;
    out.set(r.ingredientId, (out.get(r.ingredientId) ?? 0) + r.qtyBase.toNumber());
  }
  return out;
}

async function incomingBy(ingredientIds: string[], deliveryDate: ISODate) {
  const rows = await db.purchaseOrderLine.findMany({
    // An approved invoice against a sent order means it arrived (and counts as received), so it's no longer incoming.
    where: { order: { status: "SENT", deliveryDate: { lte: parseISODate(deliveryDate) }, invoices: { none: { status: "APPROVED" } } }, product: { ingredientId: { in: ingredientIds } } },
    include: { product: { select: { ingredientId: true, packQtyBase: true } } },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const id = r.product.ingredientId!;
    out.set(id, (out.get(id) ?? 0) + r.qty.toNumber() * (num(r.product.packQtyBase) ?? 0));
  }
  return out;
}

// ---- Estimated stock on hand ------------------------------------------------------

/** Raw-ingredient usage per serving of every recipe. */
export function usagePerServing(ctx: CostingContext) {
  const perServing = new Map<string, Map<string, number>>();
  const problems = new Set<string>();
  for (const r of ctx.recipes.values()) {
    const { usage, problems: p } = explodeUsage(ctx, r.id, 1);
    perServing.set(r.id, usage);
    for (const x of p) problems.add(x);
  }
  return { perServing, problems: [...problems] };
}

export interface StockEstimate {
  qty: number; // base units
  known: boolean;
  countedOn: ISODate | null;
}

/**
 * Last count + received since (POs and PO-less approved invoices) − theoretical
 * usage from sales − logged waste, per ingredient.
 */
export async function estimateStock(ingredientIds: string[], perServing: Map<string, Map<string, number>>, today: ISODate): Promise<Map<string, StockEstimate>> {
  const lastCounts = await latestCounts(ingredientIds);
  const earliestCount = [...lastCounts.values()].map((c) => c.date).sort()[0] ?? today;
  const [{ byRecipe }, received, waste] = await Promise.all([
    salesByRecipe(earliestCount, today),
    receivedSince(ingredientIds, lastCounts),
    wasteSince(ingredientIds, lastCounts),
  ]);
  const usageSince = (ingredientId: string, from: ISODate) => {
    let total = 0;
    for (const [recipeId, series] of byRecipe) {
      const per = perServing.get(recipeId)?.get(ingredientId);
      if (!per) continue;
      for (const [date, qty] of series) if (date >= from && date < today) total += qty * per;
    }
    return total;
  };
  const out = new Map<string, StockEstimate>();
  for (const id of ingredientIds) {
    const count = lastCounts.get(id);
    const est = estimateOnHand({
      lastCountQty: count?.qty ?? null,
      receivedSinceCount: received.get(id) ?? 0,
      usageSinceCount: count ? usageSince(id, count.date) : 0,
      wasteSinceCount: waste.get(id) ?? 0,
    });
    out.set(id, { qty: est.qty, known: count != null, countedOn: count?.date ?? null });
  }
  return out;
}

/** Estimated on hand for every active ingredient (the /ingredients column). */
export async function estimatedOnHandAll(): Promise<Map<string, StockEstimate>> {
  const today = businessToday();
  const [snap, ings] = await Promise.all([loadCostingSnapshot(), db.ingredient.findMany({ where: { active: true }, select: { id: true } })]);
  const { perServing } = usagePerServing(buildContext(snap, today));
  return estimateStock(ings.map((i) => i.id), perServing, today);
}

// ---- Par levels (min on hand for items no recipe uses) ------------------------------

const PAR_KEY = "ordering.minOnHand";

/** Minimum on hand per ingredient, in base units. */
export async function loadPars(): Promise<Record<string, number>> {
  const s = await db.setting.findUnique({ where: { key: PAR_KEY } });
  if (!s) return {};
  try {
    const v = JSON.parse(s.value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "number" && x > 0)) as Record<string, number>;
  } catch {
    return {};
  }
}

export async function setPar(ingredientId: string, qtyBase: number | null) {
  const pars = await loadPars();
  if (qtyBase == null || qtyBase <= 0) delete pars[ingredientId];
  else pars[ingredientId] = qtyBase;
  const value = JSON.stringify(pars);
  await db.setting.upsert({ where: { key: PAR_KEY }, create: { key: PAR_KEY, value }, update: { value } });
}

// ---- Order cutoffs and auto-drafts ----------------------------------------------------

const CUTOFF_KEY = "ordering.cutoffs";

export async function loadCutoffRules(): Promise<Record<string, Partial<CutoffRule>>> {
  const s = await db.setting.findUnique({ where: { key: CUTOFF_KEY } });
  if (!s) return {};
  try {
    return JSON.parse(s.value) as Record<string, Partial<CutoffRule>>;
  } catch {
    return {};
  }
}

export async function saveCutoffRule(supplierId: string, patch: Partial<CutoffRule>) {
  const all = await loadCutoffRules();
  all[supplierId] = { ...all[supplierId], ...patch };
  const value = JSON.stringify(all);
  await db.setting.upsert({ where: { key: CUTOFF_KEY }, create: { key: CUTOFF_KEY, value }, update: { value } });
}

const clock = (t: string) => {
  const h = Number(t.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}${t.slice(3) === "00" ? "" : `:${t.slice(3)}`}${h < 12 ? "am" : "pm"}`;
};

/** Business-local date and "HH:MM" right now. */
export function localNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: env.BUSINESS_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => (parts.find((p) => p.type === t)?.value ?? "00").padStart(2, "0");
  return { date: todayIn(env.BUSINESS_TIMEZONE, now), time: `${get("hour")}:${get("minute")}` };
}

export interface SupplierCutoff {
  supplierId: string;
  name: string;
  rule: CutoffRule;
  next: { deliveryDate: ISODate; cutoffDate: ISODate; cutoffTime: string } | null;
  hoursToCutoff: number | null;
  draftId: string | null;
}

/** Each active supplier's cutoff rule, next order deadline and any order already in for that delivery. */
export async function supplierCutoffs(now = new Date()): Promise<SupplierCutoff[]> {
  const { date, time } = localNow(now);
  const [suppliers, rules] = await Promise.all([db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }), loadCutoffRules()]);
  const nexts = suppliers.map((s) => {
    const rule = cutoffRule(rules[s.id], s.leadTimeDays);
    return { s, rule, next: nextCutoff(s.deliveryDays, rule, date, time) };
  });
  const deliveries = [...new Set(nexts.map((n) => n.next?.deliveryDate).filter((d): d is string => Boolean(d)))];
  const existing = deliveries.length
    ? await db.purchaseOrder.findMany({ where: { deliveryDate: { in: deliveries.map(parseISODate) } }, select: { id: true, supplierId: true, deliveryDate: true, status: true } })
    : [];
  return nexts.map(({ s, rule, next }) => ({
    supplierId: s.id,
    name: s.name,
    rule,
    next,
    hoursToCutoff: next ? hoursUntil(date, time, next.cutoffDate, next.cutoffTime) : null,
    draftId: next ? existing.find((o) => o.supplierId === s.id && toISODate(o.deliveryDate) === next.deliveryDate)?.id ?? null : null,
  }));
}

/**
 * Daily job: for each supplier whose order cutoff falls in the next 36 hours,
 * build the suggested order and save it as a DRAFT purchase order — unless an
 * order for that delivery already exists or there's nothing to order. Safe to
 * run repeatedly. Never throws; failures are reported per supplier.
 */
export async function autoDraftOrders(now = new Date()) {
  const results: { supplier: string; deliveryDate?: ISODate; status: "drafted" | "skipped" | "error"; reason?: string; orderId?: string; lines?: number }[] = [];
  let cutoffs: SupplierCutoff[];
  try {
    cutoffs = await supplierCutoffs(now);
  } catch (e) {
    return { results: [{ supplier: "*", status: "error" as const, reason: e instanceof Error ? e.message : String(e) }] };
  }
  for (const c of cutoffs) {
    if (!c.next) {
      results.push({ supplier: c.name, status: "skipped", reason: "no delivery days" });
      continue;
    }
    if (!shouldAutoDraft({ rule: c.rule, hoursToCutoff: c.hoursToCutoff ?? 0, hasOrderForDelivery: Boolean(c.draftId) })) {
      results.push({ supplier: c.name, deliveryDate: c.next.deliveryDate, status: "skipped", reason: c.draftId ? "already ordered" : !c.rule.autoDraft ? "auto-draft off" : "cutoff not near" });
      continue;
    }
    try {
      const r = await draftSuggestedOrder(c.supplierId, c.next, `Auto-drafted ahead of the ${clock(c.next.cutoffTime)} ${dayDate(c.next.cutoffDate)} cutoff. Review and send.`);
      if (r.status === "skipped") results.push({ supplier: c.name, deliveryDate: r.deliveryDate, status: "skipped", reason: r.reason });
      else results.push({ supplier: c.name, deliveryDate: r.deliveryDate, status: "drafted", orderId: r.orderId, lines: r.lines });
    } catch (e) {
      console.error("autoDraftOrders failed", c.name, e);
      results.push({ supplier: c.name, deliveryDate: c.next.deliveryDate, status: "error", reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results };
}

/**
 * Build the suggested order for a supplier's delivery and save it as a DRAFT — the same
 * path the daily auto-draft takes, also used by "Draft orders" on the Ordering table.
 * `next` is the delivery to order for (null: the supplier's next one by lead time).
 * Skips when there's nothing to order. The caller decides whether an order already exists.
 */
export async function draftSuggestedOrder(
  supplierId: string,
  next: { deliveryDate: ISODate } | null,
  note: string,
): Promise<{ status: "drafted"; deliveryDate: ISODate; orderId: string; lines: number } | { status: "skipped"; deliveryDate?: ISODate; reason: string }> {
  const s = await db.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { deliveryDays: true } });
  const plan = next
    ? await buildOrderPlan(supplierId, { deliveryDate: next.deliveryDate, coverUntil: nextWeekdayOnOrAfter(addDays(next.deliveryDate, 1), s.deliveryDays) ?? addDays(next.deliveryDate, 7) })
    : await buildOrderPlan(supplierId);
  const lines = plan.lines.filter((l) => l.suggestedUnits > 0);
  if (lines.length === 0) return { status: "skipped", deliveryDate: plan.deliveryDate, reason: "nothing to order" };
  const runsOut = plan.lines.filter((l) => l.status === "runs-out").length;
  const po = await db.purchaseOrder.create({
    data: {
      supplierId,
      deliveryDate: parseISODate(plan.deliveryDate),
      coverUntil: parseISODate(plan.coverUntil),
      notes: `${note}${runsOut ? ` ${runsOut} item${runsOut === 1 ? " runs" : "s run"} out before delivery.` : ""}`,
      lines: {
        create: lines.map((l) => ({
          supplierProductId: l.supplierProductId,
          suggestedQty: new Prisma.Decimal(l.suggestedUnits),
          qty: new Prisma.Decimal(l.suggestedUnits),
          unitPrice: l.unitPrice == null ? null : new Prisma.Decimal(l.unitPrice.toFixed(2)),
        })),
      },
    },
  });
  return { status: "drafted", deliveryDate: plan.deliveryDate, orderId: po.id, lines: lines.length };
}
