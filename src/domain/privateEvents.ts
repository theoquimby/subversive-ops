/**
 * Private events & parties: the booking pipeline (Inquiry → Quoted → Deposit
 * paid → Confirmed → Done, or Lost), quote maths (food, packages, bar, room
 * fee, service charge, NY sales tax, deposit), what needs a manager, and how
 * much a booking moves the day's sales forecast. Pure: no I/O.
 */

import { addDays, daysBetween, ISODate } from "./dates";

// ---- Pipeline ------------------------------------------------------------------------

export const STAGES = ["INQUIRY", "QUOTED", "DEPOSIT", "CONFIRMED", "DONE", "LOST"] as const;
export type Stage = (typeof STAGES)[number];
/** The forward path (Lost sits outside it). */
export const PATH: readonly Stage[] = ["INQUIRY", "QUOTED", "DEPOSIT", "CONFIRMED", "DONE"];

export const STAGE_LABEL: Record<Stage, string> = {
  INQUIRY: "Inquiry",
  QUOTED: "Quoted",
  DEPOSIT: "Deposit paid",
  CONFIRMED: "Confirmed",
  DONE: "Done",
  LOST: "Lost",
};

export const STAGE_TONE: Record<Stage, "good" | "warn" | "bad" | "neutral"> = {
  INQUIRY: "neutral",
  QUOTED: "warn",
  DEPOSIT: "good",
  CONFIRMED: "good",
  DONE: "neutral",
  LOST: "bad",
};

export const isStage = (s: string): s is Stage => (STAGES as readonly string[]).includes(s);

export const EVENT_TYPES = ["PARTY", "BUYOUT", "REHEARSAL", "CORPORATE", "WEDDING", "FESTIVAL", "OTHER"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  PARTY: "Party",
  BUYOUT: "Buyout",
  REHEARSAL: "Rehearsal dinner",
  CORPORATE: "Corporate",
  WEDDING: "Wedding",
  FESTIVAL: "Festival",
  OTHER: "Other",
};
export const isEventType = (s: string): s is EventType => (EVENT_TYPES as readonly string[]).includes(s);

/** What a stage move is checked against. */
export interface StageFacts {
  date: ISODate | null;
  headcount: number;
  /** Quote total, tax included. */
  total: number;
  deposit: number;
  paid: number;
  today: ISODate;
}

/**
 * Whether a booking can move from one stage to another, and if not, why (in
 * words Max can act on). Moving back is allowed to fix mistakes; Lost can be
 * reopened as an inquiry; Done only goes back to Confirmed.
 */
export function canMove(from: Stage, to: Stage, f: StageFacts): { ok: true } | { ok: false; error: string } {
  if (from === to) return { ok: false, error: `Already ${STAGE_LABEL[to].toLowerCase()}.` };
  if (to === "LOST") return from === "DONE" ? { ok: false, error: "It's already happened, so it can't be lost." } : { ok: true };
  if (from === "LOST") return to === "INQUIRY" ? { ok: true } : { ok: false, error: "Reopen it as an inquiry first." };
  if (from === "DONE" && to !== "CONFIRMED") return { ok: false, error: "A done event can only go back to confirmed." };
  const fi = PATH.indexOf(from);
  const ti = PATH.indexOf(to);
  if (ti < fi) return { ok: true };
  // Forward: every stage passed through must have what it needs.
  for (let i = fi + 1; i <= ti; i++) {
    const need = requirement(PATH[i], f);
    if (need) return { ok: false, error: need };
  }
  return { ok: true };
}

function requirement(stage: Stage, f: StageFacts): string | null {
  switch (stage) {
    case "QUOTED":
      if (!f.date) return "Add a date first.";
      if (f.headcount <= 0) return "Add a headcount first.";
      if (f.total <= 0) return "Add something to the quote first.";
      return null;
    case "DEPOSIT":
      if (f.deposit > 0 && f.paid + 0.005 < f.deposit) return `Record the deposit first (${f.deposit.toFixed(2)} due, ${f.paid.toFixed(2)} paid).`;
      return null;
    case "CONFIRMED":
      if (!f.date) return "Add a date first.";
      return null;
    case "DONE":
      if (f.date && f.date > f.today) return "It hasn't happened yet.";
      return null;
    default:
      return null;
  }
}

/** The stage a booking should be in after a payment, or null to leave it. */
export function stageAfterPayment(stage: Stage, deposit: number, paid: number): Stage | null {
  if ((stage === "INQUIRY" || stage === "QUOTED") && paid > 0 && paid + 0.005 >= deposit) return "DEPOSIT";
  return null;
}

/** The next step forward, for the one-tap button on a booking. */
export function nextStage(stage: Stage): Stage | null {
  const i = PATH.indexOf(stage);
  return i >= 0 && i < PATH.length - 1 ? PATH[i + 1] : null;
}

/** Bookings in these stages hold their date: they're on the calendar and in prep. */
export const BOOKED_STAGES: readonly Stage[] = ["DEPOSIT", "CONFIRMED", "DONE"];
/** Bookings in these stages are on the Events calendar (and so in the forecast). */
export const CALENDAR_STAGES: readonly Stage[] = ["CONFIRMED", "DONE"];
export const OPEN_STAGES: readonly Stage[] = ["INQUIRY", "QUOTED", "DEPOSIT", "CONFIRMED"];

// ---- Quote maths ---------------------------------------------------------------------

export const BAR_KINDS = ["NONE", "TICKETS", "OPEN_TAB", "MINIMUM"] as const;
export type BarKind = (typeof BAR_KINDS)[number];
export const BAR_LABEL: Record<BarKind, string> = {
  NONE: "No bar package",
  TICKETS: "Drink tickets",
  OPEN_TAB: "Open tab (estimate)",
  MINIMUM: "Bar minimum",
};
export const isBarKind = (s: string): s is BarKind => (BAR_KINDS as readonly string[]).includes(s);

export interface QuoteLineInput {
  label: string;
  qty: number;
  /** qty is per guest (× headcount). */
  perPerson: boolean;
  unitPrice: number;
  /** Food cost per unit; null when unknown. */
  unitCost: number | null;
}

export interface QuoteInput {
  headcount: number;
  lines: QuoteLineInput[];
  roomFee: number;
  bar: { kind: BarKind; tickets: number; ticketPrice: number; amount: number };
  /** 0.2 = 20%. Applies to food and bar, not the room fee. */
  serviceChargePct: number;
  /** 0.08 = 8%. Applies to everything including the service charge (NY taxes mandatory service charges). */
  taxPct: number;
  depositPct: number;
  /** Fixed deposit; wins over the percent. */
  depositAmount: number | null;
  /** Beverage cost as a share of bar sales, for the margin. */
  barCostPct: number;
  paid?: number;
}

export interface QuoteLineResult extends QuoteLineInput {
  units: number;
  amount: number;
  cost: number | null;
}

export interface QuoteResult {
  lines: QuoteLineResult[];
  food: number;
  bar: number;
  roomFee: number;
  subtotal: number;
  serviceCharge: number;
  taxable: number;
  tax: number;
  total: number;
  deposit: number;
  paid: number;
  balance: number;
  /** Food cost of the lines with a known cost. */
  foodCost: number;
  /** Some lines have no cost yet, so food cost is a floor. */
  costIncomplete: boolean;
  barCost: number;
  /** Food + bar + room fee − food and bar cost (before labor; tax and service charge excluded). */
  margin: number;
  /** Margin ÷ (food + bar + room fee). */
  marginPct: number | null;
  foodCostPct: number | null;
  perGuest: number | null;
}

/** Round to cents, half away from zero, without float drift (1.005 → 1.01). */
export const cents = (n: number) => {
  const s = Math.sign(n) || 1;
  return (s * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
};

const nn = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function quoteTotals(q: QuoteInput): QuoteResult {
  const headcount = Math.max(0, Math.floor(nn(q.headcount)));
  const lines: QuoteLineResult[] = q.lines.map((l) => {
    const units = cents(nn(l.qty) * (l.perPerson ? headcount : 1));
    return { ...l, units, amount: cents(units * nn(l.unitPrice)), cost: l.unitCost == null ? null : cents(units * nn(l.unitCost)) };
  });
  const food = cents(lines.reduce((s, l) => s + l.amount, 0));
  const bar =
    q.bar.kind === "TICKETS" ? cents(Math.floor(nn(q.bar.tickets)) * nn(q.bar.ticketPrice)) : q.bar.kind === "OPEN_TAB" || q.bar.kind === "MINIMUM" ? cents(nn(q.bar.amount)) : 0;
  const roomFee = cents(nn(q.roomFee));
  const subtotal = cents(food + bar + roomFee);
  const serviceCharge = cents((food + bar) * nn(q.serviceChargePct));
  const taxable = cents(subtotal + serviceCharge);
  const tax = cents(taxable * nn(q.taxPct));
  const total = cents(taxable + tax);
  const fixed = q.depositAmount != null && q.depositAmount >= 0 ? q.depositAmount : null;
  const deposit = Math.min(total, cents(fixed ?? total * nn(q.depositPct)));
  const paid = cents(nn(q.paid ?? 0));
  const foodCost = cents(lines.reduce((s, l) => s + (l.cost ?? 0), 0));
  const costIncomplete = lines.some((l) => l.cost == null && l.amount > 0);
  const barCost = cents(bar * nn(q.barCostPct));
  const revenue = subtotal;
  const margin = cents(revenue - foodCost - barCost);
  return {
    lines,
    food,
    bar,
    roomFee,
    subtotal,
    serviceCharge,
    taxable,
    tax,
    total,
    deposit,
    paid,
    balance: cents(total - paid),
    foodCost,
    costIncomplete,
    barCost,
    margin,
    marginPct: revenue > 0 ? margin / revenue : null,
    foodCostPct: food > 0 ? foodCost / food : null,
    perGuest: headcount > 0 && total > 0 ? cents(total / headcount) : null,
  };
}

// ---- Settings ------------------------------------------------------------------------

export interface SpaceOption {
  name: string;
  /** The whole place is closed to the public (a buyout). */
  buyout: boolean;
  capacity: number | null;
}

/**
 * Whether a booking closes the place to the public: its space is set up as a
 * buyout (Packages & defaults), or, with no known space, the booking is a buyout.
 */
export function isBuyout(e: { space: string | null; type: string }, spaces: readonly SpaceOption[]): boolean {
  const space = spaces.find((s) => s.name === e.space);
  return space ? space.buyout : e.type === "BUYOUT";
}

export interface ClashBooking {
  id: string;
  title: string;
  date: ISODate | null;
  space: string | null;
  /** "18:00"; null when not set yet. */
  startTime: string | null;
  endTime: string | null;
  type: string;
  stage: Stage;
}

const hhmm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** [start, end) in minutes; a finish at or before the start runs past midnight. No times = the whole day. */
function span(b: ClashBooking): [number, number] {
  if (!b.startTime || !b.endTime) return [0, 48 * 60];
  const s = hhmm(b.startTime);
  let e = hhmm(b.endTime);
  if (e <= s) e += 24 * 60;
  return [s, e];
}

/**
 * Other bookings that already hold `target`'s space on its date at
 * overlapping times. A buyout holds every space. Lost bookings don't count.
 * For a warning only: two parties can share a day on purpose.
 */
export function bookingClashes(target: ClashBooking, others: readonly ClashBooking[], spaces: readonly SpaceOption[]): ClashBooking[] {
  if (!target.date || !target.space) return [];
  const [ts, te] = span(target);
  const tBuyout = isBuyout(target, spaces);
  return others.filter((o) => {
    if (o.id === target.id || o.stage === "LOST" || o.date !== target.date || !o.space) return false;
    if (o.space !== target.space && !tBuyout && !isBuyout(o, spaces)) return false;
    const [os, oe] = span(o);
    return os < te && ts < oe;
  });
}

export interface PrivateEventConfig {
  spaces: SpaceOption[];
  taxPct: number;
  serviceChargePct: number;
  depositPct: number;
  /** Deposit due this many days after the quote goes out. */
  depositDueDays: number;
  /** Balance due this many days before the event. */
  balanceDueDays: number;
  barCostPct: number;
}

export const DEFAULT_CONFIG: PrivateEventConfig = {
  spaces: [
    { name: "Whole taproom", buyout: true, capacity: 120 },
    { name: "Patio", buyout: false, capacity: 60 },
    { name: "Back room", buyout: false, capacity: 40 },
  ],
  taxPct: 0.08,
  serviceChargePct: 0.2,
  depositPct: 0.25,
  depositDueDays: 7,
  balanceDueDays: 3,
  barCostPct: 0.25,
};

const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);

/** Saved settings merged over the defaults, with anything odd thrown out. */
export function parseConfig(raw: unknown): PrivateEventConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof PrivateEventConfig, unknown>>;
  const spaces = Array.isArray(r.spaces)
    ? r.spaces
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : null))
        .filter((s): s is Record<string, unknown> => !!s && typeof s.name === "string" && s.name.trim() !== "")
        .map((s) => ({ name: String(s.name).trim().slice(0, 60), buyout: s.buyout === true, capacity: typeof s.capacity === "number" && s.capacity > 0 ? Math.round(s.capacity) : null }))
    : DEFAULT_CONFIG.spaces;
  return {
    spaces: spaces.length ? spaces : DEFAULT_CONFIG.spaces,
    taxPct: clamp(r.taxPct, 0, 0.2, DEFAULT_CONFIG.taxPct),
    serviceChargePct: clamp(r.serviceChargePct, 0, 0.5, DEFAULT_CONFIG.serviceChargePct),
    depositPct: clamp(r.depositPct, 0, 1, DEFAULT_CONFIG.depositPct),
    depositDueDays: Math.round(clamp(r.depositDueDays, 0, 60, DEFAULT_CONFIG.depositDueDays)),
    balanceDueDays: Math.round(clamp(r.balanceDueDays, 0, 60, DEFAULT_CONFIG.balanceDueDays)),
    barCostPct: clamp(r.barCostPct, 0, 1, DEFAULT_CONFIG.barCostPct),
  };
}

/** Default due dates for a fresh quote. The deposit is never due after the event. */
export function defaultDueDates(today: ISODate, eventDate: ISODate | null, cfg: Pick<PrivateEventConfig, "depositDueDays" | "balanceDueDays">) {
  let deposit = addDays(today, cfg.depositDueDays);
  if (eventDate && deposit > eventDate) deposit = eventDate < today ? today : eventDate;
  const balance = eventDate ? addDays(eventDate, -cfg.balanceDueDays) : null;
  return { depositDueOn: deposit, balanceDueOn: balance && balance < today ? today : balance };
}

// ---- Forecast impact -----------------------------------------------------------------

/**
 * Demand multiplier for the day (1.3 = +30%) from the booking's food and bar
 * sales against a normal day for that weekday. A buyout replaces the day's
 * normal trade; a room or the patio adds to it. Without history, a guest is
 * worth about 1% of a normal day.
 */
export function forecastImpact(o: { eventSales: number; headcount: number; buyout: boolean; baseline: number | null }): number {
  const sales = nn(o.eventSales);
  let m: number;
  if (o.baseline && o.baseline > 0 && sales > 0) m = o.buyout ? sales / o.baseline : 1 + sales / o.baseline;
  else m = o.buyout ? 1 : 1 + nn(o.headcount) / 100;
  return Math.round(Math.min(5, Math.max(0.2, m)) * 1000) / 1000;
}

// ---- What needs a manager ------------------------------------------------------------

export interface AttentionBooking {
  id: string;
  title: string;
  stage: Stage;
  date: ISODate | null;
  createdOn: ISODate;
  followUpOn: ISODate | null;
  quoteSent: boolean;
  accepted: boolean;
  deposit: number;
  depositDueOn: ISODate | null;
  balance: number;
  balanceDueOn: ISODate | null;
  paid: number;
  headcount: number;
}

export interface PrivateEventAttention {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: "bad" | "warn" | "neutral";
  urgency: number;
}

const when = (today: ISODate, d: ISODate) => {
  const n = daysBetween(today, d);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n < 0 ? `${-n} days ago` : `in ${n} days`;
};
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Days ahead a deposit or balance coming due shows up. */
export const DUE_WINDOW_DAYS = 3;

/**
 * Follow-ups due, new inquiries nobody has answered, accepted quotes without a
 * deposit, deposits and balances coming due, and finished events to close out.
 * One item per booking (the most pressing), most urgent first.
 */
export function privateEventAttention(today: ISODate, list: AttentionBooking[]): PrivateEventAttention[] {
  const out: PrivateEventAttention[] = [];
  for (const b of list) {
    const href = `/events/private/${b.id}`;
    const item = (kind: string, title: string, detail: string, tone: PrivateEventAttention["tone"], urgency: number) => out.push({ key: `private.${kind}.${b.id}`, title, detail, href, tone, urgency });
    if (b.stage === "LOST" || b.stage === "DONE") continue;
    const past = b.date != null && b.date < today;
    if (past) {
      item("close", `Close out ${b.title}`, b.balance > 0.005 ? `${usd(b.balance)} still owed · mark it done` : "Mark it done", b.balance > 0.005 ? "warn" : "neutral", 40);
      continue;
    }
    if ((b.stage === "INQUIRY" || b.stage === "QUOTED") && b.deposit > 0 && b.paid + 0.005 < b.deposit && b.depositDueOn && b.quoteSent && daysBetween(today, b.depositDueOn) <= DUE_WINDOW_DAYS) {
      const late = b.depositDueOn < today;
      item("deposit", `Deposit ${late ? "overdue" : "due"}: ${b.title}`, `${usd(b.deposit - b.paid)} due ${when(today, b.depositDueOn)}`, late ? "bad" : "warn", late ? 85 : 70 - daysBetween(today, b.depositDueOn));
      continue;
    }
    if ((b.stage === "DEPOSIT" || b.stage === "CONFIRMED") && b.balance > 0.005 && b.balanceDueOn && daysBetween(today, b.balanceDueOn) <= DUE_WINDOW_DAYS) {
      const late = b.balanceDueOn < today;
      item("balance", `Balance ${late ? "overdue" : "due"}: ${b.title}`, `${usd(b.balance)} due ${when(today, b.balanceDueOn)}`, late ? "bad" : "warn", late ? 80 : 65 - daysBetween(today, b.balanceDueOn));
      continue;
    }
    if (b.stage === "DEPOSIT" && b.date && daysBetween(today, b.date) <= 14) {
      item("confirm", `Confirm ${b.title}`, `Deposit's in · ${b.headcount} guests ${when(today, b.date)}`, "warn", 55);
      continue;
    }
    if (b.accepted && b.stage === "QUOTED" && b.deposit > 0 && b.paid + 0.005 < b.deposit) {
      item("accepted", `Quote accepted: ${b.title}`, `Waiting on the ${usd(b.deposit - b.paid)} deposit`, "neutral", 50);
      continue;
    }
    if (b.followUpOn && b.followUpOn <= today && (b.stage === "INQUIRY" || b.stage === "QUOTED")) {
      item("follow", `Follow up with ${b.title}`, b.followUpOn === today ? "Follow-up due today" : `Follow-up was due ${when(today, b.followUpOn)}`, b.followUpOn < today ? "warn" : "neutral", 45);
      continue;
    }
    if (b.stage === "INQUIRY" && !b.quoteSent && daysBetween(b.createdOn, today) >= 2) {
      item("reply", `Quote ${b.title}`, `Inquiry from ${when(today, b.createdOn)} has no quote yet`, "neutral", 35);
    }
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

// ---- Prep ----------------------------------------------------------------------------

export interface PrepLineInput {
  kind: string;
  recipeId: string | null;
  packageId: string | null;
  label: string;
  qty: number;
  perPerson: boolean;
}

/**
 * The portions of each recipe a booking needs: menu items at their count,
 * packages exploded into their recipes (portions per guest × headcount).
 * Custom lines without a recipe are left out (they're listed by label).
 */
export function prepPortions(headcount: number, lines: PrepLineInput[], packages: Map<string, { recipeId: string; perGuest: number }[]>): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, n: number) => n > 0 && out.set(id, cents((out.get(id) ?? 0) + n));
  for (const l of lines) {
    const units = nn(l.qty) * (l.perPerson ? Math.max(0, headcount) : 1);
    if (l.kind === "PACKAGE" && l.packageId) for (const it of packages.get(l.packageId) ?? []) add(it.recipeId, units * nn(it.perGuest));
    else if (l.recipeId) add(l.recipeId, units);
  }
  return out;
}

// ---- Public quote link ---------------------------------------------------------------

/** Quote links are 32 random bytes, base64url (43 characters). */
export const QUOTE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const isQuoteToken = (s: string | null | undefined): s is string => typeof s === "string" && QUOTE_TOKEN_RE.test(s);

/** Plain-text deposit/balance reminder to send or copy. */
export function reminderText(o: { clientName: string; eventLabel: string; amount: number; dueOn: ISODate | null; kind: "deposit" | "balance"; link: string | null; business: string }) {
  const first = o.clientName.trim().split(/\s+/)[0] || "there";
  const due = o.dueOn ? ` by ${new Date(`${o.dueOn}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}` : "";
  return [
    `Hi ${first},`,
    "",
    `A quick reminder that the ${o.kind} of $${o.amount.toFixed(2)} for ${o.eventLabel} is due${due}.`,
    o.link ? `You can see the quote here: ${o.link}` : null,
    "",
    "Thanks — we're looking forward to it.",
    o.business,
  ]
    .filter((l) => l !== null)
    .join("\n");
}
