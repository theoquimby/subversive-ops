import { describe, expect, it } from "vitest";
import { BREW_PROFILES as TIMING } from "../brewProfiles";
import {
  BREW_PROFILES,
  brewDayProfiles,
  PROFILE_KEYS,
  cleanFieldValue,
  clock,
  finishDefaults,
  forecastDates,
  hopAdditions,
  hopsDue,
  logRows,
  newBrewLog,
  newerLog,
  pauseTimer,
  profileDays,
  readBrewLog,
  readProfiles,
  resetTimer,
  snapToWeekday,
  stageProgress,
  startTimer,
  timerElapsed,
  timerView,
  whatsMissing,
} from "../brewDay";
import { weekday } from "../dates";

describe("timing profiles", () => {
  it("turn into recipe days", () => {
    expect(profileDays(BREW_PROFILES.hazy)).toEqual({ dryHopDay: 7, fermentDays: 20, conditionDays: 3, tapDay: 30 });
    expect(profileDays(BREW_PROFILES.lager)).toEqual({ dryHopDay: null, fermentDays: 49, conditionDays: 3, tapDay: 60 });
    expect(profileDays(BREW_PROFILES.sour).conditionDays).toBe(4);
  });

  it("snap transfers to Mon/Tue and packaging to Wednesday, like Brew Manager", () => {
    // 2026-01-16 is a Friday. +20 = Thu Feb 5 → Tue Feb 3 (2 back beats Mon Feb 9, 4 on).
    expect(weekday("2026-01-16")).toBe(5);
    expect(snapToWeekday("2026-01-16", 20, [1, 2])).toBe("2026-02-03");
    // +23 = Sun Feb 8 → Wed Feb 11 (3 on; Wed Feb 4 is 4 back, outside the window).
    expect(snapToWeekday("2026-01-16", 23, [3])).toBe("2026-02-11");
    // Already on a preferred day: stays.
    expect(snapToWeekday("2026-02-02", 0, [1, 2])).toBe("2026-02-02");
    // A tie (Mon 3 back and… nothing 3 on): earlier wins on equal distance.
    expect(snapToWeekday("2026-02-05", 0, [1, 0])).toBe("2026-02-02");
  });

  it("forecast every date for a hazy brew", () => {
    expect(forecastDates("2026-01-16", BREW_PROFILES.hazy)).toEqual({
      brewDay: "2026-01-16",
      dryHop: "2026-01-23",
      fvTransfer: null,
      brite: "2026-02-03",
      pkg: "2026-02-11",
      tap: "2026-02-15",
    });
    const lager = forecastDates("2026-01-22", BREW_PROFILES.lager);
    expect(lager.fvTransfer).not.toBeNull();
    expect([1, 2]).toContain(weekday(lager.fvTransfer!));
    expect(weekday(lager.pkg)).toBe(3);
    expect(lager.tap).toBe("2026-03-23");
  });

  it("are the same profiles as the schedule's, with the brewery's weekdays", () => {
    for (const k of PROFILE_KEYS) {
      expect(BREW_PROFILES[k]).toMatchObject({ label: TIMING[k].label, brite: TIMING[k].brite, pkg: TIMING[k].pkg, tap: TIMING[k].tap });
      expect(BREW_PROFILES[k].dryHop ?? null).toBe(TIMING[k].dryHop);
      expect(BREW_PROFILES[k].fvTransfer ?? null).toBe(TIMING[k].fvTransfer);
    }
    expect(BREW_PROFILES.hazy).toMatchObject({ briteDay: [1, 2], pkgDay: [3] });
    const thursdays = brewDayProfiles({ transferDays: [4], packageDays: [4] });
    expect(thursdays.pale).toMatchObject({ briteDay: [4], pkgDay: [4] });
    expect(weekday(forecastDates("2026-01-16", thursdays.hazy).pkg)).toBe(4);
  });

  it("read Brew Manager's own profiles, dropping broken ones", () => {
    const p = readProfiles({ hazy: { label: "Hazy", dryHop: 6, brite: 19, pkg: 22, tap: 29, briteDay: [1, 2], pkgDay: [3] }, sour: { brite: "x" }, weird: { brite: 1, pkg: 2, tap: 3 } });
    expect(p.hazy).toMatchObject({ label: "Hazy", dryHop: 6, brite: 19 });
    expect(p.sour).toBeUndefined();
    expect(Object.keys(p)).toEqual(["hazy"]);
    expect(readProfiles(null)).toEqual({});
  });
});

describe("what a dev beer still needs", () => {
  it("lists suppliers, gravity targets, a batch size and artwork", () => {
    const items = whatsMissing({ lines: [{ name: "Pale malt", kind: "grain", hasSupplier: true }, { name: "Simcoe", kind: "hop", hasSupplier: false }], targetOg: 1.06, targetFg: null, batchBbl: 7, artworkDone: false });
    expect(items.map((i) => [i.id, i.done])).toEqual([["suppliers", false], ["gravity", false], ["batch", true], ["artwork", false]]);
    expect(items[0].detail).toBe("No supplier yet: Simcoe.");
    expect(items[1].detail).toBe("No target FG yet.");
    const done = whatsMissing({ lines: [{ name: "Pale malt", kind: "grain", hasSupplier: true }], targetOg: 1.06, targetFg: 1.01, batchBbl: 7, artworkDone: true });
    expect(done.every((i) => i.done)).toBe(true);
    expect(whatsMissing({ lines: [], targetOg: null, targetFg: null, batchBbl: null, artworkDone: false })[0].detail).toBe("No ingredients yet.");
  });
});

describe("brew-day log", () => {
  const now = new Date("2026-11-16T14:00:00Z");

  it("reads back what was stored and drops what doesn't fit", () => {
    const log = readBrewLog({
      startedAt: "2026-11-16T13:00:00Z",
      savedAt: "2026-11-16T13:30:00Z",
      stage: "boil",
      values: { mash: { strikeF: 165, mashF: "152", mtSg: 1.5, ph: 5.3, startTime: "7:05", bogus: 1 }, boil: { ogSg: 1.0633, boilStart: "25:00" } },
      notes: { mash: "Stuck a bit" },
      timers: { mash: { startedAt: 1000, elapsedMs: 50, targetMin: 60 }, boil: { startedAt: "x", elapsedMs: -5, targetMin: 9999 } },
      hops: { "0|citra|boil|60": "2026-11-16T13:40:00Z", bad: 3 },
    })!;
    expect(log.stage).toBe("boil");
    expect(log.values.mash).toEqual({ strikeF: 165, mashF: 152, ph: 5.3, startTime: "07:05" });
    expect(log.values.boil).toEqual({ ogSg: 1.0633 });
    expect(log.notes.mash).toBe("Stuck a bit");
    expect(log.notes.boil).toBe("");
    expect(log.timers.mash).toEqual({ startedAt: 1000, elapsedMs: 50, targetMin: 60 });
    expect(log.timers.boil).toEqual({ startedAt: null, elapsedMs: 0, targetMin: null });
    expect(log.hops).toEqual({ "0|citra|boil|60": "2026-11-16T13:40:00Z" });
    expect(readBrewLog(null)).toBeNull();
    expect(readBrewLog([])).toBeNull();
    expect(readBrewLog({})!.stage).toBe("mash");
  });

  it("cleans single values", () => {
    expect(cleanFieldValue("temp", "152.5")).toBe(152.5);
    expect(cleanFieldValue("temp", 500)).toBeNull();
    expect(cleanFieldValue("count", 4.6)).toBe(5);
    expect(cleanFieldValue("time", "9:5")).toBeNull();
    expect(cleanFieldValue("gravity", "")).toBeNull();
  });

  it("keeps the copy changed last", () => {
    const a = { ...newBrewLog(now), savedAt: "2026-11-16T14:00:00Z" };
    const b = { ...newBrewLog(now), savedAt: "2026-11-16T14:05:00Z" };
    expect(newerLog(a, b)).toBe(b);
    expect(newerLog(b, a)).toBe(b);
    expect(newerLog(null, a)).toBe(a);
    expect(newerLog(a, null)).toBe(a);
  });

  it("counts readings per stage and lists them for printing", () => {
    const log = newBrewLog(now);
    log.values.mash = { strikeF: 165, mtSg: 1.0821 };
    log.notes.boil = "Boil-over at 10 min";
    expect(stageProgress(log)).toEqual({ mash: 2, lauter: 0, boil: 1, ferment: 0, package: 0 });
    const rows = logRows(log, "plato");
    expect(rows[0].rows).toEqual([["Strike temp", "165 °F"], ["MT gravity", "19.8 °P"]]);
    expect(rows[2].notes).toBe("Boil-over at 10 min");
    expect(logRows(log, "sg")[0].rows[1]).toEqual(["MT gravity", "1.082"]);
  });

  it("finishes with the boil's OG, or the KO gravity, and the post-boil volume", () => {
    const log = newBrewLog(now);
    expect(finishDefaults(log, { bbl: 7 })).toEqual({ og: null, bbl: 7 });
    log.values.boil = { koSg: 1.062, postboilBbl: 7.5 };
    expect(finishDefaults(log, { bbl: 7 })).toEqual({ og: 1.062, bbl: 7.5 });
    log.values.boil.ogSg = 1.063;
    expect(finishDefaults(log, { bbl: 7 }).og).toBe(1.063);
    expect(finishDefaults(null, { bbl: null })).toEqual({ og: null, bbl: null });
  });
});

describe("timers", () => {
  it("survive a reload: start time, not ticks", () => {
    let t = startTimer(undefined, 1_000, 60);
    expect(timerElapsed(t, 61_000)).toBe(60_000);
    t = pauseTimer(t, 61_000)!;
    expect(t).toEqual({ startedAt: null, elapsedMs: 60_000, targetMin: 60 });
    expect(timerElapsed(t, 999_999)).toBe(60_000);
    t = startTimer(t, 100_000, 90);
    expect(t.targetMin).toBe(60);
    expect(timerElapsed(t, 160_000)).toBe(120_000);
    expect(startTimer(t, 200_000, 60)).toBe(t);
    expect(resetTimer(t, 30)).toEqual({ startedAt: null, elapsedMs: 0, targetMin: 60 });
    expect(resetTimer(undefined, 30)).toEqual({ startedAt: null, elapsedMs: 0, targetMin: 30 });
  });

  it("count down, then show time over", () => {
    const t = { startedAt: 0, elapsedMs: 0, targetMin: 60 };
    expect(timerView(t, 15 * 60_000).text).toBe("45:00");
    expect(timerView(t, 61 * 60_000)).toMatchObject({ text: "+1:00", over: true });
    expect(timerView({ startedAt: null, elapsedMs: 3_723_000, targetMin: null }, 0).text).toBe("1:02:03");
    expect(timerView(undefined, 0).text).toBe("0:00");
    expect(clock(59_999)).toBe("0:59");
  });
});

describe("hop additions", () => {
  const lines = [
    { kind: "grain", name: "Pils", qty: 400, unit: "lb", use: null, minutes: null },
    { kind: "hop", name: "Citra", qty: 6, unit: "lb", use: "dryhop", minutes: null },
    { kind: "hop", name: "Magnum", qty: 1.5, unit: "lb", use: "boil", minutes: 60 },
    { kind: "hop", name: "Citra", qty: 4, unit: "lb", use: "whirlpool", minutes: 20 },
    { kind: "hop", name: "Saaz", qty: 2, unit: "lb", use: "boil", minutes: 15 },
    { kind: "hop", name: "Saaz", qty: 1, unit: "lb", use: "firstwort", minutes: null },
  ];

  it("go in order with when each goes in", () => {
    const a = hopAdditions(lines, 60, 7);
    expect(a.map((h) => `${h.name} ${h.when}`)).toEqual(["Saaz First wort", "Magnum 60 min", "Saaz 15 min", "Citra Whirlpool, 20 min", "Citra Dry hop, day 7"]);
    expect(a.map((h) => h.atBoilMinute)).toEqual([0, 0, 45, null, null]);
    expect(a[1].key).toBe("1|magnum|boil|60");
  });

  it("say which are due and not ticked", () => {
    const a = hopAdditions(lines, 60);
    expect(hopsDue(a, {}, 10).map((h) => h.name)).toEqual(["Saaz", "Magnum"]);
    expect(hopsDue(a, { [a[1].key]: "x" }, 50).map((h) => h.when)).toEqual(["First wort", "15 min"]);
  });
});
