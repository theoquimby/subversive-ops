import { describe, expect, it } from "vitest";
import type { FleetEvent } from "../kegFleet";
import type { KegStatus } from "../kegs";
import {
  accountNumbers,
  accountRows,
  accountsSnapshot,
  deliveriesByMonth,
  deliveryHistory,
  kegsOut,
  movements,
  presetRange,
  stays,
  staysAt,
  takenByBeer,
  twelveMonthsFrom,
  volumeReport,
  type AccountInfo,
  type AccountKeg,
} from "../kegAccounts";

const STATUS: Record<string, KegStatus | null> = { CREATED: "EMPTY", FILLED: "FILLED", STORED: "COLD", TAPPED: "ON_TAP", KICKED: "KICKED", OUT: "OUT", RETURNED: "CLEANING", CLEANED: "EMPTY", EMPTIED: "EMPTY", MOVED: null, NOTE: null };

/** ev("A", "2026-03-02", "OUT", { accountId: "bar" }) */
const ev = (kegId: string, day: string, action: string, extra: Partial<FleetEvent> = {}): FleetEvent => ({ kegId, day, at: `${day}T15:00:00.000Z`, action, toStatus: STATUS[action] ?? null, beerId: null, accountId: null, ...extra });
const keg = (id: string, patch: Partial<AccountKeg> = {}): AccountKeg => ({ id, code: id, sizeId: "sixtel", status: "EMPTY", active: true, beer: null, account: null, createdDay: "2026-01-01", accountId: null, beerId: null, ...patch });
const acct = (id: string, patch: Partial<AccountInfo> = {}): AccountInfo => ({ id, name: id, kind: "bar", active: true, ...patch });
const out = (kegId: string, day: string, accountId: string | null, beerId: string | null = null) => ev(kegId, day, "OUT", { accountId, beerId });

const TODAY = "2026-06-15";
/** Half barrels are 15.5 gallons, so two of them make one barrel. */
const gallonsOf = (kegId: string) => (kegId.startsWith("H") ? 15.5 : 5);

describe("stays: one for each delivery", () => {
  it("is empty with no history", () => {
    expect(stays([])).toEqual([]);
  });

  it("leaves a delivery open until the keg is scanned back", () => {
    expect(stays([ev("A", "2026-03-01", "FILLED", { beerId: "ipa" }), out("A", "2026-03-03", "bar", "ipa")])).toEqual([
      { kegId: "A", accountId: "bar", beerId: "ipa", out: "2026-03-03", at: "2026-03-03T15:00:00.000Z", back: null, ended: null, days: null },
    ]);
  });

  it("ends a stay when the keg is scanned back", () => {
    const [s] = stays([out("A", "2026-03-03", "bar"), ev("A", "2026-03-24", "RETURNED", { accountId: "bar" })]);
    expect(s).toMatchObject({ back: "2026-03-24", ended: "back", days: 21 });
  });

  it("ends a stay at a kick, clean, empty or fill when the return was never scanned", () => {
    for (const action of ["KICKED", "CLEANED", "EMPTIED", "FILLED"]) {
      const [s] = stays([out("A", "2026-03-03", "bar"), ev("A", "2026-03-10", "NOTE"), ev("A", "2026-03-13", action), ev("A", "2026-03-20", "CLEANED")]);
      expect(s, action).toMatchObject({ back: "2026-03-13", ended: "back", days: 10 });
    }
  });

  it("does not end a stay at a note or a move", () => {
    const [s] = stays([out("A", "2026-03-03", "bar"), ev("A", "2026-03-10", "NOTE"), ev("A", "2026-03-11", "MOVED")]);
    expect(s.back).toBeNull();
  });

  it("counts a keg delivered twice to the same account as two deliveries", () => {
    const list = stays([out("A", "2026-03-03", "bar"), ev("A", "2026-03-24", "RETURNED"), ev("A", "2026-04-01", "FILLED"), out("A", "2026-04-02", "bar")]);
    expect(list.map((s) => [s.out, s.back, s.ended])).toEqual([["2026-03-03", "2026-03-24", "back"], ["2026-04-02", null, null]]);
  });

  it("ends a stay when the keg is next seen going to a different account, with no return scan", () => {
    const list = stays([out("A", "2026-03-03", "bar"), out("A", "2026-04-10", "cafe")]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ accountId: "bar", back: "2026-04-10", ended: "resent", days: 38 });
    expect(list[1]).toMatchObject({ accountId: "cafe", back: null, ended: null });
  });

  it("treats a later delivery to the same account with no scan in between as a new delivery", () => {
    const list = stays([out("A", "2026-03-03", "bar"), out("A", "2026-04-10", "bar")]);
    expect(list.map((s) => [s.out, s.back, s.ended])).toEqual([["2026-03-03", "2026-04-10", "resent"], ["2026-04-10", null, null]]);
  });

  it("treats a second scan out to the same account on the same day as one delivery", () => {
    const list = stays([out("A", "2026-03-03", "bar"), { ...out("A", "2026-03-03", "bar"), at: "2026-03-03T15:05:00.000Z" }]);
    expect(list).toHaveLength(1);
  });

  it("takes the beer from the fill when the delivery scan has none", () => {
    const list = stays([ev("A", "2026-03-01", "FILLED", { beerId: "ipa" }), out("A", "2026-03-03", "bar"), ev("A", "2026-03-20", "RETURNED"), out("A", "2026-04-01", "bar")]);
    expect(list.map((s) => s.beerId)).toEqual(["ipa", null]);
  });

  it("reads each keg's scans in time order, whatever order they arrive in", () => {
    const list = stays([ev("A", "2026-03-24", "RETURNED"), out("B", "2026-03-10", "bar"), out("A", "2026-03-03", "bar")]);
    expect(list.map((s) => [s.kegId, s.out, s.back])).toEqual([["A", "2026-03-03", "2026-03-24"], ["B", "2026-03-10", null]]);
  });

  it("picks one account's stays", () => {
    const list = stays([out("A", "2026-03-03", "bar"), out("B", "2026-03-04", "cafe"), out("C", "2026-03-05", null)]);
    expect(staysAt(list, "bar").map((s) => s.kegId)).toEqual(["A"]);
    expect(staysAt(list, "nobody")).toEqual([]);
  });
});

describe("kegs out right now", () => {
  it("counts the days from the latest delivery scan", () => {
    const kegs = [keg("A", { status: "OUT", accountId: "bar", beer: "IPA", beerId: "ipa" })];
    expect(kegsOut(kegs, [out("A", "2026-03-03", "bar"), ev("A", "2026-03-20", "RETURNED"), out("A", "2026-06-01", "bar"), ev("A", "2026-06-05", "NOTE")], TODAY)).toEqual([
      { id: "A", code: "A", sizeId: "sixtel", beer: "IPA", beerId: "ipa", accountId: "bar", since: "2026-06-01", days: 14 },
    ]);
  });

  it("falls back to the day a never-scanned keg was added", () => {
    expect(kegsOut([keg("A", { status: "OUT", accountId: "bar", createdDay: "2026-06-05" })], [], TODAY)[0]).toMatchObject({ since: "2026-06-05", days: 10 });
  });

  it("leaves out retired kegs and kegs that are not out", () => {
    const kegs = [keg("A", { status: "OUT", accountId: "bar", active: false }), keg("B", { status: "COLD" }), keg("C", { status: "OUT", accountId: null })];
    expect(kegsOut(kegs, [out("A", "2026-03-03", "bar"), out("C", "2026-06-10", null)], TODAY).map((k) => k.id)).toEqual(["C"]);
  });

  it("lists the longest wait first", () => {
    const kegs = [keg("A", { status: "OUT", accountId: "bar" }), keg("B", { status: "OUT", accountId: "bar" })];
    expect(kegsOut(kegs, [out("A", "2026-06-10", "bar"), out("B", "2026-01-10", "bar")], TODAY).map((k) => k.id)).toEqual(["B", "A"]);
  });

  it("is empty with no kegs", () => {
    expect(kegsOut([], [], TODAY)).toEqual([]);
  });
});

describe("the last 12 months", () => {
  it("starts on the first of the month, eleven months back", () => {
    expect(twelveMonthsFrom("2026-06-15")).toBe("2025-07-01");
    expect(twelveMonthsFrom("2026-12-31")).toBe("2026-01-01");
    expect(twelveMonthsFrom("2026-01-01")).toBe("2025-02-01");
  });
});

describe("the accounts list", () => {
  const events = [
    // Bar: one old delivery that came back, one this year still there.
    out("A", "2024-02-01", "bar"), ev("A", "2024-03-01", "RETURNED"), out("A", "2026-05-01", "bar"),
    // Cafe: two kegs there, one for a long time.
    out("B", "2025-01-10", "cafe"), out("C", "2026-06-10", "cafe"),
    // A retired keg that went to the diner and was never seen again.
    out("R", "2025-12-01", "diner"),
  ];
  const kegs = [
    keg("A", { status: "OUT", accountId: "bar" }),
    keg("B", { status: "OUT", accountId: "cafe" }),
    keg("C", { status: "OUT", accountId: "cafe" }),
    keg("R", { status: "OUT", accountId: "diner", active: false }),
  ];
  const accounts = [acct("diner"), acct("bar"), acct("cafe"), acct("quiet"), acct("zed", { active: false })];
  const rows = accountRows(accounts, stays(events), kegsOut(kegs, events, TODAY), TODAY, 14);

  it("sorts by kegs there now, then by name", () => {
    expect(rows.map((r) => r.id)).toEqual(["cafe", "bar", "diner", "quiet", "zed"]);
  });

  it("counts kegs there, the longest wait and deliveries", () => {
    expect(rows[0]).toEqual({ id: "cafe", name: "cafe", kind: "bar", active: true, kegsOut: 2, longestDays: 521, overdue: true, deliveries12: 1, lastDelivery: "2026-06-10", deliveries: 2 });
    expect(rows[1]).toMatchObject({ id: "bar", kegsOut: 1, longestDays: 45, overdue: true, deliveries12: 1, lastDelivery: "2026-05-01", deliveries: 2 });
  });

  it("does not warn at or under the limit", () => {
    const r = accountRows([acct("bar")], [], kegsOut([keg("A", { status: "OUT", accountId: "bar" })], [out("A", "2026-06-01", "bar")], TODAY), TODAY, 14);
    expect(r[0]).toMatchObject({ longestDays: 14, overdue: false });
  });

  it("keeps a retired keg's deliveries but does not count it as there now", () => {
    expect(rows.find((r) => r.id === "diner")).toMatchObject({ kegsOut: 0, longestDays: null, overdue: false, deliveries12: 1, deliveries: 1 });
  });

  it("shows an account with no history as all zeros", () => {
    expect(rows.find((r) => r.id === "quiet")).toEqual({ id: "quiet", name: "quiet", kind: "bar", active: true, kegsOut: 0, longestDays: null, overdue: false, deliveries12: 0, lastDelivery: null, deliveries: 0 });
  });

  it("is empty with no accounts", () => {
    expect(accountRows([], [], [], TODAY, 14)).toEqual([]);
  });
});

describe("one account's numbers", () => {
  it("adds up the last 12 months and finds the middle stay", () => {
    const events = [
      out("H1", "2024-01-01", "bar"), ev("H1", "2024-01-11", "RETURNED"), // 10 days, before the 12 months
      out("H1", "2025-07-01", "bar"), ev("H1", "2025-07-21", "RETURNED"), // 20 days, first day of the 12 months
      out("H2", "2026-01-05", "bar"), ev("H2", "2026-03-06", "KICKED"), // 60 days
      out("S1", "2026-06-01", "bar"), // still there
      out("S2", "2025-06-30", "bar"), out("S2", "2025-09-01", "cafe"), // just before the 12 months; no return scan
    ];
    const kegs = [keg("S1", { status: "OUT", accountId: "bar" })];
    const mine = staysAt(stays(events), "bar");
    expect(accountNumbers(mine, kegsOut(kegs, events, TODAY), gallonsOf, TODAY)).toEqual({ kegsOut: 1, deliveries12: 3, gallons12: 36, medianDays: 20, returns: 3 });
  });

  it("averages the two middle stays when there is an even number", () => {
    const mine = stays([out("A", "2026-01-01", "bar"), ev("A", "2026-01-11", "RETURNED"), out("A", "2026-02-01", "bar"), ev("A", "2026-02-16", "RETURNED")]);
    expect(accountNumbers(mine, [], gallonsOf, TODAY).medianDays).toBe(13);
  });

  it("has no middle stay until a keg has come back", () => {
    expect(accountNumbers(stays([out("A", "2026-06-01", "bar")]), [], gallonsOf, TODAY)).toMatchObject({ medianDays: null, returns: 0 });
  });

  it("is all zeros for an account with no history", () => {
    expect(accountNumbers([], [], gallonsOf, TODAY)).toEqual({ kegsOut: 0, deliveries12: 0, gallons12: 0, medianDays: null, returns: 0 });
  });
});

describe("deliveries each month", () => {
  it("counts kegs and gallons in the month they went out, with empty months as zero", () => {
    const mine = stays([out("H1", "2026-03-03", "bar"), ev("H1", "2026-03-20", "RETURNED"), out("H1", "2026-03-28", "bar"), out("S1", "2026-05-02", "bar"), out("S2", "2025-12-31", "bar")]);
    expect(deliveriesByMonth(mine, ["2026-03", "2026-04", "2026-05"], gallonsOf)).toEqual([
      { month: "2026-03", kegs: 2, gallons: 31 },
      { month: "2026-04", kegs: 0, gallons: 0 },
      { month: "2026-05", kegs: 1, gallons: 5 },
    ]);
  });

  it("is all zeros with no deliveries, and empty with no months", () => {
    expect(deliveriesByMonth([], ["2026-03"], gallonsOf)).toEqual([{ month: "2026-03", kegs: 0, gallons: 0 }]);
    expect(deliveriesByMonth([], [], gallonsOf)).toEqual([]);
  });
});

describe("what an account takes", () => {
  const mine = stays([
    out("H1", "2025-03-03", "bar", "ipa"), ev("H1", "2025-03-20", "RETURNED"),
    out("H1", "2026-03-28", "bar", "ipa"),
    out("S1", "2026-05-02", "bar", "pils"),
    out("S2", "2026-05-03", "bar"),
    out("S3", "2026-05-04", "bar", "pils"),
  ]);

  it("groups deliveries by beer, the most delivered first", () => {
    expect(takenByBeer(mine, gallonsOf)).toEqual([
      { beerId: "ipa", deliveries: 2, gallons: 31, last: "2026-03-28" },
      { beerId: "pils", deliveries: 2, gallons: 10, last: "2026-05-04" },
      { beerId: null, deliveries: 1, gallons: 5, last: "2026-05-03" },
    ]);
  });

  it("can start from a date", () => {
    expect(takenByBeer(mine, gallonsOf, "2026-01-01").map((b) => [b.beerId, b.deliveries])).toEqual([["pils", 2], ["ipa", 1], [null, 1]]);
  });

  it("is empty with no deliveries", () => {
    expect(takenByBeer([], gallonsOf)).toEqual([]);
  });
});

describe("delivery history", () => {
  const events = [
    out("A", "2026-01-05", "bar"), ev("A", "2026-01-25", "RETURNED"),
    out("A", "2026-06-05", "bar"),
    out("B", "2026-02-01", "bar"), out("B", "2026-03-01", "cafe"),
    out("R", "2026-04-01", "bar"),
  ];
  const kegs = [keg("A", { status: "OUT", accountId: "bar" }), keg("B", { status: "OUT", accountId: "cafe" }), keg("R", { status: "OUT", accountId: "bar", active: false })];
  const mine = staysAt(stays(events), "bar");
  const there = new Set(kegsOut(kegs, events, TODAY).filter((k) => k.accountId === "bar").map((k) => k.id));

  it("lists the most recent delivery first and says how each one ended", () => {
    const h = deliveryHistory(mine, there, TODAY);
    expect(h.total).toBe(4);
    expect(h.rows.map((r) => [r.kegId, r.out, r.state, r.back, r.daysKept])).toEqual([
      ["A", "2026-06-05", "there", null, 10],
      ["R", "2026-04-01", "unknown", null, null],
      ["B", "2026-02-01", "resent", "2026-03-01", null],
      ["A", "2026-01-05", "back", "2026-01-25", 20],
    ]);
  });

  it("caps the list and still reports the full count", () => {
    const h = deliveryHistory(mine, there, TODAY, 2);
    expect(h.rows).toHaveLength(2);
    expect(h.total).toBe(4);
  });

  it("is empty for an account with no history", () => {
    expect(deliveryHistory([], new Set(), TODAY)).toEqual({ rows: [], total: 0 });
  });
});

describe("report date ranges", () => {
  const first = "2022-08-17";
  it("covers each preset, ending today for the ones still running", () => {
    expect(presetRange("this-month", "2026-06-15", first)).toEqual({ from: "2026-06-01", to: "2026-06-15" });
    expect(presetRange("last-month", "2026-06-15", first)).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    expect(presetRange("this-quarter", "2026-06-15", first)).toEqual({ from: "2026-04-01", to: "2026-06-15" });
    expect(presetRange("last-quarter", "2026-06-15", first)).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(presetRange("this-year", "2026-06-15", first)).toEqual({ from: "2026-01-01", to: "2026-06-15" });
    expect(presetRange("last-year", "2026-06-15", first)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(presetRange("all", "2026-06-15", first)).toEqual({ from: "2022-08-17", to: "2026-06-15" });
  });

  it("crosses the year end", () => {
    expect(presetRange("last-month", "2026-01-10", first)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("last-quarter", "2026-02-10", first)).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(presetRange("last-month", "2024-03-31", first)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("is just today for all time with no history", () => {
    expect(presetRange("all", "2026-06-15", null)).toEqual({ from: "2026-06-15", to: "2026-06-15" });
  });
});

describe("volume by where the beer went", () => {
  const events = [
    // H1: filled, tapped, taken off, tapped again, kicked. One tap.
    ev("H1", "2026-03-01", "FILLED", { beerId: "ipa" }), ev("H1", "2026-03-05", "TAPPED", { beerId: "ipa" }), ev("H1", "2026-03-06", "MOVED"), ev("H1", "2026-03-08", "TAPPED", { beerId: "ipa" }), ev("H1", "2026-03-20", "KICKED"),
    // H1 again: cleaned, filled, tapped next month.
    ev("H1", "2026-03-21", "CLEANED"), ev("H1", "2026-03-25", "FILLED", { beerId: "ipa" }), ev("H1", "2026-04-02", "TAPPED", { beerId: "ipa" }),
    // H2: filled and sent to the bar.
    ev("H2", "2026-03-02", "FILLED", { beerId: "pils" }), out("H2", "2026-03-10", "bar", "pils"), ev("H2", "2026-03-30", "RETURNED"),
    // S1: filled, then back dirty with no tap or delivery scan.
    ev("S1", "2026-03-03", "FILLED", { beerId: "pils" }), ev("S1", "2026-03-25", "CLEANED"),
    // S2: filled and still full, so it is stock and not counted.
    ev("S2", "2026-03-04", "FILLED", { beerId: "ipa" }),
    // S3: sent to the cafe with no fill scan and no beer recorded.
    out("S3", "2026-03-15", "cafe"),
  ];
  const kegs = [keg("H1", { status: "ON_TAP" }), keg("H2"), keg("S1"), keg("S2", { status: "FILLED" }), keg("S3", { status: "OUT", accountId: "cafe" })];
  const moves = movements(events, kegs);

  it("lists one movement for each first tap, delivery and unscanned fill", () => {
    expect(moves.map((m) => [m.kind, m.day, m.kegId, m.beerId, m.accountId])).toEqual([
      ["none", "2026-03-03", "S1", "pils", null],
      ["tapped", "2026-03-05", "H1", "ipa", null],
      ["out", "2026-03-10", "H2", "pils", "bar"],
      ["out", "2026-03-15", "S3", null, "cafe"],
      ["tapped", "2026-04-02", "H1", "ipa", null],
    ]);
  });

  it("totals kegs and gallons inside the dates, with both ends included", () => {
    const r = volumeReport(moves, "2026-03-05", "2026-03-15", gallonsOf);
    expect(r.tapped).toEqual({ kegs: 1, gallons: 15.5 });
    expect(r.out).toEqual({ kegs: 2, gallons: 20.5 });
    expect(r.none).toEqual({ kegs: 0, gallons: 0 });
    expect(r.total).toEqual({ kegs: 3, gallons: 36 });
  });

  it("breaks the volume down by beer, the biggest first", () => {
    const r = volumeReport(moves, "2026-03-01", "2026-04-30", gallonsOf);
    expect(r.byBeer).toEqual([
      { beerId: "ipa", tapped: { kegs: 2, gallons: 31 }, out: { kegs: 0, gallons: 0 }, none: { kegs: 0, gallons: 0 }, total: { kegs: 2, gallons: 31 } },
      { beerId: "pils", tapped: { kegs: 0, gallons: 0 }, out: { kegs: 1, gallons: 15.5 }, none: { kegs: 1, gallons: 5 }, total: { kegs: 2, gallons: 20.5 } },
      { beerId: null, tapped: { kegs: 0, gallons: 0 }, out: { kegs: 1, gallons: 5 }, none: { kegs: 0, gallons: 0 }, total: { kegs: 1, gallons: 5 } },
    ]);
  });

  it("breaks deliveries down by account", () => {
    const r = volumeReport(moves, "2026-03-01", "2026-04-30", gallonsOf);
    expect(r.byAccount).toEqual([
      { accountId: "bar", kegs: 1, gallons: 15.5 },
      { accountId: "cafe", kegs: 1, gallons: 5 },
    ]);
  });

  it("matches the account's own delivery count for the same dates", () => {
    const r = volumeReport(moves, "2026-03-01", "2026-03-31", gallonsOf);
    const bar = staysAt(stays(events), "bar").filter((s) => s.out >= "2026-03-01" && s.out <= "2026-03-31");
    expect(r.byAccount.find((a) => a.accountId === "bar")?.kegs).toBe(bar.length);
  });

  it("is all zeros with nothing in the dates, and with no history at all", () => {
    const zero = { kegs: 0, gallons: 0 };
    expect(volumeReport(moves, "2025-01-01", "2025-12-31", gallonsOf)).toEqual({ tapped: zero, out: zero, none: zero, total: zero, byBeer: [], byAccount: [] });
    expect(movements([], [])).toEqual([]);
    expect(volumeReport([], "2026-01-01", "2026-12-31", gallonsOf)).toEqual({ tapped: zero, out: zero, none: zero, total: zero, byBeer: [], byAccount: [] });
  });
});

describe("kegs at accounts", () => {
  const events = [out("A", "2026-01-01", "bar"), out("B", "2026-06-10", "bar"), out("C", "2026-05-01", "cafe"), out("D", "2026-06-14", null), out("R", "2025-01-01", "bar")];
  const kegs = [
    keg("A", { status: "OUT", accountId: "bar", sizeId: "half" }),
    keg("B", { status: "OUT", accountId: "bar" }),
    keg("C", { status: "OUT", accountId: "cafe" }),
    keg("D", { status: "OUT", accountId: null }),
    keg("R", { status: "OUT", accountId: "bar", active: false }),
  ];
  const names: Record<string, string> = { bar: "The Bar", cafe: "Cafe" };
  const nameOf = (id: string | null) => (id ? names[id] ?? "Unknown" : "No account recorded");
  const snap = accountsSnapshot(kegsOut(kegs, events, TODAY), 30, nameOf);

  it("lists every account with kegs out, the most kegs first, and counts the ones out too long", () => {
    expect(snap.rows).toEqual([
      { accountId: "bar", name: "The Bar", total: 2, over: 1, longest: 165, bySize: { half: 1, sixtel: 1 } },
      { accountId: "cafe", name: "Cafe", total: 1, over: 1, longest: 45, bySize: { half: 0, sixtel: 1 } },
      { accountId: null, name: "No account recorded", total: 1, over: 0, longest: 1, bySize: { half: 0, sixtel: 1 } },
    ]);
  });

  it("totals every column, sizes in the usual order", () => {
    expect(snap.sizes).toEqual(["half", "sixtel"]);
    expect(snap.all).toEqual({ total: 4, over: 2, bySize: { half: 1, sixtel: 3 } });
  });

  it("counts a keg as over only past the number of days, not on it", () => {
    expect(accountsSnapshot(kegsOut(kegs, events, TODAY), 45, nameOf).rows.find((r) => r.accountId === "cafe")?.over).toBe(0);
    expect(accountsSnapshot(kegsOut(kegs, events, TODAY), 44, nameOf).rows.find((r) => r.accountId === "cafe")?.over).toBe(1);
  });

  it("is empty with no kegs out", () => {
    expect(accountsSnapshot([], 14, nameOf)).toEqual({ sizes: [], rows: [], all: { total: 0, over: 0, bySize: {} } });
  });
});
