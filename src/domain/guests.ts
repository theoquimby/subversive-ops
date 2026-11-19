/**
 * Who comes back. Square marks each card it sees; a card on a business day is
 * the nearest thing the till has to "a guest came in". From nothing but those
 * marks (no names, no contact details) this works out how much of the business
 * regulars carry, how many first-timers return, who looks local and who was
 * passing through, and how many regulars have stopped coming.
 *
 * Everything here is a floor, not the truth: cash leaves no mark, a phone
 * wallet and the card behind it look like two people, and so does a couple
 * who take turns paying. Trends are reliable; exact levels are not.
 *
 * Pure: plain data in, plain data out.
 */

import { addDays, daysBetween, type ISODate } from "./dates";

// ---- From payments to visits -------------------------------------------------------------

export interface GuestPayment {
  createdAt: string;
  status: string;
  cardKey: string | null;
  amountCents: number;
}

export interface VisitRow {
  date: ISODate;
  guest: string;
  payments: number;
  amount: number;
}

export interface GuestDayRow {
  date: ISODate;
  /** Completed payments, and how many carried a card that can be recognised again. */
  payments: number;
  identified: number;
  amount: number;
  identifiedAmount: number;
}

/** One row per card per business day, and per day how much of the trade carried a recognisable card. */
export function guestDays(payments: readonly GuestPayment[], dates: readonly ISODate[], dateOf: (iso: string) => ISODate): { visits: VisitRow[]; days: GuestDayRow[] } {
  const wanted = new Set(dates);
  const days = new Map<ISODate, GuestDayRow>(dates.map((d) => [d, { date: d, payments: 0, identified: 0, amount: 0, identifiedAmount: 0 }]));
  const visits = new Map<string, VisitRow>();
  for (const p of payments) {
    if (p.status !== "COMPLETED" || p.amountCents <= 0) continue;
    const date = dateOf(p.createdAt);
    if (!wanted.has(date)) continue;
    const amount = p.amountCents / 100;
    const day = days.get(date)!;
    day.payments++;
    day.amount += amount;
    if (!p.cardKey) continue;
    day.identified++;
    day.identifiedAmount += amount;
    const k = `${date}|${p.cardKey}`;
    const v = visits.get(k) ?? { date, guest: p.cardKey, payments: 0, amount: 0 };
    v.payments++;
    v.amount += amount;
    visits.set(k, v);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    visits: [...visits.values()].map((v) => ({ ...v, amount: round(v.amount) })),
    days: [...days.values()].map((d) => ({ ...d, amount: round(d.amount), identifiedAmount: round(d.identifiedAmount) })),
  };
}

// ---- From visits to the picture ------------------------------------------------------------

/** One card's history, as counted by the database. */
export interface GuestAgg {
  first: ISODate;
  /** The second day it was seen, if ever. */
  second: ISODate | null;
  last: ISODate;
  /** Days seen in all, and separate calendar months. */
  days: number;
  months: number;
  amount: number;
  /** In the last 365 days. */
  days365: number;
  amount365: number;
  /** In the year before the last 60 days: was this a regular before going quiet? */
  daysPrior: number;
  amountPrior: number;
}

/** Days in a year that make a regular (the trade's usual line: four or more). */
export const REGULAR_DAYS = 4;
/** A regular not seen for this long has gone quiet. */
export const QUIET_DAYS = 60;
/** First-timers are followed for return over the last two years. */
const COHORT_DAYS = 730;
/** A card first seen this recently hasn't had time to show what it is. */
const TOO_NEW_DAYS = 45;

export type Band = "once" | "few" | "regular" | "core";
export const BANDS: { key: Band; label: string; hint: string }[] = [
  { key: "once", label: "Came once", hint: "1 day in the last year" },
  { key: "few", label: "Came back", hint: "2 or 3 days" },
  { key: "regular", label: "Regulars", hint: "4 to 11 days" },
  { key: "core", label: "Core regulars", hint: "12 days or more" },
];
const bandOf = (days: number): Band => (days >= 12 ? "core" : days >= REGULAR_DAYS ? "regular" : days >= 2 ? "few" : "once");

export type Kind = "local" | "visitor" | "occasional" | "new";
export const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: "local", label: "Locals", hint: "Seen in three or more separate months" },
  { key: "visitor", label: "Visitors", hint: "Seen on up to four days within ten days, then not again" },
  { key: "occasional", label: "Now and then", hint: "Back more than once, but not often enough to call local" },
  { key: "new", label: "New", hint: "First seen in the last six weeks: too soon to say" },
];
/** What a card looks like from its timing alone. */
export function kindOf(g: Pick<GuestAgg, "first" | "last" | "days" | "months">, today: ISODate): Kind {
  if (g.months >= 3) return "local";
  if (daysBetween(g.first, today) <= TOO_NEW_DAYS) return "new";
  if (g.days <= 4 && daysBetween(g.first, g.last) <= 10) return "visitor";
  return "occasional";
}

export interface Share {
  guests: number;
  guestShare: number;
  sales: number;
  salesShare: number;
}

export interface ReturnRate {
  /** Days a first-timer is given to come back. */
  within: number;
  /** First-timers who have had that long, and how many did. */
  firstTimers: number;
  returned: number;
  rate: number | null;
}

export interface GuestSummary {
  asOf: ISODate;
  /** The first day with card marks on file; null with none. */
  from: ISODate | null;
  /** Cards seen in the last 365 days, and what they paid. */
  guests: number;
  sales: number;
  bands: Record<Band, Share>;
  kinds: Record<Kind, Share>;
  /** Regulars and core regulars together. */
  regulars: Share;
  returns: ReturnRate[];
  /** History doesn't reach a year before the first-timers being followed, so some "first-timers" are old regulars. */
  shallow: boolean;
  /** Regulars of the year before who haven't been seen in the last 60 days, and what they spent that year. */
  quiet: { guests: number; sales: number; of: number };
  /** Share of payments, and of money, that carried a recognisable card over the last 365 days; null with no days on file. */
  coverage: { payments: number; amount: number } | null;
}

const share = (): Share => ({ guests: 0, guestShare: 0, sales: 0, salesShare: 0 });

export function guestSummary(i: { guests: readonly GuestAgg[]; days: readonly Pick<GuestDayRow, "payments" | "identified" | "amount" | "identifiedAmount">[]; today: ISODate }): GuestSummary {
  const bands: Record<Band, Share> = { once: share(), few: share(), regular: share(), core: share() };
  const kinds: Record<Kind, Share> = { local: share(), visitor: share(), occasional: share(), new: share() };
  let from: ISODate | null = null;
  let guests = 0;
  let sales = 0;
  const cohortStart = addDays(i.today, -COHORT_DAYS);
  const returns: ReturnRate[] = [30, 90, 365].map((within) => ({ within, firstTimers: 0, returned: 0, rate: null }));
  const quiet = { guests: 0, sales: 0, of: 0 };
  const quietSince = addDays(i.today, -QUIET_DAYS);

  for (const g of i.guests) {
    if (from == null || g.first < from) from = g.first;
    if (g.days365 > 0) {
      guests++;
      sales += g.amount365;
      for (const s of [bands[bandOf(g.days365)], kinds[kindOf(g, i.today)]]) {
        s.guests++;
        s.sales += g.amount365;
      }
    }
    if (g.first >= cohortStart) {
      for (const r of returns) {
        // Only first-timers who have had the whole window to come back.
        if (daysBetween(g.first, i.today) < r.within) continue;
        r.firstTimers++;
        if (g.second && daysBetween(g.first, g.second) <= r.within) r.returned++;
      }
    }
    if (g.daysPrior >= REGULAR_DAYS) {
      quiet.of++;
      if (g.last < quietSince) {
        quiet.guests++;
        quiet.sales += g.amountPrior;
      }
    }
  }
  for (const s of [...Object.values(bands), ...Object.values(kinds)]) {
    s.guestShare = guests ? s.guests / guests : 0;
    s.salesShare = sales > 0 ? s.sales / sales : 0;
    s.sales = Math.round(s.sales);
  }
  for (const r of returns) r.rate = r.firstTimers >= 20 ? r.returned / r.firstTimers : null;
  const regulars: Share = {
    guests: bands.regular.guests + bands.core.guests,
    guestShare: bands.regular.guestShare + bands.core.guestShare,
    sales: bands.regular.sales + bands.core.sales,
    salesShare: bands.regular.salesShare + bands.core.salesShare,
  };
  const pay = i.days.reduce((s, d) => s + d.payments, 0);
  const amount = i.days.reduce((s, d) => s + d.amount, 0);
  return {
    asOf: i.today,
    from,
    guests,
    sales: Math.round(sales),
    bands,
    kinds,
    regulars,
    returns,
    shallow: from == null || from > addDays(cohortStart, -365),
    quiet: { ...quiet, sales: Math.round(quiet.sales) },
    coverage: pay > 0 && amount > 0 ? { payments: i.days.reduce((s, d) => s + d.identified, 0) / pay, amount: i.days.reduce((s, d) => s + d.identifiedAmount, 0) / amount } : null,
  };
}

// ---- In plain words --------------------------------------------------------------------------

const pc = (x: number) => `${Math.round(x * 100)}%`;
const n = (x: number) => x.toLocaleString("en-US");
const usd = (x: number) => `$${(x >= 10000 ? Math.round(x / 1000) * 1000 : Math.round(x / 100) * 100).toLocaleString("en-US")}`;

export interface GuestPoint {
  key: string;
  tone: "good" | "warn" | "bad" | "neutral";
  title: string;
  detail: string;
  action: string | null;
}

export interface GuestStory {
  headline: string;
  line: string;
  points: GuestPoint[];
}

/** Enough cards in the last year to say anything. */
export const STORY_MIN_GUESTS = 200;

export function guestStory(s: GuestSummary): GuestStory | null {
  if (s.guests < STORY_MIN_GUESTS) return null;
  const reg = s.regulars;
  const once = s.bands.once;
  const headline =
    reg.salesShare >= 0.35
      ? `A small group of regulars carries ${pc(reg.salesShare)} of card sales`
      : reg.salesShare >= 0.15
        ? `Regulars bring ${pc(reg.salesShare)} of card sales; most of the rest is one-time visits`
        : `Most card sales come from people seen once or twice`;
  const line = `Over the last year ${n(s.guests)} different cards paid here. ${n(reg.guests)} of them (${pc(reg.guestShare)}) came on four or more days and brought ${pc(reg.salesShare)} of card sales. ${pc(once.guestShare)} came on one day only and brought ${pc(once.salesShare)}.`;

  const points: GuestPoint[] = [];
  if (s.quiet.guests >= 5) {
    points.push({
      key: "quiet",
      tone: s.quiet.guests / Math.max(1, s.quiet.of) >= 0.25 ? "bad" : "warn",
      title: `${n(s.quiet.guests)} regulars haven't been in for two months`,
      detail: `They were among ${n(s.quiet.of)} regulars in the year before, and spent about ${usd(s.quiet.sales)} between them in that year. Some of that is the season; some have moved on.`,
      action: "Ops knows them only as cards, so there's no way to reach them. A membership or an email list is what would let you.",
    });
  }
  const r90 = s.returns.find((r) => r.within === 90);
  const r365 = s.returns.find((r) => r.within === 365);
  if (r90?.rate != null) {
    points.push({
      key: "returns",
      tone: r90.rate >= 0.25 ? "good" : r90.rate >= 0.12 ? "neutral" : "warn",
      title: `${pc(r90.rate)} of first-time cards come back within three months`,
      detail: `${n(r90.returned)} of ${n(r90.firstTimers)} first-timers.${r365?.rate != null ? ` Within a year it's ${pc(r365.rate)}.` : ""}${s.shallow ? " Some of these \"first-timers\" are old regulars seen for the first time since the history starts, so the true figure is a little lower." : ""}`,
      action: "This is the number to watch when you try something for locals: it moves before sales do.",
    });
  }
  const v = s.kinds.visitor;
  const l = s.kinds.local;
  if (v.guests + l.guests >= 50) {
    points.push({
      key: "kinds",
      tone: "neutral",
      title: `Locals are ${pc(l.guestShare)} of cards and ${pc(l.salesShare)} of card sales; visitors ${pc(v.guestShare)} and ${pc(v.salesShare)}`,
      detail: "Going by timing alone: a card seen in three or more separate months is a local, one seen on a few days within ten days and never again is a visitor. The rest come now and then, or are too new to say.",
      action: v.salesShare > l.salesShare ? "Visitors bring the bigger share, so being easy to find and well reviewed matters most." : "Locals bring the bigger share, so what keeps them coming through the slow months matters most.",
    });
  }
  if (s.coverage) {
    points.push({
      key: "coverage",
      tone: "neutral",
      title: `${pc(s.coverage.amount)} of what's paid carries a card Ops can recognise again`,
      detail: "Cash leaves no mark, a phone wallet and the card behind it look like two people, and a couple who take turns paying look like two. So the repeat figures here are a floor: the real ones are higher.",
      action: null,
    });
  }
  return { headline, line, points };
}
