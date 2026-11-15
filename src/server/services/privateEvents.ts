import "server-only";
import { randomBytes } from "node:crypto";
import type { AttentionItem } from "@/domain/attention";
import { addDays, ISODate, parseISODate, toISODate, weekday } from "@/domain/dates";
import {
  BOOKED_STAGES,
  CALENDAR_STAGES,
  canMove,
  defaultDueDates,
  EVENT_TYPE_LABEL,
  forecastImpact,
  isBarKind,
  isEventType,
  isQuoteToken,
  isStage,
  parseConfig,
  prepPortions,
  privateEventAttention,
  quoteTotals,
  STAGE_LABEL,
  stageAfterPayment,
  type BarKind,
  type EventType,
  type PrivateEventConfig,
  type QuoteInput,
  type QuoteResult,
  type Stage,
} from "@/domain/privateEvents";
import { Prisma } from "@prisma/client";
import { db, num } from "../db";
import { buildContext, loadCostingSnapshot, safeCost } from "./costing";
import { dailySalesHistory } from "./forecasting";
import { businessToday } from "./sales";
import { readSettingJSON, writeSettingJSON } from "./square";

/**
 * Private events & parties: bookings move Inquiry → Quoted → Deposit paid →
 * Confirmed → Done (or Lost). Each has one quote (menu items, per-person
 * packages, bar, room fee, service charge, tax, deposit) costed live from the
 * recipes, a public quote link the client can accept, and manual payments.
 * Confirmed bookings keep an Events calendar entry (kind PRIVATE) up to date so
 * the forecast sees them. Exposes `privateEventNeedsYou` for the Overview and
 * `eventsForPrep` for the prep list.
 */

const CONFIG_KEY = "privateEvents.config";
const D = (n: number) => new Prisma.Decimal(n);
const iso = (d: Date | null | undefined) => (d ? toISODate(d) : null);

export async function getPrivateEventConfig(): Promise<PrivateEventConfig> {
  return parseConfig(await readSettingJSON(CONFIG_KEY));
}
export async function savePrivateEventConfig(cfg: PrivateEventConfig) {
  await writeSettingJSON(CONFIG_KEY, parseConfig(cfg));
}

// ---- Loading and costing --------------------------------------------------------------

const fullInclude = { lines: { orderBy: [{ sort: "asc" as const }, { createdAt: "asc" as const }] }, payments: { orderBy: [{ paidOn: "asc" as const }, { createdAt: "asc" as const }] } };
type FullRow = Prisma.PrivateEventGetPayload<{ include: typeof fullInclude }>;

/** Cost lookups for quote lines: recipe plate cost and package cost per guest, as of today. */
async function costLookup() {
  const [snap, packages] = await Promise.all([loadCostingSnapshot(), db.privateEventPackage.findMany({ include: { items: { orderBy: { sort: "asc" } } } })]);
  const ctx = buildContext(snap, businessToday());
  const recipeCost = new Map<string, { cost: number | null; incomplete: boolean }>();
  const costOf = (id: string) => {
    let c = recipeCost.get(id);
    if (!c) {
      const r = ctx.recipes.has(id) ? safeCost(ctx, id) : { error: "missing" };
      c = "error" in r ? { cost: null, incomplete: true } : { cost: r.totalCost, incomplete: r.incomplete };
      recipeCost.set(id, c);
    }
    return c;
  };
  const packageCost = (id: string) => {
    const p = packages.find((x) => x.id === id);
    if (!p || p.items.length === 0) return null;
    let sum = 0;
    for (const it of p.items) {
      const c = costOf(it.recipeId).cost;
      if (c == null) return null;
      sum += c * it.perGuest.toNumber();
    }
    return sum;
  };
  const names = new Map(snap.recipes.map((r) => [r.id, r.name]));
  return { costOf, packageCost, packages, names, snap };
}
type Costs = Awaited<ReturnType<typeof costLookup>>;

function lineCost(l: FullRow["lines"][number], costs: Costs): number | null {
  if (l.kind === "ITEM" && l.recipeId) return costs.costOf(l.recipeId).cost;
  if (l.kind === "PACKAGE" && l.packageId) return costs.packageCost(l.packageId);
  return num(l.unitCost);
}

function quoteInput(e: FullRow, costs: Costs | null, cfg: PrivateEventConfig): QuoteInput {
  return {
    headcount: e.headcount,
    lines: e.lines.map((l) => ({ label: l.label, qty: l.qty.toNumber(), perPerson: l.perPerson, unitPrice: l.unitPrice.toNumber(), unitCost: costs ? lineCost(l, costs) : num(l.unitCost) })),
    roomFee: e.roomFee.toNumber(),
    bar: { kind: isBarKind(e.barKind) ? e.barKind : "NONE", tickets: e.drinkTickets, ticketPrice: e.ticketPrice.toNumber(), amount: e.barAmount.toNumber() },
    serviceChargePct: e.serviceChargePct.toNumber(),
    taxPct: e.taxPct.toNumber(),
    depositPct: e.depositPct.toNumber(),
    depositAmount: num(e.depositAmount),
    barCostPct: cfg.barCostPct,
    paid: e.payments.reduce((s, p) => s + p.amount.toNumber(), 0),
  };
}

const titleOf = (e: { clientName: string; company: string | null }) => e.company?.trim() || e.clientName;
const stageOf = (s: string): Stage => (isStage(s) ? s : "INQUIRY");
const typeOf = (s: string): EventType => (isEventType(s) ? s : "OTHER");

export interface PrivateEventRow {
  id: string;
  title: string;
  clientName: string;
  company: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  stage: Stage;
  type: EventType;
  date: ISODate | null;
  startTime: string | null;
  endTime: string | null;
  space: string | null;
  headcount: number;
  ownerId: string | null;
  ownerName: string | null;
  followUpOn: ISODate | null;
  depositDueOn: ISODate | null;
  balanceDueOn: ISODate | null;
  createdOn: ISODate;
  quoteSent: boolean;
  accepted: boolean;
  total: number;
  deposit: number;
  paid: number;
  balance: number;
  margin: number;
  marginPct: number | null;
  notes: string | null;
}

function toRow(e: FullRow, q: QuoteResult, owners: Map<string, string>): PrivateEventRow {
  return {
    id: e.id,
    title: titleOf(e),
    clientName: e.clientName,
    company: e.company,
    clientEmail: e.clientEmail,
    clientPhone: e.clientPhone,
    stage: stageOf(e.stage),
    type: typeOf(e.type),
    date: iso(e.date),
    startTime: e.startTime,
    endTime: e.endTime,
    space: e.space,
    headcount: e.headcount,
    ownerId: e.ownerId,
    ownerName: e.ownerId ? (owners.get(e.ownerId) ?? null) : null,
    followUpOn: iso(e.followUpOn),
    depositDueOn: iso(e.depositDueOn),
    balanceDueOn: iso(e.balanceDueOn),
    createdOn: toISODate(e.createdAt),
    quoteSent: !!e.quoteSentAt,
    accepted: !!e.acceptedAt,
    total: q.total,
    deposit: q.deposit,
    paid: q.paid,
    balance: q.balance,
    margin: q.margin,
    marginPct: q.marginPct,
    notes: e.notes,
  };
}

const ownerMap = async () => new Map((await db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));

export async function listPrivateEvents(): Promise<PrivateEventRow[]> {
  const [rows, costs, cfg, owners] = await Promise.all([
    db.privateEvent.findMany({ include: fullInclude, orderBy: [{ date: "asc" }, { createdAt: "desc" }] }),
    costLookup(),
    getPrivateEventConfig(),
    ownerMap(),
  ]);
  return rows.map((e) => toRow(e, quoteTotals(quoteInput(e, costs, cfg)), owners));
}

export async function getPrivateEvent(id: string) {
  const [e, costs, cfg, owners] = await Promise.all([db.privateEvent.findUnique({ where: { id }, include: fullInclude }), costLookup(), getPrivateEventConfig(), ownerMap()]);
  if (!e) return null;
  const q = quoteTotals(quoteInput(e, costs, cfg));
  return {
    row: toRow(e, q, owners),
    quote: q,
    lines: e.lines.map((l, i) => ({
      id: l.id,
      kind: l.kind,
      recipeId: l.recipeId,
      packageId: l.packageId,
      label: l.label,
      qty: l.qty.toNumber(),
      perPerson: l.perPerson,
      unitPrice: l.unitPrice.toNumber(),
      unitCost: lineCost(l, costs),
      units: q.lines[i].units,
      amount: q.lines[i].amount,
      cost: q.lines[i].cost,
    })),
    payments: e.payments.map((p) => ({ id: p.id, amount: p.amount.toNumber(), kind: p.kind, method: p.method, paidOn: toISODate(p.paidOn), note: p.note })),
    settings: {
      roomFee: e.roomFee.toNumber(),
      barKind: (isBarKind(e.barKind) ? e.barKind : "NONE") as BarKind,
      drinkTickets: e.drinkTickets,
      ticketPrice: e.ticketPrice.toNumber(),
      barAmount: e.barAmount.toNumber(),
      serviceChargePct: e.serviceChargePct.toNumber(),
      taxPct: e.taxPct.toNumber(),
      depositPct: e.depositPct.toNumber(),
      depositAmount: num(e.depositAmount),
      quoteNote: e.quoteNote,
      lostReason: e.lostReason,
    },
    share: {
      token: e.quoteToken,
      sentAt: e.quoteSentAt?.toISOString() ?? null,
      viewedAt: e.quoteViewedAt?.toISOString() ?? null,
      acceptedAt: e.acceptedAt?.toISOString() ?? null,
      acceptedName: e.acceptedName,
      paymentLinkUrl: e.paymentLinkUrl,
      paymentLinkAmount: num(e.paymentLinkAmount),
      remindedAt: e.remindedAt?.toISOString() ?? null,
    },
    calendarEventId: e.calendarEventId,
    config: cfg,
  };
}
export type PrivateEventDetail = NonNullable<Awaited<ReturnType<typeof getPrivateEvent>>>;

/** Menu items with a menu price, and packages, for the quote builder. */
export async function quoteCatalog() {
  const costs = await costLookup();
  const items = costs.snap.recipes
    .filter((r) => r.kind === "MENU" && r.menuPrice != null)
    .map((r) => ({ id: r.id, name: r.name, category: r.category, price: r.menuPrice!.toNumber(), cost: costs.costOf(r.id).cost }));
  const packages = costs.packages
    .filter((p) => p.active)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, description: p.description, pricePerPerson: p.pricePerPerson.toNumber(), costPerPerson: costs.packageCost(p.id), items: p.items.map((it) => ({ id: it.id, recipeId: it.recipeId, name: costs.names.get(it.recipeId) ?? "(archived recipe)", perGuest: it.perGuest.toNumber(), cost: costs.costOf(it.recipeId).cost })) }));
  const allPackages = costs.packages
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, description: p.description, active: p.active, pricePerPerson: p.pricePerPerson.toNumber(), costPerPerson: costs.packageCost(p.id), items: p.items.map((it) => ({ id: it.id, recipeId: it.recipeId, name: costs.names.get(it.recipeId) ?? "(archived recipe)", perGuest: it.perGuest.toNumber(), cost: costs.costOf(it.recipeId).cost })) }));
  return { items, packages, allPackages };
}

// ---- Public quote --------------------------------------------------------------------

export const newQuoteToken = () => randomBytes(32).toString("base64url");

/** Ensure the booking has a share link; returns the token. */
export async function ensureQuoteToken(id: string, fresh = false): Promise<string> {
  const e = await db.privateEvent.findUnique({ where: { id }, select: { quoteToken: true } });
  if (!e) throw new Error("Not found");
  if (e.quoteToken && !fresh) return e.quoteToken;
  const token = newQuoteToken();
  await db.privateEvent.update({ where: { id }, data: { quoteToken: token } });
  return token;
}

/** What the client sees. No costs, margins or internal notes. Null for a bad or revoked token. */
export async function publicQuote(token: string) {
  if (!isQuoteToken(token)) return null;
  const e = await db.privateEvent.findUnique({ where: { quoteToken: token }, include: fullInclude });
  if (!e) return null;
  const cfg = await getPrivateEventConfig();
  const q = quoteTotals(quoteInput(e, null, cfg));
  return {
    id: e.id,
    available: e.stage !== "LOST",
    clientName: e.clientName,
    company: e.company,
    type: EVENT_TYPE_LABEL[typeOf(e.type)],
    date: iso(e.date),
    startTime: e.startTime,
    endTime: e.endTime,
    space: e.space,
    headcount: e.headcount,
    note: e.quoteNote,
    lines: q.lines.map((l) => ({ label: l.label, units: l.units, perPerson: l.perPerson, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount })),
    bar: { kind: (isBarKind(e.barKind) ? e.barKind : "NONE") as BarKind, tickets: e.drinkTickets, ticketPrice: e.ticketPrice.toNumber(), amount: q.bar },
    totals: { food: q.food, bar: q.bar, roomFee: q.roomFee, subtotal: q.subtotal, serviceCharge: q.serviceCharge, tax: q.tax, total: q.total, deposit: q.deposit, paid: q.paid, balance: q.balance, perGuest: q.perGuest },
    serviceChargePct: e.serviceChargePct.toNumber(),
    taxPct: e.taxPct.toNumber(),
    depositDueOn: iso(e.depositDueOn),
    balanceDueOn: iso(e.balanceDueOn),
    acceptedAt: e.acceptedAt?.toISOString() ?? null,
    acceptedName: e.acceptedName,
    paymentLinkUrl: e.paymentLinkUrl,
    viewed: !!e.quoteViewedAt,
  };
}

export async function markQuoteViewed(token: string) {
  if (!isQuoteToken(token)) return;
  await db.privateEvent.updateMany({ where: { quoteToken: token, quoteViewedAt: null }, data: { quoteViewedAt: new Date() } });
}

export async function acceptQuote(token: string, name: string): Promise<{ error?: string; ok?: true }> {
  if (!isQuoteToken(token)) return { error: "This link isn't valid." };
  const who = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (who.length < 2) return { error: "Type your name to accept." };
  const q = await publicQuote(token);
  if (!q || !q.available) return { error: "This quote is no longer available. Please get in touch with us." };
  if (q.acceptedAt) return { ok: true };
  const e = await db.privateEvent.findUnique({ where: { quoteToken: token }, select: { id: true, stage: true } });
  if (!e) return { error: "This link isn't valid." };
  await db.privateEvent.update({
    where: { id: e.id },
    data: {
      acceptedAt: new Date(),
      acceptedName: who,
      acceptedQuote: { totals: q.totals, headcount: q.headcount, date: q.date, lines: q.lines } as Prisma.InputJsonValue,
      ...(e.stage === "INQUIRY" ? { stage: "QUOTED", quoteSentAt: new Date() } : {}),
    },
  });
  return { ok: true };
}

// ---- Mutations -----------------------------------------------------------------------

export async function createInquiry(i: { clientName: string; company?: string | null; clientEmail?: string | null; clientPhone?: string | null; date?: ISODate | null; startTime?: string | null; endTime?: string | null; headcount?: number; type?: EventType; space?: string | null; notes?: string | null; ownerId?: string | null }) {
  const cfg = await getPrivateEventConfig();
  const e = await db.privateEvent.create({
    data: {
      clientName: i.clientName,
      company: i.company || null,
      clientEmail: i.clientEmail || null,
      clientPhone: i.clientPhone || null,
      date: i.date ? parseISODate(i.date) : null,
      startTime: i.startTime || null,
      endTime: i.endTime || null,
      headcount: Math.max(0, Math.round(i.headcount ?? 0)),
      type: i.type ?? "PARTY",
      space: i.space || null,
      notes: i.notes || null,
      ownerId: i.ownerId || null,
      serviceChargePct: D(cfg.serviceChargePct),
      taxPct: D(cfg.taxPct),
      depositPct: D(cfg.depositPct),
    },
  });
  return e.id;
}

async function facts(id: string) {
  const [e, cfg] = await Promise.all([db.privateEvent.findUnique({ where: { id }, include: fullInclude }), getPrivateEventConfig()]);
  if (!e) return null;
  const q = quoteTotals(quoteInput(e, null, cfg));
  return { e, q, cfg, f: { date: iso(e.date), headcount: e.headcount, total: q.total, deposit: q.deposit, paid: q.paid, today: businessToday() } };
}

/** Move a booking to another stage, checked against what that stage needs. */
export async function moveStage(id: string, to: Stage): Promise<{ error?: string }> {
  const x = await facts(id);
  if (!x) return { error: "That booking is gone." };
  const from = stageOf(x.e.stage);
  const ok = canMove(from, to, x.f);
  if (!ok.ok) return { error: ok.error };
  const today = businessToday();
  const data: Prisma.PrivateEventUpdateInput = { stage: to };
  // Quoting fills in due dates (and counts the quote as sent) if they're blank.
  if (to === "QUOTED" || to === "DEPOSIT" || to === "CONFIRMED") {
    const due = defaultDueDates(today, x.f.date, x.cfg);
    if (!x.e.depositDueOn) data.depositDueOn = parseISODate(due.depositDueOn);
    if (!x.e.balanceDueOn && due.balanceDueOn) data.balanceDueOn = parseISODate(due.balanceDueOn);
    if (!x.e.quoteSentAt) data.quoteSentAt = new Date();
  }
  await db.privateEvent.update({ where: { id }, data });
  await syncCalendar(id);
  return {};
}

/** When a quote goes out (emailed or link copied): mark sent and move an inquiry to Quoted if it can. */
export async function markQuoteSent(id: string) {
  const x = await facts(id);
  if (!x) return;
  const due = defaultDueDates(businessToday(), x.f.date, x.cfg);
  await db.privateEvent.update({
    where: { id },
    data: {
      quoteSentAt: x.e.quoteSentAt ?? new Date(),
      ...(x.e.depositDueOn ? {} : { depositDueOn: parseISODate(due.depositDueOn) }),
      ...(x.e.balanceDueOn || !due.balanceDueOn ? {} : { balanceDueOn: parseISODate(due.balanceDueOn) }),
    },
  });
  if (x.e.stage === "INQUIRY" && canMove("INQUIRY", "QUOTED", x.f).ok) await db.privateEvent.update({ where: { id }, data: { stage: "QUOTED" } });
}

export async function recordPayment(id: string, p: { amount: number; kind: string; method: string; paidOn: ISODate; note?: string | null; userId?: string | null }): Promise<{ error?: string; message?: string }> {
  const x = await facts(id);
  if (!x) return { error: "That booking is gone." };
  await db.privateEventPayment.create({ data: { privateEventId: id, amount: D(p.amount), kind: p.kind, method: p.method, paidOn: parseISODate(p.paidOn), note: p.note || null, createdById: p.userId ?? null } });
  const paid = x.q.paid + p.amount;
  const next = stageAfterPayment(stageOf(x.e.stage), x.q.deposit, paid);
  if (next) {
    await db.privateEvent.update({ where: { id }, data: { stage: next, quoteSentAt: x.e.quoteSentAt ?? new Date() } });
  }
  await syncCalendar(id);
  return { message: next ? `Payment saved · moved to ${STAGE_LABEL[next].toLowerCase()}.` : "Payment saved." };
}

export async function deletePayment(paymentId: string) {
  const p = await db.privateEventPayment.delete({ where: { id: paymentId } }).catch(() => null);
  return p?.privateEventId ?? null;
}

export async function deletePrivateEvent(id: string) {
  const e = await db.privateEvent.findUnique({ where: { id }, select: { calendarEventId: true } });
  if (!e) return;
  if (e.calendarEventId) await db.event.deleteMany({ where: { id: e.calendarEventId } });
  await db.privateEvent.delete({ where: { id } });
}

// ---- Calendar ------------------------------------------------------------------------

/** Median sales for the event's weekday over the last 8 weeks (open days only). */
async function weekdayBaseline(date: ISODate): Promise<number | null> {
  const today = businessToday();
  const from = addDays(today, -56);
  const h = await dailySalesHistory(from, today).catch(() => null);
  if (!h) return null;
  const dow = weekday(date);
  const vals = [...h.sales].filter(([d, v]) => weekday(d) === dow && h.openDays.has(d) && v > 0).map(([, v]) => v).sort((a, b) => a - b);
  if (vals.length < 2) return null;
  const m = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
}

/**
 * Keep the booking's Events calendar entry in step: confirmed and done
 * bookings with a date have one (kind PRIVATE, impact from headcount and the
 * quote); anything else has none.
 */
export async function syncCalendar(id: string) {
  const x = await facts(id);
  if (!x) return;
  const { e, q, cfg } = x;
  const stage = stageOf(e.stage);
  const want = CALENDAR_STAGES.includes(stage) && e.date;
  if (!want) {
    if (e.calendarEventId) {
      await db.event.deleteMany({ where: { id: e.calendarEventId } });
      await db.privateEvent.update({ where: { id }, data: { calendarEventId: null } });
    }
    return;
  }
  const date = toISODate(e.date!);
  const space = cfg.spaces.find((s) => s.name === e.space);
  const buyout = space?.buyout ?? e.type === "BUYOUT";
  const impact = forecastImpact({ eventSales: q.food + q.bar, headcount: e.headcount, buyout, baseline: await weekdayBaseline(date) });
  const data = {
    date: e.date!,
    title: `Private event: ${titleOf(e)}`.slice(0, 120),
    kind: "PRIVATE",
    startTime: e.startTime,
    endTime: e.endTime,
    impact: D(impact),
    notes: [`${e.headcount} guests`, e.space, buyout ? "closed to the public" : null].filter(Boolean).join(" · ") + ". Managed in Private events.",
  };
  const existing = e.calendarEventId ? await db.event.findUnique({ where: { id: e.calendarEventId }, select: { id: true } }) : null;
  if (existing) await db.event.update({ where: { id: existing.id }, data });
  else {
    const ev = await db.event.create({ data });
    await db.privateEvent.update({ where: { id }, data: { calendarEventId: ev.id } });
  }
}

// ---- Feeds for other pages -------------------------------------------------------------

/** Overview "Needs you": follow-ups, deposits and balances due, events to close out. */
export async function privateEventNeedsYou(today: ISODate = businessToday()): Promise<AttentionItem[]> {
  const [rows, cfg] = await Promise.all([
    db.privateEvent.findMany({
      where: { stage: { notIn: ["LOST", "DONE"] }, OR: [{ date: null }, { date: { gte: parseISODate(addDays(today, -45)) } }] },
      include: fullInclude,
    }).catch((e: unknown) => {
      // A database without this feature's migration yet: nothing to show, nothing to log.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") return [];
      throw e;
    }),
    getPrivateEventConfig(),
  ]);
  const items = privateEventAttention(
    today,
    rows.map((e) => {
      const q = quoteTotals(quoteInput(e, null, cfg));
      return {
        id: e.id,
        title: titleOf(e),
        stage: stageOf(e.stage),
        date: iso(e.date),
        createdOn: toISODate(e.createdAt),
        followUpOn: iso(e.followUpOn),
        quoteSent: !!e.quoteSentAt,
        accepted: !!e.acceptedAt,
        deposit: q.deposit,
        depositDueOn: iso(e.depositDueOn),
        balance: q.balance,
        balanceDueOn: iso(e.balanceDueOn),
        paid: q.paid,
        headcount: e.headcount,
      };
    }),
  );
  // Keep it to the few that matter; the Private events page has the rest.
  return items.slice(0, 4);
}

export interface PrepEvent {
  id: string;
  title: string;
  clientName: string;
  stage: Stage;
  startTime: string | null;
  endTime: string | null;
  space: string | null;
  headcount: number;
  /** Recipes and portions (packages exploded into their recipes). */
  items: { recipeId: string; name: string; portions: number }[];
  /** Quote lines with no recipe (outside cake, custom platters). */
  other: { label: string; qty: number }[];
  notes: string | null;
}

/**
 * Booked private events on a date (deposit paid, confirmed or done), with
 * headcount and the menu as recipe portions — for the prep list.
 */
export async function eventsForPrep(date: ISODate): Promise<PrepEvent[]> {
  const rows = await db.privateEvent.findMany({
    where: { date: parseISODate(date), stage: { in: [...BOOKED_STAGES] } },
    include: { lines: { orderBy: { sort: "asc" } } },
    orderBy: [{ startTime: "asc" }, { createdAt: "asc" }],
  }).catch((e: unknown) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") return [];
    throw e;
  });
  if (rows.length === 0) return [];
  const pkgIds = [...new Set(rows.flatMap((e) => e.lines.map((l) => l.packageId).filter((x): x is string => !!x)))];
  const pkgs = pkgIds.length ? await db.privateEventPackage.findMany({ where: { id: { in: pkgIds } }, include: { items: true } }) : [];
  const pkgMap = new Map(pkgs.map((p) => [p.id, p.items.map((it) => ({ recipeId: it.recipeId, perGuest: it.perGuest.toNumber() }))]));
  const recipeIds = new Set<string>();
  const portions = rows.map((e) => {
    const m = prepPortions(e.headcount, e.lines.map((l) => ({ kind: l.kind, recipeId: l.recipeId, packageId: l.packageId, label: l.label, qty: l.qty.toNumber(), perPerson: l.perPerson })), pkgMap);
    for (const k of m.keys()) recipeIds.add(k);
    return m;
  });
  const names = new Map((await db.recipe.findMany({ where: { id: { in: [...recipeIds] } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]));
  return rows.map((e, i) => ({
    id: e.id,
    title: titleOf(e),
    clientName: e.clientName,
    stage: stageOf(e.stage),
    startTime: e.startTime,
    endTime: e.endTime,
    space: e.space,
    headcount: e.headcount,
    items: [...portions[i]].map(([recipeId, n]) => ({ recipeId, name: names.get(recipeId) ?? "Recipe", portions: n })).sort((a, b) => a.name.localeCompare(b.name)),
    other: e.lines.filter((l) => l.kind === "CUSTOM" && !l.recipeId).map((l) => ({ label: l.label, qty: l.qty.toNumber() * (l.perPerson ? e.headcount : 1) })),
    notes: e.notes,
  }));
}
