import { describe, expect, it } from "vitest";
import { buildActions } from "../lab";
import { emptyFeedState } from "../analytics";
import type { KegStatus } from "../kegs";
import { cycles, notSeenLately, outTooLong, type Cycle, type FleetEvent, type FleetKeg, type WeekPoint } from "../kegFleet";
import { fleetLoad, fleetLoadLine, idleLine, kegAttentionItems, kegLook, kegSignalFindings, kegWeek, kegWeekLines, LOAD, loadWeeks, nagToday, outLine, SCAN_GAP, scanGap, scanGapLine, scanGapSentence, signalWeek, type KegLook } from "../kegSignals";

const STATUS: Record<string, KegStatus | null> = { FILLED: "FILLED", STORED: "COLD", TAPPED: "ON_TAP", KICKED: "KICKED", OUT: "OUT", RETURNED: "CLEANING", CLEANED: "EMPTY", EMPTIED: "EMPTY", MOVED: null };
const ev = (kegId: string, day: string, action: string, extra: Partial<FleetEvent> = {}): FleetEvent => ({ kegId, day, at: `${day}T15:00:00.000Z`, action, toStatus: STATUS[action] ?? null, beerId: null, accountId: null, ...extra });
const keg = (id: string, patch: Partial<FleetKeg> = {}): FleetKeg => ({ id, code: id, sizeId: "sixtel", status: "EMPTY", active: true, beer: null, account: null, createdDay: "2026-01-01", ...patch });

// 2026-11-16 is a Monday.
const MON = "2026-11-16";
const TUE = "2026-11-17";
const SUN = "2026-11-15";

/** The two lists as services/kegFleet hands them over, built with the fleet module itself. */
const lookFor = (kegs: FleetKeg[], events: FleetEvent[], today: string, overdueDays = 14, idleDays = 90) =>
  kegLook({ out: outTooLong(kegs, events, today, overdueDays), idle: notSeenLately(kegs, events, today, idleDays), overdueDays, idleDays });

const outKeg = (id: string, account: string, sent: string) => ({ keg: keg(id, { status: "OUT", account }), event: ev(id, sent, "OUT") });

describe("the two lists, counted", () => {
  it("is all zeros with no kegs", () => {
    const l = lookFor([], [], TUE);
    expect(l).toEqual({ overdueDays: 14, idleDays: 90, outKegs: 0, outAccounts: 0, longest: null, outNew: 0, idleKegs: 0, idleNew: 0 });
    expect(outLine(l)).toBeNull();
    expect(idleLine(l)).toBeNull();
    expect(kegAttentionItems(TUE, l)).toEqual([]);
  });
  it("counts kegs, accounts, the longest wait and the kegs that passed the line today", () => {
    const rows = [outKeg("A", "Fred's Tavern", "2025-09-01"), outKeg("B", "Fred's Tavern", "2026-11-02"), outKeg("C", "The Anchor", "2026-10-01")];
    const l = lookFor(rows.map((r) => r.keg), rows.map((r) => r.event), TUE);
    // B went out 15 days before Tuesday the 17th: its first day over a 14-day line.
    expect(l).toMatchObject({ outKegs: 3, outAccounts: 2, longest: { account: "Fred's Tavern", days: 442 }, outNew: 1 });
    expect(outLine(l)).toBe("3 kegs have been at 2 accounts for more than 14 days");
  });
  it("leaves out a keg at exactly the line, and counts it the day after", () => {
    const { keg: k, event } = outKeg("A", "The Anchor", "2026-11-03");
    expect(lookFor([k], [event], TUE).outKegs).toBe(0); // 14 days out, line is 14
    expect(lookFor([k], [event], "2026-11-18")).toMatchObject({ outKegs: 1, outNew: 1 }); // 15 days
    expect(lookFor([k], [event], "2026-11-19")).toMatchObject({ outKegs: 1, outNew: 0 }); // 16 days: no longer new
  });
  it("does the same for kegs nobody has scanned", () => {
    const k = keg("A", { status: "COLD" });
    const seen = [ev("A", "2026-08-19", "STORED")]; // 90 days before Nov 17
    expect(lookFor([k], seen, TUE).idleKegs).toBe(0);
    expect(lookFor([k], seen, "2026-11-18")).toMatchObject({ idleKegs: 1, idleNew: 1 });
    expect(lookFor([k], seen, "2026-11-19")).toMatchObject({ idleKegs: 1, idleNew: 0 });
  });
  it("words one keg, one account and no account plainly", () => {
    const one = outKeg("A", "The Anchor", "2026-10-01");
    expect(outLine(lookFor([one.keg], [one.event], TUE))).toBe("1 keg has been at The Anchor for more than 14 days");
    const two = [outKeg("A", "The Anchor", "2026-10-01"), outKeg("B", "The Anchor", "2026-10-02")];
    expect(outLine(lookFor(two.map((r) => r.keg), two.map((r) => r.event), TUE))).toBe("2 kegs have been at The Anchor for more than 14 days");
    const lost = { keg: keg("A", { status: "OUT" }), event: ev("A", "2026-10-01", "OUT") };
    expect(outLine(lookFor([lost.keg], [lost.event], TUE))).toBe("1 keg has been out, with no account recorded, for more than 14 days");
    expect(outLine(lookFor([one.keg], [one.event], TUE, 1))).toBe("1 keg has been at The Anchor for more than 1 day");
    expect(idleLine({ ...lookFor([], [], TUE), idleKegs: 1 })).toBe("1 keg hasn't been scanned in 90 days");
    expect(idleLine({ ...lookFor([], [], TUE), idleKegs: 31 })).toBe("31 kegs haven't been scanned in 90 days");
  });
});

describe("the don't-nag rule", () => {
  const standing: KegLook = { overdueDays: 14, idleDays: 90, outKegs: 20, outAccounts: 10, longest: { account: "Fred's Tavern", days: 412 }, outNew: 0, idleKegs: 31, idleNew: 0 };

  it("speaks on Mondays, and on any day something new passed the line", () => {
    expect(nagToday(MON, 0)).toBe(true);
    expect(nagToday(TUE, 0)).toBe(false);
    expect(nagToday(SUN, 0)).toBe(false);
    expect(nagToday(TUE, 1)).toBe(true);
  });
  it("always lists both for the Overview, as warnings below everything else there", () => {
    const items = kegAttentionItems(TUE, standing);
    expect(items.map((i) => i.key)).toEqual(["kegs.out", "kegs.idle"]);
    expect(items[0]).toMatchObject({ title: "20 kegs out for more than 14 days", detail: "At 10 accounts · longest: Fred's Tavern, 412 days", href: "/kegs/fleet#look", tone: "warn" });
    expect(items[1]).toMatchObject({ title: "31 kegs not scanned in 90 days", detail: "Find and scan them, or retire them", href: "/kegs/fleet#look", tone: "warn" });
    // Certificates expiring soon (30) are the lowest item the Overview had before these.
    expect(items.every((i) => i.urgency < 30)).toBe(true);
  });
  it("marks both as standing on an ordinary day, so the morning brief leaves them out", () => {
    expect(kegAttentionItems(TUE, standing).map((i) => i.standing)).toEqual([true, true]);
  });
  it("lets both through on a Monday", () => {
    expect(kegAttentionItems(MON, standing).map((i) => i.standing)).toEqual([false, false]);
  });
  it("lets through only the list that grew today, and says so", () => {
    const items = kegAttentionItems(TUE, { ...standing, outNew: 2 });
    expect(items.map((i) => i.standing)).toEqual([false, true]);
    expect(items[0].detail).toBe("2 passed 14 days today · at 10 accounts");
    expect(items[0].urgency).toBeGreaterThan(items[1].urgency);
    const idle = kegAttentionItems(TUE, { ...standing, idleNew: 1 });
    expect(idle.map((i) => i.standing)).toEqual([true, false]);
    expect(idle.find((i) => i.key === "kegs.idle")!.detail).toBe("1 passed 90 days today · find and scan them, or retire them");
  });
  it("never turns red", () => {
    for (const day of [MON, TUE]) expect(kegAttentionItems(day, { ...standing, outNew: 5, idleNew: 5 }).every((i) => i.tone === "warn")).toBe(true);
  });
  it("words a single keg", () => {
    const [out, idle] = kegAttentionItems(TUE, { ...standing, outKegs: 1, outAccounts: 1, longest: { account: "The Anchor", days: 20 }, idleKegs: 1 });
    expect(out).toMatchObject({ title: "1 keg out for more than 14 days", detail: "At The Anchor · 20 days" });
    expect(idle).toMatchObject({ title: "1 keg not scanned in 90 days", detail: "Find and scan it, or retire it" });
  });
});

describe("the week in kegs", () => {
  it("reports the week the weekly brief's recap covers", () => {
    expect(signalWeek(SUN)).toBe("2026-11-09"); // Sunday: the week ending today
    expect(signalWeek(MON)).toBe("2026-11-09"); // otherwise the Monday to Sunday before
    expect(signalWeek("2026-11-21")).toBe("2026-11-09");
    expect(signalWeek("2026-11-22")).toBe("2026-11-16");
  });
  it("is all zeros with no history", () => {
    expect(kegWeek([], [], "2026-11-09")).toEqual({ from: "2026-11-09", to: "2026-11-15", fills: 0, fillsBefore: 0, tapped: 0, sentOut: 0, returned: 0, returnedNoScan: 0 });
  });
  it("counts fills against the week before, kegs tapped and sent out, and returns with no scan", () => {
    const events = [
      // The week before: two fills.
      ev("A", "2026-11-02", "FILLED"), ev("B", "2026-11-08", "FILLED"),
      // This week: A tapped Monday and kicked Friday; B came back cleaned with no scan in between.
      ev("A", "2026-11-09", "TAPPED"), ev("A", "2026-11-13", "KICKED"),
      ev("B", "2026-11-12", "CLEANED"),
      // Three fills this week, one sent out, one tapped then moved and tapped again (still one keg).
      ev("C", "2026-11-09", "FILLED"), ev("C", "2026-11-10", "OUT", { accountId: "acc" }),
      ev("D", "2026-11-15", "FILLED"),
      ev("E", "2026-11-10", "FILLED"), ev("E", "2026-11-11", "TAPPED"), ev("E", "2026-11-12", "STORED"), ev("E", "2026-11-13", "TAPPED"),
      // The week after doesn't count.
      ev("F", "2026-11-16", "FILLED"), ev("F", "2026-11-16", "TAPPED"),
    ];
    const kegs = ["A", "B", "C", "D", "E", "F"].map((id) => keg(id));
    const w = kegWeek(events, cycles(events, kegs), "2026-11-09");
    expect(w).toEqual({ from: "2026-11-09", to: "2026-11-15", fills: 3, fillsBefore: 2, tapped: 2, sentOut: 1, returned: 2, returnedNoScan: 1 });
  });
  it("writes the week in a few plain lines, the two lists last", () => {
    const w = { from: "2026-11-09", to: "2026-11-15", fills: 12, fillsBefore: 9, tapped: 2, sentOut: 1, returned: 8, returnedNoScan: 6 };
    const l: KegLook = { overdueDays: 14, idleDays: 90, outKegs: 20, outAccounts: 10, longest: { account: "Fred's Tavern", days: 412 }, outNew: 0, idleKegs: 31, idleNew: 0 };
    expect(kegWeekLines(w, l)).toEqual([
      "12 kegs filled, up from 9 the week before.",
      "2 tapped here and 1 sent out.",
      "8 kegs came back empty, 6 of them with no tap or delivery scan.",
      "20 kegs have been at 10 accounts for more than 14 days.",
      "31 kegs haven't been scanned in 90 days.",
    ]);
  });
  it("words a quiet week, an even week and a clean record", () => {
    const zero = { from: "2026-11-09", to: "2026-11-15", fills: 0, fillsBefore: 0, tapped: 0, sentOut: 0, returned: 0, returnedNoScan: 0 };
    expect(kegWeekLines(zero, null)).toEqual(["No kegs filled, and none the week before."]);
    expect(kegWeekLines({ ...zero, fillsBefore: 4 }, null)).toEqual(["No kegs filled, after 4 the week before."]);
    expect(kegWeekLines({ ...zero, fills: 1, fillsBefore: 0, tapped: 1 }, null)).toEqual(["1 keg filled, after none the week before.", "1 tapped here and none sent out."]);
    expect(kegWeekLines({ ...zero, fills: 4, fillsBefore: 4, returned: 3 }, null)).toEqual(["4 kegs filled, the same as the week before.", "3 kegs came back empty, each with a tap or delivery scan."]);
    expect(kegWeekLines({ ...zero, fills: 2, fillsBefore: 5, returned: 1, returnedNoScan: 1 }, null)).toEqual(["2 kegs filled, down from 5 the week before.", "1 keg came back empty, with no tap or delivery scan."]);
    expect(kegWeekLines({ ...zero, fills: 2, fillsBefore: 5, returned: 2, returnedNoScan: 2 }, null)[1]).toBe("2 kegs came back empty, both with no tap or delivery scan.");
    expect(kegWeekLines({ ...zero, fills: 2, fillsBefore: 5, returned: 3, returnedNoScan: 3 }, null)[1]).toBe("3 kegs came back empty, all with no tap or delivery scan.");
  });
});

describe("the scan gap", () => {
  const cyc = (start: string, went: Cycle["went"]): Cycle => ({ kegId: "K", beerId: null, start, scannedFill: true, went, end: null, days: null });
  const mix = (none: number, others: number, start = "2026-11-01") => [...Array.from({ length: none }, () => cyc(start, "none")), ...Array.from({ length: others }, () => cyc(start, "tapped"))];

  it("is empty with no history", () => {
    expect(scanGap([], TUE)).toEqual({ days: 90, fills: 0, none: 0, tapped: 0, out: 0, stock: 0, share: null });
    expect(kegSignalFindings(scanGap([], TUE), null)).toEqual([]);
  });
  it("counts the fills of the last 90 days by where they went", () => {
    const g = scanGap([cyc("2026-11-01", "none"), cyc("2026-11-02", "none"), cyc("2026-10-01", "tapped"), cyc("2026-10-02", "out"), cyc("2026-11-10", "stock"), cyc("2026-08-19", "none"), cyc("2026-08-20", "none"), cyc("2026-11-18", "none")], TUE);
    // Aug 19 is 90 days back (outside); Aug 20 is inside; tomorrow's doesn't count.
    expect(g).toEqual({ days: 90, fills: 6, none: 3, tapped: 1, out: 1, stock: 1, share: 0.5 });
  });
  it("is one sentence for the Insights tile, and nothing when every fill was scanned", () => {
    expect(scanGapLine(scanGap(mix(0, 12), TUE))).toBeNull();
    expect(scanGapSentence(scanGap(mix(0, 12), TUE))).toBeNull();
    expect(scanGapSentence(scanGap(mix(1, 2), TUE))).toBe("1 of 3 kegs filled in the last 90 days came back with no tap or delivery scan, so the beer tax worksheet and keg yield are missing it.");
  });
  it("becomes a finding at exactly the line, and not below it", () => {
    expect(SCAN_GAP).toMatchObject({ minFills: 10, share: 0.25 });
    expect(kegSignalFindings(scanGap(mix(5, 15), TUE), null)).toHaveLength(1); // 5 of 20 = 25%
    expect(kegSignalFindings(scanGap(mix(4, 16), TUE), null)).toEqual([]); // 20%
    expect(kegSignalFindings(scanGap(mix(9, 0), TUE), null)).toEqual([]); // 9 fills: too few to say
    expect(kegSignalFindings(scanGap(mix(10, 0), TUE), null)).toHaveLength(1);
  });
  it("says what is missing and where it matters, with no dollar figure", () => {
    const [f] = kegSignalFindings(scanGap(mix(291, 73), TUE), null);
    expect(f.title).toBe("291 of 364 kegs filled in the last 90 days came back with no tap or delivery scan");
    expect(f.story?.now).toBe("291 of 364 kegs filled in the last 90 days came back with no tap or delivery scan, so the beer tax worksheet and keg yield are missing them.");
    expect(f).toMatchObject({ key: "kegs.scangap", kind: "kegs.scangap", monthly: 0, low: 0, high: 0, href: "/kegs/fleet" });
    expect(f.how.join(" ")).toContain("73 were scanned onto a tap");
  });
});

describe("fleet slack and strain", () => {
  const pt = (i: number, p: Partial<WeekPoint>): WeekPoint => ({ week: `w${i}`, full: 0, out: 0, dirty: 0, clean: 0, ...p });
  const eight = (p: Partial<WeekPoint>) => Array.from({ length: LOAD.weeks }, (_, i) => pt(i, p));

  it("looks at the eight full weeks before this one", () => {
    expect(loadWeeks(TUE)).toEqual(["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(loadWeeks(MON).at(-1)).toBe("2026-11-09");
  });
  it("says nothing with no history, too few weeks or too few kegs", () => {
    expect(fleetLoad([])).toBeNull();
    expect(fleetLoad(eight({}))).toBeNull();
    expect(fleetLoad(eight({ clean: 60, full: 40 }).slice(1))).toBeNull();
    expect(fleetLoad(eight({ clean: 6, full: 3 }))).toBeNull(); // 9 kegs
  });
  it("calls slack when more than half sat empty every week, and not at exactly half", () => {
    expect(fleetLoad(eight({ clean: 30, dirty: 20, full: 30, out: 20 }))).toBeNull(); // exactly half
    const s = fleetLoad([...eight({ clean: 31, dirty: 20, full: 29, out: 20 }).slice(1), pt(9, { clean: 40, dirty: 30, full: 20, out: 10 })]);
    expect(s).toEqual({ kind: "slack", weeks: 8, kegs: 100, atLeast: 51, latest: { week: "w9", full: 20, out: 10, dirty: 30, clean: 40 } });
  });
  it("needs every one of the weeks", () => {
    const weeks = eight({ clean: 60, full: 40 });
    weeks[3] = pt(3, { clean: 40, full: 60 });
    expect(fleetLoad(weeks)).toBeNull();
  });
  it("uses only the last eight weeks it is given", () => {
    expect(fleetLoad([pt(99, { full: 100 }), ...eight({ clean: 60, full: 40 })])?.kind).toBe("slack");
  });
  it("calls strain when nine in ten were full or out every week, from exactly nine in ten", () => {
    expect(fleetLoad(eight({ full: 50, out: 40, dirty: 5, clean: 5 }))).toMatchObject({ kind: "strain", kegs: 100, atLeast: 90 });
    expect(fleetLoad(eight({ full: 50, out: 39, dirty: 6, clean: 5 }))).toBeNull();
  });
  it("is one sentence for the Insights tile", () => {
    expect(fleetLoadLine(null)).toBeNull();
    expect(fleetLoadLine(fleetLoad(eight({ clean: 60, full: 40 })))).toBe("More than half the fleet sat empty in each of the last 8 weeks, so there are kegs to spare.");
    expect(fleetLoadLine(fleetLoad(eight({ full: 95, clean: 5 })))).toBe("Nearly every keg was full, on tap or out in each of the last 8 weeks, so there are few spare to fill.");
  });
  it("turns either into one finding that names the scans it rests on", () => {
    const none = scanGap([], TUE);
    const [slack] = kegSignalFindings(none, fleetLoad(eight({ clean: 80, dirty: 30, full: 49, out: 30 })));
    expect(slack).toMatchObject({ key: "kegs.fleet.slack", title: "More than half the keg fleet sat empty in each of the last 8 weeks", monthly: 0, href: "/kegs/fleet" });
    expect(slack.how[0]).toBe("At the end of each of the last 8 weeks, at least 110 of about 189 kegs were empty: clean, or waiting to be cleaned.");
    expect(slack.how.join(" ")).toContain("last scan");
    const [strain] = kegSignalFindings(none, fleetLoad(eight({ full: 50, out: 40, dirty: 5, clean: 5 })));
    expect(strain).toMatchObject({ key: "kegs.fleet.strain", title: "Nearly every keg was full, on tap or out in each of the last 8 weeks" });
  });
});

describe("findings for the Insights feed", () => {
  const cyc = (went: Cycle["went"]): Cycle => ({ kegId: "K", beerId: null, start: "2026-11-01", scannedFill: true, went, end: null, days: null });
  const load = fleetLoad(Array.from({ length: 8 }, (_, i) => ({ week: `w${i}`, full: 20, out: 10, dirty: 30, clean: 40 })));
  const gap = scanGap([...Array.from({ length: 30 }, () => cyc("none")), ...Array.from({ length: 10 }, () => cyc("tapped"))], TUE);

  it("gives at most two, the scan gap first", () => {
    expect(kegSignalFindings(gap, load).map((f) => f.key)).toEqual(["kegs.scangap", "kegs.fleet.slack"]);
  });
  it("survives the feed's own filters as actions, ranked at the floor below any money finding", () => {
    const money = { key: "menu.reprice.x", kind: "menu.reprice", model: "menu", title: "Reprice", action: "Do it", monthly: 60, low: 40, high: 80, confidence: 0.5, how: [], inputs: [], href: "/menu" };
    const actions = buildActions([...kegSignalFindings(gap, load), money], emptyFeedState(), TUE);
    expect(actions.map((a) => a.key).sort()).toEqual(["kegs.fleet.slack", "kegs.scangap", "menu.reprice.x"]);
    expect(actions[0].key).toBe("menu.reprice.x");
    expect(actions.find((a) => a.key === "kegs.scangap")).toMatchObject({ area: "ordering", vector: "save", value: 20 });
    // Every story has its four beats, so the deck never falls back to "About $0 a month".
    for (const f of kegSignalFindings(gap, load)) expect(f.story?.gain).toBeTruthy();
  });
});
