/**
 * What the keg fleet has to say to the rest of the app: the two "needs a
 * look" lists as one-liners for the Overview and the morning brief (with the
 * rule that keeps long-standing lists from nagging every day), the week in
 * kegs for the weekly brief, and the scan gap and fleet slack or strain for
 * Insights. Pure: no I/O; services/kegSignals.ts loads the history, and
 * domain/kegFleet does the counting this builds on.
 */

import type { AttentionItem } from "./attention";
import { addDays, weekday, type ISODate } from "./dates";
import type { Cycle, FleetEvent, IdleKeg, OutGroup, WeekPoint } from "./kegFleet";
import type { LabFinding } from "./lab";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const days = (n: number) => plural(n, "day");
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
const mondayOf = (d: ISODate): ISODate => addDays(d, -((weekday(d) + 6) % 7));

// ---- The two lists, counted -------------------------------------------------------------------

/** Where the two lists live. */
export const LOOK_HREF = "/kegs/fleet#look";
export const FLEET_HREF = "/kegs/fleet";

/** What kegFleet's outTooLong calls a keg that is out with no account on it. */
const NO_ACCOUNT = "No account recorded";

export interface KegLook {
  overdueDays: number;
  idleDays: number;
  /** Kegs out at an account for more than `overdueDays`, and how many accounts hold them. */
  outKegs: number;
  outAccounts: number;
  /** The longest wait. */
  longest: { account: string; days: number } | null;
  /** Of those, the kegs that passed the line today (their first day over it). */
  outNew: number;
  /** Kegs in service nobody has scanned for more than `idleDays`. */
  idleKegs: number;
  idleNew: number;
}

/** The two lists from kegFleet (outTooLong, notSeenLately) boiled down to counts. */
export function kegLook(i: { out: OutGroup[]; idle: IdleKeg[]; overdueDays: number; idleDays: number }): KegLook {
  const outKegs = i.out.flatMap((g) => g.kegs);
  const worst = i.out.reduce<OutGroup | null>((a, g) => (!a || g.longest > a.longest ? g : a), null);
  return {
    overdueDays: i.overdueDays,
    idleDays: i.idleDays,
    outKegs: outKegs.length,
    outAccounts: i.out.length,
    longest: worst ? { account: worst.account, days: worst.longest } : null,
    outNew: outKegs.filter((k) => k.days === i.overdueDays + 1).length,
    idleKegs: i.idle.length,
    idleNew: i.idle.filter((k) => k.days === i.idleDays + 1).length,
  };
}

/** "20 kegs have been at 10 accounts for more than 14 days"; null with none. */
export function outLine(l: KegLook): string | null {
  if (!l.outKegs) return null;
  const where = l.outAccounts > 1 ? `at ${l.outAccounts} accounts` : !l.longest || l.longest.account === NO_ACCOUNT ? "out, with no account recorded," : `at ${l.longest.account}`;
  return `${plural(l.outKegs, "keg")} ${l.outKegs === 1 ? "has" : "have"} been ${where} for more than ${days(l.overdueDays)}`;
}

/** "31 kegs haven't been scanned in 90 days"; null with none. */
export function idleLine(l: KegLook): string | null {
  if (!l.idleKegs) return null;
  return `${plural(l.idleKegs, "keg")} ${l.idleKegs === 1 ? "hasn't" : "haven't"} been scanned in ${days(l.idleDays)}`;
}

// ---- Overview and morning brief ------------------------------------------------------------------

/** The weekday the morning brief carries the standing lists (Monday, with the weekly wrap). */
export const NAG_WEEKDAY = 1;

/**
 * The don't-nag rule. A list that has been the same for months is worth a
 * line once a week, not every morning: the morning brief carries it on
 * Mondays, and on any other day only when a keg passed the line that day.
 */
export function nagToday(today: ISODate, fresh: number): boolean {
  return fresh > 0 || weekday(today) === NAG_WEEKDAY;
}

/**
 * The two lists as "Needs you" items. The Overview always shows them, as
 * warnings below everything it had before (certificates expiring soon sit at
 * 30); `standing` tells the morning brief to leave one out today.
 */
export function kegAttentionItems(today: ISODate, l: KegLook): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (l.outKegs) {
    const account = !l.longest || l.longest.account === NO_ACCOUNT ? "no account recorded" : `at ${l.longest.account}`;
    const where = l.outAccounts > 1 ? `at ${l.outAccounts} accounts` : account;
    const wait = l.longest?.days ?? 0;
    out.push({
      key: "kegs.out",
      title: `${plural(l.outKegs, "keg")} out for more than ${days(l.overdueDays)}`,
      detail: l.outNew
        ? `${l.outNew} passed ${days(l.overdueDays)} today · ${where}`
        : l.outKegs === 1
          ? `${cap(where)} · ${days(wait)}`
          : l.outAccounts === 1
            ? `${cap(where)} · longest: ${days(wait)}`
            : `${cap(where)} · longest: ${l.longest!.account}, ${days(wait)}`,
      href: LOOK_HREF,
      tone: "warn",
      urgency: l.outNew ? 44 : 26,
      standing: !nagToday(today, l.outNew),
    });
  }
  if (l.idleKegs) {
    const todo = l.idleKegs === 1 ? "find and scan it, or retire it" : "find and scan them, or retire them";
    out.push({
      key: "kegs.idle",
      title: `${plural(l.idleKegs, "keg")} not scanned in ${days(l.idleDays)}`,
      detail: l.idleNew ? `${l.idleNew} passed ${days(l.idleDays)} today · ${todo}` : cap(todo),
      href: LOOK_HREF,
      tone: "warn",
      urgency: l.idleNew ? 42 : 24,
      standing: !nagToday(today, l.idleNew),
    });
  }
  return out;
}

// ---- The week in kegs (weekly brief) ----------------------------------------------------------------

/**
 * The Monday of the week the weekly brief looks back on, the same week as its
 * "Last week vs budget" card: on a Sunday (when the brief goes out) the week
 * ending today, otherwise the Monday to Sunday before this one.
 */
export function signalWeek(today: ISODate): ISODate {
  return weekday(today) === 0 ? mondayOf(today) : addDays(mondayOf(today), -7);
}

export interface KegWeek {
  from: ISODate;
  to: ISODate;
  /** Kegs filled in the week, and in the week before it. */
  fills: number;
  fillsBefore: number;
  /** Kegs scanned onto a tap, and out to an account, in the week. */
  tapped: number;
  sentOut: number;
  /** Fills that ended in the week (kicked, returned or cleaned), and how many of those had no tap or delivery scan. */
  returned: number;
  returnedNoScan: number;
}

/** One Monday-to-Sunday week from the real scans and their cycles (kegFleet's `cycles`). */
export function kegWeek(events: FleetEvent[], cs: Cycle[], from: ISODate): KegWeek {
  const to = addDays(from, 6);
  const before = addDays(from, -7);
  const inWeek = (d: ISODate | null) => d != null && d >= from && d <= to;
  const kegsWith = (action: string) => new Set(events.filter((e) => e.action === action && inWeek(e.day)).map((e) => e.kegId)).size;
  const back = cs.filter((c) => inWeek(c.end));
  return {
    from,
    to,
    fills: cs.filter((c) => inWeek(c.start)).length,
    fillsBefore: cs.filter((c) => c.start >= before && c.start < from).length,
    tapped: kegsWith("TAPPED"),
    sentOut: kegsWith("OUT"),
    returned: back.length,
    returnedNoScan: back.filter((c) => c.went === "none").length,
  };
}

/** The week in a few plain sentences (the weekly brief's email and page share them), the two lists last. */
export function kegWeekLines(w: KegWeek, l: KegLook | null): string[] {
  const lines: string[] = [];
  const filled = `${plural(w.fills, "keg")} filled`;
  if (w.fills === 0) lines.push(w.fillsBefore === 0 ? "No kegs filled, and none the week before." : `No kegs filled, after ${w.fillsBefore} the week before.`);
  else if (w.fillsBefore === 0) lines.push(`${filled}, after none the week before.`);
  else if (w.fills === w.fillsBefore) lines.push(`${filled}, the same as the week before.`);
  else lines.push(`${filled}, ${w.fills > w.fillsBefore ? "up" : "down"} from ${w.fillsBefore} the week before.`);
  if (w.tapped + w.sentOut > 0) lines.push(`${cap(`${w.tapped || "none"}`)} tapped here and ${w.sentOut || "none"} sent out.`);
  if (w.returned > 0) {
    const n = w.returnedNoScan;
    const how = n === 0 ? `${w.returned === 1 ? "" : "each "}with a tap or delivery scan` : n < w.returned ? `${n} of them with no tap or delivery scan` : `${w.returned === 1 ? "" : w.returned === 2 ? "both " : "all "}with no tap or delivery scan`;
    lines.push(`${plural(w.returned, "keg")} came back empty, ${how}.`);
  }
  if (l) for (const line of [outLine(l), idleLine(l)]) if (line) lines.push(`${line}.`);
  return lines;
}

// ---- The scan gap -----------------------------------------------------------------------------------

/** The scan gap looks at this many days of fills, and is worth a finding from this many fills and this share. */
export const SCAN_GAP = { days: 90, minFills: 10, share: 0.25 } as const;

export interface ScanGap {
  days: number;
  /** Fills in the last `days` days. */
  fills: number;
  /** Of those: next scanned empty or filled again, with no tap or delivery scan in between. */
  none: number;
  tapped: number;
  out: number;
  /** Still full, so not yet either way. */
  stock: number;
  /** none / fills; null with no fills. */
  share: number | null;
}

/** Where the fills of the last 90 days went, by the scans (kegFleet's `cycles`). */
export function scanGap(cs: Cycle[], today: ISODate, window: number = SCAN_GAP.days): ScanGap {
  const since = addDays(today, -window);
  const g: ScanGap = { days: window, fills: 0, none: 0, tapped: 0, out: 0, stock: 0, share: null };
  for (const c of cs) {
    if (c.start <= since || c.start > today) continue;
    g.fills++;
    g[c.went]++;
  }
  g.share = g.fills ? g.none / g.fills : null;
  return g;
}

/** "291 of 364 kegs filled in the last 90 days came back with no tap or delivery scan"; null with none. */
export function scanGapLine(g: ScanGap): string | null {
  return g.none ? `${g.none} of ${plural(g.fills, "keg")} filled in the last ${days(g.days)} came back with no tap or delivery scan` : null;
}

/** The line above with why it matters, as a sentence; null with none. */
export function scanGapSentence(g: ScanGap): string | null {
  const line = scanGapLine(g);
  return line ? `${line}, so the beer tax worksheet and keg yield are missing ${g.none === 1 ? "it" : "them"}.` : null;
}

const gapIsFinding =(g: ScanGap) => g.fills >= SCAN_GAP.minFills && g.none >= g.fills * SCAN_GAP.share;

// ---- Fleet slack or strain ---------------------------------------------------------------------------

/**
 * Slack or strain is only called over this many whole weeks, with at least
 * this many kegs counted every week: slack when more than half sat empty
 * (clean or dirty) in every one of them, strain when at least nine in ten were
 * full, on tap or out in every one of them.
 */
export const LOAD = { weeks: 8, minKegs: 10 } as const;

export interface FleetLoad {
  kind: "slack" | "strain";
  weeks: number;
  /** Kegs counted in the latest week. */
  kegs: number;
  /** The fewest kegs that sat empty (slack) or were full or out (strain) in any of the weeks. */
  atLeast: number;
  latest: WeekPoint;
}

/** The Mondays of the eight whole weeks before this one (for kegFleet's `weeklyFleet`). */
export function loadWeeks(today: ISODate): ISODate[] {
  const monday = mondayOf(today);
  return Array.from({ length: LOAD.weeks }, (_, i) => addDays(monday, -7 * (LOAD.weeks - i)));
}

/** Slack, strain or neither (null), from where the fleet sat at the end of each week. Uses the last eight points. */
export function fleetLoad(points: WeekPoint[]): FleetLoad | null {
  const last = points.slice(-LOAD.weeks);
  if (last.length < LOAD.weeks) return null;
  const total = (p: WeekPoint) => p.full + p.tap + p.out + p.dirty + p.clean;
  if (last.some((p) => total(p) < LOAD.minKegs)) return null;
  const empty = (p: WeekPoint) => p.clean + p.dirty;
  const busy = (p: WeekPoint) => p.full + p.tap + p.out;
  const latest = last[last.length - 1];
  const result = (kind: FleetLoad["kind"], of: (p: WeekPoint) => number): FleetLoad => ({ kind, weeks: LOAD.weeks, kegs: total(latest), atLeast: Math.min(...last.map(of)), latest });
  if (last.every((p) => empty(p) * 2 > total(p))) return result("slack", empty);
  if (last.every((p) => busy(p) * 10 >= total(p) * 9)) return result("strain", busy);
  return null;
}

/** One sentence for the Insights tile; null with neither. */
export function fleetLoadLine(f: FleetLoad | null): string | null {
  if (!f) return null;
  return f.kind === "slack"
    ? `More than half the fleet sat empty in each of the last ${f.weeks} weeks, so there are kegs to spare.`
    : `Nearly every keg was full, on tap or out in each of the last ${f.weeks} weeks, so there are few spare to fill.`;
}

// ---- Insights findings ---------------------------------------------------------------------------------

const BY_LAST_SCAN = "A keg counts where its last scan left it, so a keg that moved without a scan is counted in the wrong place.";

/**
 * At most two findings for the Insights feed: the scan gap, and fleet slack
 * or strain. Counts of scans only, so neither carries a dollar figure (they
 * rank at the feed's floor, below money findings).
 */
export function kegSignalFindings(gap: ScanGap, load: FleetLoad | null): LabFinding[] {
  const out: LabFinding[] = [];
  const base = { model: "kegs", monthly: 0, low: 0, high: 0, href: FLEET_HREF, area: "ordering", vector: "save" } as const;
  if (gapIsFinding(gap)) {
    const title = scanGapLine(gap)!;
    const action = "Scan each keg when it goes on tap or out to an account, so the beer tax worksheet and keg yield count it.";
    out.push({
      ...base,
      key: "kegs.scangap",
      kind: "kegs.scangap",
      title,
      action,
      confidence: 0.75,
      how: [
        `Last ${days(gap.days)}: ${plural(gap.fills, "fill")} in the keg history. ${gap.tapped} ${gap.tapped === 1 ? "was" : "were"} scanned onto a tap, ${gap.out} out to an account, ${gap.stock} ${gap.stock === 1 ? "is" : "are"} still full, and ${gap.none} ${gap.none === 1 ? "was" : "were"} next scanned empty or filled again.`,
        "The beer tax worksheet counts beer as removed when a keg is tapped or sent out, and pints per keg are measured from the tap scan, so both miss these kegs.",
      ],
      inputs: [
        { label: "Fills", value: String(gap.fills) },
        { label: "No tap or delivery scan", value: String(gap.none) },
      ],
      subject: "scan-gap",
      effort: "medium",
      story: {
        now: scanGapSentence(gap)!,
        why: "Each was filled and next scanned empty, cleaned or filled again, with nothing in between.",
        todo: action,
        gain: "Beer tax numbers and pints per keg that count every keg.",
      },
    });
  }
  if (load?.kind === "slack") {
    const title = `More than half the keg fleet sat empty in each of the last ${load.weeks} weeks`;
    const action = "Use the kegs sitting empty before buying or renting more.";
    out.push({
      ...base,
      key: "kegs.fleet.slack",
      kind: "kegs.fleet.slack",
      title,
      action,
      confidence: 0.5,
      how: [`At the end of each of the last ${load.weeks} weeks, at least ${load.atLeast} of about ${load.kegs} kegs were empty: clean, or waiting to be cleaned.`, `Last week: ${load.latest.clean} clean, ${load.latest.dirty} dirty, ${load.latest.full} full and ${load.latest.tap + load.latest.out} on tap or out.`, BY_LAST_SCAN],
      inputs: [
        { label: "Kegs counted", value: String(load.kegs) },
        { label: "Empty every week", value: `${load.atLeast}+` },
      ],
      subject: "fleet",
      effort: "easy",
      story: { now: `${title}.`, why: `By the scans, at least ${load.atLeast} of about ${load.kegs} kegs were clean or waiting to be cleaned at the end of every week.`, todo: action, gain: "No money tied up in kegs you don't need." },
    });
  } else if (load?.kind === "strain") {
    const title = `Nearly every keg was full, on tap or out in each of the last ${load.weeks} weeks`;
    const action = "Get back the kegs that have been out longest, or add kegs, before a batch has nowhere to go.";
    out.push({
      ...base,
      key: "kegs.fleet.strain",
      kind: "kegs.fleet.strain",
      title,
      action,
      confidence: 0.4,
      how: [`At the end of each of the last ${load.weeks} weeks, at least ${load.atLeast} of about ${load.kegs} kegs were full, on tap or out at an account.`, `Last week: ${load.latest.full} full, ${load.latest.tap + load.latest.out} on tap or out, ${load.latest.dirty} dirty and ${load.latest.clean} clean.`, BY_LAST_SCAN],
      inputs: [
        { label: "Kegs counted", value: String(load.kegs) },
        { label: "Full or out every week", value: `${load.atLeast}+` },
      ],
      subject: "fleet",
      effort: "medium",
      story: { now: `${title}.`, why: `By the scans, at least ${load.atLeast} of about ${load.kegs} kegs were in use at the end of every week, so few were clean and ready to fill.`, todo: action, gain: "A clean keg ready whenever a batch is." },
    });
  }
  return out;
}
