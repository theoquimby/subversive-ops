import "server-only";

/**
 * Learned suggestions (see src/domain/learned.ts). The nightly job works out
 * what the data says and caches it in Setting `learned.snapshot`; pages
 * compare that with what's saved *now*, so a suggestion disappears the moment
 * it's applied or someone sets the same thing by hand. "Not now" remembers the
 * exact suggestion in Setting `learned.dismissed`.
 */

import { addDays, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import {
  bufferFromPlan,
  distanceKm,
  fingerprint,
  hoursChanges,
  inferDeadlines,
  inferDeliveryDays,
  inferHoursFromSales,
  isDismissed,
  squareWeek,
  suggestPar,
  townFromAddress,
  WEATHER_NEAR_KM,
  type DayChange,
  type DeadlineInference,
  type DeliveryDays,
  type SalesHours,
} from "@/domain/learned";
import { inSeason, seasonOn, type WeekHours } from "@/domain/openingHours";
import { cutoffRule, deadlineFor } from "@/domain/ordering";
import { businessDateOf } from "@/lib/format";
import { db, num } from "@/server/db";
import { env } from "@/server/env";
import { fetchLocationProfiles } from "@/server/integrations/square-auth";
import { location } from "./forecasting";
import { getRegularHours, getSeasonalHours } from "./labor-rules";
import { loadCutoffRules, loadPars } from "./planning";
import { businessToday } from "./sales";
import { findTown, getBusinessContact } from "./settings";
import { getSquareConnection, readSettingJSON, writeSettingJSON } from "./square";

const SNAPSHOT_KEY = "learned.snapshot";
const DISMISSED_KEY = "learned.dismissed";
const STALE_MS = 36 * 3600_000;
const HOURS_WEEKS = 12;
const HISTORY_DAYS = 182;

export type HoursTarget = { kind: "regular" } | { kind: "season"; id: string; label: string };

export interface LearnedSnapshot {
  v: 1;
  at: string;
  hours: { target: HoursTarget; sales: SalesHours | null; square: WeekHours | null; squareLocation: string | null };
  weather: { lat: number; lon: number; label: string; source: "square" | "address" } | null;
  suppliers: { id: string; name: string; delivery: DeliveryDays; deadlines: DeadlineInference; invoices: number; orders: number }[];
  pars: { ingredientId: string; name: string; qtyBase: number; packBase: number | null; unit: string; n: number }[];
  buffers: { ingredientId: string; name: string; buffer: number }[];
  notes: string[];
}

// ---- Working it out ------------------------------------------------------------------------

async function squareProfile(): Promise<{ hours: WeekHours | null; name: string | null; coords: { lat: number; lon: number; label: string } | null; note?: string }> {
  const c = await getSquareConnection();
  if (!c || !c.locationIds.length) return { hours: null, name: null, coords: null };
  try {
    const all = await fetchLocationProfiles(c);
    const picked = all.filter((l) => c.locationIds.includes(l.id) && l.active);
    const best = [...picked].sort((a, b) => Number(!!b.periods) - Number(!!a.periods) || Number(b.type === "PHYSICAL") - Number(a.type === "PHYSICAL"))[0];
    if (!best) return { hours: null, name: null, coords: null };
    const town = [best.address?.locality, best.address?.administrative_district_level_1].filter(Boolean).join(", ");
    const withCoords = picked.find((l) => l.coordinates && l.type !== "MOBILE") ?? null;
    return {
      hours: squareWeek(best.periods),
      name: best.name,
      coords: withCoords?.coordinates ? { lat: Math.round(withCoords.coordinates.latitude * 10000) / 10000, lon: Math.round(withCoords.coordinates.longitude * 10000) / 10000, label: town || withCoords.name } : null,
    };
  } catch (e) {
    return { hours: null, name: null, coords: null, note: `Square locations: ${(e as Error).message}` };
  }
}

async function addressLocation(): Promise<{ lat: number; lon: number; label: string } | null> {
  const { address } = await getBusinessContact();
  const town = address ? townFromAddress(address) : null;
  if (!town) return null;
  const r = await findTown(town.split(",")[0]);
  if ("error" in r || !r.results.length) return null;
  return r.results.find((x) => x.label === town) ?? null;
}

/** Work everything out from scratch (Square is called once). */
export async function computeLearned(): Promise<LearnedSnapshot> {
  const today = businessToday();
  const yesterday = addDays(today, -1);
  const from = addDays(today, -HOURS_WEEKS * 7);
  const since = parseISODate(addDays(today, -HISTORY_DAYS));
  const notes: string[] = [];

  const [seasons, hourly, sq, suppliers, invoices, orders, ingredients, plans] = await Promise.all([
    getSeasonalHours(),
    db.hourlySale.findMany({ where: { date: { gte: parseISODate(from), lte: parseISODate(today) } }, select: { date: true, hour: true, netSales: true } }),
    squareProfile(),
    // "Unassigned supplier" is a catch-all for lines with no supplier, not someone who delivers.
    db.supplier.findMany({ where: { active: true, NOT: { name: { startsWith: "Unassigned", mode: "insensitive" } } }, select: { id: true, name: true } }),
    db.invoice.findMany({ where: { invoiceDate: { gte: since } }, select: { supplierId: true, invoiceDate: true } }),
    db.purchaseOrder.findMany({ where: { createdAt: { gte: since }, status: { in: ["SENT", "RECEIVED"] } }, select: { supplierId: true, status: true, deliveryDate: true, sentAt: true, receivedAt: true } }),
    db.ingredient.findMany({ where: { active: true, recipeLines: { none: {} } }, select: { id: true, name: true, products: { where: { active: true, packQtyBase: { gt: 0 } }, select: { id: true, packQtyBase: true, purchaseUnit: true, supplier: { select: { deliveryDays: true } } } }, preferredProductId: true } }),
    readSettingJSON<{ details?: { plans?: { id: string; name: string; best: number; onHand: number; pack: number; mean: number }[] } }>("analytics.orders"),
  ]);
  if (sq.note) notes.push(sq.note);

  // Opening hours: the hours in force today (a season, or the regular week), learned only from dates under them.
  const season = seasonOn(today, seasons);
  const target: HoursTarget = season ? { kind: "season", id: season.id, label: season.label } : { kind: "regular" };
  const include = (d: ISODate) => (season ? inSeason(d, season.from, season.to) : !seasonOn(d, seasons));
  const rows = hourly.map((h) => ({ date: toISODate(h.date), hour: h.hour, sales: num(h.netSales) ?? 0 }));
  const sales = rows.length ? inferHoursFromSales(rows, { from, to: yesterday }, include) : null;

  // Weather: Square's coordinates, else the delivery address's town.
  let weather: LearnedSnapshot["weather"] = sq.coords ? { ...sq.coords, source: "square" } : null;
  if (!weather) {
    try {
      const a = await addressLocation();
      if (a) weather = { ...a, source: "address" };
    } catch {}
  }

  // Deliveries: invoice dates and the dates orders were received (or their delivery date, once received).
  const tz = env.BUSINESS_TIMEZONE;
  const learnedSuppliers = suppliers.map((s) => {
    const inv = invoices.filter((i) => i.supplierId === s.id);
    const po = orders.filter((o) => o.supplierId === s.id);
    const obs = [
      ...inv.map((i) => ({ date: toISODate(i.invoiceDate), source: "invoice" as const })),
      ...po.filter((o) => o.status === "RECEIVED").map((o) => ({ date: o.receivedAt ? businessDateOf(o.receivedAt, tz) : toISODate(o.deliveryDate), source: "order" as const })),
    ];
    const sent = po.filter((o) => o.sentAt).map((o) => {
      const t = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(o.sentAt!);
      return { sentDate: businessDateOf(o.sentAt!, tz), sentTime: t, deliveryDate: toISODate(o.deliveryDate) };
    });
    return { id: s.id, name: s.name, delivery: inferDeliveryDays(obs), deadlines: inferDeadlines(sent), invoices: inv.length, orders: po.length };
  });

  // Minimum on hand for things no recipe uses, from how fast they're bought.
  const productIds = ingredients.flatMap((i) => i.products.map((p) => p.id));
  const parSince = addDays(today, -120);
  const bought = productIds.length
    ? await db.invoiceLine.findMany({ where: { supplierProductId: { in: productIds }, invoice: { invoiceDate: { gte: parseISODate(parSince) } } }, select: { supplierProductId: true, qty: true, invoice: { select: { invoiceDate: true } } } })
    : [];
  const pars: LearnedSnapshot["pars"] = [];
  for (const i of ingredients) {
    const pref = i.products.find((p) => p.id === i.preferredProductId) ?? i.products[0];
    if (!pref) continue;
    const packOf = new Map(i.products.map((p) => [p.id, num(p.packQtyBase)]));
    const purchases = bought.filter((b) => b.supplierProductId && packOf.has(b.supplierProductId)).map((b) => ({ date: toISODate(b.invoice.invoiceDate), qtyBase: (num(b.qty) ?? 0) * (packOf.get(b.supplierProductId!) ?? 0) }));
    const r = suggestPar({ purchases, windowDays: 120, deliveryDays: pref.supplier.deliveryDays, packBase: num(pref.packQtyBase) });
    if (r) pars.push({ ingredientId: i.id, name: i.name, qtyBase: Math.round(r.qtyBase * 1000) / 1000, packBase: num(pref.packQtyBase), unit: pref.purchaseUnit, n: r.n });
  }

  // Order buffers the order-size model landed on (only when Insights has sized orders).
  const buffers: LearnedSnapshot["buffers"] = [];
  for (const p of plans?.details?.plans ?? []) {
    const b = bufferFromPlan(p);
    if (b != null) buffers.push({ ingredientId: p.id, name: p.name, buffer: b });
  }

  return { v: 1, at: new Date().toISOString(), hours: { target, sales, square: sq.hours, squareLocation: sq.name }, weather, suppliers: learnedSuppliers, pars, buffers, notes };
}

/** Nightly (daily-ops) and on demand: recompute and cache. */
export async function refreshLearned(): Promise<{ suppliers: number; hours: boolean; square: boolean; pending: number }> {
  const s = await computeLearned();
  await writeSettingJSON(SNAPSHOT_KEY, s);
  const p = await pendingSuggestions(s);
  return { suppliers: s.suppliers.filter((x) => x.delivery.confidence !== "low").length, hours: !!s.hours.sales, square: !!s.hours.square, pending: p.total };
}

/** The cached snapshot; recomputed when it's missing or over 36 hours old. */
export async function getLearned(): Promise<LearnedSnapshot | null> {
  const cur = await readSettingJSON<LearnedSnapshot>(SNAPSHOT_KEY);
  if (cur?.v === 1 && Date.now() - Date.parse(cur.at) < STALE_MS) return cur;
  try {
    const next = await computeLearned();
    await writeSettingJSON(SNAPSHOT_KEY, next);
    return next;
  } catch (e) {
    console.error("learned suggestions failed", e);
    return cur ?? null;
  }
}

// ---- What's waiting for a person -----------------------------------------------------------

export interface HoursSuggestion {
  key: "hours";
  target: HoursTarget;
  /** Applying with Square first (or sales only when Square has no hours). */
  changes: DayChange[];
  /** The same, preferring the sales; set only when it differs from `changes`. */
  salesChanges: DayChange[] | null;
  weeks: number;
  squareLocation: string | null;
  hasSquare: boolean;
  hasSales: boolean;
}

export interface WeatherSuggestion {
  key: "weather";
  lat: number;
  lon: number;
  label: string;
  source: "square" | "address";
  current: string;
  km: number;
}

export interface SupplierSuggestion {
  id: string;
  name: string;
  days?: { key: string; days: number[]; current: number[]; confidence: "high" | "medium"; coverage: number; n: number; sources: string };
  lead?: { key: string; days: number; current: number; n: number };
  deadlines?: { key: string; perDay: Record<number, { day: number; time: string; n: number }>; n: number };
}

export interface ParSuggestion {
  key: string;
  ingredientId: string;
  name: string;
  qtyBase: number;
  packs: number | null;
  unit: string;
  n: number;
}

export interface BufferSuggestion {
  key: string;
  ingredientId: string;
  name: string;
  buffer: number;
  current: number;
}

export interface PendingSuggestions {
  hours: HoursSuggestion | null;
  weather: WeatherSuggestion | null;
  suppliers: SupplierSuggestion[];
  pars: ParSuggestion[];
  buffers: BufferSuggestion[];
  /** Waiting per Settings item id, for the badges on Settings home. */
  counts: Record<string, number>;
  total: number;
  at: string | null;
}

export const getDismissed = async () => (await readSettingJSON<Record<string, string>>(DISMISSED_KEY)) ?? {};

export async function dismissSuggestion(key: string, value: unknown) {
  const d = await getDismissed();
  d[key] = fingerprint(value);
  await writeSettingJSON(DISMISSED_KEY, d);
}

const EMPTY: PendingSuggestions = { hours: null, weather: null, suppliers: [], pars: [], buffers: [], counts: {}, total: 0, at: null };

/** Suggestions that differ from what's saved now and haven't been put off. Never throws. */
export async function pendingSuggestions(snapshot?: LearnedSnapshot | null): Promise<PendingSuggestions> {
  try {
    return await pending(snapshot === undefined ? await getLearned() : snapshot);
  } catch (e) {
    console.error("learned suggestions failed", e);
    return EMPTY;
  }
}

async function pending(s: LearnedSnapshot | null): Promise<PendingSuggestions> {
  if (!s) return EMPTY;
  const [dismissed, regular, seasons, loc, savedLoc, suppliers, cutoffs, pars, ingredients] = await Promise.all([
    getDismissed(),
    getRegularHours(),
    getSeasonalHours(),
    location(),
    db.setting.findUnique({ where: { key: "location" }, select: { key: true } }),
    db.supplier.findMany({ where: { active: true }, select: { id: true, name: true, deliveryDays: true, leadTimeDays: true } }),
    loadCutoffRules(),
    loadPars(),
    db.ingredient.findMany({ where: { active: true }, select: { id: true, safetyPct: true } }),
  ]);

  // Hours
  let hours: HoursSuggestion | null = null;
  const t = s.hours.target;
  const season = t.kind === "season" ? seasons.find((x) => x.id === t.id) : null;
  if (t.kind === "regular" || season) {
    const saved = season ? season.hours : regular;
    const changes = hoursChanges(saved, s.hours.sales, s.hours.square, "square");
    const bySales = s.hours.square && s.hours.sales ? hoursChanges(saved, s.hours.sales, s.hours.square, "sales") : null;
    const salesChanges = bySales && fingerprint(bySales.map((c) => [c.weekday, c.next])) !== fingerprint(changes.map((c) => [c.weekday, c.next])) ? bySales : null;
    if ((changes.length || salesChanges?.length) && !isDismissed(dismissed, "hours", changes.map((c) => [c.weekday, c.next]))) {
      hours = { key: "hours", target: t, changes, salesChanges, weeks: s.hours.sales?.weeks ?? 0, squareLocation: s.hours.squareLocation, hasSquare: !!s.hours.square, hasSales: !!s.hours.sales };
    }
  }

  // Weather
  let weather: WeatherSuggestion | null = null;
  if (s.weather) {
    const km = distanceKm(loc, s.weather);
    const value = { lat: s.weather.lat, lon: s.weather.lon };
    if (km > WEATHER_NEAR_KM && !isDismissed(dismissed, "weather", value)) weather = { key: "weather", ...s.weather, current: savedLoc ? loc.label : `${loc.label} (the default)`, km: Math.round(km) };
  }

  // Suppliers
  const out: SupplierSuggestion[] = [];
  for (const l of s.suppliers) {
    const sup = suppliers.find((x) => x.id === l.id);
    if (!sup) continue;
    const sug: SupplierSuggestion = { id: sup.id, name: sup.name };
    const d = l.delivery;
    const cur = [...sup.deliveryDays].sort();
    if (d.confidence !== "low" && fingerprint(d.days) !== fingerprint(cur) && !isDismissed(dismissed, `supplier.${sup.id}.days`, d.days)) {
      const sources = [l.invoices ? `${l.invoices} invoice${l.invoices === 1 ? "" : "s"}` : "", l.orders ? `${l.orders} order${l.orders === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
      sug.days = { key: `supplier.${sup.id}.days`, days: d.days, current: cur, confidence: d.confidence, coverage: d.coverage, n: d.n, sources };
    }
    const lead = l.deadlines.leadDays;
    if (lead != null && lead !== sup.leadTimeDays && lead <= 14 && !isDismissed(dismissed, `supplier.${sup.id}.lead`, lead)) sug.lead = { key: `supplier.${sup.id}.lead`, days: lead, current: sup.leadTimeDays, n: l.deadlines.n };
    // Deadlines only for days it delivers (or will, once the suggested days are set) that differ from what's in force.
    const rule = cutoffRule(cutoffs[sup.id], sup.leadTimeDays);
    const days = sug.days?.days ?? cur;
    const perDay = Object.fromEntries(Object.entries(l.deadlines.perDay).filter(([wd, v]) => {
      if (!days.includes(Number(wd))) return false;
      const now = deadlineFor(rule, Number(wd));
      return !rule.perDay?.[Number(wd)] || (Number(wd) - now.daysBefore + 70) % 7 !== v.day || now.time !== v.time;
    }));
    if (Object.keys(perDay).length && !isDismissed(dismissed, `supplier.${sup.id}.deadlines`, perDay)) sug.deadlines = { key: `supplier.${sup.id}.deadlines`, perDay, n: l.deadlines.n };
    if (sug.days || sug.lead || sug.deadlines) out.push(sug);
  }

  // Minimums (only where none is set — a set minimum is a person's call) and buffers.
  const parOut: ParSuggestion[] = s.pars
    .filter((p) => pars[p.ingredientId] == null && !isDismissed(dismissed, `par.${p.ingredientId}`, p.qtyBase))
    .map((p) => ({ key: `par.${p.ingredientId}`, ingredientId: p.ingredientId, name: p.name, qtyBase: p.qtyBase, packs: p.packBase ? Math.round((p.qtyBase / p.packBase) * 100) / 100 : null, unit: p.unit, n: p.n }));
  const safety = new Map(ingredients.map((i) => [i.id, num(i.safetyPct)]));
  const bufOut: BufferSuggestion[] = s.buffers
    .filter((b) => safety.has(b.ingredientId) && Math.abs(safety.get(b.ingredientId)! - b.buffer) >= 0.05 && !isDismissed(dismissed, `buffer.${b.ingredientId}`, b.buffer))
    .map((b) => ({ key: `buffer.${b.ingredientId}`, ingredientId: b.ingredientId, name: b.name, buffer: b.buffer, current: safety.get(b.ingredientId)! }));

  const counts: Record<string, number> = {};
  if (hours) counts["business.hours"] = 1;
  if (weather) counts["business.weather"] = 1;
  if (out.length) counts["food.suppliers"] = out.length;
  if (parOut.length + bufOut.length) counts["food.buffer"] = parOut.length + bufOut.length;
  return { hours, weather, suppliers: out, pars: parOut, buffers: bufOut, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), at: s.at };
}
