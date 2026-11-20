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
/**
 * A regular has gone quiet when they've been away much longer than is usual for them: two and a half times
 * their own typical gap, and never less than this many days. Someone who comes four times a year often goes
 * three months between visits; someone who comes weekly doesn't go two.
 */
export const QUIET_DAYS = 60;
export const QUIET_GAPS = 2.5;
/** Days away after which a regular who came on `days` days in a year counts as gone quiet. */
export const quietAfter = (days: number) => Math.max(QUIET_DAYS, Math.round((QUIET_GAPS * 365) / Math.max(1, days)));
/** Bumped when the way any figure is worked out changes, so the kept copy is counted again at once. */
export const GUEST_RULES = 3;
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
/** A local is seen in this many separate months; a visitor on at most this many days, all within this span. */
export const LOCAL_MONTHS = 3;
export const VISITOR_MAX_DAYS = 4;
export const VISITOR_SPAN_DAYS = 10;

/** What a card looks like from its timing alone. */
export function kindOf(g: Pick<GuestAgg, "first" | "last" | "days" | "months">, today: ISODate): Kind {
  if (g.months >= LOCAL_MONTHS) return "local";
  if (daysBetween(g.first, today) <= TOO_NEW_DAYS) return "new";
  if (g.days <= VISITOR_MAX_DAYS && daysBetween(g.first, g.last) <= VISITOR_SPAN_DAYS) return "visitor";
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
  /** Regulars of the year before who've been away far longer than is usual for them, and what they spent that year. */
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
      if (daysBetween(g.last, i.today) >= quietAfter(g.daysPrior)) {
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

export function guestStory(s: GuestSummary, rhythm?: GuestRhythm | null): GuestStory | null {
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
      title: `${n(s.quiet.guests)} regulars have gone quiet`,
      detail: `They were among ${n(s.quiet.of)} regulars in the year before, and have now been away far longer than is usual for them (at least two months, and two and a half times their own usual gap). They spent about ${usd(s.quiet.sales)} between them in that year. Some will be seasonal; some have moved on.`,
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
  if (rhythm) points.push(...rhythmPoints(rhythm));
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

// ---- When they come ----------------------------------------------------------------------------

/** For the weekday and month view a card is a local, a visitor, or in between (a brand-new card counts by what it has done so far). */
export type RhythmKind = "local" | "visitor" | "occasional";

/** Visits over the last 12 months, counted by weekday (0 = Sunday), month (1 to 12) and kind of card. */
export interface RhythmRow {
  wd: number;
  month: number;
  kind: RhythmKind;
  visits: number;
  sales: number;
}

export interface RhythmCell {
  /** The weekday (0 = Sunday) or the month (1 to 12). */
  key: number;
  /** Days open with card payments, and card sales and cards on a typical one of them. */
  openDays: number;
  salesPerDay: number;
  cardsPerDay: number;
  /** Local cards on a typical day, and locals' and visitors' share of that day's card sales. */
  localsPerDay: number;
  visitorsPerDay: number;
  localShare: number;
  visitorShare: number;
}

export interface GuestRhythm {
  /** Monday first; only weekdays open at least eight times in the year. */
  weekdays: RhythmCell[];
  /** January first; only months with at least four open days. */
  months: RhythmCell[];
}

const WEEKDAY_MIN_DAYS = 8;
/** Open on at least half the weeks of the year: a weekday the summary can speak about. */
const REGULAR_WEEKDAY_DAYS = 26;
const MONTH_MIN_DAYS = 4;

export function guestRhythm(rows: readonly RhythmRow[], open: readonly { wd: number; month: number; days: number }[]): GuestRhythm {
  const cell = (key: number, mine: (r: { wd: number; month: number }) => boolean): RhythmCell | null => {
    const openDays = open.filter(mine).reduce((s, o) => s + o.days, 0);
    const got = rows.filter(mine);
    const sales = got.reduce((s, r) => s + r.sales, 0);
    if (!openDays || sales <= 0) return null;
    const of = (k: RhythmKind) => got.filter((r) => r.kind === k);
    const sum = (xs: readonly RhythmRow[], f: (r: RhythmRow) => number) => xs.reduce((s, r) => s + f(r), 0);
    return {
      key,
      openDays,
      salesPerDay: sales / openDays,
      cardsPerDay: sum(got, (r) => r.visits) / openDays,
      localsPerDay: sum(of("local"), (r) => r.visits) / openDays,
      visitorsPerDay: sum(of("visitor"), (r) => r.visits) / openDays,
      localShare: sum(of("local"), (r) => r.sales) / sales,
      visitorShare: sum(of("visitor"), (r) => r.sales) / sales,
    };
  };
  const keep = (c: RhythmCell | null, min: number): c is RhythmCell => !!c && c.openDays >= min;
  return {
    weekdays: [1, 2, 3, 4, 5, 6, 0].map((wd) => cell(wd, (r) => r.wd === wd)).filter((c) => keep(c, WEEKDAY_MIN_DAYS)) as RhythmCell[],
    months: Array.from({ length: 12 }, (_, i) => cell(i + 1, (r) => r.month === i + 1)).filter((c) => keep(c, MONTH_MIN_DAYS)) as RhythmCell[],
  };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const per = (x: number) => (x >= 10 ? String(Math.round(x)) : (Math.round(x * 10) / 10).toString());

/** What the weekday and month view says, as an owner would put it. */
export function rhythmPoints(r: GuestRhythm): GuestPoint[] {
  const points: GuestPoint[] = [];
  // Only days the place is regularly open: a weekday open ten times in the year isn't a pattern.
  const regular = r.weekdays.filter((c) => c.openDays >= REGULAR_WEEKDAY_DAYS);
  if (regular.length >= 3) {
    const byShare = [...regular].sort((a, b) => b.localShare - a.localShare);
    const most = byShare[0];
    const least = byShare[byShare.length - 1];
    const crowd = [...regular].sort((a, b) => b.localsPerDay - a.localsPerDay)[0];
    if (most.localShare - least.localShare >= 0.08) {
      const midweek = most.key >= 1 && most.key <= 4;
      points.push({
        key: "weekdays",
        tone: "neutral",
        title: `${DAY_NAMES[most.key]}s are your most local day; ${DAY_NAMES[least.key]}s belong to visitors`,
        detail: `Locals bring ${pc(most.localShare)} of card sales on a ${DAY_NAMES[most.key]} and ${pc(least.localShare)} on a ${DAY_NAMES[least.key]}. In numbers, though, the most locals come on a ${DAY_NAMES[crowd.key]}: about ${per(crowd.localsPerDay)} local cards, against ${per(most.localsPerDay)} on a ${DAY_NAMES[most.key]}.`,
        action: midweek
          ? "Midweek is where locals decide your night. That's the audience for a weekly reason to come, and the one a membership or email list reaches."
          : "Locals and visitors share your busiest days, so a midweek night has no local habit behind it yet: one would have to be built.",
      });
    }
  }
  if (r.months.length >= 6) {
    const bySales = [...r.months].sort((a, b) => a.salesPerDay - b.salesPerDay);
    const quiet = bySales.slice(0, 3);
    const busy = bySales.slice(-3);
    const avg = (xs: RhythmCell[], f: (c: RhythmCell) => number) => xs.reduce((s, c) => s + f(c) * c.openDays, 0) / xs.reduce((s, c) => s + c.openDays, 0);
    const names = (xs: RhythmCell[]) => listOf([...xs].sort((a, b) => a.key - b.key).map((c) => MONTH_NAMES[c.key - 1]));
    const qLocals = avg(quiet, (c) => c.localsPerDay);
    const bLocals = avg(busy, (c) => c.localsPerDay);
    const qShare = avg(quiet, (c) => c.localShare);
    const bShare = avg(busy, (c) => c.localShare);
    const fewer = bLocals > 0 ? 1 - qLocals / bLocals : 0;
    points.push({
      key: "season",
      tone: fewer >= 0.2 ? "warn" : "neutral",
      title: fewer >= 0.2 ? `In your quietest months even locals come ${pc(fewer)} less` : `Locals hold steady through your quietest months; it's visitors who fall away`,
      detail: `In ${names(quiet)} a typical open day has about ${per(qLocals)} local cards and locals bring ${pc(qShare)} of card sales. In ${names(busy)} it's about ${per(bLocals)} local cards and ${pc(bShare)}.`,
      action: fewer >= 0.2 ? "That's the gap a winter membership or a standing weekly night is for: giving people who already like the place a reason to come in the cold." : "The quiet months are already a locals' business. More of them is the only lever then, since the visitors aren't in town.",
    });
  }
  return points;
}
