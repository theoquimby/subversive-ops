import { describe, expect, it } from "vitest";
import {
  BREW_PROFILES,
  brewTiming,
  DEFAULT_SNAP,
  guessProfile,
  packageAfter,
  parseWeekdays,
  profileLabel,
  releaseMessage,
  snapToDays,
  weekdaysText,
  type TimingSource,
} from "../brewProfiles";
import { weekday } from "../dates";

// 2026-11-16 is a Monday.
const MON = "2026-11-16";
const THU = "2026-11-19";

const src = (over: Partial<TimingSource> = {}): TimingSource => ({ profile: null, dryHopDay: null, tapDay: null, fermentDays: 14, conditionDays: 7, ...over });

describe("Brew Manager's profiles", () => {
  it("keeps its four timings, in days from brew day", () => {
    expect(BREW_PROFILES.hazy).toMatchObject({ dryHop: 7, brite: 20, pkg: 23, tap: 30, fvTransfer: null });
    expect(BREW_PROFILES.sour).toMatchObject({ dryHop: null, brite: 38, pkg: 42, tap: 49 });
    expect(BREW_PROFILES.lager).toMatchObject({ fvTransfer: 21, brite: 49, pkg: 52, tap: 60 });
    expect(BREW_PROFILES.pale).toMatchObject({ brite: 32, pkg: 35, tap: 42 });
  });

  it("guesses a profile from the style and name the way Brew Manager does", () => {
    expect(guessProfile("NYIPA", "NY Nectar")).toBe("hazy");
    expect(guessProfile("IPA", "New York Nectar")).toBe("hazy");
    expect(guessProfile("Hazy IPA", "Camp Comet")).toBe("hazy");
    expect(guessProfile("Farmhouse", "Pickle Beer")).toBe("sour");
    expect(guessProfile("Sour", null)).toBe("sour");
    expect(guessProfile("Märzen", "Marzen")).toBe("lager");
    expect(guessProfile("Pilsner", "Puff Puff Pils")).toBe("lager");
    expect(guessProfile("Festbier", null)).toBe("lager");
    expect(guessProfile("Kölsch", "Tiny Glasses")).toBe("pale");
    expect(guessProfile(null, null)).toBe("pale");
  });

  it("labels known and custom profiles", () => {
    expect(profileLabel("hazy")).toBe("Hazy IPA");
    expect(profileLabel("barrel")).toBe("barrel");
    expect(profileLabel(null)).toBe("Recipe days");
  });
});

describe("weekday snapping", () => {
  it("leaves a day that is already allowed", () => {
    expect(snapToDays("2026-11-17", [1, 2])).toBe("2026-11-17");
  });

  it("moves to the nearest allowed day within three days", () => {
    // Wed → Tue (one back) for Mon/Tue transfers.
    expect(snapToDays("2026-11-18", [1, 2])).toBe("2026-11-17");
    // Sat → Mon (two ahead): Fri and Thu aren't allowed.
    expect(snapToDays("2026-11-21", [1, 2])).toBe("2026-11-23");
    // Sun → Wed (three ahead) for Wednesday packaging.
    expect(snapToDays("2026-11-22", [3])).toBe("2026-11-25");
  });

  it("takes the earlier day when two are equally near", () => {
    // Thu: Tue is two back and Sat two ahead; the earlier one wins.
    expect(snapToDays(THU, [2, 6])).toBe("2026-11-17");
  });

  it("keeps the day when nothing allowed is within reach, or nothing is allowed", () => {
    expect(snapToDays(THU, [])).toBe(THU);
    expect(snapToDays(THU, [1], 2)).toBe(THU);
  });

  it("puts packaging after the transfer even when snapping would pull it back", () => {
    // Transfer Tue 17th, nominal packaging Thu 19th → Wed 18th: after the transfer, fine.
    expect(packageAfter("2026-11-17", "2026-11-19", [3])).toBe("2026-11-18");
    // Transfer Wed 18th, nominal Fri 20th → snaps back to Wed 18th (same day): next Wednesday instead.
    expect(packageAfter("2026-11-18", "2026-11-20", [3])).toBe("2026-11-25");
    // No days set: the nominal day.
    expect(packageAfter("2026-11-18", "2026-11-20", [])).toBe("2026-11-20");
  });

  it("reads and writes weekday settings", () => {
    expect(parseWeekdays("1,2", [3])).toEqual([1, 2]);
    expect(parseWeekdays(" 3 , 3, 9, x", [1])).toEqual([3]);
    expect(parseWeekdays("", [3])).toEqual([3]);
    expect(parseWeekdays(null, [1, 2])).toEqual([1, 2]);
    expect(parseWeekdays("none", [1])).toEqual([]);
    expect(weekdaysText([1, 2])).toBe("Mon or Tue");
    expect(weekdaysText([3])).toBe("Wed");
    expect(weekdaysText([1, 2, 4])).toBe("Mon, Tue or Thu");
    expect(weekdaysText([])).toBe("any day");
  });
});

describe("brewTiming", () => {
  it("dates a hazy brew: dry hop and release as counted, transfer and packaging on brewery days", () => {
    const t = brewTiming(THU, src({ profile: "hazy" }), DEFAULT_SNAP);
    expect(t.profile).toBe("hazy");
    expect(t.dryHopOn).toBe("2026-11-26"); // day 7, not snapped
    expect(t.transferOn).toBe("2026-12-08"); // day 20 is Wed Dec 9 → Tue Dec 8
    expect(weekday(t.transferOn)).toBe(2);
    expect(t.packageOn).toBe("2026-12-09"); // day 23 is Sat Dec 12 → Wed Dec 9
    expect(weekday(t.packageOn)).toBe(3);
    expect(t.tapOn).toBe("2026-12-19"); // day 30
    expect(t.fermentDays).toBe(19);
    expect(t.conditionDays).toBe(1);
    expect(t.fvTransferOn).toBeNull();
    expect(t.tapDays).toBe(30);
  });

  it("gives a lager its fermenter-to-fermenter move too", () => {
    const t = brewTiming(MON, src({ profile: "lager" }), DEFAULT_SNAP);
    expect(t.fvTransferOn).toBe("2026-12-07"); // day 21 is Mon
    expect(t.transferOn).toBe("2027-01-04"); // day 49 is Mon Jan 4
    expect(t.packageOn).toBe("2027-01-06"); // day 52 Thu Jan 7 → Wed Jan 6
    expect(t.tapOn).toBe("2027-01-15");
    expect(t.dryHopOn).toBeNull();
  });

  it("lets a recipe's own dry-hop and release days win over its profile", () => {
    const t = brewTiming(MON, src({ profile: "hazy", dryHopDay: 5, tapDay: 28 }), DEFAULT_SNAP);
    expect(t.dryHopOn).toBe("2026-11-21");
    expect(t.tapOn).toBe("2026-12-14");
  });

  it("uses the recipe's days when it has no profile (or one Ops doesn't know)", () => {
    for (const profile of [null, "barrel"]) {
      const t = brewTiming(MON, src({ profile, fermentDays: 14, conditionDays: 7 }), DEFAULT_SNAP);
      expect(t.profile).toBeNull();
      expect(t.transferOn).toBe("2026-11-30"); // day 14, a Monday
      expect(t.packageOn).toBe("2026-12-09"); // day 21 Mon Dec 7 → Wed Dec 9 (two ahead)
      expect(t.tapOn).toBe("2026-12-14"); // packaging day 21 + 7, counted from brew day
      expect(t.dryHopOn).toBeNull();
    }
  });

  it("packages straight from the fermenter when there are no conditioning days", () => {
    const t = brewTiming(MON, src({ fermentDays: 10, conditionDays: 0 }), DEFAULT_SNAP);
    expect(t.transferOn).toBe(t.packageOn);
    expect(t.conditionDays).toBe(0);
    expect(weekday(t.packageOn)).toBe(3);
  });

  it("never snaps a transfer onto or before brew day", () => {
    const t = brewTiming(MON, src({ fermentDays: 1, conditionDays: 1 }), { transferDays: [6], packageDays: [3] });
    expect(t.transferOn > MON).toBe(true);
    expect(t.packageOn > t.transferOn).toBe(true);
  });

  it("does no snapping when no days are set", () => {
    const t = brewTiming(THU, src({ profile: "hazy" }), { transferDays: [], packageDays: [] });
    expect(t.transferOn).toBe("2026-12-09");
    expect(t.packageOn).toBe("2026-12-12");
  });

  it("keeps a locked release and says when the brew day can't make it", () => {
    const locked = "2026-12-19"; // hazy brewed Thu Nov 19 → release day 30
    const ok = brewTiming(THU, src({ profile: "hazy" }), DEFAULT_SNAP, locked);
    expect(ok.tapOn).toBe(locked);
    expect(ok.release).toEqual({ locked: true, ok: true, brewBy: "2026-11-19" });
    const early = brewTiming("2026-11-16", src({ profile: "hazy" }), DEFAULT_SNAP, locked);
    expect(early.tapOn).toBe(locked);
    expect(early.release.ok).toBe(true);
    const late = brewTiming("2026-11-23", src({ profile: "hazy" }), DEFAULT_SNAP, locked);
    expect(late.tapOn).toBe(locked);
    expect(late.release).toEqual({ locked: true, ok: false, brewBy: "2026-11-19" });
    expect(releaseMessage(late.release, locked)).toBe("Brew by Nov 19 to keep the release on Dec 19.");
    expect(releaseMessage(ok.release, locked)).toBeNull();
    const free = brewTiming(THU, src({ profile: "hazy" }), DEFAULT_SNAP);
    expect(free.release).toEqual({ locked: false, ok: true, brewBy: null });
  });
});
